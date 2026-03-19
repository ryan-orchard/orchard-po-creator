/**
 * Shared Stord API utilities — used by data ingestion sync and receipt sync.
 */

export const STORD_BASE_URL = "https://api-next.stord.com/v1";

// Stord API response shape for an inventory adjustment (verified against live API 2026-03-17)
export interface StordAdjustment {
  adjustment_id: string;
  adjusted_at: string;
  sku: string;
  reason: string;
  reason_type: string;
  category: string;           // "Receiving", "Locked", "allocated", etc.
  adjustment_quantity: string; // returned as string e.g. "12.00000"
  name: string;               // product name
  facility_alias: string;     // human-readable e.g. "RNOs003"
  facility_id: string;        // UUID
  order_number: string;
  lot_number: string | null;
  expires_at: string | null;
  unit: string;
}

export async function fetchAllAdjustments(
  apiKey: string,
  orgId: string,
  networkId: string,
  baseParams: URLSearchParams
): Promise<StordAdjustment[]> {
  const results: StordAdjustment[] = [];
  let cursor: string | null = null;

  do {
    const pageParams = new URLSearchParams(baseParams.toString());
    pageParams.set("limit", "1000");
    if (cursor) pageParams.set("after", cursor);

    const url = `${STORD_BASE_URL}/organizations/${orgId}/oms/networks/${networkId}/inventory/adjustments?${pageParams}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
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
