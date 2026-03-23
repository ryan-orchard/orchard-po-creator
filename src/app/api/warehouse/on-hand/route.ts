import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

import skuMappingData from "@/../clients/magna/config/stord-sku-mapping.json";
import unitCostData from "@/../clients/magna/config/unit-costs-2026-02.json";

const UNIT_COSTS: Record<string, number> = unitCostData as Record<string, number>;
const SKU_MAPPING: Record<
  string,
  { standardSku: string; airtableId: string } | null
> = skuMappingData as Record<
  string,
  { standardSku: string; airtableId: string } | null
>;

// Reverse mapping: standardSku → stordSku (for unit cost lookup)
const STANDARD_TO_STORD: Record<string, string> = {};
for (const [stordSku, mapping] of Object.entries(SKU_MAPPING)) {
  if (mapping?.standardSku) {
    STANDARD_TO_STORD[mapping.standardSku] = stordSku;
  }
}

const STORD_BASE_URL = "https://api-next.stord.com/v1";

// Warehouse codes
const WAREHOUSE_CODES = ["STORD", "ANS", "BMC"] as const;
type WarehouseCode = (typeof WAREHOUSE_CODES)[number];

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

// --- Stord API fetch ---

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
  categoryByRecordId: Map<string, string>
): OnHandItem[] {
  return balances.map((b) => {
    const mapping = SKU_MAPPING[b.sku];
    const totalOnHand = parseInt(b.total_on_hand) || 0;
    const incoming = parseInt(b.incoming) || 0;
    const unitCost = UNIT_COSTS[b.sku] ?? null;
    const extendedValue =
      unitCost !== null && totalOnHand > 0
        ? Math.round(unitCost * totalOnHand * 100) / 100
        : null;

    const category = mapping?.airtableId
      ? categoryByRecordId.get(mapping.airtableId) || null
      : null;

    return {
      standardSku: mapping?.standardSku || b.sku,
      stordSku: b.sku,
      category,
      productName: b.name,
      warehouse: "STORD",
      totalOnHand,
      incoming,
      unitCost,
      extendedValue,
    };
  });
}

// --- ANS calculated from receipts + work orders ---

async function fetchANSInventory(
  skuMap: Map<string, { standardSku: string; category: string }>
): Promise<OnHandItem[]> {
  // Find the ANS warehouse record ID
  const warehouses = await getRecords(TABLES.WAREHOUSES, {
    filterByFormula: '{Code} = "ANS"',
  });
  if (warehouses.length === 0) return [];
  const ansWarehouseId = warehouses[0].id;

  // Fetch receipts and work orders in parallel
  const [receipts, allReceiptLines, allWOs, allWOLines] = await Promise.all([
    getRecords(TABLES.RECEIPTS),
    getRecords(TABLES.RECEIPT_LINES),
    getRecords(TABLES.WORK_ORDERS),
    getRecords(TABLES.WORK_ORDER_LINES),
  ]);

  // --- Receipts: add received quantities ---
  const ansReceiptIds = new Set(
    receipts
      .filter((r) => {
        const whLinks = r.fields["Warehouses"] as string[] | undefined;
        return whLinks?.includes(ansWarehouseId);
      })
      .map((r) => r.id)
  );

  const qtyBySkuId = new Map<string, number>();

  const ansLines = allReceiptLines.filter((rl) => {
    const receiptLinks = rl.fields["Receipt"] as string[] | undefined;
    return receiptLinks?.some((id) => ansReceiptIds.has(id));
  });

  for (const line of ansLines) {
    const skuLinks = line.fields["SKU"] as string[] | undefined;
    const skuId = skuLinks?.[0];
    if (!skuId) continue;
    const qty = (line.fields["Qty Received"] as number) || 0;
    qtyBySkuId.set(skuId, (qtyBySkuId.get(skuId) || 0) + qty);
  }

  // --- Work Orders: subtract inputs, add outputs for completed WOs at ANS ---
  const completedANSWOIds = new Set(
    allWOs
      .filter((wo) => {
        const locLinks = wo.fields["Location"] as string[] | undefined;
        const status = wo.fields["Status"] as string;
        return locLinks?.includes(ansWarehouseId) && status === "Completed";
      })
      .map((wo) => wo.id)
  );

  if (completedANSWOIds.size > 0) {
    const woLines = allWOLines.filter((wl) => {
      const woLinks = wl.fields["Work Order"] as string[] | undefined;
      return woLinks?.some((id) => completedANSWOIds.has(id));
    });

    for (const line of woLines) {
      const skuLinks = line.fields["SKU"] as string[] | undefined;
      const skuId = skuLinks?.[0];
      if (!skuId) continue;
      const qty = (line.fields["Quantity"] as number) || 0;
      const lineType = line.fields["Line Type"] as string;

      if (lineType === "Input") {
        // Inputs consumed — subtract from inventory
        qtyBySkuId.set(skuId, (qtyBySkuId.get(skuId) || 0) - qty);
      } else if (lineType === "Output") {
        // Outputs produced — add to inventory
        qtyBySkuId.set(skuId, (qtyBySkuId.get(skuId) || 0) + qty);
      }
    }
  }

  // Convert to OnHandItem[] (skip SKUs with zero or negative qty)
  const items: OnHandItem[] = [];
  for (const [skuId, qty] of qtyBySkuId) {
    if (qty <= 0) continue;
    const skuInfo = skuMap.get(skuId);
    const standardSku = skuInfo?.standardSku || skuId;
    const stordSku = STANDARD_TO_STORD[standardSku] || null;
    const unitCost = stordSku ? (UNIT_COSTS[stordSku] ?? null) : null;
    const extendedValue =
      unitCost !== null && qty > 0
        ? Math.round(unitCost * qty * 100) / 100
        : null;

    items.push({
      standardSku,
      stordSku,
      category: skuInfo?.category || null,
      productName: standardSku,
      warehouse: "ANS",
      totalOnHand: qty,
      incoming: 0,
      unitCost,
      extendedValue,
    });
  }

  return items;
}

// --- BMC from inventory snapshots ---

async function fetchBMCInventory(
  skuMap: Map<string, { standardSku: string; category: string }>
): Promise<{ items: OnHandItem[]; snapshotDate: string | null }> {
  // Find the BMC warehouse record ID
  const warehouses = await getRecords(TABLES.WAREHOUSES, {
    filterByFormula: '{Code} = "BMC"',
  });
  if (warehouses.length === 0) return { items: [], snapshotDate: null };
  const bmcWarehouseId = warehouses[0].id;

  // Get all snapshot records for BMC
  const snapshots = await getRecords(TABLES.INVENTORY_SNAPSHOTS);
  const bmcSnapshots = snapshots.filter((s) => {
    const whLinks = s.fields["Warehouse"] as string[] | undefined;
    return whLinks?.includes(bmcWarehouseId);
  });

  if (bmcSnapshots.length === 0) return { items: [], snapshotDate: null };

  // Find the latest snapshot date
  const snapshotDate = bmcSnapshots.reduce((latest, s) => {
    const d = s.fields["Snapshot Date"] as string | undefined;
    return d && d > (latest || "") ? d : latest;
  }, null as string | null);

  // Filter to only records from the latest date
  const latestSnapshots = snapshotDate
    ? bmcSnapshots.filter((s) => s.fields["Snapshot Date"] === snapshotDate)
    : bmcSnapshots;

  const items: OnHandItem[] = latestSnapshots.map((s) => {
    const skuLinks = s.fields["SKU"] as string[] | undefined;
    const skuId = skuLinks?.[0];
    const qty = (s.fields["Qty On Hand"] as number) || 0;
    const skuInfo = skuId ? skuMap.get(skuId) : undefined;
    const standardSku = skuInfo?.standardSku || "Unknown";
    const stordSku = STANDARD_TO_STORD[standardSku] || null;
    const unitCost = stordSku ? (UNIT_COSTS[stordSku] ?? null) : null;
    const extendedValue =
      unitCost !== null && qty > 0
        ? Math.round(unitCost * qty * 100) / 100
        : null;

    return {
      standardSku,
      stordSku,
      category: skuInfo?.category || null,
      productName: standardSku,
      warehouse: "BMC",
      totalOnHand: qty,
      incoming: 0,
      unitCost,
      extendedValue,
    };
  });

  return { items, snapshotDate };
}

// Server-side cache: 24 hours (Stord only — ANS/BMC always fresh from Airtable)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let stordCachedItems: OnHandItem[] | null = null;
let stordCachedAt = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "1";
  const warehouseFilter = (searchParams.get("warehouse") || "all").toUpperCase();

  try {
    // Always fetch items master data (needed for all warehouses)
    const allItems = await getRecords(TABLES.SKUS);

    // Build lookups
    const categoryByRecordId = new Map<string, string>();
    const skuMap = new Map<string, { standardSku: string; category: string }>();
    for (const item of allItems) {
      const category = (item.fields["Category"] as string) || "";
      const standardSku = (item.fields["Standard SKU"] as string) || "";
      categoryByRecordId.set(item.id, category);
      skuMap.set(item.id, { standardSku, category });
    }

    // Fetch data for requested warehouses
    const includeStord = warehouseFilter === "ALL" || warehouseFilter === "STORD";
    const includeANS = warehouseFilter === "ALL" || warehouseFilter === "ANS";
    const includeBMC = warehouseFilter === "ALL" || warehouseFilter === "BMC";

    let stordItems: OnHandItem[] = [];
    let ansItems: OnHandItem[] = [];
    let bmcResult: { items: OnHandItem[]; snapshotDate: string | null } = { items: [], snapshotDate: null };

    // Parallel fetch for all requested warehouses
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
              stordItems = mapStordToOnHand(balances, categoryByRecordId);
              stordCachedItems = stordItems;
              stordCachedAt = Date.now();
            })
          );
        }
      }
    }

    if (includeANS) {
      fetches.push(
        fetchANSInventory(skuMap).then((items) => {
          ansItems = items;
        })
      );
    }

    if (includeBMC) {
      fetches.push(
        fetchBMCInventory(skuMap).then((result) => {
          bmcResult = result;
        })
      );
    }

    await Promise.all(fetches);

    // Combine all items
    const allOnHand = [...stordItems, ...ansItems, ...bmcResult.items].sort(
      (a, b) => a.standardSku.localeCompare(b.standardSku)
    );

    const summary = {
      totalSkus: new Set(allOnHand.map((i) => i.standardSku)).size,
      totalOnHand: allOnHand.reduce((sum, i) => sum + i.totalOnHand, 0),
      totalValue: allOnHand.reduce((sum, i) => sum + (i.extendedValue ?? 0), 0),
      totalIncoming: allOnHand.reduce((sum, i) => sum + i.incoming, 0),
    };

    // Build warehouse info
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
        sourceLabel: bmcResult.snapshotDate
          ? `Snapshot from ${bmcResult.snapshotDate}`
          : "No snapshot loaded",
        asOf: bmcResult.snapshotDate,
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
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch inventory",
      },
      { status: 500 }
    );
  }
}
