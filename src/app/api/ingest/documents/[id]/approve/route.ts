import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { generateNextNumber } from "@/lib/sequence";
import { logActivity } from "@/lib/activity-log";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id } = await params;

  // Fetch the ingested document
  const { data: doc, error: fetchError } = await db
    .schema("orchard")
    .from("ingested_documents")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (doc.status !== "pending") {
    return NextResponse.json({ error: `Document already ${doc.status}` }, { status: 400 });
  }

  // Allow overrides from the request body
  const body = await request.json().catch(() => ({}));

  if (doc.document_type === "invoice") {
    const parsed = doc.parsed_data as {
      invoiceNumber: string;
      invoiceDate: string;
      dueDate: string | null;
      paymentTerms: string | null;
      vendor: string;
      poReference: string | null;
      invoiceAmount: number;
      freight: number | null;
      tax: number | null;
      lines: { description: string; quantity: number; unit: string; unitPrice: number; amount: number }[];
      suggestedType: string;
    };

    if (!parsed) {
      return NextResponse.json({ error: "No parsed data to approve" }, { status: 400 });
    }

    // Use overrides or fall back to AI-extracted values
    const supplierId = body.supplierId || doc.supplier_id;
    const poId = body.poId || doc.po_id;

    if (!supplierId) {
      return NextResponse.json({ error: "Supplier must be resolved before approving" }, { status: 400 });
    }

    // Create invoice
    const { data: invoice, error: invoiceError } = await db
      .schema("orchard")
      .from("invoices")
      .insert({
        invoice_number: parsed.invoiceNumber,
        supplier_id: supplierId,
        invoice_date: parsed.invoiceDate,
        due_date: parsed.dueDate || null,
        total_amount: parsed.invoiceAmount,
        notes: [
          parsed.paymentTerms ? `Terms: ${parsed.paymentTerms}` : null,
          parsed.suggestedType ? `Type: ${parsed.suggestedType}` : null,
        ]
          .filter(Boolean)
          .join(". ") || null,
      })
      .select("id")
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: `Failed to create invoice: ${invoiceError?.message}` },
        { status: 500 }
      );
    }

    // Create invoice lines
    if (parsed.lines?.length) {
      const lines = parsed.lines.map((line) => ({
        invoice_id: invoice.id,
        item_id: null, // TODO: resolve item from description
        qty: line.quantity,
        unit_price: line.unitPrice,
        total: line.amount,
      }));

      const { error: linesError } = await db
        .schema("orchard")
        .from("invoice_lines")
        .insert(lines);

      if (linesError) console.error("Failed to insert invoice lines:", linesError);
    }

    // Create invoice status
    await db.schema("orchard_calcs").from("invoice_statuses").insert({
      invoice_id: invoice.id,
      payment_status: "Unpaid",
      updated_by: "Orchard AI",
    });

    // Mark ingested document as approved
    await db
      .schema("orchard")
      .from("ingested_documents")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: "Ryan",
        created_record_type: "invoice",
        created_record_id: invoice.id,
      })
      .eq("id", id);

    // Log activity if linked to a PO
    if (poId) {
      logActivity({
        poId,
        action: "invoice_created",
        description: `Invoice ${parsed.invoiceNumber} created from email ingestion`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoice.id,
      });
    }

    return NextResponse.json({
      approved: true,
      recordType: "invoice",
      recordId: invoice.id,
      invoiceNumber: parsed.invoiceNumber,
    });
  }

  // TODO: handle other document types (receipts, transaction exports)
  return NextResponse.json(
    { error: `Approval not yet implemented for document type: ${doc.document_type}` },
    { status: 400 }
  );
}
