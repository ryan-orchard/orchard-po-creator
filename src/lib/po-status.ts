/**
 * Roll a PO's status up from its line statuses.
 * Ordering: ordered < confirmed < complete. Cancelled lines are ignored.
 */
export function rollUpPoStatus(lineStates: string[]): string {
  const active = lineStates.filter((s) => s !== "cancelled");
  if (active.length === 0) return lineStates.length > 0 ? "cancelled" : "ordered";
  if (active.every((s) => s === "complete")) return "complete";
  if (active.every((s) => s === "complete" || s === "confirmed")) return "confirmed";
  return "ordered";
}
