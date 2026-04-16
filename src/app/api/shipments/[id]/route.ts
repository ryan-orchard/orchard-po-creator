import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { data: shipment, error } = await db
      .schema("orchard")
      .from("shipments")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !shipment) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }

    type Shipment = {
      id: string; shipment_number: string; po_id: string | null; wo_id: string | null;
      shipped_date: string | null; estimated_delivery: string | null; carrier: string | null;
      carrier_reference: string | null; tracking_number: string | null; notes: string | null;
      location_id: string | null; status: string;
    };
    const s = shipment as Shipment;

    // Fetch PO details if linked
    let poNumber: string | null = null;
    let supplierName: string | null = null;
    if (s.po_id) {
      const { data: po } = await db
        .schema("orchard")
        .from("purchase_orders")
        .select("po_number, supplier_id")
        .eq("id", s.po_id)
        .single();
      if (po) {
        poNumber = po.po_number;
        if (po.supplier_id) {
          const { data: supplier } = await db
            .schema("org_config")
            .from("suppliers")
            .select("name")
            .eq("id", po.supplier_id)
            .single();
          supplierName = supplier?.name ?? null;
        }
      }
    }

    // Fetch ship-to location — from shipment, or fall back to PO's location
    let shipToId = s.location_id;
    if (!shipToId && s.po_id) {
      const { data: po } = await db
        .schema("orchard")
        .from("purchase_orders")
        .select("location_id")
        .eq("id", s.po_id)
        .single();
      shipToId = po?.location_id ?? null;
    }

    let shipTo = null;
    if (shipToId) {
      const { data: loc } = await db
        .schema("org_config")
        .from("locations")
        .select("id, name")
        .eq("id", shipToId)
        .single();
      if (loc) shipTo = { id: loc.id, name: loc.name, address: null, city: null, state: null, zip: null };
    }

    // Fetch receipts linked to this shipment
    const { data: receiptData } = await db
      .schema("orchard")
      .from("receipts")
      .select("id, receipt_number, received_date")
      .eq("shipment_id", id);

    const receipts = (receiptData ?? []).map((r) => ({
      id: r.id,
      receiptNumber: r.receipt_number,
      receivedDate: r.received_date ?? "",
    }));

    return NextResponse.json({
      id: s.id,
      shipmentNumber: s.shipment_number,
      purchaseOrderId: s.po_id,
      poNumber,
      supplierName,
      shipDate: s.shipped_date,
      expectedDeliveryDate: s.estimated_delivery,
      carrier: s.carrier,
      carrierReference: s.carrier_reference,
      trackingNumber: s.tracking_number,
      notes: s.notes,
      shipToId,
      shipTo,
      status: s.status,
      lineItems: [], // shipment lines not in v1 schema
      receipts,
    });
  } catch {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
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
    const updates: Record<string, unknown> = {
      shipped_date: body.shipDate || null,
      estimated_delivery: body.expectedDeliveryDate || null,
      carrier: body.carrier || null,
      carrier_reference: body.carrierReference || null,
      tracking_number: body.trackingNumber || null,
    };
    if (body.shipToId !== undefined) updates.location_id = body.shipToId || null;

    const { error } = await db.schema("orchard").from("shipments").update(updates).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update shipment" }, { status: 500 });
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
    const { error } = await db.schema("orchard").from("shipments").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete shipment" }, { status: 500 });
  }
}
