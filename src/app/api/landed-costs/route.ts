import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

import skuMappingData from "@/../clients/magna/config/stord-sku-mapping.json";
import unitCostData from "@/../clients/magna/config/unit-costs-2026-02.json";

const SKU_MAPPING: Record<
  string,
  { standardSku: string; airtableId: string } | null
> = skuMappingData as Record<
  string,
  { standardSku: string; airtableId: string } | null
>;

const UNIT_COSTS: Record<string, number> = unitCostData as Record<
  string,
  number
>;

const STORD_BASE_URL = "https://api-next.stord.com/v1";

interface StordFacilityBalance {
  sku: string;
  name: string;
  facility_alias: string;
  available: string;
  allocated: string;
  locked: string;
  incoming: string;
  total_on_hand: string;
  inventory_alerts: {
    out_of_stock: boolean;
  };
}

async function fetchAllFacilityBalances(
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

export interface LandedCostItem {
  stordSku: string;
  standardSku: string | null;
  category: string | null;
  productName: string;
  totalOnHand: number;
  unitCost: number | null;
  extendedValue: number | null;
  hasCost: boolean;
}

export interface LandedCostResponse {
  items: LandedCostItem[];
  summary: {
    totalInventoryValue: number;
    skusWithCosts: number;
    skusMissingCosts: number;
    skusMissingCostsWithStock: number;
    totalSkus: number;
  };
  costEffectiveDate: string;
  fetchedAt: string;
}

export async function GET() {
  const apiKey = process.env.STORD_API_KEY;
  const orgId = process.env.STORD_ORG_ID;
  const networkId = process.env.STORD_NETWORK_ID;

  if (!apiKey) {
    return NextResponse.json(
      { error: "STORD_API_KEY not configured" },
      { status: 500 }
    );
  }
  if (!orgId || !networkId) {
    return NextResponse.json(
      { error: "STORD_ORG_ID or STORD_NETWORK_ID not configured" },
      { status: 500 }
    );
  }

  try {
    const [balances, allItems] = await Promise.all([
      fetchAllFacilityBalances(apiKey, orgId, networkId),
      getRecords(TABLES.SKUS),
    ]);

    // Build lookup: airtableId → category
    const categoryByRecordId = new Map<string, string>();
    for (const item of allItems) {
      categoryByRecordId.set(
        item.id,
        (item.fields["Category"] as string) || ""
      );
    }

    const items: LandedCostItem[] = balances
      .map((b) => {
        const mapping = SKU_MAPPING[b.sku];
        const totalOnHand = parseInt(b.total_on_hand) || 0;
        const unitCost = UNIT_COSTS[b.sku] ?? null;
        const extendedValue =
          unitCost !== null && totalOnHand > 0
            ? Math.round(unitCost * totalOnHand * 100) / 100
            : null;

        const category = mapping?.airtableId
          ? categoryByRecordId.get(mapping.airtableId) || null
          : null;

        return {
          stordSku: b.sku,
          standardSku: mapping?.standardSku || null,
          category,
          productName: b.name,
          totalOnHand,
          unitCost,
          extendedValue,
          hasCost: unitCost !== null,
        };
      })
      // Only include items with on-hand qty > 0 OR a cost defined
      .filter((item) => item.totalOnHand > 0 || item.hasCost)
      // Default sort: extended value desc (biggest $ first)
      .sort((a, b) => (b.extendedValue ?? 0) - (a.extendedValue ?? 0));

    const withStock = items.filter((i) => i.totalOnHand > 0);
    const summary = {
      totalInventoryValue: items.reduce(
        (sum, i) => sum + (i.extendedValue ?? 0),
        0
      ),
      skusWithCosts: withStock.filter((i) => i.hasCost).length,
      skusMissingCosts: withStock.filter((i) => !i.hasCost).length,
      skusMissingCostsWithStock: withStock.filter((i) => !i.hasCost).length,
      totalSkus: withStock.length,
    };

    const response: LandedCostResponse = {
      items,
      summary,
      costEffectiveDate: "2026-02-28",
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Landed costs fetch error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch landed costs",
      },
      { status: 500 }
    );
  }
}
