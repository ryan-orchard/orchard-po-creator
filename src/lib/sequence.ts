import { db } from "./supabase";

type SequencePrefix = "PO" | "WO" | "RCP" | "SH" | "TR";

/**
 * Generate the next sequence number for a given prefix.
 * Pattern: PREFIX-10001, PREFIX-10002, ...
 *
 * Backed by a Postgres sequence (see sql/019-sequences.sql) — concurrent
 * callers never collide.
 *
 * Supports legacy 3-arg Airtable call form: generateNextNumber(tableId, fieldName, prefix).
 * The first two args are ignored; the prefix (3rd) drives the call.
 */
export async function generateNextNumber(
  prefixOrTableId: string,
  _fieldName?: string,
  prefixArg?: string
): Promise<string> {
  const prefix = (prefixArg ?? prefixOrTableId) as SequencePrefix;

  const { data, error } = await db.rpc("next_sequence", { p_prefix: prefix });

  if (error || !data) {
    throw new Error(
      `Failed to generate ${prefix} number: ${error?.message ?? "no value returned"}`
    );
  }

  return data as string;
}
