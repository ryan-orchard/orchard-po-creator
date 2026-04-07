export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { getRecords, TABLES } from "@/lib/airtable";

const client = new Anthropic();

const EXTRACTION_PROMPT = `Extract structured data from this invoice PDF. Return ONLY a valid JSON object — no explanation, no markdown.

{
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD or null",
  "paymentTerms": "e.g. Net 30, Net 45, Due on Receipt, or null",
  "vendor": "company name",
  "poReference": "PO number or null",
  "subtotal": number or null,
  "freight": number or null,
  "tax": number or null,
  "invoiceAmount": number,
  "lines": [
    {
      "description": "string",
      "quantity": number,
      "unit": "EA or similar",
      "unitPrice": number,
      "amount": number
    }
  ],
  "suggestedType": "Supplier" | "Freight" | "Customs" | "Packaging" | "Work Order"
}

For dueDate: look for fields labeled "Due Date", "Payment Due Date", "Payment Due", "Pay By", "Due", "Due On", or similar. If not explicitly stated but payment terms are present (e.g. "Net 30"), compute dueDate as invoiceDate + the number of days. If no due date can be determined, use null.

For suggestedType:
- Supplier: product/inventory purchase from a manufacturer or supplier
- Freight: shipping, freight forwarding, or logistics charges
- Customs: customs duties, import fees, broker fees, or tariffs
- Packaging: packaging materials (boxes, labels, bags, etc.)
- Work Order: manufacturing, assembly, or co-packing services

Use null for numeric fields not present on the invoice. All amounts should be numbers (no $ signs or commas).`;

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
      return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
    }

    // Convert file to base64
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    // Call Claude with PDF document
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            } as Anthropic.DocumentBlockParam,
            {
              type: "text",
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });

    // Parse the JSON response
    const rawText =
      message.content[0].type === "text" ? message.content[0].text : "";

    let extracted: {
      invoiceNumber: string;
      invoiceDate: string;
      dueDate: string | null;
      paymentTerms: string | null;
      vendor: string;
      poReference: string | null;
      subtotal: number | null;
      freight: number | null;
      tax: number | null;
      invoiceAmount: number;
      lines: {
        description: string;
        quantity: number;
        unit: string;
        unitPrice: number;
        amount: number;
      }[];
      suggestedType: string;
    };

    try {
      // Strip markdown code fences if Claude wrapped the JSON
      let cleaned = rawText.trim();
      // Remove ```json ... ``` or ``` ... ``` wrappers
      cleaned = cleaned.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
      // If there's still non-JSON preamble, find the first { and last }
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }
      extracted = JSON.parse(cleaned);
    } catch {
      console.error("Claude raw response:", rawText);
      return NextResponse.json(
        { error: "Could not parse AI response. Raw output logged to console." },
        { status: 422 }
      );
    }

    // Derive due date from payment terms if not explicitly found
    if (!extracted.dueDate && extracted.invoiceDate && extracted.paymentTerms) {
      const netMatch = extracted.paymentTerms.match(/net\s*(\d+)/i);
      if (netMatch) {
        const days = parseInt(netMatch[1], 10);
        const base = new Date(extracted.invoiceDate + "T00:00:00");
        base.setDate(base.getDate() + days);
        extracted.dueDate = base.toISOString().split("T")[0];
      }
    }

    // Check for duplicate
    let isDuplicate = false;
    if (extracted.invoiceNumber) {
      const existing = await getRecords(TABLES.INVOICES, {
        filterByFormula: `{Invoice Number} = "${extracted.invoiceNumber}"`,
      });
      isDuplicate = existing.length > 0;
    }

    return NextResponse.json({
      fileName: file.name,
      invoice: {
        invoiceNumber: extracted.invoiceNumber || "",
        invoiceDate: extracted.invoiceDate || "",
        dueDate: extracted.dueDate || null,
        vendor: extracted.vendor || "",
        poReference: extracted.poReference || "",
        subtotal: extracted.subtotal ?? 0,
        freight: extracted.freight ?? 0,
        tax: extracted.tax ?? 0,
        invoiceAmount: extracted.invoiceAmount || 0,
        lines: (extracted.lines || []).map((l) => ({
          description: l.description || "",
          quantity: l.quantity || 0,
          unit: l.unit || "EA",
          unitPrice: l.unitPrice || 0,
          amount: l.amount || 0,
        })),
      },
      suggestedType: extracted.suggestedType || "Supplier",
      isDuplicate,
    });
  } catch (error) {
    console.error("Invoice extraction error:", error);
    return NextResponse.json(
      { error: `Extraction failed: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
