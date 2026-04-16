import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { generateNextNumber } from "@/lib/sequence";
import { logActivity } from "@/lib/activity-log";

export async function GET() {
  const { data, error } = await db
    .schema("orchard")
    .from("shipments")
    .select("*")
    .order("shipped_date", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Shipment = {
    id: string; shipment_number: string; po_id: string | null; wo_id: string | null;
    shipped_date: string | null; estimated_delivery: string | null; carrier: string | null;
    carrier_reference: string | null; tracking_number: string | null;
    location_id: string | null; status: string;
  };

  const shipments = (data as Shipment[]).map((s) => ({
    id: s.id,
    shipmentNumber: s.shipment_number,
    purchaseOrder: s.po_id ? [s.po_id] : [],
    workOrder: s.wo_id ? [s.wo_id] : [],
    shipDate: s.shipped_date,
    expectedDeliveryDate: s.estimated_delivery,
    carrier: s.carrier,
    carrierReference: s.carrier_reference,
    trackingNumber: s.tracking_number,
    shipTo: s.location_id ? [s.location_id] : [],
    status: s.status,
    shipmentLines: [], // shipment lines not in v1 schema
  }));

  return NextResponse.json(shipments);
}

export async function POST(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  const body = await request.json();
  const shipmentNumber = await generateNextNumber("SH");

  const { data: shipment, error } = await db
    .schema("orchard")
    .from("shipments")
    .insert({
      shipment_number: shipmentNumber,
      po_id: body.purchaseOrderId || null,
      wo_id: body.workOrderId || null,
      shipped_date: body.shipDate || null,
      estimated_delivery: body.expectedDeliveryDate || null,
      carrier: body.carrier || null,
      carrier_reference: body.carrierReference || null,
      tracking_number: body.trackingNumber || null,
      location_id: body.shipToId || null,
      status: "Created",
    })
    .select("id")
    .single();

  if (error || !shipment) {
    return NextResponse.json({ error: error?.message ?? "Failed to create shipment" }, { status: 500 });
  }

  // Shipment lines not stored in v1 Supabase schema

  logActivity({
    poId: body.purchaseOrderId || undefined,
    woId: body.workOrderId || undefined,
    action: "shipment_created",
    description: `Shipment ${shipmentNumber} created`,
    actor: "Ryan Belanger",
    relatedRecordType: "shipment",
    relatedRecordId: shipment.id,
  });

  return NextResponse.json({ id: shipment.id, shipmentNumber });
}
