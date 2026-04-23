import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id } = await params;

  const { data: doc, error } = await db
    .schema("orchard")
    .from("ingested_documents")
    .select("storage_path")
    .eq("id", id)
    .single();

  if (error || !doc?.storage_path) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const { data: signedUrl, error: urlError } = await db.storage
    .from("ingest")
    .createSignedUrl(doc.storage_path, 300); // 5 min expiry

  if (urlError || !signedUrl) {
    return NextResponse.json({ error: "Failed to generate URL" }, { status: 500 });
  }

  return NextResponse.json({ url: signedUrl.signedUrl });
}
