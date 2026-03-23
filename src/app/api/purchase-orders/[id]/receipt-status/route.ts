import { NextRequest, NextResponse } from "next/server";
import { getRecord, getRecords, TABLES } from "@/lib/airtable";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const po = await getRecord(TABLES.PURCHASE_ORDERS, id);
    if (!po || !po.id) {
      return NextResponse.json({ error: "PO not found" }, { status: 404 });
    }

    // Fetch PO line items
    const lineItemIds = (po.fields["PO Line Items"] as string[]) || [];
    const lineItems = await Promise.all(
      lineItemIds.map((liId: string) => getRecord(TABLES.PO_LINE_ITEMS, liId))
    );

    // Fetch all receipt lines that reference any of these PO line items
    // Receipt lines have a "PO Line Item" link field when matched
    const allReceiptLines = await getRecords(TABLES.RECEIPT_LINES);

    // Build qty received per PO line item (from matched receipt lines)
    const receivedByLineItem: Record<string, number> = {};
    for (const rl of allReceiptLines) {
      const poLineIds = rl.fields["PO Line Item"] as string[] | undefined;
      if (poLineIds?.[0] && lineItemIds.includes(poLineIds[0])) {
        receivedByLineItem[poLineIds[0]] =
          (receivedByLineItem[poLineIds[0]] || 0) +
          ((rl.fields["Qty Received"] as number) || 0);
      }
    }

    // Fetch SKU details for each line item
    const result = await Promise.all(
      lineItems.map(async (li) => {
        const skuIds = (li.fields["SKU"] as string[]) || [];
        const sku = skuIds[0]
          ? await getRecord(TABLES.SKUS, skuIds[0])
          : null;
        const qtyOrdered = (li.fields["Qty Sticks"] as number) || 0;
        const qtyReceived = receivedByLineItem[li.id] || 0;

        return {
          id: li.id,
          skuId: skuIds[0] || null,
          sku: sku
            ? {
                standardSku: sku.fields["Standard SKU"] as string,
                flavor: sku.fields["Flavor"] as string,
                uom: sku.fields["UOM"] as string,
                count: sku.fields["Sticks per Carton"] as number | null,
                category: sku.fields["Category"] as string,
              }
            : null,
          section: li.fields["Section"] as string,
          qtyOrdered,
          qtyCartons: (li.fields["Qty Cartons"] as number) || 0,
          qtyReceived,
          qtyRemaining: Math.max(0, qtyOrdered - qtyReceived),
        };
      })
    );

    return NextResponse.json({
      poId: id,
      poNumber: po.fields["PO Number"] as string,
      lineItems: result,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch receipt status" },
      { status: 500 }
    );
  }
}
