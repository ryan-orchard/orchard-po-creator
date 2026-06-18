import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/supabase";
import { rollUpPoStatus } from "@/lib/po-status";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the Orchard inventory assistant — the AI layer on top of Magna's inventory management system. Magna makes functional beverages (magnesium electrolyte sticks).

Three teams rely on you:
- Ops: creates POs and transfers, cares about what's in stock at each warehouse.
- Finance: needs to know which invoices can be paid and what future cash obligations look like.
- Accounting: values inventory by matching receipts to invoices so inventory assets can be capitalized on the balance sheet and COGS can be tracked.

The inventory flow: Supplier ships goods → Transfer (if Magna handles freight) → Receipt at warehouse.
Each receipt line has two independent statuses:
- invoice_status: has an invoice been linked? Accounting needs this to value the inventory.
- transfer_status: has a transfer shipment been confirmed? Ops uses this for location tracking.

An invoice is "ready to pay" when all its lines have receipt coverage.
Inventory is valued (has a cost basis) when receipt lines are linked to invoice lines.

Always use get_exceptions first when someone asks what needs attention or for a summary.
Be concise and specific. Answer the actual question.
Format dollar amounts with $ and commas. Dates as Month D, YYYY.
When recommending an action (e.g. linking an invoice to a receipt), tell the user which page to go to in the app.
Use plain English. No jargon.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_exceptions",
    description: "Get a summary of items currently needing attention: unmatched receipt lines, invoices waiting for receipts, past-due invoices, and transfers in transit.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_receipts",
    description: "Get receipts, optionally filtered by invoice match status.",
    input_schema: {
      type: "object" as const,
      properties: {
        invoice_status: {
          type: "string",
          enum: ["unmatched", "matched", "all"],
          description: "Filter by invoice match status. Default: all.",
        },
        limit: { type: "number", description: "Max receipts to return. Default: 15." },
      },
      required: [],
    },
  },
  {
    name: "get_invoices",
    description: "Get invoices, optionally filtered by payability status.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["ready_to_pay", "pending_receipt", "all"],
          description: "Filter by payability status.",
        },
        limit: { type: "number", description: "Max invoices to return. Default: 15." },
      },
      required: [],
    },
  },
  {
    name: "get_transfers",
    description: "Get transfers, optionally filtered by status.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["in_transit", "received", "all"],
          description: "Filter by status.",
        },
        limit: { type: "number", description: "Max transfers to return. Default: 15." },
      },
      required: [],
    },
  },
  {
    name: "get_purchase_orders",
    description: "Get purchase orders, optionally filtered by status.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["draft", "ordered", "confirmed", "complete", "all"],
          description: "Filter by status.",
        },
        limit: { type: "number", description: "Max POs to return. Default: 15." },
      },
      required: [],
    },
  },
  {
    name: "suggest_invoice_match",
    description: "For a set of unmatched receipt lines, suggest the best matching invoices ranked by confidence. Use when accounting asks about matching a receipt to an invoice.",
    input_schema: {
      type: "object" as const,
      properties: {
        receipt_line_ids: {
          type: "array",
          items: { type: "string" },
          description: "Receipt line IDs to find invoice matches for.",
        },
      },
      required: ["receipt_line_ids"],
    },
  },
];

function toolStatusText(name: string): string {
  const map: Record<string, string> = {
    get_exceptions: "Checking what needs attention...",
    get_receipts: "Looking at receipts...",
    get_invoices: "Reviewing invoices...",
    get_transfers: "Checking transfers...",
    get_purchase_orders: "Looking at purchase orders...",
    suggest_invoice_match: "Finding invoice matches...",
  };
  return map[name] ?? "Working...";
}

// ─── Tool implementations ───────────────────────────────────────────────────

async function toolGetExceptions() {
  const today = new Date();

  const [unmatchedResult, invoiceStatusResult, transfersResult, allInvoices] = await Promise.all([
    db.schema("orchard_calcs").from("receipt_line_statuses")
      .select("receipt_line_id", { count: "exact", head: true })
      .eq("invoice_status", "unmatched")
      .not("flag", "eq", "excluded"),
    db.schema("orchard_calcs").from("invoice_statuses")
      .select("invoice_id", { count: "exact", head: true })
      .eq("match_status", "Unmatched"),
    db.schema("orchard").from("transfers")
      .select("id", { count: "exact", head: true })
      .eq("status", "in_transit"),
    db.schema("orchard").from("invoices")
      .select("id, invoice_date, payment_terms"),
  ]);

  let pastDueCount = 0;
  for (const inv of allInvoices.data ?? []) {
    if (!inv.invoice_date) continue;
    const netDays = parseInt(String(inv.payment_terms ?? "30").replace(/\D/g, "")) || 30;
    const due = new Date(inv.invoice_date as string);
    due.setDate(due.getDate() + netDays);
    if (due < today) pastDueCount++;
  }

  return {
    unmatchedReceiptLines: unmatchedResult.count ?? 0,
    invoicesAwaitingReceipts: invoiceStatusResult.count ?? 0,
    transfersInTransit: transfersResult.count ?? 0,
    pastDueInvoices: pastDueCount,
  };
}

async function toolGetReceipts(invoiceStatus = "all", limit = 15) {
  const { data: receipts } = await db.schema("orchard").from("receipts")
    .select("id, receipt_number, external_id, received_date, location_id")
    .order("received_date", { ascending: false })
    .limit(limit * 3);

  if (!receipts?.length) return [];

  const receiptIds = receipts.map((r) => r.id as string);
  const { data: lines } = await db.schema("orchard").from("receipt_lines")
    .select("id, receipt_id, item_id, qty_received, three_pl_sku")
    .in("receipt_id", receiptIds);

  const lineIds = (lines ?? []).map((l) => l.id as string);
  const { data: statuses } = lineIds.length > 0
    ? await db.schema("orchard_calcs").from("receipt_line_statuses")
        .select("receipt_line_id, invoice_status, flag")
        .in("receipt_line_id", lineIds)
    : { data: [] };

  const itemIds = [...new Set((lines ?? []).map((l) => l.item_id as string).filter(Boolean))];
  const { data: items } = itemIds.length > 0
    ? await db.schema("org_config").from("items").select("id, sku").in("id", itemIds)
    : { data: [] };

  const locationIds = [...new Set(receipts.map((r) => r.location_id as string).filter(Boolean))];
  const { data: locations } = locationIds.length > 0
    ? await db.schema("org_config").from("locations").select("id, code, name").in("id", locationIds)
    : { data: [] };

  const itemMap = new Map((items ?? []).map((i) => [i.id as string, i.sku as string]));
  const locMap = new Map((locations ?? []).map((l) => [l.id as string, ((l.code || l.name) as string)]));
  const statusMap = new Map((statuses ?? []).map((s) => [s.receipt_line_id as string, s]));
  const linesByReceipt = new Map<string, typeof lines>();
  for (const line of lines ?? []) {
    const arr = linesByReceipt.get(line.receipt_id as string) ?? [];
    arr.push(line);
    linesByReceipt.set(line.receipt_id as string, arr);
  }

  return receipts.map((r) => {
    const rLines = linesByReceipt.get(r.id as string) ?? [];
    const filtered = rLines.filter((l) => {
      const s = statusMap.get(l.id as string);
      if (s?.flag === "excluded") return false;
      if (invoiceStatus === "unmatched") return !s || s.invoice_status === "unmatched";
      if (invoiceStatus === "matched") return s?.invoice_status === "matched";
      return true;
    });
    return {
      orderNumber: (r.external_id || r.receipt_number) as string,
      date: r.received_date as string,
      warehouse: r.location_id ? locMap.get(r.location_id as string) ?? null : null,
      lines: filtered.map((l) => ({
        lineId: l.id as string,
        sku: itemMap.get(l.item_id as string) ?? (l.three_pl_sku as string) ?? "Unknown",
        qty: Number(l.qty_received),
        invoiceStatus: statusMap.get(l.id as string)?.invoice_status ?? "unmatched",
      })),
    };
  }).filter((r) => r.lines.length > 0).slice(0, limit);
}

async function toolGetInvoices(status = "all", limit = 15) {
  const { data: invoices } = await db.schema("orchard").from("invoices")
    .select("id, invoice_number, invoice_date, invoice_type, supplier_id, total_amount, payment_terms")
    .order("invoice_date", { ascending: false })
    .limit(limit * 2);

  if (!invoices?.length) return [];

  const invoiceIds = invoices.map((i) => i.id as string);
  const [statusResult, supplierResult] = await Promise.all([
    db.schema("orchard_calcs").from("invoice_statuses")
      .select("invoice_id, match_status, payment_status")
      .in("invoice_id", invoiceIds),
    db.schema("org_config").from("suppliers")
      .select("id, name, code")
      .in("id", invoices.map((i) => i.supplier_id as string).filter(Boolean)),
  ]);

  const statusMap = new Map((statusResult.data ?? []).map((s) => [s.invoice_id as string, s]));
  const supplierMap = new Map((supplierResult.data ?? []).map((s) => [s.id as string, (s.code || s.name) as string]));
  const today = new Date();

  const result = invoices.map((inv) => {
    const s = statusMap.get(inv.id as string);
    const paid = s?.payment_status === "Paid";
    const matched = s?.match_status === "Matched";
    const payability = paid ? "paid" : matched ? "ready_to_pay" : "pending_receipt";

    const netDays = parseInt(String(inv.payment_terms ?? "30").replace(/\D/g, "")) || 30;
    const dueDate = inv.invoice_date ? new Date(inv.invoice_date as string) : null;
    if (dueDate) dueDate.setDate(dueDate.getDate() + netDays);

    return {
      invoiceNumber: inv.invoice_number as string,
      type: inv.invoice_type as string,
      supplier: inv.supplier_id ? supplierMap.get(inv.supplier_id as string) ?? null : null,
      date: inv.invoice_date as string,
      dueDate: dueDate?.toISOString().split("T")[0] ?? null,
      amount: Number(inv.total_amount) || 0,
      payability,
      pastDue: !!dueDate && dueDate < today && !paid,
    };
  }).filter((inv) => {
    if (status === "ready_to_pay") return inv.payability === "ready_to_pay";
    if (status === "pending_receipt") return inv.payability === "pending_receipt";
    return true;
  }).slice(0, limit);

  return result;
}

async function toolGetTransfers(status = "all", limit = 15) {
  let query = db.schema("orchard").from("transfers")
    .select("id, transfer_number, status, ship_date, from_location_id, to_location_id")
    .order("ship_date", { ascending: false })
    .limit(limit);
  if (status !== "all") query = query.eq("status", status);

  const { data: transfers } = await query;
  if (!transfers?.length) return [];

  const transferIds = transfers.map((t) => t.id as string);
  const { data: lines } = await db.schema("orchard").from("transfer_lines")
    .select("id, transfer_id, item_id, shipped_qty")
    .in("transfer_id", transferIds);

  const lineIds = (lines ?? []).map((l) => l.id as string);
  const { data: links } = lineIds.length > 0
    ? await db.schema("orchard_calcs").from("transfer_line_receipt_line_links")
        .select("transfer_line_id, matched_qty, confirmed")
        .in("transfer_line_id", lineIds)
    : { data: [] };

  const receivedByLine = new Map<string, number>();
  for (const l of links ?? []) {
    if (!l.confirmed) continue;
    const k = l.transfer_line_id as string;
    receivedByLine.set(k, (receivedByLine.get(k) ?? 0) + Number(l.matched_qty));
  }

  const itemIds = [...new Set((lines ?? []).map((l) => l.item_id as string).filter(Boolean))];
  const locationIds = [...new Set([
    ...transfers.map((t) => t.from_location_id as string),
    ...transfers.map((t) => t.to_location_id as string),
  ].filter(Boolean))];

  const [itemsResult, locResult] = await Promise.all([
    itemIds.length > 0
      ? db.schema("org_config").from("items").select("id, sku").in("id", itemIds)
      : { data: [] },
    locationIds.length > 0
      ? db.schema("org_config").from("locations").select("id, code, name").in("id", locationIds)
      : { data: [] },
  ]);

  const itemMap = new Map((itemsResult.data ?? []).map((i) => [i.id as string, i.sku as string]));
  const locMap = new Map((locResult.data ?? []).map((l) => [l.id as string, ((l.code || l.name) as string)]));
  const linesByTransfer = new Map<string, typeof lines>();
  for (const line of lines ?? []) {
    const arr = linesByTransfer.get(line.transfer_id as string) ?? [];
    arr.push(line);
    linesByTransfer.set(line.transfer_id as string, arr);
  }

  return transfers.map((t) => ({
    transferNumber: t.transfer_number as string,
    status: t.status as string,
    shipDate: t.ship_date as string,
    from: t.from_location_id ? locMap.get(t.from_location_id as string) ?? null : null,
    to: t.to_location_id ? locMap.get(t.to_location_id as string) ?? null : null,
    lines: (linesByTransfer.get(t.id as string) ?? []).map((l) => ({
      sku: itemMap.get(l.item_id as string) ?? "Unknown",
      shipped: Number(l.shipped_qty),
      received: receivedByLine.get(l.id as string) ?? 0,
    })),
  }));
}

async function toolGetPurchaseOrders(status = "all", limit = 15) {
  const { data: pos } = await db.schema("orchard").from("purchase_orders")
    .select("id, po_number, supplier_id, order_date")
    .order("order_date", { ascending: false })
    .limit(limit * 2);

  if (!pos?.length) return [];

  const poIds = pos.map((p) => p.id as string);
  const { data: poLines } = await db.schema("orchard").from("po_lines")
    .select("id, po_id").in("po_id", poIds);

  const lineIds = (poLines ?? []).map((l) => l.id as string);
  const { data: lineStatuses } = lineIds.length > 0
    ? await db.schema("orchard_calcs").from("po_line_statuses")
        .select("po_line_id, status").in("po_line_id", lineIds)
    : { data: [] };

  const stateMap = new Map((lineStatuses ?? []).map((s) => [s.po_line_id as string, s.status as string]));
  const linesByPO = new Map<string, string[]>();
  for (const l of poLines ?? []) {
    const arr = linesByPO.get(l.po_id as string) ?? [];
    arr.push(l.id as string);
    linesByPO.set(l.po_id as string, arr);
  }

  const supplierIds = [...new Set(pos.map((p) => p.supplier_id as string).filter(Boolean))];
  const { data: suppliers } = supplierIds.length > 0
    ? await db.schema("org_config").from("suppliers").select("id, name, code").in("id", supplierIds)
    : { data: [] };

  const supplierMap = new Map((suppliers ?? []).map((s) => [s.id as string, (s.code || s.name) as string]));

  return pos.map((po) => {
    const lineIds = linesByPO.get(po.id as string) ?? [];
    const states = lineIds.map((id) => stateMap.get(id) ?? "ordered");
    const poStatus = rollUpPoStatus(states);
    return {
      poNumber: po.po_number as string,
      supplier: po.supplier_id ? supplierMap.get(po.supplier_id as string) ?? null : null,
      date: po.order_date as string,
      status: poStatus,
      lineCount: lineIds.length,
    };
  }).filter((po) => status === "all" || po.status === status).slice(0, limit);
}

async function toolSuggestInvoiceMatch(receiptLineIds: string[]) {
  if (!receiptLineIds.length) return { candidates: [] };

  const { data: receiptLines } = await db.schema("orchard").from("receipt_lines")
    .select("id, item_id, qty_received").in("id", receiptLineIds);

  const itemIds = [...new Set((receiptLines ?? []).map((rl) => rl.item_id as string).filter(Boolean))];
  if (!itemIds.length) return { candidates: [], note: "Receipt lines have no SKUs assigned." };

  const { data: invoiceLines } = await db.schema("orchard").from("invoice_lines")
    .select("id, invoice_id, item_id, qty, unit_price").in("item_id", itemIds);

  if (!invoiceLines?.length) return { candidates: [] };

  const invoiceIds = [...new Set((invoiceLines ?? []).map((il) => il.invoice_id as string))];
  const [invoicesResult, statusResult, supplierResult] = await Promise.all([
    db.schema("orchard").from("invoices")
      .select("id, invoice_number, invoice_date, supplier_id, total_amount").in("id", invoiceIds),
    db.schema("orchard_calcs").from("invoice_statuses")
      .select("invoice_id, match_status").in("invoice_id", invoiceIds),
    db.schema("org_config").from("suppliers").select("id, name, code"),
  ]);

  const fullyMatched = new Set(
    (statusResult.data ?? []).filter((s) => s.match_status === "Matched").map((s) => s.invoice_id as string)
  );
  const supplierMap = new Map((supplierResult.data ?? []).map((s) => [s.id as string, (s.code || s.name) as string]));

  const receiptQtyByItem = new Map<string, number>();
  for (const rl of receiptLines ?? []) {
    if (rl.item_id) {
      receiptQtyByItem.set(rl.item_id as string, (receiptQtyByItem.get(rl.item_id as string) ?? 0) + Number(rl.qty_received));
    }
  }

  const ilByInvoice = new Map<string, typeof invoiceLines>();
  for (const il of invoiceLines ?? []) {
    const arr = ilByInvoice.get(il.invoice_id as string) ?? [];
    arr.push(il);
    ilByInvoice.set(il.invoice_id as string, arr);
  }

  const candidates = (invoicesResult.data ?? [])
    .filter((inv) => !fullyMatched.has(inv.id as string))
    .map((inv) => {
      const ils = ilByInvoice.get(inv.id as string) ?? [];
      const matching = ils.filter((il) => itemIds.includes(il.item_id as string));
      let qtyScore = 0;
      for (const il of matching) {
        const rQty = receiptQtyByItem.get(il.item_id as string) ?? 0;
        const iQty = Number(il.qty);
        if (iQty > 0 && rQty > 0) {
          qtyScore += 1 - Math.abs(iQty - rQty) / Math.max(iQty, rQty);
        }
      }
      const score = matching.length + qtyScore;
      return {
        invoiceNumber: inv.invoice_number as string,
        supplier: inv.supplier_id ? supplierMap.get(inv.supplier_id as string) ?? null : null,
        date: inv.invoice_date as string,
        amount: Number(inv.total_amount) || 0,
        matchingSkus: matching.length,
        unitCosts: matching.map((il) => ({
          qty: Number(il.qty),
          unitPrice: Number(il.unit_price),
        })),
        confidence: score > 1.5 ? "high" : score > 0.5 ? "medium" : "low",
        score,
      };
    })
    .filter((c) => c.matchingSkus > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return { candidates };
}

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_exceptions": return toolGetExceptions();
    case "get_receipts": return toolGetReceipts(input.invoice_status as string, input.limit as number);
    case "get_invoices": return toolGetInvoices(input.status as string, input.limit as number);
    case "get_transfers": return toolGetTransfers(input.status as string, input.limit as number);
    case "get_purchase_orders": return toolGetPurchaseOrders(input.status as string, input.limit as number);
    case "suggest_invoice_match": return toolSuggestInvoiceMatch(input.receipt_line_ids as string[]);
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ─── Route handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json() as { messages: Anthropic.MessageParam[] };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: object) => {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        };

        try {
          let currentMessages = [...messages];
          let iterations = 0;

          while (iterations < 10) {
            iterations++;
            const response = await client.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 2048,
              system: SYSTEM_PROMPT,
              tools: TOOLS,
              messages: currentMessages,
            });

            if (response.stop_reason === "end_turn") {
              for (const block of response.content) {
                if (block.type === "text") {
                  send({ type: "text", text: block.text });
                }
              }
              break;
            }

            if (response.stop_reason === "tool_use") {
              const toolResults: Anthropic.ToolResultBlockParam[] = [];
              for (const block of response.content) {
                if (block.type === "tool_use") {
                  send({ type: "status", text: toolStatusText(block.name) });
                  const result = await executeTool(block.name, block.input as Record<string, unknown>);
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: JSON.stringify(result),
                  });
                }
              }
              currentMessages = [
                ...currentMessages,
                { role: "assistant", content: response.content },
                { role: "user", content: toolResults },
              ];
            } else {
              break;
            }
          }

          send({ type: "done" });
        } catch (error) {
          send({ type: "error", text: error instanceof Error ? error.message : "Something went wrong" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
