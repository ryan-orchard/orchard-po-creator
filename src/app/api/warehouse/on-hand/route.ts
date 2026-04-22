import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { SKU_MAPPING } from "@/lib/client-config";

import unitCostData from "@/../clients/magna/config/unit-costs-2026-02.json";

const UNIT_COSTS: Record<string, number> = unitCostData as Record<string, number>;

// Reverse mapping: standardSku → stordSku (for unit cost lookup by standard SKU)
const STANDARD_TO_STORD: Record<string, string> = {};
for (const [stordSku, mapping] of Object.entries(SKU_MAPPING)) {
  if (mapping?.standardSku) {
    STANDARD_TO_STORD[mapping.standardSku] = stordSku;
  }
}

const STORD_BASE_URL = "https://api-next.stord.com/v1";

interface StordFacilityBalance {
  sku: string;
  name: string;
  facility_alias: string;
  facility_id: string;
  brand: string;
  base_unit: string;
  available: string;
  allocated: string;
  locked: string;
  incoming: string;
  damaged: string;
  quarantined: string;
  receiving: string;
  other: string;
  total_on_hand: string;
  inventory_alerts: {
    out_of_stock: boolean;
    reorder_warning: boolean;
  };
}

export interface OnHandItem {
  standardSku: string;
  stordSku: string | null;
  category: string | null;
  productName: string;
  warehouse: string;
  totalOnHand: number;
  incoming: number;
  unitCost: number | null;
  extendedValue: number | null;
}

export interface WarehouseInfo {
  code: string;
  name: string;
  sourceType: "api" | "calculated" | "snapshot";
  sourceLabel: string;
  asOf: string | null;
}

export interface OnHandResponse {
  items: OnHandItem[];
  summary: {
    totalSkus: number;
    totalOnHand: number;
    totalValue: number;
    totalIncoming: number;
  };
  warehouses: WarehouseInfo[];
  costEffectiveDate: string;
  fetchedAt: string;
}

// --- Stord API fetch (unchanged) ---

async function fetchStordInventory(
  apiKey: string,
  orgId: string,
  networkId: string
): Promise<StordFacilityBalance[]> {
  const results: StordFacilityBalance[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("after", cursor);

    const url = `${STORD_BASE_URL}/organizations/${orgId}/oms/networks/${networkId}/inventory/reports/facilities?${params}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Stord API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    results.push(...(data.data ?? []));
    cursor = data.metadata?.after ?? null;
  } while (cursor);

  return results;
}

function mapStordToOnHand(
  balances: StordFacilityBalance[],
  categoryByStandardSku: Map<string, string>,
  nameByStandardSku: Map<string, string>
): OnHandItem[] {
  return balances.map((b) => {
    const mapping = SKU_MAPPING[b.sku];
    const standardSku = mapping?.standardSku || b.sku;
    const totalOnHand = parseInt(b.total_on_hand) || 0;
    const incoming = parseInt(b.incoming) || 0;
    const unitCost = UNIT_COSTS[b.sku] ?? null;
    const extendedValue =
      unitCost !== null && totalOnHand > 0
        ? Math.round(unitCost * totalOnHand * 100) / 100
        : null;
    const category = categoryByStandardSku.get(standardSku) ?? null;

    return {
      standardSku,
      stordSku: b.sku,
      category,
      productName: nameByStandardSku.get(standardSku) || b.name,
      warehouse: "STORD",
      totalOnHand,
      incoming,
      unitCost,
      extendedValue,
    };
  });
}

// --- ANS calculated from Supabase receipts + work orders ---

async function fetchANSInventory(
  itemMap: Map<string, { sku: string; uom: string }>
): Promise<OnHandItem[]> {
  // Find ANS warehouse id
  const { data: warehouse } = await db
    .schema("org_config")
    .from("warehouses")
    .select("id")
    .eq("code", "ANS")
    .maybeSingle();

  if (!warehouse) return [];
  const ansWarehouseId = warehouse.id as string;

  // Fetch ANS receipts and work orders in parallel
  const [receiptsResult, wosResult] = await Promise.all([
    db.schema("orchard").from("receipts").select("id").eq("location_id", ansWarehouseId),
    db
      .schema("orchard")
      .from("work_orders")
      .select("id")
      .eq("location_id", ansWarehouseId)
      .eq("status", "Completed"),
  ]);

  const ansReceiptIds = (receiptsResult.data ?? []).map((r) => r.id as string);
  const ansWOIds = (wosResult.data ?? []).map((wo) => wo.id as string);

  const qtyByItemId = new Map<string, number>();

  // Add received quantities from ANS receipts
  if (ansReceiptIds.length > 0) {
    const { data: receiptLines } = await db
      .schema("orchard")
      .from("receipt_lines")
      .select("item_id, qty_received")
      .in("receipt_id", ansReceiptIds);

    for (const line of receiptLines ?? []) {
      const itemId = line.item_id as string;
      if (!itemId) continue;
      const qty = Number(line.qty_received) || 0;
      qtyByItemId.set(itemId, (qtyByItemId.get(itemId) || 0) + qty);
    }
  }

  // Adjust for completed WOs at ANS: subtract inputs, add outputs
  if (ansWOIds.length > 0) {
    const { data: woLines } = await db
      .schema("orchard")
      .from("work_order_lines")
      .select("item_id, qty, line_type")
      .in("wo_id", ansWOIds);

    for (const line of woLines ?? []) {
      const itemId = line.item_id as string;
      if (!itemId) continue;
      const qty = Number(line.qty) || 0;
      const lineType = line.line_type as string;
      if (lineType === "Input") {
        qtyByItemId.set(itemId, (qtyByItemId.get(itemId) || 0) - qty);
      } else if (lineType === "Output") {
        qtyByItemId.set(itemId, (qtyByItemId.get(itemId) || 0) + qty);
      }
    }
  }

  // Convert to OnHandItem[]
  const items: OnHandItem[] = [];
  for (const [itemId, qty] of qtyByItemId) {
    if (qty <= 0) continue;
    const itemInfo = itemMap.get(itemId);
    const standardSku = itemInfo?.sku || itemId;
    const stordSku = STANDARD_TO_STORD[standardSku] || null;
    const unitCost = stordSku ? (UNIT_COSTS[stordSku] ?? null) : null;
    const extendedValue =
      unitCost !== null && qty > 0 ? Math.round(unitCost * qty * 100) / 100 : null;

    items.push({
      standardSku,
      stordSku,
      category: null, // will be enriched below
      productName: standardSku, // will be enriched below
      warehouse: "ANS",
      totalOnHand: qty,
      incoming: 0,
      unitCost,
      extendedValue,
    });
  }

  return items;
}

// Server-side cache: 24 hours (Stord API only — ANS always fresh from Supabase)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let stordCachedItems: OnHandItem[] | null = null;
let stordCachedAt = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "1";
  const warehouseFilter = (searchParams.get("warehouse") || "all").toUpperCase();

  try {
    // Fetch all items from org_config (including metadata for name/category)
    const { data: allItemsRaw } = await db
      .schema("org_config")
      .from("items")
      .select("id, sku, uom, metadata");

    const itemMap = new Map(
      (allItemsRaw ?? []).map((i) => [i.id as string, { sku: i.sku as string, uom: i.uom as string }])
    );
    const categoryByStandardSku = new Map<string, string>();
    const nameByStandardSku = new Map<string, string>();
    for (const item of allItemsRaw ?? []) {
      const meta = item.metadata as Record<string, unknown> | null;
      const sku = item.sku as string;
      if (meta?.category) categoryByStandardSku.set(sku, meta.category as string);
      if (meta?.flavor) nameByStandardSku.set(sku, meta.flavor as string);
    }

    const includeStord = warehouseFilter === "ALL" || warehouseFilter === "STORD";
    const includeANS = warehouseFilter === "ALL" || warehouseFilter === "ANS";
    const includeBMC = warehouseFilter === "ALL" || warehouseFilter === "BMC";

    let stordItems: OnHandItem[] = [];
    let ansItems: OnHandItem[] = [];
    const bmcItems: OnHandItem[] = []; // BMC snapshot not yet migrated to Supabase
    let bmcSnapshotDate: string | null = null;

    const fetches: Promise<void>[] = [];

    if (includeStord) {
      const useStordCache = !forceRefresh && stordCachedItems && Date.now() - stordCachedAt < CACHE_TTL_MS;
      if (useStordCache) {
        stordItems = stordCachedItems!;
      } else {
        const apiKey = process.env.STORD_API_KEY;
        const orgId = process.env.STORD_ORG_ID;
        const networkId = process.env.STORD_NETWORK_ID;
        if (apiKey && orgId && networkId) {
          fetches.push(
            fetchStordInventory(apiKey, orgId, networkId).then((balances) => {
              stordItems = mapStordToOnHand(balances, categoryByStandardSku, nameByStandardSku);
              stordCachedItems = stordItems;
              stordCachedAt = Date.now();
            })
          );
        }
      }
    }

    if (includeANS) {
      fetches.push(
        fetchANSInventory(itemMap).then((items) => {
          ansItems = items;
        })
      );
    }

    await Promise.all(fetches);

    // Enrich all items with category/name from item metadata
    const allRaw = [...stordItems, ...ansItems, ...bmcItems];
    for (const item of allRaw) {
      if (!item.category) item.category = categoryByStandardSku.get(item.standardSku) ?? null;
      if (!item.productName || item.productName === item.standardSku) {
        item.productName = nameByStandardSku.get(item.standardSku) || item.standardSku;
      }
    }

    const allOnHand = allRaw.sort((a, b) =>
      a.standardSku.localeCompare(b.standardSku)
    );

    const summary = {
      totalSkus: new Set(allOnHand.map((i) => i.standardSku)).size,
      totalOnHand: allOnHand.reduce((sum, i) => sum + i.totalOnHand, 0),
      totalValue: allOnHand.reduce((sum, i) => sum + (i.extendedValue ?? 0), 0),
      totalIncoming: allOnHand.reduce((sum, i) => sum + i.incoming, 0),
    };

    const warehouses: WarehouseInfo[] = [];
    if (includeStord) {
      warehouses.push({
        code: "STORD",
        name: "Stord",
        sourceType: "api",
        sourceLabel: "Live from Stord API",
        asOf: new Date().toISOString(),
      });
    }
    if (includeANS) {
      warehouses.push({
        code: "ANS",
        name: "ANS",
        sourceType: "calculated",
        sourceLabel: "Calculated from receipts + work orders",
        asOf: new Date().toISOString(),
      });
    }
    if (includeBMC) {
      warehouses.push({
        code: "BMC",
        name: "BMC",
        sourceType: "snapshot",
        sourceLabel: bmcSnapshotDate ? `Snapshot from ${bmcSnapshotDate}` : "No snapshot loaded",
        asOf: bmcSnapshotDate,
      });
    }

    const response: OnHandResponse = {
      items: allOnHand,
      summary,
      warehouses,
      costEffectiveDate: "2026-02-28",
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("On-hand inventory fetch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}
