import { NextRequest, NextResponse } from "next/server";
import {
  getRecords,
  getRecord,
  createRecord,
  createRecords,
  TABLES,
} from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";

export async function GET() {
  const records = await getRecords(TABLES.WORK_ORDERS, {
    sort: [{ field: "Issue Date", direction: "desc" }],
  });

  const wos = records.map((r) => ({
    id: r.id,
    woNumber: r.fields["WO Number"] as string,
    description: r.fields["Notes"] as string,
    warehouse: r.fields["Location"] as string[],
    status: r.fields["Status"] as string,
    issuedDate: r.fields["Issue Date"] as string,
    completedDate: r.fields["Completion Date"] as string,
    lineItems: r.fields["Work Order Lines"] as string[],
  }));

  return NextResponse.json(wos);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  // Generate WO number: WO-10001, WO-10002, ...
  const existingWOs = await getRecords(TABLES.WORK_ORDERS);
  let maxNum = 10000;
  for (const r of existingWOs) {
    const num = r.fields["WO Number"] as string;
    const match = num?.match(/^WO-(\d+)$/);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }
  const woNumber = `WO-${maxNum + 1}`;

  // Create WO header
  const wo = await createRecord(TABLES.WORK_ORDERS, {
    "WO Number": woNumber,
    Notes: body.description || "",
    Location: [body.warehouseId],
    Status: "Draft",
    "Issue Date": body.issuedDate || null,
  });

  // Create line items (both inputs and outputs)
  if (body.lineItems && body.lineItems.length > 0) {
    const lineItemRecords = body.lineItems.map(
      (item: {
        skuId: string;
        lineType: "Input" | "Output";
        qty: number;
      }) => ({
        fields: {
          "Work Order": [wo.id],
          SKU: [item.skuId],
          "Line Type": item.lineType,
          Quantity: item.qty,
        },
      })
    );

    await createRecords(TABLES.WORK_ORDER_LINES, lineItemRecords);
  }

  logActivity({
    woId: wo.id,
    action: "wo_created",
    description: `Created ${woNumber}: ${body.description || ""}`.trim(),
    actor: "Ryan Belanger",
    relatedRecordType: "work_order",
    relatedRecordId: wo.id,
  });

  return NextResponse.json({ id: wo.id, woNumber });
}
