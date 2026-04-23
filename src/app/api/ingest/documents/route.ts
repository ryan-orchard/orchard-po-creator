import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  const status = request.nextUrl.searchParams.get("status"); // null = all

  let query = db
    .schema("orchard")
    .from("ingested_documents")
    .select(`
      id,
      email_id,
      filename,
      content_type,
      storage_path,
      document_type,
      confidence,
      parsed_data,
      supplier_name,
      supplier_id,
      po_reference,
      po_id,
      invoice_number,
      status,
      created_at,
      reviewed_at,
      ingested_emails (
        from_address,
        from_name,
        subject,
        received_at
      )
    `)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  } else {
    // Exclude rejected by default when no filter specified
    query = query.neq("status", "rejected");
  }

  const { data: documents, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ documents: documents || [] });
}
