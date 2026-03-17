/**
 * PO matching utility — extracts PO number from Stord Order Number strings
 * and matches against existing POs.
 *
 * Used by both data ingestion (preview) and receipt matching (confirmation).
 */

export interface POCandidate {
  id: string;
  poNumber: string;
}

/**
 * Attempt to match a Stord Order Number to a PO.
 *
 * Handles various formats:
 * - Exact match: "PO-10001"
 * - Leading number: "36 - Blue Ice" → PO-36
 * - ANS format: "ANS PO 27-4 Bulk Sticks..." → PO-27
 * - Generic PO prefix: "PO 0126-MAG-03"
 */
export function attemptPOMatch(
  orderNumber: string,
  poList: POCandidate[]
): POCandidate | null {
  if (!orderNumber) return null;

  // Try exact match first (e.g., "PO-10001")
  const exactMatch = poList.find(
    (po) => po.poNumber.toLowerCase() === orderNumber.toLowerCase()
  );
  if (exactMatch) return exactMatch;

  // Extract leading number from order number (e.g., "36 - Blue Ice" -> "36")
  const numMatch = orderNumber.match(/^(\d+)/);
  if (numMatch) {
    const num = numMatch[1];
    const poMatch = poList.find((po) => po.poNumber === `PO-${num}`);
    if (poMatch) return poMatch;
  }

  // Try extracting PO number from various formats
  // "ANS PO 27-4 Bulk Sticks..." -> try "PO-27"
  const ansPOMatch = orderNumber.match(/(?:ANS\s+)?PO\s+(\d+)/i);
  if (ansPOMatch) {
    const num = ansPOMatch[1];
    const poMatch = poList.find((po) => po.poNumber === `PO-${num}`);
    if (poMatch) return poMatch;
  }

  return null;
}
