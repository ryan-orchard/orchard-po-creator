import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

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

    // Fetch linked shipment and work order
    let linkedShipment: { id: string; shipmentNumber: string } | null = null;
    if (inv.shipment_id) {
      const { data: shipment } = await db
        .schema("orchard")
        .from("shipments")
        .select("id, shipment_number")
        .eq("id", inv.shipment_id as string)
        .single();
      if (shipment) linkedShipment = { id: shipment.id, shipmentNumber: shipment.shipment_number };
    }

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

    // Fetch linked PO, receipts, and shipments via po_id
    let purchaseOrder: { id: string; poNumber: string; status: string } | null = null;
    let receipts: { id: string; receiptNumber: string; receivedDate: string; lines: { sku: string; qtyReceived: number }[] }[] = [];
    let shipments: { id: string; shipmentNumber: string; shipDate: string; status: string }[] = [];

    if (inv.po_id) {
      const [poResult, poStatusResult, receiptsResult, shipmentsResult] = await Promise.all([
        db.schema("orchard").from("purchase_orders").select("id, po_number").eq("id", inv.po_id as string).single(),
        db.schema("orchard_calcs").from("po_statuses").select("status").eq("po_id", inv.po_id as string).maybeSingle(),
        db.schema("orchard").from("receipts").select("id, receipt_number, received_date").eq("po_id", inv.po_id as string),
        db.schema("orchard").from("shipments").select("id, shipment_number, shipped_date, status").eq("po_id", inv.po_id as string),
      ]);

      if (poResult.data) {
        purchaseOrder = {
          id: poResult.data.id,
          poNumber: poResult.data.po_number,
          status: poStatusResult.data?.status ?? "Draft",
        };
      }

      // Receipts with their lines
      const poReceiptIds = (receiptsResult.data ?? []).map((r) => r.id as string);
      if (poReceiptIds.length > 0) {
        const { data: receiptLinesData } = await db
          .schema("orchard")
          .from("receipt_lines")
          .select("receipt_id, item_id, qty_received")
          .in("receipt_id", poReceiptIds);

        const linesByReceipt: Record<string, { sku: string; qtyReceived: number }[]> = {};
        for (const rl of receiptLinesData ?? []) {
          if (!linesByReceipt[rl.receipt_id]) linesByReceipt[rl.receipt_id] = [];
          linesByReceipt[rl.receipt_id].push({
            sku: rl.item_id ? (itemMap.get(rl.item_id as string) ?? "Unknown") : "Unknown",
            qtyReceived: Number(rl.qty_received),
          });
        }

        receipts = (receiptsResult.data ?? []).map((r) => ({
          id: r.id,
          receiptNumber: r.receipt_number,
          receivedDate: r.received_date ?? "",
          lines: linesByReceipt[r.id] ?? [],
        }));
      }

      shipments = (shipmentsResult.data ?? []).map((s) => ({
        id: s.id,
        shipmentNumber: s.shipment_number,
        shipDate: s.shipped_date ?? "",
        status: s.status ?? "",
      }));
    }

    return NextResponse.json({
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      invoiceDate: inv.invoice_date,
      supplier: supplierName,
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
      matchStatus: statusResult.data?.match_status ?? inv.match_status ?? "Open",
      paymentStatus: statusResult.data?.payment_status ?? "Unpaid",
      classification: inv.classification ?? "",
      notes: inv.notes ?? "",
      invoiceType: inv.invoice_type ?? "Supplier",
      linkedShipment,
      linkedWorkOrder,
      lines,
      purchaseOrder,
      receipts,
      shipments,
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

  const updates: Record<string, unknown> = {};
  if ("shipmentId" in body) updates.shipment_id = body.shipmentId || null;
  if ("workOrderId" in body) updates.wo_id = body.workOrderId || null;
  if ("status" in body) updates.match_status = body.status;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await db.schema("orchard").from("invoices").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sync match_status to invoice_statuses table too
  if ("status" in body) {
    await db
      .schema("orchard_calcs")
      .from("invoice_statuses")
      .upsert({ invoice_id: id, match_status: body.status, updated_by: "Ryan Belanger" }, { onConflict: "invoice_id" });
  }

  return NextResponse.json({ success: true, id });
}
