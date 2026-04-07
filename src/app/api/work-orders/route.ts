import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import {
  getRecords,
  createRecord,
  createRecords,
  TABLES,
} from "@/lib/airtable";
import { generateNextNumber } from "@/lib/sequence";
import { logActivity } from "@/lib/activity-log";

export async function GET() {
  const [records, allLineItems, allSKUs] = await Promise.all([
    getRecords(TABLES.WORK_ORDERS, { sort: [{ field: "Issue Date", direction: "desc" }] }),
    getRecords(TABLES.WORK_ORDER_LINES),
    getRecords(TABLES.SKUS),
  ]);

  // Build SKU name lookup
  const skuMap = new Map(allSKUs.map((s) => [s.id, s.fields["Standard SKU"] as string]));

  // Group output SKU names by WO
  const outputSkusByWO: Record<string, string[]> = {};
  for (const li of allLineItems) {
    if ((li.fields["Line Type"] as string) !== "Output") continue;
    const woIds = (li.fields["Work Order"] as string[]) || [];
    const skuIds = (li.fields["SKU"] as string[]) || [];
    if (woIds[0] && skuIds[0]) {
      const skuName = skuMap.get(skuIds[0]);
      if (skuName) {
        if (!outputSkusByWO[woIds[0]]) outputSkusByWO[woIds[0]] = [];
        if (!outputSkusByWO[woIds[0]].includes(skuName)) outputSkusByWO[woIds[0]].push(skuName);
      }
    }
  }

  const wos = records.map((r) => ({
    id: r.id,
    woNumber: r.fields["WO Number"] as string,
    description: r.fields["Notes"] as string,
    warehouse: r.fields["Location"] as string[],
    status: r.fields["Status"] as string,
    issuedDate: r.fields["Issue Date"] as string,
    completedDate: r.fields["Completion Date"] as string,
    lineItems: r.fields["Work Order Lines"] as string[],
    outputSkus: outputSkusByWO[r.id] || [],
  }));

  return NextResponse.json(wos);
}

export async function POST(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  const body = await request.json();

  const woNumber = await generateNextNumber(TABLES.WORK_ORDERS, "WO Number", "WO");

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
