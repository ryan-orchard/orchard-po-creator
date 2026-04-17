import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/supabase";
import { attemptPOMatch } from "@/lib/po-matching";

const claude = new Anthropic();

// ── Types ──────────────────────────────────────────────────────────

export interface IngestAttachment {
  filename: string;
  contentType: string;
  content: string; // base64
  contentLength: number;
}

export interface ClassifyResult {
  documentType: "invoice" | "receipt" | "transaction_export" | "shipping_doc" | "unknown";
  confidence: number;
  reasoning: string;
}

export interface ParsedInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  paymentTerms: string | null;
  vendor: string;
  poReference: string | null;
  salesOrder: string | null;
  trackingNumber: string | null;
  shipTo: string | null;
  deliveryTerms: string | null;
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
}

export interface ParsedTransactionExport {
  source: string;
  lines: {
    date: string;
    documentNumber: string;
    itemNumber: string;
    description: string;
    quantity: number;
    entryType: string;
  }[];
}

export type ParsedData = ParsedInvoice | ParsedTransactionExport;

// ── Classify ───────────────────────────────────────────────────────

const CLASSIFY_PROMPT = `You are classifying a document received via email for an inventory management system.

Determine the document type. Return ONLY valid JSON, no explanation:

{
  "documentType": "invoice" | "receipt" | "transaction_export" | "shipping_doc" | "unknown",
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence why"
}

Definitions:
- invoice: a bill from a supplier for goods or services (has invoice number, amounts, line items)
- receipt: a packing slip, delivery receipt, or proof of receipt (lists items received)
- transaction_export: a spreadsheet/report of inventory transactions (from a warehouse or ERP)
- shipping_doc: bill of lading, shipping label, tracking info
- unknown: can't determine`;

export async function classifyDocument(
  attachment: IngestAttachment,
  emailSubject: string
): Promise<ClassifyResult> {
  const isPdf = attachment.contentType === "application/pdf";
  const isExcel =
    attachment.contentType.includes("spreadsheet") ||
    attachment.contentType.includes("excel") ||
    attachment.filename.match(/\.xlsx?$/i);

  // Excel files are almost always transaction exports in this context
  if (isExcel) {
    return {
      documentType: "transaction_export",
      confidence: 0.9,
      reasoning: "Excel file attachment — likely a transaction export from a warehouse or ERP system",
    };
  }

  if (!isPdf) {
    return {
      documentType: "unknown",
      confidence: 0.3,
      reasoning: `Unexpected content type: ${attachment.contentType}`,
    };
  }

  // Use Claude to classify PDFs
  const message = await claude.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: attachment.content },
          } as Anthropic.DocumentBlockParam,
          {
            type: "text",
            text: `Email subject: "${emailSubject}"\nFilename: "${attachment.filename}"\n\n${CLASSIFY_PROMPT}`,
          },
        ],
      },
    ],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  try {
    const cleaned = extractJson(raw);
    return JSON.parse(cleaned) as ClassifyResult;
  } catch {
    return { documentType: "unknown", confidence: 0.1, reasoning: "Failed to parse classification" };
  }
}

// ── Parse ──────────────────────────────────────────────────────────

const INVOICE_PARSE_PROMPT = `Extract structured data from this invoice. Return ONLY valid JSON:

{
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD or null",
  "paymentTerms": "e.g. Net 30 or null",
  "vendor": "company name",
  "poReference": "PO number referenced on the invoice, or null",
  "salesOrder": "supplier's sales/order number, or null",
  "trackingNumber": "shipping tracking number, or null",
  "shipTo": "ship-to address or location name, or null",
  "deliveryTerms": "e.g. FOB Destination, or null",
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

Rules:
- For dueDate: if payment terms are present but no explicit due date, compute from invoiceDate + days.
- Use null for fields not present. All amounts as numbers (no $ or commas).
- "freight" is the shipping/freight line amount (separate from product lines). "tax" is sales tax.
- "invoiceAmount" is the grand total including freight and tax.
- "subtotal" is product lines only (before freight and tax).`;

// Supplier-specific extraction hints — helps the AI find fields that have non-obvious labels
const SUPPLIER_TEMPLATES: Record<string, string> = {
  ans: `
Supplier: Arizona Nutritional Supplements (ANS)
Field mapping:
- "Your Reference" = the PO number (poReference)
- "Sales Order" = ANS's internal sales order number (salesOrder)
- "Tracking Number" or "Tracking #" = shipping tracking (trackingNumber)
- "Ship To" = delivery destination (shipTo)
- "Freight" = freight/shipping charge line (freight)
- "Sales Tax" = tax amount (tax)
- Line items list product descriptions with qty, unit price, and extended amount.
- ANS invoices typically have a subtotal, then freight, then tax, then grand total.`,
};

export async function parseInvoicePdf(base64Content: string, supplierHint?: string): Promise<ParsedInvoice> {
  // Build prompt with supplier-specific template if available
  let prompt = INVOICE_PARSE_PROMPT;
  if (supplierHint) {
    const key = supplierHint.toLowerCase();
    const template = SUPPLIER_TEMPLATES[key];
    if (template) {
      prompt += `\n\nSupplier-specific guidance:${template}`;
    }
  }

  const message = await claude.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64Content },
          } as Anthropic.DocumentBlockParam,
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const cleaned = extractJson(raw);
  return JSON.parse(cleaned) as ParsedInvoice;
}

// ── Resolve references ─────────────────────────────────────────────

export async function resolveSupplier(vendorName: string): Promise<{ id: string; name: string } | null> {
  const { data: suppliers } = await db
    .schema("org_config")
    .from("suppliers")
    .select("id, name, code");

  if (!suppliers?.length) return null;

  const lower = vendorName.toLowerCase();
  // Try exact match first, then fuzzy
  const exact = suppliers.find(
    (s) => (s.name as string).toLowerCase() === lower || (s.code as string).toLowerCase() === lower
  );
  if (exact) return { id: exact.id as string, name: exact.name as string };

  // Partial match
  const partial = suppliers.find(
    (s) =>
      lower.includes((s.name as string).toLowerCase()) ||
      (s.name as string).toLowerCase().includes(lower)
  );
  if (partial) return { id: partial.id as string, name: partial.name as string };

  return null;
}

export async function resolvePO(poReference: string): Promise<{ id: string; poNumber: string } | null> {
  const { data: allPOs } = await db
    .schema("orchard")
    .from("purchase_orders")
    .select("id, po_number");

  if (!allPOs?.length) return null;
  const poList = allPOs.map((p) => ({ id: p.id as string, poNumber: p.po_number as string }));
  return attemptPOMatch(poReference, poList);
}

export async function checkDuplicateInvoice(invoiceNumber: string): Promise<boolean> {
  // Check existing invoices
  const { data: existing } = await db
    .schema("orchard")
    .from("invoices")
    .select("id")
    .eq("invoice_number", invoiceNumber)
    .maybeSingle();

  if (existing) return true;

  // Check pending ingested documents
  const { data: pending } = await db
    .schema("orchard")
    .from("ingested_documents")
    .select("id")
    .eq("invoice_number", invoiceNumber)
    .neq("status", "rejected")
    .maybeSingle();

  return !!pending;
}

// ── Store attachment ───────────────────────────────────────────────

export async function storeAttachment(
  emailId: string,
  attachment: IngestAttachment
): Promise<string> {
  const buffer = Buffer.from(attachment.content, "base64");
  const path = `${emailId}/${attachment.filename}`;

  const { error } = await db.storage.from("ingest").upload(path, buffer, {
    contentType: attachment.contentType,
    upsert: false,
  });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return path;
}

// ── Utils ──────────────────────────────────────────────────────────

function extractJson(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1) {
    cleaned = cleaned.slice(first, last + 1);
  }
  return cleaned;
}
