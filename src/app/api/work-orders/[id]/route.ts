import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { logActivity } from "@/lib/activity-log";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [woResult, linesResult] = await Promise.all([
      db.schema("orchard").from("work_orders").select("*").eq("id", id).single(),
      db.schema("orchard").from("work_order_lines").select("*").eq("wo_id", id),
    ]);

    if (woResult.error || !woResult.data) {
      return NextResponse.json({ error: "Work Order not found" }, { status: 404 });
    }

    const wo = woResult.data as Record<string, unknown>;
    const lines = linesResult.data ?? [];

    // Fetch item details and warehouse
    const itemIds = [...new Set(lines.map((l) => l.item_id as string))];
    const [itemsResult, warehouseResult] = await Promise.all([
      itemIds.length
        ? db.schema("org_config").from("items").select("id, sku, unit_of_measure, sticks_per_carton, metadata").in("id", itemIds)
        : { data: [] },
      db.schema("org_config").from("locations").select("id, name, code").eq("id", wo.location_id as string).single(),
    ]);

    const itemMap = new Map((itemsResult.data ?? []).map((i) => [i.id, i]));
    type Item = { id: string; sku: string; unit_of_measure: string; sticks_per_carton: number | null; metadata: Record<string, unknown> | null };

    const lineItemsWithSkus = lines.map((l) => {
      const item = itemMap.get(l.item_id as string) as Item | undefined;
      return {
        id: l.id,
        skuId: l.item_id,
        sku: item
          ? {
              standardSku: item.sku,
              flavor: item.metadata?.flavor ?? null,
              count: item.sticks_per_carton,
              uom: item.unit_of_measure,
              category: item.metadata?.category ?? null,
            }
          : null,
        lineType: l.line_type,
        qty: Number(l.qty),
      };
    });

    const inputs = lineItemsWithSkus.filter((l) => l.lineType === "Input");
    const outputs = lineItemsWithSkus.filter((l) => l.lineType === "Output");

    // Fetch linked receipts via wo_receipt_links
    const { data: woReceiptLinks } = await db
      .schema("orchard_calcs")
      .from("wo_receipt_links")
      .select("receipt_id")
      .eq("wo_id", id);

    const receiptIds = (woReceiptLinks ?? []).map((l) => l.receipt_id as string);
    let receipts: { id: string; receiptNumber: string; receivedDate: string | null; warehouse: string | null }[] = [];
    if (receiptIds.length > 0) {
      const { data: receiptData } = await db
        .schema("orchard")
        .from("receipts")
        .select("id, receipt_number, received_date, location_id")
        .in("id", receiptIds);
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

    // Fetch linked shipments (via wo_id FK)
    const { data: shipmentsData } = await db
      .schema("orchard")
      .from("shipments")
      .select("id, shipment_number, shipped_date, status")
      .eq("wo_id", id);

    const shipments = (shipmentsData ?? []).map((s) => ({
      id: s.id,
      shipmentNumber: s.shipment_number,
      shipDate: s.shipped_date ?? null,
      status: s.status ?? null,
    }));

    const warehouse = warehouseResult.data;

    return NextResponse.json({
      id: wo.id,
      woNumber: wo.wo_number,
      description: wo.notes,
      status: wo.status,
      issuedDate: wo.issued_date,
      completedDate: wo.completed_date,
      warehouseId: wo.location_id,
      warehouse: warehouse ? { id: warehouse.id, name: warehouse.name, code: warehouse.code } : null,
      inputs,
      outputs,
      lineItems: lineItemsWithSkus,
      shipments,
      receipts,
      invoices: [], // WO → invoice linking not yet in Silver layer
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Work Order" },
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
    const { data: existing } = await db
      .schema("orchard")
      .from("work_orders")
      .select("wo_number")
      .eq("id", id)
      .single();
    const woNumber = existing?.wo_number ?? id;

    await db.schema("orchard").from("work_orders").update({
      notes: body.description || null,
      location_id: body.warehouseId,
      issued_date: body.issuedDate || null,
    }).eq("id", id);

    // Delete and recreate line items
    await db.schema("orchard").from("work_order_lines").delete().eq("wo_id", id);

    if (body.lineItems && body.lineItems.length > 0) {
      const lineRows = (body.lineItems as { skuId: string; lineType: "Input" | "Output"; qty: number }[]).map((item) => ({
        wo_id: id,
        item_id: item.skuId,
        line_type: item.lineType,
        qty: item.qty,
      }));
      await db.schema("orchard").from("work_order_lines").insert(lineRows);
    }

    logActivity({
      woId: id,
      action: "wo_edited",
      description: `Edited ${woNumber}`,
      actor: "Ryan Belanger",
      relatedRecordType: "work_order",
      relatedRecordId: id,
    });

    return NextResponse.json({ id, woNumber });
  } catch {
    return NextResponse.json({ error: "Failed to update Work Order" }, { status: 500 });
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
    // work_order_lines cascade via FK ON DELETE CASCADE
    const { error } = await db.schema("orchard").from("work_orders").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete Work Order" }, { status: 500 });
  }
}
