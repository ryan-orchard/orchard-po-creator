import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { generateNextNumber } from "@/lib/sequence";
import { logActivity } from "@/lib/activity-log";
import { deriveCostBasis } from "@/lib/po-calc";

export async function GET() {
  const [posResult, statusesResult, linesResult, itemsResult] = await Promise.all([
    db.schema("orchard").from("purchase_orders").select("*").order("order_date", { ascending: false }),
    db.schema("orchard_calcs").from("po_statuses").select("po_id, status"),
    db.schema("orchard").from("po_lines").select("id, po_id, qty, unit_cost, item_id"),
    db.schema("org_config").from("items").select("id, sku"),
  ]);

  if (posResult.error) return NextResponse.json({ error: posResult.error.message }, { status: 500 });

  const statuses = new Map((statusesResult.data ?? []).map((s) => [s.po_id, s.status]));
  const items = new Map((itemsResult.data ?? []).map((i) => [i.id, i.sku]));

  // Grand total, line IDs, and SKU list per PO — one pass over lines
  const totalsByPO: Record<string, number> = {};
  const lineIdsByPO: Record<string, string[]> = {};
  const skusByPO: Record<string, string[]> = {};
  for (const l of linesResult.data ?? []) {
    totalsByPO[l.po_id] = (totalsByPO[l.po_id] ?? 0) + Number(l.qty) * Number(l.unit_cost);
    if (!lineIdsByPO[l.po_id]) lineIdsByPO[l.po_id] = [];
    lineIdsByPO[l.po_id].push(l.id);
    const sku = items.get(l.item_id);
    if (sku) {
      if (!skusByPO[l.po_id]) skusByPO[l.po_id] = [];
      if (!skusByPO[l.po_id].includes(sku)) skusByPO[l.po_id].push(sku);
    }
  }

  type PO = {
    id: string;
    po_number: string;
    order_date: string;
    supplier_id: string;
    location_id: string;
    delivery_date: string | null;
    shipping_terms: string | null;
    payment_terms: string | null;
    notes: string | null;
  };

  const pos = (posResult.data as PO[]).map((po) => ({
    id: po.id,
    poNumber: po.po_number,
    date: po.order_date,
    status: statuses.get(po.id) ?? "Draft",
    supplier: [po.supplier_id],
    shipTo: [po.location_id],
    deliveryDate: po.delivery_date,
    shippingTerms: po.shipping_terms,
    paymentTerms: po.payment_terms,
    notes: po.notes,
    grandTotal: totalsByPO[po.id] ?? 0,
    lineItems: lineIdsByPO[po.id] ?? [],
    skus: skusByPO[po.id] ?? [],
  }));

  return NextResponse.json(pos);
}

export async function POST(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  const body = await request.json();

  const poNumber = await generateNextNumber("PO");

  type LineItemInput = {
    skuId: string;
    uom: string;
    count: number | null;
    qtySticks: number;
    qtyCartons: number | null;
    unitCost: number;
  };

  const lineItems: LineItemInput[] = body.lineItems ?? [];

  // Insert PO header
  const { data: po, error: poError } = await db
    .schema("orchard")
    .from("purchase_orders")
    .insert({
      po_number: poNumber,
      order_date: body.date,
      supplier_id: body.supplierId,
      location_id: body.shipToId,
      delivery_date: body.deliveryDate || null,
      shipping_terms: body.shippingTerms || null,
      payment_terms: body.paymentTerms || null,
      notes: body.notes || null,
      so_number: null,
    })
    .select("id")
    .single();

  if (poError || !po) {
    return NextResponse.json({ error: poError?.message ?? "Failed to create PO" }, { status: 500 });
  }

  // Insert status
  await db.schema("orchard_calcs").from("po_statuses").insert({
    po_id: po.id,
    status: "Draft",
    updated_by: "Ryan Belanger",
  });

  // Insert line items
  if (lineItems.length > 0) {
    const lineRows = lineItems.map((item) => ({
      po_id: po.id,
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

  logActivity({
    poId: po.id,
    action: "po_created",
    description: `Created ${poNumber}`,
    actor: "Ryan Belanger",
    relatedRecordType: "po",
    relatedRecordId: po.id,
  });

  return NextResponse.json({ id: po.id, poNumber });
}
