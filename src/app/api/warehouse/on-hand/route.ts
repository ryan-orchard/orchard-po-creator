import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

import skuMappingData from "@/../clients/magna/config/stord-sku-mapping.json";
const SKU_MAPPING: Record<
  string,
  { standardSku: string; airtableId: string } | null
> = skuMappingData as Record<
  string,
  { standardSku: string; airtableId: string } | null
>;

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
  stordSku: string;
  standardSku: string | null;
  category: string | null;
  productName: string;
  facility: string;
  available: number;
  allocated: number;
  locked: number;
  incoming: number;
  damaged: number;
  totalOnHand: number;
  outOfStock: boolean;
}

export interface OnHandResponse {
  items: OnHandItem[];
  summary: {
    totalSkus: number;
    totalOnHand: number;
    totalAvailable: number;
    totalAllocated: number;
    totalIncoming: number;
    outOfStockCount: number;
  };
  fetchedAt: string;
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

    const items: OnHandItem[] = balances
      .map((b) => {
        const mapping = SKU_MAPPING[b.sku];
        const totalOnHand = parseInt(b.total_on_hand) || 0;
        const available = parseInt(b.available) || 0;
        const allocated = parseInt(b.allocated) || 0;
        const locked = parseInt(b.locked) || 0;
        const incoming = parseInt(b.incoming) || 0;
        const damaged = parseInt(b.damaged) || 0;

        const category = mapping?.airtableId
          ? categoryByRecordId.get(mapping.airtableId) || null
          : null;

        return {
          stordSku: b.sku,
          standardSku: mapping?.standardSku || null,
          category,
          productName: b.name,
          facility: b.facility_alias,
          available,
          allocated,
          locked,
          incoming,
          damaged,
          totalOnHand,
          outOfStock: b.inventory_alerts.out_of_stock,
        };
      })
      // Sort: mapped SKUs first (by standardSku), then unmapped (by stordSku)
      .sort((a, b) => {
        if (a.standardSku && !b.standardSku) return -1;
        if (!a.standardSku && b.standardSku) return 1;
        const aKey = a.standardSku || a.stordSku;
        const bKey = b.standardSku || b.stordSku;
        return aKey.localeCompare(bKey);
      });

    const summary = {
      totalSkus: items.length,
      totalOnHand: items.reduce((sum, i) => sum + i.totalOnHand, 0),
      totalAvailable: items.reduce((sum, i) => sum + i.available, 0),
      totalAllocated: items.reduce((sum, i) => sum + i.allocated, 0),
      totalIncoming: items.reduce((sum, i) => sum + i.incoming, 0),
      outOfStockCount: items.filter((i) => i.outOfStock).length,
    };

    const response: OnHandResponse = {
      items,
      summary,
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
