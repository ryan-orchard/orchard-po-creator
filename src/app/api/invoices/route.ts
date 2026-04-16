import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { logActivity } from "@/lib/activity-log";

export async function GET() {
  try {
    const [invoicesResult, statusesResult, suppliersResult] = await Promise.all([
      db.schema("orchard").from("invoices").select("*").order("invoice_date", { ascending: false }),
      db.schema("orchard_calcs").from("invoice_statuses").select("invoice_id, payment_status, match_status"),
      db.schema("org_config").from("suppliers").select("id, name"),
    ]);

    if (invoicesResult.error) return NextResponse.json({ error: invoicesResult.error.message }, { status: 500 });

    const payStatusMap = new Map((statusesResult.data ?? []).map((s) => [s.invoice_id, s]));
    const supplierMap = new Map((suppliersResult.data ?? []).map((s) => [s.id, s.name as string]));

    // Count lines per invoice
    const { data: lineCountData } = await db
      .schema("orchard")
      .from("invoice_lines")
      .select("invoice_id");
    const lineCountByInvoice: Record<string, number> = {};
    for (const l of lineCountData ?? []) {
      lineCountByInvoice[l.invoice_id] = (lineCountByInvoice[l.invoice_id] ?? 0) + 1;
    }

    type Invoice = {
      id: string; invoice_number: string; invoice_date: string; supplier_id: string | null;
      po_reference: string | null; sales_order: string | null; po_id: string | null;
      total_amount: number; match_status: string | null;
    };

    const invoices = (invoicesResult.data as Invoice[]).map((inv) => {
      const status = payStatusMap.get(inv.id);
      return {
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        invoiceDate: inv.invoice_date,
        supplier: inv.supplier_id ? supplierMap.get(inv.supplier_id) ?? null : null,
        poReference: inv.po_reference ?? "",
        salesOrder: inv.sales_order ?? "",
        purchaseOrder: inv.po_id ?? null,
        invoiceAmount: Number(inv.total_amount),
        matchStatus: status?.match_status ?? inv.match_status ?? "Open",
        paymentStatus: status?.payment_status ?? "Unpaid",
        lineCount: lineCountByInvoice[inv.id] ?? 0,
      };
    });

    return NextResponse.json(invoices);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  try {
    const body = await request.json();

    // Check for duplicate invoice number
    const { data: existing } = await db
      .schema("orchard")
      .from("invoices")
      .select("id")
      .eq("invoice_number", body.invoiceNumber)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `Invoice ${body.invoiceNumber} already exists` },
        { status: 409 }
      );
    }

    // Look up supplier
    let supplierId: string | null = null;
    if (!body.invoiceType) {
      // ANS supplier invoices
      const { data: suppliers } = await db
        .schema("org_config")
        .from("suppliers")
        .select("id")
        .eq("code", "ANS")
        .limit(1);
      if (suppliers && suppliers.length > 0) supplierId = suppliers[0].id;
    } else if (body.vendor) {
      const { data: suppliers } = await db
        .schema("org_config")
        .from("suppliers")
        .select("id")
        .eq("name", body.vendor)
        .limit(1);
      if (suppliers && suppliers.length > 0) supplierId = suppliers[0].id;
    }

    // Resolve PO id from po_reference if possible
    let poId: string | null = null;
    if (body.poReference) {
      const { data: pos } = await db
        .schema("orchard")
        .from("purchase_orders")
        .select("id")
        .eq("po_number", body.poReference)
        .limit(1);
      if (pos && pos.length > 0) poId = pos[0].id;
    }

    const { data: invoice, error: invoiceError } = await db
      .schema("orchard")
      .from("invoices")
      .insert({
        invoice_number: body.invoiceNumber,
        invoice_date: body.invoiceDate,
        due_date: body.dueDate || null,
        supplier_id: supplierId,
        total_amount: body.invoiceAmount ?? 0,
        notes: null,
        sales_order: body.salesOrder || null,
        po_reference: body.poReference || null,
        payment_terms: body.paymentTerms || null,
        tracking_number: body.trackingNumber || null,
        delivery_terms: body.deliveryTerms || null,
        ship_to_text: body.shipTo || null,
        subtotal: body.subtotal ?? 0,
        freight: body.freight ?? 0,
        tax: body.tax ?? 0,
        invoice_type: body.invoiceType || "Supplier",
        match_status: "Open",
        po_id: poId,
      })
      .select("id")
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: invoiceError?.message ?? "Failed to create invoice" }, { status: 500 });
    }

    // Insert invoice status row
    await db.schema("orchard_calcs").from("invoice_statuses").insert({
      invoice_id: invoice.id,
      payment_status: "Unpaid",
      match_status: "Open",
      updated_by: "Ryan Belanger",
    });

    // Create invoice lines
    if (body.lines && body.lines.length > 0) {
      const lineRows = (body.lines as {
        ansItemNumber: string; description: string; airtableSkuId: string | null;
        quantity: number; unit: string; unitPrice: number; amount: number; batchNumber: string | null;
      }[]).map((line, idx) => ({
        invoice_id: invoice.id,
        item_id: line.airtableSkuId || null, // may be Supabase UUID from new items
        qty: line.quantity,
        unit_price: line.unitPrice,
        total: line.amount,
        line_id: `${body.invoiceNumber}-${idx + 1}`,
        ans_item_number: line.ansItemNumber || null,
        description: line.description || null,
        unit: line.unit || "EA",
        batch_number: line.batchNumber || null,
      }));

      await db.schema("orchard").from("invoice_lines").insert(lineRows);
    }

    // Log activity if PO resolved
    if (poId) {
      logActivity({
        poId,
        action: "invoice_created",
        description: `Invoice ${body.invoiceNumber} created — $${(body.invoiceAmount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoice.id,
      });
    }

    return NextResponse.json({ id: invoice.id, invoiceNumber: body.invoiceNumber });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to create invoice: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
