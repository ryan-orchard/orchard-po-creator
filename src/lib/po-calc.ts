/**
 * Server-side line item total calculation.
 * Single source of truth — frontend values are ignored.
 */
export function computeLineTotal(
  uom: string,
  qtySticks: number,
  qtyCartons: number | null,
  unitCost: number
): number {
  if (uom === "Carton" && qtyCartons != null) {
    return qtyCartons * unitCost;
  }
  return qtySticks * unitCost;
}

/** Derive the legacy Cost Basis string from item UOM (for Airtable storage only). */
export function deriveCostBasis(uom: string): string {
  if (uom === "Carton") return "Per Carton";
  if (uom === "Each") return "Per Each";
  return "Per Stick";
}

/** Derive the legacy Section string from item UOM + count (for Airtable storage only). */
export function deriveSection(uom: string, count: number | null): string {
  if (uom === "Stick") return "Bulk Sticks";
  if (uom === "Each") return "";
  return count ? `${count}CT` : "Carton";
}
