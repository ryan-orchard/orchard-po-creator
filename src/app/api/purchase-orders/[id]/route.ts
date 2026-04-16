import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { logActivity } from "@/lib/activity-log";
import { deriveCostBasis } from "@/lib/po-calc";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // PO header + status + lines (with items) in parallel
    const [poResult, statusResult, linesResult] = await Promise.all([
      db.schema("orchard").from("purchase_orders").select("*").eq("id", id).single(),
      db.schema("orchard_calcs").from("po_statuses").select("status").eq("po_id", id).maybeSingle(),
      db.schema("orchard").from("po_lines").select("*").eq("po_id", id),
    ]);

    if (poResult.error || !poResult.data) {
      return NextResponse.json({ error: "PO not found" }, { status: 404 });
    }

    const po = poResult.data as Record<string, unknown>;
    const poLines = linesResult.data ?? [];
    const poLineIds = poLines.map((l) => l.id as string);

    // Fetch supplier and location (ship-to) in parallel
    const [supplierResult, locationResult] = await Promise.all([
      db.schema("org_config").from("suppliers").select("id, name").eq("id", po.supplier_id as string).single(),
      db.schema("org_config").from("locations").select("id, name, code").eq("id", po.location_id as string).single(),
    ]);

    // Fetch item details for line items
    const itemIds = [...new Set(poLines.map((l) => l.item_id as string))];
    const { data: itemsData } = itemIds.length
      ? await db.schema("org_config").from("items").select("id, sku, unit_of_measure, sticks_per_carton, metadata").in("id", itemIds)
      : { data: [] };
    const itemMap = new Map((itemsData ?? []).map((i) => [i.id, i]));

    // Map line items
    type Item = { id: string; sku: string; unit_of_measure: string; sticks_per_carton: number | null; metadata: Record<string, unknown> | null };
    const lineItemsWithSkus = poLines.map((l) => {
      const item = itemMap.get(l.item_id as string) as Item | undefined;
      const uom = item?.unit_of_measure ?? "Each";
      const qty = Number(l.qty);
      return {
        id: l.id,
        skuId: l.item_id,
        sku: item
          ? {
              standardSku: item.sku,
              flavor: (item.metadata as Record<string, unknown>)?.flavor ?? null,
              count: item.sticks_per_carton,
              uom,
              category: (item.metadata as Record<string, unknown>)?.category ?? null,
              supplierItemName: (item.metadata as Record<string, unknown>)?.supplierItemName ?? null,
            }
          : null,
        section: null, // not stored in new schema
        qtyCartons: uom === "Carton" ? qty : null,
        qtySticks: uom !== "Carton" ? qty : null,
        unitCost: Number(l.unit_cost),
        costBasis: l.cost_basis,
        totalPrice: qty * Number(l.unit_cost),
      };
    });

    const grandTotal = lineItemsWithSkus.reduce((sum, l) => sum + l.totalPrice, 0);

    // Fetch linked receipts via link table
    let receipts: { id: string; receiptNumber: string; receivedDate: string | null; warehouse: string | null }[] = [];
    if (poLineIds.length > 0) {
      const { data: links } = await db
        .schema("orchard_calcs")
        .from("po_line_receipt_line_links")
        .select("receipt_line_id")
        .in("po_line_id", poLineIds);

      const receiptLineIds = [...new Set((links ?? []).map((l) => l.receipt_line_id as string))];
      if (receiptLineIds.length > 0) {
        const { data: receiptLines } = await db
          .schema("orchard")
          .from("receipt_lines")
          .select("receipt_id")
          .in("id", receiptLineIds);

        const receiptIds = [...new Set((receiptLines ?? []).map((l) => l.receipt_id as string))];
        if (receiptIds.length > 0) {
          const { data: receiptData } = await db
            .schema("orchard")
            .from("receipts")
            .select("id, receipt_number, received_date, location_id")
            .in("id", receiptIds);

          // Get location codes for warehouse display
          const locIds = [...new Set((receiptData ?? []).map((r) => r.location_id as string))];
          const { data: locsData } = locIds.length
            ? await db.schema("org_config").from("locations").select("id, code").in("id", locIds)
            : { data: [] };
          const locCodeMap = new Map((locsData ?? []).map((l) => [l.id, l.code]));

          receipts = (receiptData ?? []).map((r) => ({
            id: r.id,
            receiptNumber: r.receipt_number,
            receivedDate: r.received_date ?? null,
            warehouse: locCodeMap.get(r.location_id) ?? null,
          }));
        }
      }
    }

    // Fetch linked invoices via link table
    let invoices: {
      id: string; invoiceNumber: string; invoiceDate: string | null;
      matchStatus: string | null; paymentStatus: string; totalAmount: number | null;
    }[] = [];
    if (poLineIds.length > 0) {
      const { data: invLinks } = await db
        .schema("orchard_calcs")
        .from("po_line_invoice_line_links")
        .select("invoice_line_id")
        .in("po_line_id", poLineIds);

      const invoiceLineIds = [...new Set((invLinks ?? []).map((l) => l.invoice_line_id as string))];
      if (invoiceLineIds.length > 0) {
        const { data: invLines } = await db
          .schema("orchard")
          .from("invoice_lines")
          .select("invoice_id")
          .in("id", invoiceLineIds);

        const invoiceIds = [...new Set((invLines ?? []).map((l) => l.invoice_id as string))];
        if (invoiceIds.length > 0) {
          const [{ data: invData }, { data: invStatuses }] = await Promise.all([
            db.schema("orchard").from("invoices").select("id, invoice_number, invoice_date, total_amount").in("id", invoiceIds),
            db.schema("orchard_calcs").from("invoice_statuses").select("invoice_id, payment_status").in("invoice_id", invoiceIds),
          ]);
          const payStatusMap = new Map((invStatuses ?? []).map((s) => [s.invoice_id, s.payment_status]));
          invoices = (invData ?? []).map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoice_number,
            invoiceDate: inv.invoice_date ?? null,
            matchStatus: null, // match status not yet in Silver
            paymentStatus: payStatusMap.get(inv.id) ?? "Unpaid",
            totalAmount: inv.total_amount ?? null,
          }));
        }
      }
    }

    const supplier = supplierResult.data;
    const location = locationResult.data;

    return NextResponse.json({
      id: po.id,
      poNumber: po.po_number,
      date: po.order_date,
      status: statusResult.data?.status ?? "Draft",
      deliveryDate: po.delivery_date ?? null,
      shippingTerms: po.shipping_terms ?? null,
      paymentTerms: po.payment_terms ?? null,
      notes: po.notes ?? null,
      soNumber: po.so_number ?? null,
      grandTotal,
      supplierId: po.supplier_id,
      shipToId: po.location_id,
      supplier: supplier ? { id: supplier.id, name: supplier.name, address: null, city: null, state: null, zip: null } : null,
      shipTo: location ? { id: location.id, name: location.name, address: null, city: null, state: null, zip: null } : null,
      lineItems: lineItemsWithSkus,
      receipts,
      invoices,
    });
  } catch (error) {
    console.error("PO detail fetch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load PO" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;
  const { id } = await params;
  const body = await request.json();

  try {
    type LineItemInput = {
      skuId: string;
      uom: string;
      qtySticks: number;
      qtyCartons: number | null;
      unitCost: number;
    };
    const lineItems: LineItemInput[] = body.lineItems ?? [];

    // Update PO header
    const { error: updateError } = await db
      .schema("orchard")
      .from("purchase_orders")
      .update({
        order_date: body.date,
        supplier_id: body.supplierId,
        location_id: body.shipToId,
        delivery_date: body.deliveryDate || null,
        shipping_terms: body.shippingTerms || null,
        payment_terms: body.paymentTerms || null,
        notes: body.notes || null,
      })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Delete existing line items (fails if receipt/invoice links exist — intentional)
    const { error: delError } = await db
      .schema("orchard")
      .from("po_lines")
      .delete()
      .eq("po_id", id);

    if (delError) {
      return NextResponse.json(
        { error: "Cannot edit a PO that has linked receipts or invoices" },
        { status: 409 }
      );
    }

    // Recreate line items
    if (lineItems.length > 0) {
      const lineRows = lineItems.map((item) => ({
        po_id: id,
        item_id: item.skuId,
        qty: item.uom === "Carton" ? (item.qtyCartons ?? 0) : item.qtySticks,
        unit_cost: item.unitCost,
        cost_basis: deriveCostBasis(item.uom),
      }));
      const { error: lineError } = await db.schema("orchard").from("po_lines").insert(lineRows);
      if (lineError) {
        return NextResponse.json({ error: lineError.message }, { status: 500 });
      }
    }

    // Fetch PO number for activity log
    const { data: poData } = await db.schema("orchard").from("purchase_orders").select("po_number").eq("id", id).single();
    const poNumber = poData?.po_number ?? id;

    logActivity({
      poId: id,
      action: "po_edited",
      description: `Edited ${poNumber}`,
      actor: "Ryan Belanger",
      relatedRecordType: "po",
      relatedRecordId: id,
    });

    return NextResponse.json({ id, poNumber });
  } catch {
    return NextResponse.json({ error: "Failed to update PO" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;
  const { id } = await params;

  try {
    // Delete line items first (fails if links exist — intentional)
    const { error: delLinesError } = await db
      .schema("orchard")
      .from("po_lines")
      .delete()
      .eq("po_id", id);

    if (delLinesError) {
      return NextResponse.json(
        { error: "Cannot delete a PO that has linked receipts or invoices" },
        { status: 409 }
      );
    }

    // Delete status row
    await db.schema("orchard_calcs").from("po_statuses").delete().eq("po_id", id);

    // Delete PO
    const { error: delPoError } = await db
      .schema("orchard")
      .from("purchase_orders")
      .delete()
      .eq("id", id);

    if (delPoError) {
      return NextResponse.json({ error: delPoError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete PO" }, { status: 500 });
  }
}
