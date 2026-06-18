/**
 * Roll a PO's status up from its line statuses.
 * Floor wins: draft < ordered < confirmed < complete. Cancelled lines are ignored.
 * A line with no status row is treated as 'ordered' by callers (legacy default);
 * app-created lines get an explicit 'draft' row on creation/edit.
 */
export function rollUpPoStatus(lineStates: string[]): string {
  const active = lineStates.filter((s) => s !== "cancelled");
  if (active.length === 0) return lineStates.length > 0 ? "cancelled" : "ordered";
  if (active.every((s) => s === "complete")) return "complete";
  if (active.every((s) => s === "complete" || s === "confirmed")) return "confirmed";
  if (active.some((s) => s === "draft")) return "draft";
  return "ordered";
}
