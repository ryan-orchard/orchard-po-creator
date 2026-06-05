export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import ansSkuMappingData from "@/../clients/magna/config/ans-sku-mapping.json";
import { db } from "@/lib/supabase";

const ANS_SKU_MAPPING = ansSkuMappingData as Record<
  string,
  { standardSku: string; airtableId: string } | null
>;

interface ParsedLine {
  ansItemNumber: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  batchNumber: string | null;
  standardSku: string | null;
  skuMapped: boolean;
}

interface ParsedInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  salesOrder: string;
  poReference: string;
  paymentTerms: string;
  trackingNumber: string;
  deliveryTerms: string;
  shipTo: string;
  subtotal: number;
  freight: number;
  tax: number;
  invoiceAmount: number;
  lines: ParsedLine[];
}

function parseCurrency(str: string): number {
  return parseFloat(str.replace(/,/g, "").trim()) || 0;
}

function parseDate(str: string): string {
  // Convert MM/DD/YY or MM/DD/YYYY to YYYY-MM-DD
  const match = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return str;
  const [, m, d, y] = match;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseInvoiceText(allLines: string[]): ParsedInvoice {
  // Pre-process: join split item number lines (e.g., "F4063S-" + "11L")
  for (let i = allLines.length - 2; i >= 0; i--) {
    if (allLines[i].match(/^F[A-Z]?\d+[A-Z]*S?-\s*$/) && allLines[i + 1]) {
      allLines[i] = allLines[i].trim() + allLines[i + 1].trim();
      allLines.splice(i + 1, 1);
    }
  }

  // Pre-process: fix split decimals within lines (e.g., "0. 29" → "0.29")
  for (let i = 0; i < allLines.length; i++) {
    allLines[i] = allLines[i].replace(/(\d+)\.\s+(\d)/g, "$1.$2");
  }

  const fullText = allLines.join("\n");

  // --- Parse header fields ---
  // The header labels appear as a block, followed by values in the same order:
  // Number, Invoice Date, Sales Order, Page, Your reference, Payment terms,
  // Payment due date, Cash discount, Invoice account, Tracking number, Delivery terms
  // Values follow in sequence after the labels

  let invoiceNumber = "";
  let invoiceDate = "";
  let salesOrder = "";
  let poReference = "";
  let paymentTerms = "";
  let trackingNumber = "";
  let deliveryTerms = "";
  let shipTo = "";

  // Find the header value block — labels appear in a block, followed by values
  // Labels: Number, Invoice Date, Sales Order, Page, Your reference, Payment terms,
  //         Payment due date, Cash discount, Invoice account, Tracking number, Delivery terms
  // Cash discount often has no value, so we can't rely on positional indexing.
  // Instead: find where labels end and values begin, then use pattern matching.
  const deliveryTermsIdx = allLines.findIndex((l) =>
    l.match(/^Delivery terms/i)
  );
  if (deliveryTermsIdx >= 0) {
    // Values start right after the last label
    const values = allLines.slice(deliveryTermsIdx + 1);

    // First value is always the invoice number (8-digit number)
    if (values.length >= 1) invoiceNumber = values[0]?.trim() || "";

    // Find date pattern for invoice date (MM/DD/YY)
    const dateVal = values.find((v) => v.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/));
    if (dateVal) invoiceDate = dateVal.trim();

    // Sales Order starts with SO
    const soVal = values.find((v) => v.match(/^SO\d+$/));
    if (soVal) salesOrder = soVal.trim();

    // PO Reference: appears after "Page" value (X of Y), before payment terms
    // It's the value that's not a date, not SO, not "X of Y", and not a known pattern
    const pageIdx = values.findIndex((v) => v.match(/^\d+\s+of\s+\d+$/));
    if (pageIdx >= 0 && pageIdx + 1 < values.length) {
      poReference = values[pageIdx + 1]?.trim() || "";
    }

    // Payment terms: "Net X" or "X% Down/X% B4 Ship" pattern
    const ptVal = values.find((v) => v.match(/^Net \d+$|Down|Due|COD|Prepaid/i));
    if (ptVal) paymentTerms = ptVal.trim();

    // Tracking number: SLPACK pattern
    const tkVal = values.find((v) => v.match(/^SLPACK/));
    if (tkVal) trackingNumber = tkVal.trim();

    // Delivery terms: FOB pattern (last value)
    const dtVal = values.find((v) => v.match(/^FOB/i));
    if (dtVal) deliveryTerms = dtVal.trim();
  }

  // Format B fallback: inline labels (e.g., "Number 00536748", "Invoice date 1/15/2026")
  if (!invoiceNumber) {
    const m = fullText.match(/\bNumber\s+(\d{7,8})\b/);
    if (m) invoiceNumber = m[1];
  }
  if (!invoiceDate) {
    const m = fullText.match(/Invoice date\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (m) invoiceDate = m[1];
  }
  if (!salesOrder) {
    const m = fullText.match(/Sales order\s+(SO\d+)/i);
    if (m) salesOrder = m[1];
  }
  if (!poReference) {
    const yrIdx = allLines.findIndex((l) => l.match(/^Your reference$/i));
    if (yrIdx >= 0) {
      for (let k = yrIdx + 1; k < Math.min(yrIdx + 5, allLines.length); k++) {
        const val = allLines[k].trim();
        if (val && !val.match(/^(Payment|Tracking|Delivery|Invoice|Cash|Number|Sales)/i)) {
          poReference = val;
          break;
        }
      }
    }
  }
  if (!paymentTerms) {
    const ptIdx = allLines.findIndex((l) => l.match(/^Payment terms$/i));
    if (ptIdx >= 0) {
      for (let k = ptIdx + 1; k < Math.min(ptIdx + 5, allLines.length); k++) {
        if (allLines[k].match(/^Net \d+|COD|Prepaid/i)) {
          paymentTerms = allLines[k].trim();
          break;
        }
      }
    }
  }
  if (!trackingNumber) {
    const m = fullText.match(/Tracking number\s+(SLPACK\S+)/i);
    if (m) trackingNumber = m[1];
  }
  if (!deliveryTerms) {
    const m = fullText.match(/Delivery terms\s+(FOB\b.*)/i);
    if (m) deliveryTerms = m[1].trim();
  }

  // Ship To: label on its own line, destination name on the next line
  const shipToIdx = allLines.findIndex((l) => l.match(/^Ship to$/i));
  if (shipToIdx >= 0 && shipToIdx + 1 < allLines.length) {
    shipTo = allLines[shipToIdx + 1].trim();
  }

  // --- Parse totals ---
  let subtotal = 0;
  let freight = 0;
  let tax = 0;
  let invoiceAmount = 0;

  // Look for "USD" followed by the three values (subtotal, freight, tax)
  const usdIdx = allLines.findIndex((l) => l.trim() === "USD");
  if (usdIdx >= 0) {
    subtotal = parseCurrency(allLines[usdIdx + 1] || "0");
    freight = parseCurrency(allLines[usdIdx + 2] || "0");
    tax = parseCurrency(allLines[usdIdx + 3] || "0");
  } else {
    // Format B: inline totals (e.g., "Sales subtotal amount 41,470.00")
    const stMatch = fullText.match(/Sales subtotal amount\s+([\d,.]+)/i);
    if (stMatch) subtotal = parseCurrency(stMatch[1]);
    const frMatch = fullText.match(/\bFreight\s+([\d,.]+)/i);
    if (frMatch) freight = parseCurrency(frMatch[1]);
    const txMatch = fullText.match(/Sales tax\s+([\d,.]+)/i);
    if (txMatch) tax = parseCurrency(txMatch[1]);
  }

  // Invoice amount from "Invoice amount" line
  const invAmtLine = allLines.find((l) => l.match(/Invoice amount/i));
  if (invAmtLine) {
    const amtMatch = invAmtLine.match(/Invoice amount\s+([\d,.]+)/i);
    if (amtMatch) {
      invoiceAmount = parseCurrency(amtMatch[1]);
    }
  }

  // --- Parse line items ---
  // ANS item numbers match patterns like: F4063S-30, F4283S-28-11L, FK4230S-28, F4110S-11L
  const ansItemPattern = /^F[A-Z]?\d+[A-Z]*S?-[\w-]+/;
  const lines: ParsedLine[] = [];

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    const itemMatch = line.match(ansItemPattern);
    if (!itemMatch) continue;

    const ansItemNumber = itemMatch[0].trim();

    // Extract the rest of the line after the item number
    const rest = line.slice(itemMatch[0].length).trim();

    // Parse description and numeric fields from the rest
    // Pattern: description text, then qty, unit (EA), unit price, maybe discount fields, amount
    // The amount is always the last number, unit price is before EA or before amount

    // Find all numbers in the rest of the line and subsequent lines until we hit
    // "Quantity:" or another item number
    let combinedText = rest;

    // Check if next lines are continuation (no item number, no "Quantity:", no section marker)
    let j = i + 1;
    while (
      j < allLines.length &&
      !allLines[j].match(ansItemPattern) &&
      !allLines[j].match(/^Quantity\s*:/i) &&
      !allLines[j].match(/^Arizona Nutritional/i) &&
      !allLines[j].match(/^Sold to/i) &&
      !allLines[j].match(/^Item number/i) &&
      !allLines[j].match(/^Currency/i) &&
      !allLines[j].match(/^Cust item:/i)
    ) {
      combinedText += " " + allLines[j].trim();
      j++;
    }

    // Fix decimal-split numbers: PDF sometimes splits "223300.000" into "223300.00" + "0"
    // Rejoin: number with decimals + standalone small number before EA
    combinedText = combinedText.replace(
      /([\d,]+\.\d+)\s+(\d{1,3})\s+(EA\b)/i,
      (_, num, dec, ea) => `${num}${dec} ${ea}`
    );

    // Now parse the combined text
    // Pattern: description, qty EA unitPrice [optional discount columns] amount
    const eaMatch = combinedText.match(/([\d,.]+)\s+EA\s+(.+)$/i);

    let description = "";
    let quantity = 0;
    let unitPrice = 0;
    let amount = 0;

    if (eaMatch) {
      description = combinedText.slice(0, eaMatch.index).trim();
      quantity = parseCurrency(eaMatch[1]);
      // Extract numbers from leading numeric block only (stop at alphabetic content)
      const afterEA = eaMatch[2].trim();
      const numBlock = afterEA.match(/^[\d,.\s]+/);
      const nums = numBlock ? numBlock[0].match(/[\d,.]+/g) || [] : [];
      if (nums.length >= 2) {
        unitPrice = parseCurrency(nums[0]);
        amount = parseCurrency(nums[nums.length - 1]);
      } else if (nums.length === 1) {
        amount = parseCurrency(nums[0]);
      }
    } else {
      // Fallback: just grab what we can
      description = combinedText;
    }

    // Clean up description — remove trailing numbers that leaked in
    description = description.replace(/[\d,.]+\s*$/, "").trim();

    // Parse batch number from "Quantity: X Batch number: Y" line
    let batchNumber: string | null = null;
    const batchLine = allLines
      .slice(i + 1, i + 10)
      .find((l) => l.match(/Batch number\s*:/i));
    if (batchLine) {
      const batchMatch = batchLine.match(/Batch number\s*:\s*(.+?)$/i);
      if (batchMatch) batchNumber = batchMatch[1].replace(/\s+/g, "").trim();
    }

    // Apply SKU mapping
    const mapping = ANS_SKU_MAPPING[ansItemNumber] || null;

    lines.push({
      ansItemNumber,
      description,
      quantity,
      unit: "EA",
      unitPrice,
      amount,
      batchNumber,
      standardSku: mapping?.standardSku || null,
      skuMapped: !!mapping,
    });
  }

  return {
    invoiceNumber,
    invoiceDate: parseDate(invoiceDate),
    salesOrder,
    poReference,
    paymentTerms,
    trackingNumber,
    deliveryTerms,
    shipTo,
    subtotal,
    freight,
    tax,
    invoiceAmount,
    lines,
  };
}

export async function POST(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only PDF files are supported" },
        { status: 400 }
      );
    }

    // Extract text from PDF using pdf2json
    const buffer = await file.arrayBuffer();
    const PDFParser = (await import("pdf2json")).default;

    const textLines = await new Promise<string[]>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("PDF parsing timed out")), 15000);
      const pdfParser = new PDFParser();

      pdfParser.on("pdfParser_dataReady", (data: { Pages?: { Texts?: { y: number; R: { T: string }[] }[] }[] }) => {
        clearTimeout(timeout);
        try {
          const allLines: string[] = [];
          const pages = data.Pages || [];

          for (const page of pages) {
            const texts = page.Texts || [];
            let lastY: number | null = null;
            let line = "";

            for (const t of texts) {
              const y = Math.round(t.y * 10) / 10;
              if (lastY !== null && Math.abs(y - lastY) > 0.3) {
                if (line.trim()) allLines.push(line.trim());
                line = "";
              }
              const str = t.R.map((r: { T: string }) => {
              try { return decodeURIComponent(r.T); } catch { return r.T; }
            }).join("");
              line += str + " ";
              lastY = y;
            }
            if (line.trim()) allLines.push(line.trim());
          }

          resolve(allLines);
        } catch (err) {
          reject(err);
        }
      });

      pdfParser.on("pdfParser_dataError", (err: unknown) => {
        clearTimeout(timeout);
        reject(err);
      });
      pdfParser.parseBuffer(Buffer.from(buffer));
    });

    if (textLines.length < 5) {
      return NextResponse.json(
        { error: "Could not extract text from PDF. Is this a valid ANS invoice?" },
        { status: 400 }
      );
    }

    // Parse the invoice
    const invoice = parseInvoiceText(textLines);

    if (!invoice.invoiceNumber) {
      return NextResponse.json(
        { error: "Could not find invoice number in PDF" },
        { status: 400 }
      );
    }

    // Check for duplicate invoice in Supabase
    const { count } = await db
      .schema("orchard")
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("invoice_number", invoice.invoiceNumber);

    const isDuplicate = (count ?? 0) > 0;

    // Find unmapped items
    const unmappedItems = invoice.lines
      .filter((l) => !l.skuMapped)
      .map((l) => l.ansItemNumber);

    return NextResponse.json({
      fileName: file.name,
      invoice,
      unmappedItems: [...new Set(unmappedItems)],
      isDuplicate,
    });
  } catch (error) {
    console.error("Invoice parse error:", error);
    return NextResponse.json(
      { error: `Failed to parse invoice: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
