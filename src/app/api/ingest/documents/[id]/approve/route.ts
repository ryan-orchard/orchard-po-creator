import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { generateNextNumber } from "@/lib/sequence";
import { logActivity } from "@/lib/activity-log";
import { resolveItem } from "@/lib/ingest";

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
      salesOrder: string | null;
      trackingNumber: string | null;
      shipTo: string | null;
      deliveryTerms: string | null;
      subtotal: number | null;
      freight: number | null;
      tax: number | null;
      invoiceAmount: number;
      lines: { description: string; quantity: number; unit: string; unitPrice: number; amount: number }[];
      suggestedType: string;
    };

    if (!parsed) {
      return NextResponse.json({ error: "No parsed data to approve" }, { status: 400 });
    }

    // Use overrides or fall back to AI-extracted values
    const overrides = body.overrides || {};
    const supplierId = body.supplierId || doc.supplier_id;
    const poId = body.poId || doc.po_id;

    if (!supplierId) {
      return NextResponse.json({ error: "Supplier must be resolved before approving" }, { status: 400 });
    }

    // Merge: UI overrides > parsed data > defaults
    const invoiceNumber = overrides.invoiceNumber || parsed.invoiceNumber;
    const invoiceDate = overrides.invoiceDate || parsed.invoiceDate;
    const dueDate = overrides.dueDate ?? parsed.dueDate ?? null;
    const paymentTerms = overrides.paymentTerms ?? parsed.paymentTerms ?? null;
    const salesOrder = overrides.salesOrder ?? parsed.salesOrder ?? null;
    const trackingNumber = overrides.trackingNumber ?? parsed.trackingNumber ?? null;
    const shipTo = overrides.shipTo ?? parsed.shipTo ?? null;
    const deliveryTerms = overrides.deliveryTerms ?? parsed.deliveryTerms ?? null;
    const subtotal = overrides.subtotal ?? parsed.subtotal ?? 0;
    const freight = overrides.freight ?? parsed.freight ?? 0;
    const tax = overrides.tax ?? parsed.tax ?? 0;
    const invoiceAmount = overrides.invoiceAmount ?? parsed.invoiceAmount;
    const invoiceType = overrides.suggestedType || parsed.suggestedType || "Supplier";
    const poReference = overrides.poReference ?? parsed.poReference ?? null;

    // Create invoice
    const { data: invoice, error: invoiceError } = await db
      .schema("orchard")
      .from("invoices")
      .insert({
        invoice_number: invoiceNumber,
        supplier_id: supplierId,
        po_id: poId || null,
        invoice_date: invoiceDate,
        due_date: dueDate,
        payment_terms: paymentTerms,
        sales_order: salesOrder,
        tracking_number: trackingNumber,
        ship_to_text: shipTo,
        delivery_terms: deliveryTerms,
        subtotal: subtotal || 0,
        freight: freight || 0,
        tax: tax || 0,
        total_amount: invoiceAmount,
        invoice_type: invoiceType,
        po_reference: poReference,
        notes: null,
      })
      .select("id")
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: `Failed to create invoice: ${invoiceError?.message}` },
        { status: 500 }
      );
    }

    // Create invoice lines — use overrides if provided, else parsed data
    const sourceLines = overrides.lines?.length ? overrides.lines : parsed.lines;
    if (sourceLines?.length) {
      // Fetch items for SKU lookup when itemId is provided
      const { data: allItems } = await db.schema("org_config").from("items").select("id, sku");
      const itemMap = new Map((allItems || []).map((i) => [i.id, i.sku as string]));

      const lines = await Promise.all(
        sourceLines.map(async (line: { description: string; quantity: number; unitPrice: number; amount: number; itemId?: string }) => {
          // Use explicit itemId if provided, otherwise try fuzzy resolution
          let itemId = line.itemId || null;
          let sku: string | null = null;

          if (itemId) {
            sku = itemMap.get(itemId) || null;
          } else {
            const resolved = await resolveItem(line.description);
            if (resolved) {
              itemId = resolved.id;
              sku = resolved.sku;
            }
          }

          return {
            invoice_id: invoice.id,
            item_id: itemId,
            sku,
            description: line.description,
            qty: line.quantity,
            unit_price: line.unitPrice,
            total: line.amount,
          };
        })
      );

      const { error: linesError } = await db
        .schema("orchard")
        .from("invoice_lines")
        .insert(lines);

      if (linesError) console.error("Failed to insert invoice lines:", linesError);
    }

    // Create invoice status
    await db.schema("orchard_calcs").from("invoice_statuses").insert({
      invoice_id: invoice.id,
      match_status: "Unmatched",
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
        description: `Invoice ${invoiceNumber} created from email ingestion`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoice.id,
      });
    }

    return NextResponse.json({
      approved: true,
      recordType: "invoice",
      recordId: invoice.id,
      invoiceNumber,
    });
  }

  // TODO: handle other document types (receipts, transaction exports)
  return NextResponse.json(
    { error: `Approval not yet implemented for document type: ${doc.document_type}` },
    { status: 400 }
  );
}
