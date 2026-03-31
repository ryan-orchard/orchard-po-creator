import { NextRequest, NextResponse } from "next/server";
import { getRecord, getRecords, TABLES } from "@/lib/airtable";

/**
 * GET /api/match/[invoiceId]
 *
 * Returns the full match state for the Universal Match page:
 * - Invoice summary
 * - Linked order (PO or WO)
 * - Receipts (linked to the order, with confirmation status)
 * - Summary counts for progress bar
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;

    const invoiceRecord = await getRecord(TABLES.INVOICES, invoiceId);
    if (!invoiceRecord) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const f = invoiceRecord.fields;

    // Resolve supplier name
    let supplier = "";
    const supplierIds = f["Supplier"] as string[] | undefined;
    if (supplierIds?.length) {
      const s = await getRecord(TABLES.SUPPLIERS, supplierIds[0]);
      supplier = (s?.fields["Supplier Name"] as string) || "";
    }

    // Invoice summary
    const invoice = {
      id: invoiceRecord.id,
      invoiceNumber: (f["Invoice Number"] as string) || "",
      supplier,
      invoiceDate: (f["Invoice Date"] as string) || "",
      invoiceAmount: (f["Total Amount"] as number) || 0,
      paymentStatus: (f["Payment Status"] as string) || "Unpaid",
      invoiceType: (f["Type"] as string) || "Supplier",
      matchStatus: (f["Match Status"] as string) || "Open",
      poReference: (f["PO Reference"] as string) || "",
    };

    // Linked order
    const linkedPOIds = (f["Purchase Order"] as string[] | undefined) || [];
    const linkedWOIds = (f["Work Orders"] as string[] | undefined) || [];

    let order: {
      type: "po" | "wo";
      id: string;
      number: string;
      status: string;
      date: string;
      supplier: string;
    } | null = null;

    if (linkedPOIds.length > 0) {
      const po = await getRecord(TABLES.PURCHASE_ORDERS, linkedPOIds[0]);
      if (po) {
        order = {
          type: "po",
          id: po.id,
          number: (po.fields["PO Number"] as string) || "",
          status: (po.fields["Status"] as string) || "",
          date: (po.fields["Date"] as string) || "",
          supplier: "",
        };
        // Resolve PO supplier
        const poSupplierIds = po.fields["Supplier"] as string[] | undefined;
        if (poSupplierIds?.length) {
          const poSupplier = await getRecord(TABLES.SUPPLIERS, poSupplierIds[0]);
          order.supplier = (poSupplier?.fields["Supplier Name"] as string) || "";
        }
      }
    } else if (linkedWOIds.length > 0) {
      const wo = await getRecord(TABLES.WORK_ORDERS, linkedWOIds[0]);
      if (wo) {
        order = {
          type: "wo",
          id: wo.id,
          number: (wo.fields["WO Number"] as string) || "",
          status: (wo.fields["Status"] as string) || "",
          date: (wo.fields["Created Time"] as string) || "",
          supplier: "ANS",
        };
      }
    }

    // Fetch invoice lines to know which receipt lines are confirmed
    const invoiceLineIds = (f["Invoice Lines"] as string[] | undefined) || [];
    const confirmedReceiptLineIds = new Set<string>();

    if (invoiceLineIds.length > 0) {
      const invoiceLines = await Promise.all(
        invoiceLineIds.map((lid) => getRecord(TABLES.INVOICE_LINES, lid))
      );
      for (const il of invoiceLines) {
        if (!il) continue;
        const receiptLineLink = il.fields["Receipt Line"] as string[] | undefined;
        if (receiptLineLink?.length) {
          confirmedReceiptLineIds.add(receiptLineLink[0]);
        }
      }
    }

    // Fetch receipts linked to the order (or all open receipts if no order)
    let allReceipts = await getRecords(TABLES.RECEIPTS, {
      sort: [{ field: "Received Date", direction: "asc" }],
    });

    if (order) {
      const orderId = order.id;
      const orderType = order.type;
      allReceipts = allReceipts.filter((r) => {
        if (orderType === "po") {
          const poIds = r.fields["Purchase Order"] as string[] | undefined;
          return poIds?.[0] === orderId;
        } else {
          const woIds = r.fields["Work Order"] as string[] | undefined;
          return woIds?.[0] === orderId;
        }
      });
    } else {
      // No order linked: show all open receipts so user can still confirm without a PO/WO
      allReceipts = allReceipts.filter((r) => {
        const status = (r.fields["Match Status"] as string) || "";
        return !status || status === "Open";
      });
    }

    // Fetch receipt lines for all relevant receipts
    const receiptIds = allReceipts.map((r) => r.id);
    let allReceiptLines: Awaited<ReturnType<typeof getRecords>> = [];
    if (receiptIds.length > 0) {
      allReceiptLines = await getRecords(TABLES.RECEIPT_LINES);
      allReceiptLines = allReceiptLines.filter((rl) => {
        const receiptLink = rl.fields["Receipt"] as string[] | undefined;
        return receiptLink?.[0] && receiptIds.includes(receiptLink[0]);
      });
    }

    // Fetch warehouse names
    const warehouseIds = new Set<string>();
    for (const r of allReceipts) {
      const wIds = r.fields["Warehouses"] as string[] | undefined;
      if (wIds?.[0]) warehouseIds.add(wIds[0]);
    }
    const warehouseMap: Record<string, string> = {};
    for (const wId of warehouseIds) {
      const w = await getRecord(TABLES.WAREHOUSES, wId);
      if (w) warehouseMap[wId] = (w.fields["Name"] as string) || (w.fields["Code"] as string) || wId;
    }

    // Build receipt objects with confirmation status
    const receipts = allReceipts.map((r) => {
      const rf = r.fields;
      const warehouseId = (rf["Warehouses"] as string[] | undefined)?.[0];
      const warehouse = warehouseId ? warehouseMap[warehouseId] || "" : "";

      const thisReceiptLines = allReceiptLines.filter((rl) => {
        const receiptLink = rl.fields["Receipt"] as string[] | undefined;
        return receiptLink?.[0] === r.id;
      });

      const totalCartons = thisReceiptLines.reduce(
        (sum, rl) => sum + ((rl.fields["Qty Received"] as number) || 0),
        0
      );

      // A receipt is confirmed if at least one of its lines is linked to this invoice
      const confirmed = thisReceiptLines.some((rl) => confirmedReceiptLineIds.has(rl.id));

      return {
        id: r.id,
        receiptNumber: (rf["Receipt Number"] as string) || "",
        receivedDate: (rf["Received Date"] as string) || "",
        warehouse,
        totalCartons,
        confirmed,
        lineCount: thisReceiptLines.length,
        matchStatus: (rf["Match Status"] as string) || "Open",
      };
    });

    // Summary
    const confirmedReceipts = receipts.filter((r) => r.confirmed);
    const totalCartons = receipts.reduce((s, r) => s + r.totalCartons, 0);
    const noOrderState = !linkedPOIds.length && !linkedWOIds.length &&
      (invoice.matchStatus === "Matched" || invoice.matchStatus === "Approved");
    const orderLinked = !!order || noOrderState;
    const receiptsConfirmed = receipts.length > 0 && confirmedReceipts.length === receipts.length;

    let linkedCount = 1; // invoice is always linked (we're here from it)
    if (orderLinked) linkedCount++;
    if (receiptsConfirmed) linkedCount++;

    return NextResponse.json({
      invoice,
      order,
      noOrderConfirmed: noOrderState,
      receipts,
      summary: {
        invoiceLinked: true,
        orderLinked,
        receiptsConfirmed,
        confirmedCount: confirmedReceipts.length,
        totalReceipts: receipts.length,
        totalCartons,
        linkedCount,
      },
    });
  } catch (error) {
    console.error("Match state error:", error);
    return NextResponse.json({ error: "Failed to load match state" }, { status: 500 });
  }
}
