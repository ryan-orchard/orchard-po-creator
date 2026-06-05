import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

/**
 * GET /api/invoices/[id]/line-context?invoiceLineId=XXX
 *
 * Returns the full invoice (header + all lines) plus, for the specified invoice
 * line, the receipt lines that are already matched to it. Used by the invoice
 * slide panel on the receipts matching page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const invoiceLineId = request.nextUrl.searchParams.get("invoiceLineId");
  if (!invoiceLineId) {
    return NextResponse.json({ error: "invoiceLineId required" }, { status: 400 });
  }

  try {
    // 1. Invoice header + all lines (parallel)
    const [invoiceRes, allLinesRes] = await Promise.all([
      db.schema("orchard").from("invoices")
        .select("id, invoice_number, supplier_id, po_reference, invoice_date, freight, tax, total_amount, ship_to_text")
        .eq("id", id)
        .single(),
      db.schema("orchard").from("invoice_lines")
        .select("id, item_id, qty, unit_price, description, ans_item_number")
        .eq("invoice_id", id),
    ]);

    if (invoiceRes.error || !invoiceRes.data) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const invoice = invoiceRes.data as Record<string, unknown>;
    const allInvLines = allLinesRes.data ?? [];

    // 2. Resolve SKUs + supplier (parallel)
    const allItemIds = [...new Set(allInvLines.map(l => l.item_id as string).filter(Boolean))];
    const [{ data: items }, supplierResult] = await Promise.all([
      allItemIds.length
        ? db.schema("org_config").from("items").select("id, sku").in("id", allItemIds)
        : { data: [] },
      invoice.supplier_id
        ? db.schema("org_config").from("suppliers").select("name").eq("id", invoice.supplier_id as string).single()
        : { data: null },
    ]);
    const skuMap = new Map((items ?? []).map(i => [i.id as string, i.sku as string]));
    const supplierName = (supplierResult.data as { name?: string } | null)?.name ?? null;

    // 3. Receipt lines already matched to this invoice line
    const { data: links } = await db.schema("orchard_calcs")
      .from("receipt_line_invoice_line_links")
      .select("receipt_line_id")
      .eq("invoice_line_id", invoiceLineId);

    const matchedReceiptLineIds = (links ?? []).map(l => l.receipt_line_id as string);

    let matchedReceiptLines: Array<{
      receiptLineId: string;
      qty: number;
      date: string | null;
      source: string;
      orderRef: string | null;
    }> = [];

    if (matchedReceiptLineIds.length > 0) {
      const { data: rcptLines } = await db.schema("orchard_calcs").from("receipt_lines")
        .select("id, qty_received, received_date, source, source_doc_no")
        .in("id", matchedReceiptLineIds);
      matchedReceiptLines = (rcptLines ?? []).map(l => ({
        receiptLineId: l.id as string,
        qty: Number(l.qty_received) || 0,
        date: (l.received_date as string) ?? null,
        source: (l.source as string) ?? "",
        orderRef: (l.source_doc_no as string) ?? null,
      }));
    }

    // 4. Overhead per unit (freight + tax allocated across product lines)
    const freight = Number(invoice.freight) || 0;
    const tax = Number(invoice.tax) || 0;
    const totalProductQty = allInvLines.reduce((sum, l) => {
      if (!l.item_id) return sum;
      return sum + (Number(l.qty) || 0);
    }, 0);
    const overheadPerUnit = totalProductQty > 0 ? (freight + tax) / totalProductQty : 0;

    // 5. Target line summary
    const targetInvLine = allInvLines.find(l => l.id === invoiceLineId);
    const targetQty = Number(targetInvLine?.qty) || 0;
    const alreadyMatchedQty = matchedReceiptLines.reduce((sum, l) => sum + l.qty, 0);
    const unitPrice = Number(targetInvLine?.unit_price) || 0;

    return NextResponse.json({
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        supplier: supplierName,
        invoiceDate: invoice.invoice_date ?? null,
        poReference: invoice.po_reference ?? null,
        shipTo: (invoice.ship_to_text as string) ?? null,
        freight,
        tax,
        totalAmount: Number(invoice.total_amount) || null,
        lines: allInvLines.map(l => ({
          id: l.id,
          sku: l.item_id ? (skuMap.get(l.item_id as string) ?? null) : null,
          description: (l.description as string) ?? null,
          ansItemNumber: (l.ans_item_number as string) ?? null,
          qty: Number(l.qty) || 0,
          unitPrice: Number(l.unit_price) || 0,
          isTarget: l.id === invoiceLineId,
        })),
      },
      targetLine: {
        id: invoiceLineId,
        sku: targetInvLine?.item_id ? (skuMap.get(targetInvLine.item_id as string) ?? null) : null,
        qty: targetQty,
        unitPrice,
        overheadPerUnit: Math.round(overheadPerUnit * 10000) / 10000,
        landedUnitCost: Math.round((unitPrice + overheadPerUnit) * 10000) / 10000,
        alreadyMatchedQty,
        remainingQty: Math.max(0, targetQty - alreadyMatchedQty),
        matchedReceiptLines,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch line context: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    );
  }
}
