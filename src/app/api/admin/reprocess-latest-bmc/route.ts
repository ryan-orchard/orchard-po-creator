import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { parseBmcReport } from "@/lib/bmc-parser";
import { processBmcReport } from "@/lib/bmc-ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/reprocess-latest-bmc
 * GET also works for one-shot browser invocation.
 *
 * Finds the most recently-ingested BMC report document and re-parses
 * its stored attachment. Used after a parser fix to backfill bronze
 * BMC transactions from already-received reports.
 *
 * Clerk-protected via src/proxy.ts (no extra auth needed here).
 */
async function handler() {
  const { data: doc, error: docErr } = await db
    .schema("orchard")
    .from("ingested_documents")
    .select("id, email_id, filename, storage_path, content_type")
    .eq("parsed_data->>type", "bmc_report")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 });
  if (!doc) return NextResponse.json({ error: "No BMC report documents found" }, { status: 404 });
  if (!doc.storage_path) return NextResponse.json({ error: "Document has no storage_path" }, { status: 400 });

  const { data: email } = await db
    .schema("orchard")
    .from("ingested_emails")
    .select("received_at")
    .eq("id", doc.email_id)
    .maybeSingle();

  const { data: file, error: dlErr } = await db.storage.from("ingest").download(doc.storage_path);
  if (dlErr || !file) {
    return NextResponse.json({ error: `Storage download failed: ${dlErr?.message}` }, { status: 500 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = parseBmcReport(buffer);
  const writeResult = await processBmcReport(parsed, email?.received_at);

  await db
    .schema("orchard")
    .from("ingested_documents")
    .update({
      parsed_data: {
        type: "bmc_report",
        snapshotItems: parsed.snapshotItemCount,
        transactions: parsed.transactionCount,
        newTransactions: writeResult.newTransactions,
        skippedDuplicates: writeResult.skippedDuplicates,
        unmapped: parsed.unmapped,
        reportDate: parsed.reportDate,
        reprocessedAt: new Date().toISOString(),
      },
    })
    .eq("id", doc.id);

  return NextResponse.json({
    document: { id: doc.id, filename: doc.filename, storagePath: doc.storage_path },
    parsed: {
      snapshotItems: parsed.snapshotItemCount,
      transactions: parsed.transactionCount,
      reportDate: parsed.reportDate,
      unmapped: parsed.unmapped,
    },
    write: writeResult,
  });
}

export const GET = handler;
export const POST = handler;
