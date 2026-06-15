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
import { isBmcReport, parseBmcReport } from "@/lib/bmc-parser";
import { processBmcReport } from "@/lib/bmc-ingest";
import {
  isAnsOnOrderReport,
  parseAnsOnOrderReport,
} from "@/lib/ans-on-order-parser";
import { processAnsOnOrderReport } from "@/lib/ans-on-order-ingest";
import {
  isStordAdjustmentsReport,
  parseStordAdjustmentsReport,
} from "@/lib/stord-adjustments-parser";
import { processStordAdjustmentsReport } from "@/lib/stord-adjustments-ingest";

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

// ── Fetch attachment content via Postmark API ──────────────────────

async function fetchAttachmentsFromPostmarkAPI(
  messageID: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const serverToken = process.env.POSTMARK_SERVER_TOKEN;
  if (!serverToken) {
    console.warn("POSTMARK_SERVER_TOKEN not set — cannot fetch attachments via API");
    return result;
  }

  try {
    // Search for the inbound message by MessageID
    const searchRes = await fetch(
      `https://api.postmarkapp.com/messages/inbound?count=1&offset=0&recipient=magna@orchardinventory.com&subject=&mailboxhash=&status=&fromemail=&tag=&todate=&fromdate=`,
      {
        headers: {
          Accept: "application/json",
          "X-Postmark-Server-Token": serverToken,
        },
      }
    );

    if (!searchRes.ok) {
      // Try fetching by the Postmark MessageID directly
      const detailRes = await fetch(
        `https://api.postmarkapp.com/messages/inbound/${messageID}/details`,
        {
          headers: {
            Accept: "application/json",
            "X-Postmark-Server-Token": serverToken,
          },
        }
      );

      if (!detailRes.ok) {
        console.error(`Postmark API error: ${detailRes.status}`);
        return result;
      }

      const detail = await detailRes.json();
      for (const att of detail.Attachments || []) {
        if (att.Content) {
          result.set(att.Name, att.Content);
        }
      }
      return result;
    }

    // Find our message and get its details
    const messages = await searchRes.json();
    for (const msg of messages.InboundMessages || []) {
      if (msg.MessageID === messageID) {
        // Fetch full details
        const detailRes = await fetch(
          `https://api.postmarkapp.com/messages/inbound/${msg.MessageID}/details`,
          {
            headers: {
              Accept: "application/json",
              "X-Postmark-Server-Token": serverToken,
            },
          }
        );
        if (detailRes.ok) {
          const detail = await detailRes.json();
          for (const att of detail.Attachments || []) {
            if (att.Content) {
              result.set(att.Name, att.Content);
            }
          }
        }
        break;
      }
    }
  } catch (err) {
    console.error("Failed to fetch from Postmark API:", err);
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
  const rawEmailLength = payload.RawEmail ? payload.RawEmail.length : 0;
  // Log all top-level keys to diagnose what Postmark actually sends
  const payloadKeys = Object.keys(payload).map((k) => {
    const val = (payload as unknown as Record<string, unknown>)[k];
    if (typeof val === "string") return `${k}(${val.length})`;
    if (Array.isArray(val)) return `${k}[${val.length}]`;
    return k;
  });
  console.log(
    `Ingest email: "${payload.Subject}" | keys: ${payloadKeys.join(",")} | hasRawEmail: ${hasRawEmail} (${rawEmailLength} chars) | attachments: ${JSON.stringify(attachmentSummary)}`
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

  // If any attachment is missing Content, try fallbacks:
  // 1. Parse RawEmail MIME source (if "Include raw email content" is enabled)
  // 2. Fetch from Postmark API (if POSTMARK_SERVER_TOKEN is set)
  const needsFallback = attachments.some((a) => !a.Content);
  let recoveredAttachments: Map<string, string> | null = null;

  if (needsFallback) {
    // Try RawEmail first
    if (payload.RawEmail) {
      console.log("Trying RawEmail MIME extraction...");
      recoveredAttachments = await extractAttachmentsFromRaw(payload.RawEmail);
      console.log(`RawEmail extraction: ${recoveredAttachments.size} attachments`);
    }

    // If RawEmail didn't work, try Postmark API
    if (!recoveredAttachments || recoveredAttachments.size === 0) {
      console.log("Trying Postmark API fallback...");
      recoveredAttachments = await fetchAttachmentsFromPostmarkAPI(payload.MessageID);
      console.log(`Postmark API: ${recoveredAttachments.size} attachments`);
    }
  }

  for (const att of attachments) {
    try {
      // Skip inline images (signature logos, embedded graphics from forwarded
      // emails). Always referenced via ContentID in HTML, never the intended
      // document for an inventory/invoice workflow.
      if (att.ContentType?.startsWith("image/")) {
        console.log(`Skipping inline image: ${att.Name} (${att.ContentType}, ${att.ContentLength}B)`);
        results.push({ filename: att.Name, documentType: "image", status: "skipped" });
        continue;
      }

      // Resolve content: prefer Postmark Content, fall back to RawEmail extraction
      let content = att.Content;
      if (!content && recoveredAttachments) {
        content = recoveredAttachments.get(att.Name) || undefined;
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

      // ── BMC report auto-processing ───────────────────────────────
      if (isBmcReport(payload.Subject || "", att.Name)) {
        try {
          console.log(`Detected BMC report: ${att.Name}`);
          const buffer = Buffer.from(content, "base64");
          const parsed = parseBmcReport(buffer);
          const writeResult = await processBmcReport(parsed, payload.Date);

          // Record as auto-approved document
          await db
            .schema("orchard")
            .from("ingested_documents")
            .insert({
              email_id: emailId,
              filename: att.Name,
              content_type: att.ContentType,
              storage_path: storagePath,
              file_size_bytes: att.ContentLength,
              document_type: "transaction_export",
              confidence: 1.0,
              parsed_data: {
                type: "bmc_report",
                snapshotItems: parsed.snapshotItemCount,
                transactions: parsed.transactionCount,
                newTransactions: writeResult.newTransactions,
                skippedDuplicates: writeResult.skippedDuplicates,
                unmapped: parsed.unmapped,
                reportDate: parsed.reportDate,
              },
              status: "approved",
              reviewed_at: new Date().toISOString(),
              reviewed_by: "Orchard AI (auto)",
            });

          console.log(
            `BMC report processed: ${parsed.snapshotItemCount} snapshot items, ` +
            `${writeResult.newTransactions} new / ${writeResult.skippedDuplicates} dup transactions`
          );

          results.push({
            filename: att.Name,
            documentType: "transaction_export",
            status: "auto_approved",
          });
          continue; // Skip normal classification flow
        } catch (bmcError) {
          console.error(`BMC report parse failed for ${att.Name}:`, bmcError);
          // Fall through to normal classification — will land in inbox for manual review
          await db
            .schema("orchard")
            .from("ingested_documents")
            .insert({
              email_id: emailId,
              filename: att.Name,
              content_type: att.ContentType,
              storage_path: storagePath,
              file_size_bytes: att.ContentLength,
              document_type: "transaction_export",
              confidence: 0.9,
              parsed_data: { error: (bmcError as Error).message, type: "bmc_report_failed" },
              status: "failed",
            });

          results.push({
            filename: att.Name,
            documentType: "transaction_export",
            status: "parse_failed",
          });
          continue;
        }
      }

      // ── ANS On Order Report auto-processing ──────────────────────
      if (isAnsOnOrderReport(payload.Subject || "", att.Name)) {
        try {
          console.log(`Detected ANS On Order report: ${att.Name}`);
          const buffer = Buffer.from(content, "base64");
          const parsed = parseAnsOnOrderReport(buffer, att.Name, payload.Date);
          const writeResult = await processAnsOnOrderReport(parsed);

          await db
            .schema("orchard")
            .from("ingested_documents")
            .insert({
              email_id: emailId,
              filename: att.Name,
              content_type: att.ContentType,
              storage_path: storagePath,
              file_size_bytes: att.ContentLength,
              document_type: "ans_on_order",
              confidence: 1.0,
              parsed_data: {
                type: "ans_on_order",
                reportDate: parsed.reportDate,
                rows: parsed.rows,
                malformed: parsed.malformed,
                matchedLines: writeResult.matchedLines,
                unmatchedRows: writeResult.unmatchedRows,
                activityEvents: writeResult.activityEvents,
              },
              status: "approved",
              reviewed_at: new Date().toISOString(),
              reviewed_by: "Orchard AI (auto)",
            });

          console.log(
            `ANS On Order processed: ${writeResult.matchedLines} matched lines, ` +
              `${writeResult.unmatchedRows.length} unmatched, ` +
              `${writeResult.activityEvents} activity events`
          );

          results.push({
            filename: att.Name,
            documentType: "ans_on_order",
            status: "auto_approved",
          });
          continue;
        } catch (ansError) {
          console.error(`ANS On Order parse failed for ${att.Name}:`, ansError);
          await db
            .schema("orchard")
            .from("ingested_documents")
            .insert({
              email_id: emailId,
              filename: att.Name,
              content_type: att.ContentType,
              storage_path: storagePath,
              file_size_bytes: att.ContentLength,
              document_type: "ans_on_order",
              confidence: 0.9,
              parsed_data: { error: (ansError as Error).message, type: "ans_on_order_failed" },
              status: "failed",
            });

          results.push({
            filename: att.Name,
            documentType: "ans_on_order",
            status: "parse_failed",
          });
          continue;
        }
      }

      // ── Stord Inventory Adjustments Report auto-processing ────────
      if (isStordAdjustmentsReport(payload.Subject || "", att.Name)) {
        try {
          console.log(`Detected Stord adjustments report: ${att.Name}`);
          const buffer = Buffer.from(content, "base64");
          const parsed = parseStordAdjustmentsReport(buffer);
          const writeResult = await processStordAdjustmentsReport(parsed);

          await db
            .schema("orchard")
            .from("ingested_documents")
            .insert({
              email_id: emailId,
              filename: att.Name,
              content_type: att.ContentType,
              storage_path: storagePath,
              file_size_bytes: att.ContentLength,
              document_type: "stord_adjustments",
              confidence: 1.0,
              parsed_data: {
                type: "stord_adjustments",
                totalRows: parsed.rows.length,
                dateRange: parsed.dateRange,
                newReceipts: writeResult.newReceipts,
                skippedExisting: writeResult.skippedExisting,
                totalReceiptRows: writeResult.totalReceiptRows,
                failedOrders: writeResult.failedOrders,
              },
              status: "approved",
              reviewed_at: new Date().toISOString(),
              reviewed_by: "Orchard AI (auto)",
            });

          console.log(
            `Stord adjustments processed: ${writeResult.newReceipts} new receipts, ` +
              `${writeResult.skippedExisting} skipped, ${writeResult.totalReceiptRows} receipt rows`
          );

          results.push({
            filename: att.Name,
            documentType: "stord_adjustments",
            status: "auto_approved",
          });
          continue;
        } catch (stordError) {
          console.error(`Stord adjustments parse failed for ${att.Name}:`, stordError);
          await db
            .schema("orchard")
            .from("ingested_documents")
            .insert({
              email_id: emailId,
              filename: att.Name,
              content_type: att.ContentType,
              storage_path: storagePath,
              file_size_bytes: att.ContentLength,
              document_type: "stord_adjustments",
              confidence: 0.9,
              parsed_data: { error: (stordError as Error).message, type: "stord_adjustments_failed" },
              status: "failed",
            });

          results.push({
            filename: att.Name,
            documentType: "stord_adjustments",
            status: "parse_failed",
          });
          continue;
        }
      }

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
          // Try to detect supplier from sender for template hints
          const senderLower = (payload.From || "").toLowerCase() + " " + (payload.FromName || "").toLowerCase();
          const supplierHint = senderLower.includes("ans") || senderLower.includes("arizona nutritional")
            ? "ans"
            : undefined;

          const parsed = await parseInvoicePdf(attachment.content, supplierHint);
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
      const errMsg = docError instanceof Error ? docError.message : String(docError);
      const errStack = docError instanceof Error ? docError.stack?.slice(0, 500) : "";
      console.error(`Error processing attachment ${att.Name}:`, docError);

      // Save error details to a document record so we can debug
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
          parsed_data: { error: errMsg, stack: errStack },
          status: "pending",
        })
        .then(({ error }) => {
          if (error) console.error("Failed to save error doc:", error);
        });

      results.push({
        filename: att.Name,
        documentType: "error",
        status: "failed",
      });
    }
  }

  // Mark email as processed — always keep diagnostics for now
  const diagnosticMsg = `keys: ${payloadKeys.join(",")} | hasRawEmail: ${hasRawEmail} (${rawEmailLength}) | atts: ${JSON.stringify(attachmentSummary)} | results: ${JSON.stringify(results)}`;
  await db
    .schema("orchard")
    .from("ingested_emails")
    .update({ status: "processed", error_message: diagnosticMsg })
    .eq("id", emailId);

  console.log(`Processed email ${payload.MessageID}: ${results.length} documents`);
  return NextResponse.json({ received: true, emailId, documents: results });
}
