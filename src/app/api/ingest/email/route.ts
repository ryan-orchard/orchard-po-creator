import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { simpleParser } from "mailparser";
import {
  classifyDocument,
  parseInvoicePdf,
  resolveSupplier,
  resolvePO,
  checkDuplicateInvoice,
  storeAttachment,
  type IngestAttachment,
} from "@/lib/ingest";
import { logActivity } from "@/lib/activity-log";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s for AI parsing

// ── Postmark inbound webhook payload types ─────────────────────────

interface PostmarkAttachment {
  Name: string;
  Content?: string; // base64 — may be absent for inline/ContentID attachments
  ContentType: string;
  ContentLength: number;
  ContentID?: string;
}

interface PostmarkInboundPayload {
  From: string;
  FromName: string;
  FromFull: { Email: string; Name: string };
  To: string;
  ToFull: { Email: string; Name: string }[];
  Subject: string;
  MessageID: string;
  Date: string;
  TextBody: string;
  HtmlBody: string;
  Attachments: PostmarkAttachment[];
  RawEmail?: string; // Present when "Include raw email content" is checked
}

// ── Extract attachments from RawEmail MIME source ──────────────────

async function extractAttachmentsFromRaw(
  rawEmail: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>(); // filename → base64 content
  try {
    const parsed = await simpleParser(rawEmail);
    for (const att of parsed.attachments || []) {
      const filename = att.filename || "unknown";
      result.set(filename, att.content.toString("base64"));
    }
  } catch (err) {
    console.error("Failed to parse RawEmail:", err);
  }
  return result;
}

// ── Webhook handler ────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Auth: check webhook token
  const token = request.nextUrl.searchParams.get("token");
  const expectedToken = process.env.INGEST_WEBHOOK_SECRET;

  if (!expectedToken) {
    console.error("INGEST_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  if (token !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: PostmarkInboundPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Determine client from recipient address
  const toAddress = payload.To?.toLowerCase() || "";
  const clientId = toAddress.split("@")[0] || "unknown";

  // Idempotency: check MessageID
  const { data: existingEmail } = await db
    .schema("orchard")
    .from("ingested_emails")
    .select("id")
    .eq("message_id", payload.MessageID)
    .maybeSingle();

  if (existingEmail) {
    return NextResponse.json({ received: true, skipped: true, reason: "duplicate" });
  }

  // Debug: log what Postmark sent
  const attachmentSummary = (payload.Attachments || []).map((a) => ({
    name: a.Name,
    type: a.ContentType,
    size: a.ContentLength,
    hasContent: !!a.Content,
    contentID: a.ContentID || null,
  }));
  const hasRawEmail = !!payload.RawEmail;
  console.log(
    `Ingest email: "${payload.Subject}" | ${attachmentSummary.length} attachments | hasRawEmail: ${hasRawEmail} | details: ${JSON.stringify(attachmentSummary)}`
  );

  // Store email record
  const { data: emailRecord, error: emailError } = await db
    .schema("orchard")
    .from("ingested_emails")
    .insert({
      message_id: payload.MessageID,
      client_id: clientId,
      from_address: payload.FromFull?.Email || payload.From,
      from_name: payload.FromName || null,
      to_address: toAddress,
      subject: payload.Subject || null,
      received_at: payload.Date || new Date().toISOString(),
      status: "processing",
      error_message: `hasRawEmail: ${hasRawEmail} | attachments: ${JSON.stringify(attachmentSummary)}`,
    })
    .select("id")
    .single();

  if (emailError || !emailRecord) {
    console.error("Failed to store email:", emailError);
    return NextResponse.json({ error: "Failed to store email" }, { status: 500 });
  }

  const emailId = emailRecord.id as string;
  const results: { filename: string; documentType: string; status: string }[] = [];

  // Process each attachment
  const attachments = payload.Attachments || [];
  if (attachments.length === 0) {
    await db
      .schema("orchard")
      .from("ingested_emails")
      .update({ status: "processed" })
      .eq("id", emailId);

    return NextResponse.json({ received: true, emailId, documents: [], note: "No attachments" });
  }

  // If any attachment is missing Content, try extracting from RawEmail
  const needsRawParse = attachments.some((a) => !a.Content);
  let rawAttachments: Map<string, string> | null = null;
  if (needsRawParse && payload.RawEmail) {
    console.log("Extracting attachments from RawEmail MIME source...");
    rawAttachments = await extractAttachmentsFromRaw(payload.RawEmail);
    console.log(`Extracted ${rawAttachments.size} attachments from RawEmail: ${[...rawAttachments.keys()].join(", ")}`);
  }

  for (const att of attachments) {
    try {
      // Resolve content: prefer Postmark Content, fall back to RawEmail extraction
      let content = att.Content;
      if (!content && rawAttachments) {
        content = rawAttachments.get(att.Name) || undefined;
        if (content) {
          console.log(`Recovered attachment ${att.Name} from RawEmail`);
        }
      }

      if (!content) {
        console.warn(`Attachment ${att.Name} has no content (ContentID: ${att.ContentID || "none"}, RawEmail: ${hasRawEmail})`);

        await db
          .schema("orchard")
          .from("ingested_documents")
          .insert({
            email_id: emailId,
            filename: att.Name,
            content_type: att.ContentType,
            file_size_bytes: att.ContentLength,
            document_type: "unknown",
            confidence: 0,
            parsed_data: {
              error: "No attachment content — enable 'Include raw email content' in Postmark or get account approved",
            },
            status: "pending",
          });

        results.push({
          filename: att.Name,
          documentType: "unknown",
          status: "no_content",
        });
        continue;
      }

      const attachment: IngestAttachment = {
        filename: att.Name,
        contentType: att.ContentType,
        content,
        contentLength: att.ContentLength,
      };

      // Store raw file
      const storagePath = await storeAttachment(emailId, attachment);

      // Classify
      const classification = await classifyDocument(attachment, payload.Subject || "");

      // Parse based on type
      let parsedData = null;
      let supplierName: string | null = null;
      let supplierId: string | null = null;
      let poReference: string | null = null;
      let poId: string | null = null;
      let invoiceNumber: string | null = null;
      let status = "pending";

      if (classification.documentType === "invoice" && classification.confidence >= 0.5) {
        try {
          const parsed = await parseInvoicePdf(attachment.content);
          parsedData = parsed;
          supplierName = parsed.vendor || null;
          poReference = parsed.poReference || null;
          invoiceNumber = parsed.invoiceNumber || null;

          // Resolve supplier
          if (supplierName) {
            const supplier = await resolveSupplier(supplierName);
            if (supplier) supplierId = supplier.id;
          }

          // Resolve PO
          if (poReference) {
            const po = await resolvePO(poReference);
            if (po) poId = po.id;
          }

          // Check duplicate
          if (invoiceNumber) {
            const isDup = await checkDuplicateInvoice(invoiceNumber);
            if (isDup) status = "duplicate";
          }
        } catch (parseError) {
          console.error(`Parse failed for ${att.Name}:`, parseError);
          parsedData = { error: (parseError as Error).message };
        }
      }

      // Store document record
      await db
        .schema("orchard")
        .from("ingested_documents")
        .insert({
          email_id: emailId,
          filename: att.Name,
          content_type: att.ContentType,
          storage_path: storagePath,
          file_size_bytes: att.ContentLength,
          document_type: classification.documentType,
          confidence: classification.confidence,
          parsed_data: parsedData,
          supplier_name: supplierName,
          supplier_id: supplierId,
          po_reference: poReference,
          po_id: poId,
          invoice_number: invoiceNumber,
          status,
        });

      // Log activity if we matched a PO
      if (poId && invoiceNumber) {
        logActivity({
          poId,
          action: "document_ingested",
          description: `Invoice ${invoiceNumber} from ${supplierName || "unknown"} received via email`,
          actor: "Orchard AI",
        });
      }

      results.push({
        filename: att.Name,
        documentType: classification.documentType,
        status,
      });
    } catch (docError) {
      console.error(`Error processing attachment ${att.Name}:`, docError);
      results.push({
        filename: att.Name,
        documentType: "error",
        status: "failed",
      });
    }
  }

  // Mark email as processed
  await db
    .schema("orchard")
    .from("ingested_emails")
    .update({ status: "processed", error_message: null })
    .eq("id", emailId);

  console.log(`Processed email ${payload.MessageID}: ${results.length} documents`);
  return NextResponse.json({ received: true, emailId, documents: results });
}
