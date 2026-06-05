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

    // Fetch all invoice lines with item info for SKU summary
    const { data: allLines } = await db
      .schema("orchard")
      .from("invoice_lines")
      .select("id, invoice_id, item_id, description, sku");

    // Receipt link coverage: which invoice_line_ids have at least one linked receipt line?
    const { data: rlLinks } = await db
      .schema("orchard_calcs")
      .from("receipt_line_invoice_line_links")
      .select("invoice_line_id");
    const linkedInvoiceLineIds = new Set((rlLinks ?? []).map((l) => l.invoice_line_id as string));

    // Build item IDs to resolve names
    const itemIds = [...new Set((allLines ?? []).map((l) => l.item_id as string).filter(Boolean))];
    const { data: itemsData } = itemIds.length
      ? await db.schema("org_config").from("items").select("id, sku").in("id", itemIds)
      : { data: [] };
    const itemMap = new Map((itemsData ?? []).map((i) => [i.id, i.sku as string]));

    // Group lines by invoice — collect SKU names, count, and linked-line count
    const linesByInvoice: Record<string, { skus: string[]; count: number; linkedCount: number }> = {};
    for (const l of allLines ?? []) {
      const invId = l.invoice_id as string;
      if (!linesByInvoice[invId]) linesByInvoice[invId] = { skus: [], count: 0, linkedCount: 0 };
      linesByInvoice[invId].count++;
      if (linkedInvoiceLineIds.has(l.id as string)) linesByInvoice[invId].linkedCount++;
      const skuName = l.item_id ? itemMap.get(l.item_id as string) : (l.sku as string | null);
      if (skuName && !linesByInvoice[invId].skus.includes(skuName)) {
        linesByInvoice[invId].skus.push(skuName);
      }
    }

    type Invoice = {
      id: string; invoice_number: string; invoice_date: string; due_date: string | null;
      supplier_id: string | null; po_reference: string | null; sales_order: string | null;
      po_id: string | null; total_amount: number; match_status: string | null;
      invoice_type: string | null; payment_terms: string | null;
    };

    const invoices = (invoicesResult.data as Invoice[]).map((inv) => {
      const status = payStatusMap.get(inv.id);
      const lineInfo = linesByInvoice[inv.id];
      const dueDate = inv.due_date || computeDueDate(inv.invoice_date, inv.payment_terms || "");
      return {
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        invoiceDate: inv.invoice_date,
        dueDate,
        supplier: inv.supplier_id ? supplierMap.get(inv.supplier_id) ?? null : null,
        poReference: inv.po_reference ?? "",
        salesOrder: inv.sales_order ?? "",
        purchaseOrder: inv.po_id ?? null,
        invoiceAmount: Number(inv.total_amount),
        matchStatus: status?.match_status ?? "unmatched",
        paymentStatus: status?.payment_status ?? "Unpaid",
        invoiceType: inv.invoice_type ?? "Supplier",
        lineCount: lineInfo?.count ?? 0,
        linkedLineCount: lineInfo?.linkedCount ?? 0,
        skuSummary: lineInfo?.skus.join(", ") ?? "",
      };
    });

    return NextResponse.json(invoices);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 });
  }
}

function computeDueDate(invoiceDate: string, paymentTerms: string): string {
  if (!invoiceDate) return "";
  const netMatch = paymentTerms.match(/^Net\s+(\d+)$/i);
  if (!netMatch) return "";
  const days = parseInt(netMatch[1], 10);
  const date = new Date(invoiceDate + "T00:00:00");
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
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
      match_status: "unmatched",
      updated_by: "Ryan Belanger",
    });

    // Create invoice lines
    if (body.lines && body.lines.length > 0) {
      const lineRows = (body.lines as {
        ansItemNumber: string; description: string; airtableSkuId: string | null;
        quantity: number; unit: string; unitPrice: number; amount: number; batchNumber: string | null;
      }[]).map((line, idx) => ({
        invoice_id: invoice.id,
        item_id: line.airtableSkuId || null,
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
