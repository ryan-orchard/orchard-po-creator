import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { SKU_MAPPING } from "@/lib/client-config";

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
  nameByStandardSku: Map<string, string>,
  unitCostBySku: Map<string, number>
): OnHandItem[] {
  return balances.map((b) => {
    const mapping = SKU_MAPPING[b.sku];
    const standardSku = mapping?.standardSku || b.sku;
    const totalOnHand = parseInt(b.total_on_hand) || 0;
    const incoming = parseInt(b.incoming) || 0;
    const unitCost = unitCostBySku.get(standardSku) ?? null;
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

// Server-side cache: 24 hours (Stord API only)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let stordCachedItems: OnHandItem[] | null = null;
let stordCachedAt = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "1";
  const warehouseFilter = (searchParams.get("warehouse") || "all").toUpperCase();

  try {
    // Fetch all items from org_config
    const { data: allItemsRaw } = await db
      .schema("org_config")
      .from("items")
      .select("id, sku, name, unit_of_measure, category");

    const categoryByStandardSku = new Map<string, string>();
    const nameByStandardSku = new Map<string, string>();
    const itemIdBySku = new Map<string, string>();
    for (const item of allItemsRaw ?? []) {
      const sku = item.sku as string;
      if (item.category) categoryByStandardSku.set(sku, item.category as string);
      if (item.name) nameByStandardSku.set(sku, item.name as string);
      itemIdBySku.set(sku, item.id as string);
    }

    // Fetch latest unit cost per item from item_costs table
    const unitCostByItemId = new Map<string, number>();
    const { data: costRows } = await db
      .schema("orchard")
      .from("item_costs")
      .select("item_id, unit_cost, effective_date")
      .order("effective_date", { ascending: false });

    // Keep only the most recent cost per item
    for (const row of costRows ?? []) {
      const itemId = row.item_id as string;
      if (!unitCostByItemId.has(itemId)) {
        unitCostByItemId.set(itemId, Number(row.unit_cost));
      }
    }

    // Build sku → unit cost lookup
    const unitCostBySku = new Map<string, number>();
    for (const [sku, itemId] of itemIdBySku) {
      const cost = unitCostByItemId.get(itemId);
      if (cost != null) unitCostBySku.set(sku, cost);
    }

    const includeStord = warehouseFilter === "ALL" || warehouseFilter === "STORD";
    const includeBMC = warehouseFilter === "ALL" || warehouseFilter === "BMC";

    let stordItems: OnHandItem[] = [];
    let bmcItems: OnHandItem[] = [];
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
              stordItems = mapStordToOnHand(balances, categoryByStandardSku, nameByStandardSku, unitCostBySku);
              stordCachedItems = stordItems;
              stordCachedAt = Date.now();
            })
          );
        }
      }
    }

    if (includeBMC) {
      fetches.push(
        (async () => {
          // Fetch the most recent BMC snapshot from Supabase
          const { data: latestSnapshot } = await db
            .schema("orchard")
            .from("inventory_snapshots")
            .select("snapshot_date")
            .eq("warehouse_code", "BMC")
            .order("snapshot_date", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (latestSnapshot) {
            bmcSnapshotDate = latestSnapshot.snapshot_date as string;
            const { data: snapRows } = await db
              .schema("orchard")
              .from("inventory_snapshots")
              .select("*")
              .eq("warehouse_code", "BMC")
              .eq("snapshot_date", bmcSnapshotDate);

            bmcItems = (snapRows || []).map((row) => {
              const sku = row.sku as string;
              const onHand = Number(row.qty_on_hand) || 0;
              const unitCost = unitCostBySku.get(sku) ?? null;
              return {
                standardSku: sku,
                stordSku: null,
                category: categoryByStandardSku.get(sku) ?? null,
                productName: nameByStandardSku.get(sku) || sku,
                warehouse: "BMC",
                totalOnHand: onHand,
                incoming: 0,
                unitCost,
                extendedValue: unitCost != null ? Math.round(unitCost * onHand * 100) / 100 : null,
              };
            });
          }
        })()
      );
    }

    await Promise.all(fetches);

    // Enrich all items with category/name from items table
    const allRaw = [...stordItems, ...bmcItems];
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
      costEffectiveDate: (costRows ?? []).length > 0 ? (costRows![0].effective_date as string) : "",
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
