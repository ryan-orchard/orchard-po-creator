/**
 * Server-side line item total calculation.
 * Single source of truth — frontend values are ignored.
 */
export function computeLineTotal(
  costBasis: string,
  qtySticks: number,
  qtyCartons: number | null,
  unitCost: number
): number {
  if (costBasis === "Per Carton" && qtyCartons != null) {
    return qtyCartons * unitCost;
  }
  // Per Stick and Per Each both use qtySticks
  return qtySticks * unitCost;
}
