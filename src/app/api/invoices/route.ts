import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import {
  getRecords,
  createRecord,
  createRecords,
  TABLES,
} from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";

export async function GET() {
  try {
    const records = await getRecords(TABLES.INVOICES, {
      sort: [{ field: "Invoice Date", direction: "desc" }],
    });

    // Resolve supplier names
    const supplierIds = new Set<string>();
    records.forEach((r) => {
      const s = r.fields["Supplier"] as string[] | undefined;
      if (s?.[0]) supplierIds.add(s[0]);
    });
    const supplierMap: Record<string, string> = {};
    if (supplierIds.size > 0) {
      const suppliers = await getRecords(TABLES.SUPPLIERS);
      suppliers.forEach((s) => {
        supplierMap[s.id] = (s.fields["Supplier Name"] as string) || "";
      });
    }

    const invoices = records.map((r) => {
      const supplierId = (r.fields["Supplier"] as string[] | undefined)?.[0];
      const poLink = (r.fields["Purchase Order"] as string[] | undefined)?.[0];
      return {
        id: r.id,
        invoiceNumber: (r.fields["Invoice Number"] as string) || "",
        invoiceDate: (r.fields["Invoice Date"] as string) || "",
        supplier: supplierId ? supplierMap[supplierId] || null : null,
        poReference: (r.fields["PO Reference"] as string) || "",
        salesOrder: (r.fields["Sales Order"] as string) || "",
        purchaseOrder: poLink || null,
        invoiceAmount: (r.fields["Total Amount"] as number) || 0,
        matchStatus: (r.fields["Status"] as string) || "Open",
        paymentStatus: (r.fields["Payment Status"] as string) || "Unpaid",
        lineCount: (r.fields["Invoice Lines"] as string[])?.length || 0,
      };
    });

    return NextResponse.json(invoices);
  } catch (error) {
    console.error("Error fetching invoices:", error);
    return NextResponse.json(
      { error: "Failed to fetch invoices" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  try {
    const body = await request.json();

    // Check for duplicate invoice
    const existing = await getRecords(TABLES.INVOICES, {
      filterByFormula: `{Invoice Number} = "${body.invoiceNumber}"`,
    });
    if (existing.length > 0) {
      return NextResponse.json(
        { error: `Invoice ${body.invoiceNumber} already exists in Airtable` },
        { status: 409 }
      );
    }

    // Look up supplier — ANS by code (existing invoices) or by name (universal invoices)
    let supplierId: string | null = null;
    if (!body.invoiceType) {
      // ANS supplier invoices (existing flow)
      const suppliers = await getRecords(TABLES.SUPPLIERS, {
        filterByFormula: `{Code} = "ANS"`,
      });
      if (suppliers.length > 0) supplierId = suppliers[0].id;
    } else if (body.vendor) {
      // Universal invoices — look up by name
      const suppliers = await getRecords(TABLES.SUPPLIERS, {
        filterByFormula: `{Supplier Name} = "${body.vendor}"`,
      });
      if (suppliers.length > 0) supplierId = suppliers[0].id;
    }

    // Create invoice header
    const invoiceFields: Record<string, unknown> = {
      "Invoice Number": body.invoiceNumber,
      "Invoice Date": body.invoiceDate,
      "Sales Order": body.salesOrder || "",
      "PO Reference": body.poReference || "",
      "Payment Terms": body.paymentTerms || "",
      "Tracking Number": body.trackingNumber || "",
      "Delivery Terms": body.deliveryTerms || "",
      "Ship To": body.shipTo || "",
      Subtotal: body.subtotal || 0,
      Freight: body.freight || 0,
      Tax: body.tax || 0,
      "Total Amount": body.invoiceAmount || 0,
      "Payment Status": "Unpaid",
      "Status": "Open",
    };

    if (body.invoiceType) {
      invoiceFields["Type"] = body.invoiceType;
    }
    if (body.dueDate) {
      invoiceFields["Invoice Due Date"] = body.dueDate;
    }
    if (supplierId) {
      invoiceFields["Supplier"] = [supplierId];
    }

    const invoice = await createRecord(TABLES.INVOICES, invoiceFields);

    // Create invoice line items
    if (body.lines && body.lines.length > 0) {
      const lineRecords = body.lines.map(
        (
          line: {
            ansItemNumber: string;
            description: string;
            airtableSkuId: string | null;
            quantity: number;
            unit: string;
            unitPrice: number;
            amount: number;
            batchNumber: string | null;
          },
          idx: number
        ) => {
          const fields: Record<string, unknown> = {
            "Line ID": `${body.invoiceNumber}-${idx + 1}`,
            Invoice: [invoice.id],
            "ANS Item Number": line.ansItemNumber,
            Description: line.description,
            "Qty Billed": line.quantity,
            "Unit Cost": line.unitPrice,
            Unit: line.unit || "EA",
            Amount: line.amount,
            "Batch Number": line.batchNumber || "",
          };

          if (line.airtableSkuId) {
            fields["SKU"] = [line.airtableSkuId];
          }

          return { fields };
        }
      );

      await createRecords(TABLES.INVOICE_LINES, lineRecords);
    }

    // Log activity if we can resolve the PO from the reference
    if (body.poReference) {
      const poRecords = await getRecords(TABLES.PURCHASE_ORDERS, {
        filterByFormula: `{PO Number} = "${body.poReference}"`,
      });
      if (poRecords.length > 0) {
        logActivity({
          poId: poRecords[0].id,
          action: "invoice_created",
          description: `Invoice ${body.invoiceNumber} created — $${(body.invoiceAmount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
          actor: "Ryan Belanger",
          relatedRecordType: "invoice",
          relatedRecordId: invoice.id,
        });
      }
    }

    return NextResponse.json({
      id: invoice.id,
      invoiceNumber: body.invoiceNumber,
    });
  } catch (error) {
    console.error("Error creating invoice:", error);
    return NextResponse.json(
      { error: `Failed to create invoice: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
