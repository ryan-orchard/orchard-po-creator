import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

// A PO's status is a roll-up of its line statuses (ordered < confirmed < complete).
function rollUpStatus(states: string[]): string {
  const active = states.filter((s) => s !== "cancelled");
  if (active.length === 0) return states.length > 0 ? "cancelled" : "ordered";
  if (active.every((s) => s === "complete")) return "complete";
  if (active.every((s) => s === "complete" || s === "confirmed")) return "confirmed";
  return "ordered";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [invoiceResult, statusResult, linesResult] = await Promise.all([
      db.schema("orchard").from("invoices").select("*").eq("id", id).single(),
      db.schema("orchard_calcs").from("invoice_statuses").select("payment_status, match_status").eq("invoice_id", id).maybeSingle(),
      db.schema("orchard").from("invoice_lines").select("*").eq("invoice_id", id),
    ]);

    if (invoiceResult.error || !invoiceResult.data) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const inv = invoiceResult.data as Record<string, unknown>;
    const invLines = linesResult.data ?? [];

    // Fetch supplier name
    let supplierName = "";
    if (inv.supplier_id) {
      const { data: supplier } = await db
        .schema("org_config")
        .from("suppliers")
        .select("name")
        .eq("id", inv.supplier_id as string)
        .single();
      supplierName = supplier?.name ?? "";
    }

    // Resolve item names for invoice lines
    const itemIds = [...new Set(invLines.map((l) => l.item_id as string).filter(Boolean))];
    const { data: itemsData } = itemIds.length
      ? await db.schema("org_config").from("items").select("id, sku").in("id", itemIds)
      : { data: [] };
    const itemMap = new Map((itemsData ?? []).map((i) => [i.id, i.sku as string]));

    const lines = invLines.map((l) => ({
      id: l.id,
      lineId: l.line_id ?? "",
      ansItemNumber: l.ans_item_number ?? "",
      description: l.description ?? "",
      skuName: l.item_id ? (itemMap.get(l.item_id as string) ?? null) : null,
      qtyBilled: Number(l.qty) || 0,
      unitCost: Number(l.unit_price) || 0,
      unit: l.unit ?? "EA",
      amount: Number(l.total) || 0,
      batchNumber: l.batch_number ?? "",
    }));

    // Fetch linked work order
    let linkedWorkOrder: { id: string; woNumber: string } | null = null;
    if (inv.wo_id) {
      const { data: wo } = await db
        .schema("orchard")
        .from("work_orders")
        .select("id, wo_number")
        .eq("id", inv.wo_id as string)
        .single();
      if (wo) linkedWorkOrder = { id: wo.id, woNumber: wo.wo_number };
    }

    // Fetch linked PO and receipts
    let purchaseOrder: { id: string; poNumber: string; status: string } | null = null;
    const receiptsById = new Map<
      string,
      { id: string; receiptNumber: string; receivedDate: string }
    >();

    if (inv.po_id) {
      const [poResult, receiptsResult, poLinesResult] = await Promise.all([
        db.schema("orchard").from("purchase_orders").select("id, po_number").eq("id", inv.po_id as string).single(),
        db.schema("orchard").from("receipts").select("id, receipt_number, received_date").eq("po_id", inv.po_id as string),
        db.schema("orchard").from("po_lines").select("id").eq("po_id", inv.po_id as string),
      ]);

      // Roll the PO status up from its line statuses.
      const poLineIds = (poLinesResult.data ?? []).map((l) => l.id as string);
      let poStatus = "ordered";
      if (poLineIds.length > 0) {
        const { data: ls } = await db
          .schema("orchard_calcs")
          .from("po_line_statuses")
          .select("po_line_id, state")
          .in("po_line_id", poLineIds);
        const stateByLine = new Map((ls ?? []).map((s) => [s.po_line_id, s.state]));
        poStatus = rollUpStatus(poLineIds.map((lid) => stateByLine.get(lid) ?? "ordered"));
      }

      if (poResult.data) {
        purchaseOrder = {
          id: poResult.data.id,
          poNumber: poResult.data.po_number,
          status: poStatus,
        };
      }

      for (const r of receiptsResult.data ?? []) {
        receiptsById.set(r.id, {
          id: r.id,
          receiptNumber: r.receipt_number,
          receivedDate: r.received_date ?? "",
        });
      }
    }

    // Also pull receipts linked directly to this invoice's lines via the
    // receipt_line ↔ invoice_line link table (the Link Invoice flow on the
    // Receipts page). These won't necessarily share the invoice's po_id.
    const invoiceLineIds = invLines.map((l) => l.id as string);
    if (invoiceLineIds.length > 0) {
      const { data: linkRows } = await db
        .schema("orchard_calcs")
        .from("receipt_line_invoice_line_links")
        .select("receipt_line_id")
        .in("invoice_line_id", invoiceLineIds);

      const linkedReceiptLineIds = [
        ...new Set((linkRows ?? []).map((r) => r.receipt_line_id as string)),
      ];

      if (linkedReceiptLineIds.length > 0) {
        const { data: linkedReceiptLines } = await db
          .schema("orchard")
          .from("receipt_lines")
          .select("receipt_id")
          .in("id", linkedReceiptLineIds);

        const linkedReceiptIds = [
          ...new Set(
            (linkedReceiptLines ?? [])
              .map((l) => l.receipt_id as string | null)
              .filter((id): id is string => Boolean(id))
          ),
        ];

        const missingReceiptIds = linkedReceiptIds.filter(
          (rid) => !receiptsById.has(rid)
        );
        if (missingReceiptIds.length > 0) {
          const { data: extraReceipts } = await db
            .schema("orchard")
            .from("receipts")
            .select("id, receipt_number, received_date")
            .in("id", missingReceiptIds);
          for (const r of extraReceipts ?? []) {
            receiptsById.set(r.id, {
              id: r.id,
              receiptNumber: r.receipt_number,
              receivedDate: r.received_date ?? "",
            });
          }
        }
      }
    }

    // Hydrate receipt lines for every receipt we ended up with
    const allReceiptIds = [...receiptsById.keys()];
    const linesByReceipt: Record<string, { sku: string; qtyReceived: number }[]> = {};
    if (allReceiptIds.length > 0) {
      const { data: receiptLinesData } = await db
        .schema("orchard")
        .from("receipt_lines")
        .select("receipt_id, item_id, qty_received")
        .in("receipt_id", allReceiptIds);

      // Resolve any item ids we haven't seen yet (linked receipts may
      // include SKUs that aren't on the invoice itself).
      const extraItemIds = [
        ...new Set(
          (receiptLinesData ?? [])
            .map((rl) => rl.item_id as string | null)
            .filter((id): id is string => Boolean(id) && !itemMap.has(id))
        ),
      ];
      if (extraItemIds.length > 0) {
        const { data: extraItems } = await db
          .schema("org_config")
          .from("items")
          .select("id, sku")
          .in("id", extraItemIds);
        for (const i of extraItems ?? []) {
          itemMap.set(i.id, i.sku as string);
        }
      }

      for (const rl of receiptLinesData ?? []) {
        if (!linesByReceipt[rl.receipt_id]) linesByReceipt[rl.receipt_id] = [];
        linesByReceipt[rl.receipt_id].push({
          sku: rl.item_id ? (itemMap.get(rl.item_id as string) ?? "Unknown") : "Unknown",
          qtyReceived: Number(rl.qty_received),
        });
      }
    }

    const receipts = [...receiptsById.values()]
      .map((r) => ({
        ...r,
        lines: linesByReceipt[r.id] ?? [],
      }))
      .sort((a, b) => (b.receivedDate || "").localeCompare(a.receivedDate || ""));

    // Look up source document (ingested_documents) for "View Original" link
    const { data: sourceDoc } = await db
      .schema("orchard")
      .from("ingested_documents")
      .select("id")
      .eq("created_record_id", id)
      .maybeSingle();

    return NextResponse.json({
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      invoiceDate: inv.invoice_date,
      dueDate: inv.due_date ?? "",
      supplier: supplierName,
      supplierId: inv.supplier_id ?? null,
      sourceDocumentId: sourceDoc?.id ?? null,
      salesOrder: inv.sales_order ?? "",
      poReference: inv.po_reference ?? "",
      paymentTerms: inv.payment_terms ?? "",
      trackingNumber: inv.tracking_number ?? "",
      deliveryTerms: inv.delivery_terms ?? "",
      shipTo: inv.ship_to_text ?? "",
      subtotal: Number(inv.subtotal) || 0,
      freight: Number(inv.freight) || 0,
      tax: Number(inv.tax) || 0,
      invoiceAmount: Number(inv.total_amount) || 0,
      matchStatus: statusResult.data?.match_status ?? "Unmatched",
      paymentStatus: statusResult.data?.payment_status ?? "Unpaid",
      classification: inv.classification ?? "",
      notes: inv.notes ?? "",
      invoiceType: inv.invoice_type ?? "Supplier",
      linkedWorkOrder,
      lines,
      purchaseOrder,
      receipts,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch invoice" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const fieldMap: Record<string, string> = {
    workOrderId: "wo_id",
    invoiceNumber: "invoice_number",
    invoiceDate: "invoice_date",
    dueDate: "due_date",
    poReference: "po_reference",
    poId: "po_id",
    paymentTerms: "payment_terms",
    salesOrder: "sales_order",
    trackingNumber: "tracking_number",
    deliveryTerms: "delivery_terms",
    shipTo: "ship_to_text",
    notes: "notes",
    invoiceType: "invoice_type",
    supplierId: "supplier_id",
    subtotal: "subtotal",
    freight: "freight",
    tax: "tax",
    invoiceAmount: "total_amount",
  };

  const updates: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in body) updates[col] = body[key] ?? null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await db.schema("orchard").from("invoices").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, id });
}
