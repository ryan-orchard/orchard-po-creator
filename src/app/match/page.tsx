"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type {
  MatchPayload,
  MatchInvoice,
  MatchSourceDoc,
  MatchReceipt,
  CheckStripRow,
  CandidateSourceDoc,
  CandidateInvoice,
  CandidateInvoiceLine,
} from "@/app/api/match/route";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtQty(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

// ─────────────────────────────────────────────────────────────
// Card shell
// ─────────────────────────────────────────────────────────────

type CardState = "anchor" | "green" | "amber";

function Card({
  state,
  label,
  children,
}: {
  state: CardState;
  label: string;
  children: React.ReactNode;
}) {
  const border =
    state === "anchor"
      ? "border-stone-300"
      : state === "green"
      ? "border-emerald-400"
      : "border-amber-400";

  const labelColor =
    state === "anchor"
      ? "text-stone-400"
      : state === "green"
      ? "text-emerald-600"
      : "text-amber-600";

  const dot =
    state === "anchor"
      ? "bg-stone-300"
      : state === "green"
      ? "bg-emerald-400"
      : "bg-amber-400";

  return (
    <div className={`flex flex-col bg-white rounded-2xl border-2 ${border} overflow-hidden h-full`}>
      <div className="px-5 pt-4 pb-3 border-b border-stone-100 flex items-center gap-2 flex-shrink-0">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
        <span className={`text-[10px] font-bold tracking-widest uppercase ${labelColor}`}>
          {label}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Invoice Card
// ─────────────────────────────────────────────────────────────

function InvoiceCard({
  invoice,
  isAnchor,
}: {
  invoice: MatchInvoice;
  isAnchor: boolean;
}) {
  const statusColors: Record<string, string> = {
    Open: "bg-stone-100 text-stone-600",
    Matched: "bg-emerald-50 text-emerald-700",
    Discrepancy: "bg-red-50 text-red-700",
  };

  const paymentStatusColors: Record<string, string> = {
    Unpaid: "bg-amber-50 text-amber-700",
    Paid: "bg-emerald-50 text-emerald-700",
    Disputed: "bg-red-50 text-red-700",
  };

  return (
    <Card state={isAnchor ? "anchor" : "green"} label="Invoice">
      <div className="px-5 py-4 space-y-4">
        {/* Header */}
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-stone-900 leading-tight">
                {invoice.invoiceNumber}
              </p>
              <p className="text-sm text-stone-500 mt-0.5">{invoice.supplier || "—"}</p>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                  statusColors[invoice.status] || "bg-stone-100 text-stone-600"
                }`}
              >
                {invoice.status}
              </span>
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                  paymentStatusColors[invoice.paymentStatus] || "bg-stone-100 text-stone-600"
                }`}
              >
                {invoice.paymentStatus}
              </span>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 capitalize">
                {invoice.invoiceType}
              </span>
            </div>
          </div>
        </div>

        {/* Metadata row */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <p className="text-stone-400 uppercase tracking-wide text-[9px] font-semibold mb-0.5">Invoice Date</p>
            <p className="text-stone-700">{fmtDate(invoice.invoiceDate)}</p>
          </div>
          {invoice.dueDate && (
            <div>
              <p className="text-stone-400 uppercase tracking-wide text-[9px] font-semibold mb-0.5">Due Date</p>
              <p className="text-stone-700">{fmtDate(invoice.dueDate)}</p>
            </div>
          )}
          {invoice.paymentTerms && (
            <div>
              <p className="text-stone-400 uppercase tracking-wide text-[9px] font-semibold mb-0.5">Payment Terms</p>
              <p className="text-stone-700">{invoice.paymentTerms}</p>
            </div>
          )}
          {invoice.poReference && (
            <div>
              <p className="text-stone-400 uppercase tracking-wide text-[9px] font-semibold mb-0.5">PO Reference</p>
              <p className="text-stone-700">{invoice.poReference}</p>
            </div>
          )}
          {invoice.salesOrderNumber && (
            <div>
              <p className="text-stone-400 uppercase tracking-wide text-[9px] font-semibold mb-0.5">Sales Order</p>
              <p className="text-stone-700">{invoice.salesOrderNumber}</p>
            </div>
          )}
        </div>

        {/* Financial summary */}
        <div className="bg-stone-50 rounded-xl px-4 py-3 space-y-1.5">
          {invoice.subtotal != null && (
            <div className="flex justify-between text-xs">
              <span className="text-stone-400">Subtotal</span>
              <span className="text-stone-600">{fmtCurrency(invoice.subtotal)}</span>
            </div>
          )}
          {invoice.freight != null && (
            <div className="flex justify-between text-xs">
              <span className="text-stone-400">Freight</span>
              <span className="text-stone-600">{fmtCurrency(invoice.freight)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline pt-1 border-t border-stone-200">
            <p className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase">
              Total
            </p>
            <p className="text-2xl font-semibold text-stone-900">
              {fmtCurrency(invoice.totalAmount)}
            </p>
          </div>
        </div>

        {/* Lines */}
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase mb-2">
            Line Items
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stone-100">
                <th className="text-left pb-1.5 text-stone-400 font-medium">SKU / Description</th>
                <th className="text-right pb-1.5 text-stone-400 font-medium">Qty</th>
                <th className="text-right pb-1.5 text-stone-400 font-medium">Unit</th>
                <th className="text-right pb-1.5 text-stone-400 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id} className="border-b border-stone-50 last:border-0">
                  <td className="py-2 text-stone-700 font-medium">
                    {l.skuName || l.description || "—"}
                  </td>
                  <td className="py-2 text-right text-stone-500">{fmtQty(l.qtyBilled)}</td>
                  <td className="py-2 text-right text-stone-500">{fmtCurrency(l.unitCost)}</td>
                  <td className="py-2 text-right text-stone-700 font-medium">
                    {fmtCurrency(l.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div className="bg-stone-50 rounded-lg px-3 py-2.5">
            <p className="text-[9px] font-semibold tracking-widest text-stone-400 uppercase mb-1">Notes</p>
            <p className="text-xs text-stone-600">{invoice.notes}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Source Doc Card
// ─────────────────────────────────────────────────────────────

function SourceDocCard({
  sourceDoc,
  candidates,
  isAnchor,
  onSelect,
  onUnlink,
}: {
  sourceDoc: MatchSourceDoc | null;
  candidates: CandidateSourceDoc[];
  isAnchor: boolean;
  onSelect: (id: string, type: "po" | "wo") => void;
  onUnlink: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = candidates
    .filter(
      (c) =>
        c.number.toLowerCase().includes(search.toLowerCase()) ||
        (c.supplier || "").toLowerCase().includes(search.toLowerCase())
    )
    .slice(0, 10);

  if (sourceDoc) {
    const poStatusColors: Record<string, string> = {
      Draft: "bg-stone-100 text-stone-600",
      Issued: "bg-blue-50 text-blue-700",
      Accepted: "bg-blue-50 text-blue-700",
      Shipped: "bg-amber-50 text-amber-700",
      "Partially Received": "bg-amber-50 text-amber-700",
      Received: "bg-emerald-50 text-emerald-700",
      Closed: "bg-stone-100 text-stone-500",
      Cancelled: "bg-red-50 text-red-600",
    };

    return (
      <Card state={isAnchor ? "anchor" : "green"} label={sourceDoc.type === "po" ? "Purchase Order" : "Work Order"}>
        <div className="px-5 py-4 space-y-4">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-stone-900 leading-tight">
                {sourceDoc.number}
              </p>
              <p className="text-sm text-stone-500 mt-0.5">{sourceDoc.supplier || "—"}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span
                className={`text-[11px] font-medium px-2 py-1 rounded-full ${
                  poStatusColors[sourceDoc.status] || "bg-stone-100 text-stone-600"
                }`}
              >
                {sourceDoc.status}
              </span>
              {!isAnchor && (
                <button
                  onClick={onUnlink}
                  className="text-[11px] text-stone-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors border border-stone-200 hover:border-red-200"
                  title="Unlink source document"
                >
                  Unlink
                </button>
              )}
            </div>
          </div>

          {/* Template fields */}
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-stone-400">
                {sourceDoc.type === "wo" ? "WO Date" : "PO Date"}
              </span>
              <span className="text-stone-700 font-medium">{fmtDate(sourceDoc.date)}</span>
            </div>
            {sourceDoc.location && (
              <div className="flex justify-between">
                <span className="text-stone-400">Location</span>
                <span className="text-stone-700 font-medium">{sourceDoc.location}</span>
              </div>
            )}
          </div>

          {/* Notes/description — shown for all types */}
          {sourceDoc.notes && (
            <div className="bg-stone-50 rounded-lg px-3 py-2.5">
              <p className="text-[9px] font-semibold tracking-widest text-stone-400 uppercase mb-1">
                {sourceDoc.type === "wo" ? "Description" : "Notes"}
              </p>
              <p className="text-sm text-stone-700">{sourceDoc.notes}</p>
            </div>
          )}

          <div>
            <p className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase mb-2">
              Line Items
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-100">
                  <th className="text-left pb-1.5 text-stone-400 font-medium">SKU</th>
                  <th className="text-right pb-1.5 text-stone-400 font-medium">Ordered</th>
                  <th className="text-right pb-1.5 text-stone-400 font-medium">Unit Cost</th>
                </tr>
              </thead>
              <tbody>
                {sourceDoc.lines.map((l) => (
                  <tr key={l.id} className="border-b border-stone-50 last:border-0">
                    <td className="py-2 text-stone-700 font-medium">
                      {l.skuName || "—"}
                    </td>
                    <td className="py-2 text-right text-stone-500">{fmtQty(l.qtyOrdered)}</td>
                    <td className="py-2 text-right text-stone-500">
                      {l.unitCost != null ? fmtCurrency(l.unitCost) : "—"}
                      {l.costBasis ? (
                        <span className="text-stone-400 ml-1">/{l.costBasis.replace("Per ", "").toLowerCase()}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    );
  }

  // No source doc — show search
  return (
    <Card state="amber" label="Purchase Order / Work Order">
      <div className="px-5 py-4 space-y-3">
        <p className="text-sm text-stone-500">
          No source document linked. Search to find the PO or WO this belongs to.
        </p>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by PO number or supplier…"
          className="w-full text-sm px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-stone-400 bg-white placeholder:text-stone-400"
        />
        {search && (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-xs text-stone-400 py-2">No results</p>
            )}
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelect(c.id, c.type)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-stone-50 border border-stone-100 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-stone-800">{c.number}</span>
                    {c.supplier && (
                      <span className="text-xs text-stone-400 ml-2">{c.supplier}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 uppercase">
                      {c.type}
                    </span>
                    <span className="text-[11px] text-stone-400">{fmtDate(c.date)}</span>
                  </div>
                </div>
                <p className="text-xs text-stone-400 mt-0.5">{c.status}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Invoice Search Card (receipt anchor — no invoice linked yet)
// ─────────────────────────────────────────────────────────────

const INVOICE_TYPE_COLORS: Record<string, string> = {
  Supplier: "bg-blue-50 text-blue-600",
  Freight: "bg-purple-50 text-purple-600",
  Other: "bg-stone-100 text-stone-500",
};

function InvoiceLineTable({
  lines,
  receiptSkuIds,
}: {
  lines: CandidateInvoiceLine[];
  receiptSkuIds: string[];
}) {
  if (!lines.length) return <p className="text-[11px] text-stone-400 italic">No line items</p>;
  return (
    <table className="w-full text-xs mt-1">
      <thead>
        <tr className="border-b border-stone-100">
          <th className="text-left pb-1 text-stone-400 font-medium">SKU</th>
          <th className="text-right pb-1 text-stone-400 font-medium">Qty</th>
          <th className="text-right pb-1 text-stone-400 font-medium">Unit Price</th>
          <th className="text-right pb-1 text-stone-400 font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const isMatch = l.skuId ? receiptSkuIds.includes(l.skuId) : false;
          return (
            <tr
              key={l.id}
              className={`border-b border-stone-50 last:border-0 ${isMatch ? "bg-emerald-50/40" : ""}`}
            >
              <td className={`py-1.5 font-medium ${isMatch ? "text-emerald-800" : "text-stone-700"}`}>
                {l.skuName || l.description || "—"}
                {isMatch && (
                  <span className="ml-1.5 text-[9px] font-bold text-emerald-600 uppercase tracking-wide">
                    match
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right text-stone-500">{fmtQty(l.qtyBilled)}</td>
              <td className="py-1.5 text-right text-stone-500">{fmtCurrency(l.unitCost)}</td>
              <td className="py-1.5 text-right text-stone-700 font-medium">{fmtCurrency(l.amount)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function InvoiceSearchCard({
  candidates,
  receiptSkuIds,
  onSelect,
}: {
  candidates: CandidateInvoice[];
  receiptSkuIds: string[];
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [filterBySkus, setFilterBySkus] = useState(receiptSkuIds.length > 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const displayed = candidates
    .filter((c) => {
      if (filterBySkus && receiptSkuIds.length > 0) {
        if (!c.skuIds.some((sid) => receiptSkuIds.includes(sid))) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          c.invoiceNumber.toLowerCase().includes(q) ||
          (c.supplier || "").toLowerCase().includes(q) ||
          (c.poReference || "").toLowerCase().includes(q)
        );
      }
      return true;
    })
    .slice(0, 15);

  return (
    <Card state={selectedId ? "green" : "amber"} label="Invoice">
      <div className="px-5 py-4 space-y-3">
        <div className="space-y-2">
          {receiptSkuIds.length > 0 && (
            <button
              onClick={() => setFilterBySkus(!filterBySkus)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                filterBySkus
                  ? "bg-stone-900 text-white border-stone-900"
                  : "bg-white text-stone-500 border-stone-200 hover:border-stone-400"
              }`}
            >
              {filterBySkus ? "✓ Matching SKUs only" : "Show all invoices"}
            </button>
          )}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by invoice # or supplier…"
            className="w-full text-sm px-3 py-2 border border-stone-200 rounded-lg outline-none focus:border-stone-400 bg-white placeholder:text-stone-400"
          />
        </div>

        <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
          {displayed.length === 0 && (
            <p className="text-xs text-stone-400 py-2">
              {filterBySkus
                ? "No matching invoices — try toggling the SKU filter."
                : "No open invoices found."}
            </p>
          )}
          {displayed.map((c) => {
            const isSelected = selectedId === c.id;
            return (
              <div
                key={c.id}
                className={`rounded-xl border-2 transition-colors ${
                  isSelected
                    ? "border-emerald-300 bg-emerald-50/40"
                    : "border-stone-100 bg-white hover:border-stone-200"
                }`}
              >
                {/* Invoice header — click to select */}
                <button
                  className="w-full text-left px-3 pt-3 pb-2"
                  onClick={() => {
                    setSelectedId(c.id);
                    onSelect(c.id);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold text-stone-800">
                          {c.invoiceNumber}
                        </span>
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                            INVOICE_TYPE_COLORS[c.invoiceType] || "bg-stone-100 text-stone-500"
                          }`}
                        >
                          {c.invoiceType}
                        </span>
                        {isSelected && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            ✓ selected
                          </span>
                        )}
                      </div>
                      {c.supplier && (
                        <p className="text-xs text-stone-500 mt-0.5">{c.supplier}</p>
                      )}
                      {c.poReference && (
                        <p className="text-[11px] text-stone-400 mt-0.5">
                          PO Ref: {c.poReference}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-stone-800">
                        {fmtCurrency(c.totalAmount)}
                      </p>
                      <p className="text-[11px] text-stone-400 mt-0.5">
                        {fmtDate(c.invoiceDate)}
                      </p>
                    </div>
                  </div>
                </button>

                {/* Line items — always shown */}
                <div className="px-3 pb-2.5 border-t border-stone-100">
                  <InvoiceLineTable lines={c.lines} receiptSkuIds={receiptSkuIds} />
                </div>

                {/* Footer */}
                <div className="border-t border-stone-100 px-3 py-1.5 flex justify-end">
                  <a
                    href={`/invoices/${c.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-stone-400 hover:text-stone-700 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View invoice ↗
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Anchor Receipt Card
// ─────────────────────────────────────────────────────────────

function AnchorReceiptCard({ receipt }: { receipt: MatchReceipt }) {
  const totalQty = receipt.lines.reduce((s, l) => s + l.qtyReceived, 0);

  return (
    <Card state="anchor" label="Receipt">
      <div className="px-5 py-4 space-y-4">
        {/* Primary identifier — Order Number */}
        <div>
          <p className="text-[9px] font-semibold tracking-widest text-stone-400 uppercase mb-0.5">
            Order Number
          </p>
          <p className="text-xl font-semibold text-stone-900 leading-tight">
            {receipt.orderNumber || "—"}
          </p>
        </div>

        {/* Template fields */}
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-stone-400">Received</span>
            <span className="text-stone-700 font-medium">{fmtDate(receipt.receivedDate)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-400">Warehouse</span>
            <span className="text-stone-700 font-medium">{receipt.warehouse || "—"}</span>
          </div>
          {receipt.externalReceiptId &&
            receipt.externalReceiptId !== receipt.orderNumber && (
              <div className="flex justify-between">
                <span className="text-stone-400">Stord Ref</span>
                <span className="font-mono text-stone-600 text-[11px]">
                  {receipt.externalReceiptId}
                </span>
              </div>
            )}
          <div className="flex justify-between">
            <span className="text-stone-400">Internal Ref</span>
            <span className="text-stone-500">{receipt.receiptNumber}</span>
          </div>
        </div>

        {/* Items received */}
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase mb-2">
            Items Received
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stone-100">
                <th className="text-left pb-1.5 text-stone-400 font-medium">SKU</th>
                <th className="text-right pb-1.5 text-stone-400 font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((l) => (
                <tr key={l.id} className="border-b border-stone-50 last:border-0">
                  <td className="py-2 text-stone-700 font-medium">{l.skuName || "—"}</td>
                  <td className="py-2 text-right text-stone-500">{fmtQty(l.qtyReceived)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-stone-400 mt-2">
            {receipt.lines.length} line{receipt.lines.length !== 1 ? "s" : ""} · {fmtQty(totalQty)} units total
          </p>
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Receipts Card
// ─────────────────────────────────────────────────────────────

function ReceiptsCard({
  available,
  selectedIds,
  suggestedIds,
  hasSourceDoc,
  onToggle,
}: {
  available: MatchReceipt[];
  selectedIds: Set<string>;
  suggestedIds: Set<string>;
  hasSourceDoc: boolean;
  onToggle: (id: string) => void;
}) {
  const state: CardState = selectedIds.size > 0 ? "green" : "amber";

  // Sort: suggested first, then by date desc
  const sorted = [...available].sort((a, b) => {
    const aS = suggestedIds.has(a.id) ? 0 : 1;
    const bS = suggestedIds.has(b.id) ? 0 : 1;
    if (aS !== bS) return aS - bS;
    return (b.receivedDate || "").localeCompare(a.receivedDate || "");
  });

  return (
    <Card state={state} label={`Receipts${selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}`}>
      {!hasSourceDoc ? (
        <div className="px-5 py-4">
          <p className="text-sm text-stone-400">Link a source document first.</p>
        </div>
      ) : available.length === 0 ? (
        <div className="px-5 py-4">
          <p className="text-sm text-stone-400">No receipts found for this document.</p>
        </div>
      ) : (
        <div className="divide-y divide-stone-100">
          {sorted.map((r) => {
            const selected = selectedIds.has(r.id);
            const suggested = suggestedIds.has(r.id);
            const totalQty = r.lines.reduce((s, l) => s + l.qtyReceived, 0);

            return (
              <label
                key={r.id}
                className={`flex items-start gap-3 px-5 py-3.5 cursor-pointer transition-colors ${
                  selected ? "bg-emerald-50/50" : "hover:bg-stone-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggle(r.id)}
                  className="mt-0.5 w-4 h-4 accent-emerald-600 flex-shrink-0 cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-stone-800">
                        {r.receiptNumber}
                      </span>
                      {suggested && !selected && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-600">
                          suggested
                        </span>
                      )}
                      {selected && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600">
                          selected
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-stone-400 flex-shrink-0">
                      {fmtDate(r.receivedDate)}
                    </span>
                  </div>
                  {r.orderNumber && (
                    <p className="text-xs text-stone-500 mt-0.5 font-medium">{r.orderNumber}</p>
                  )}
                  {r.warehouse && (
                    <p className="text-xs text-stone-400 mt-0.5">{r.warehouse}</p>
                  )}
                  <table className="w-full text-xs mt-2">
                    <tbody>
                      {r.lines.map((l) => (
                        <tr key={l.id}>
                          <td className="py-0.5 text-stone-600">{l.skuName || "—"}</td>
                          <td className="py-0.5 text-right text-stone-400">
                            {fmtQty(l.qtyReceived)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-stone-400 mt-1.5">
                    {r.lines.length} line{r.lines.length !== 1 ? "s" : ""} ·{" "}
                    {fmtQty(totalQty)} units
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Check Strip
// ─────────────────────────────────────────────────────────────

function CheckStrip({ rows }: { rows: CheckStripRow[] }) {
  if (!rows.length) return null;

  const allGood = rows.every((r) => r.priceMatch !== false && r.qtyMatch !== false);

  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between">
        <p className="text-[10px] font-bold tracking-widest text-stone-400 uppercase">
          Verification
        </p>
        <span
          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
            allGood
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {allGood ? "All checks pass" : "Discrepancy detected"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              <th className="text-left px-5 py-2.5 text-stone-500 font-medium">SKU</th>
              <th className="text-right px-3 py-2.5 text-stone-500 font-medium">PO Price</th>
              <th className="text-right px-3 py-2.5 text-stone-500 font-medium">Inv. Price</th>
              <th className="text-center px-3 py-2.5 text-stone-500 font-medium">Price</th>
              <th className="text-right px-3 py-2.5 text-stone-500 font-medium">PO Qty</th>
              <th className="text-right px-3 py-2.5 text-stone-500 font-medium">Rcv&apos;d</th>
              <th className="text-right px-3 py-2.5 text-stone-500 font-medium">Inv. Qty</th>
              <th className="text-center px-3 py-2.5 text-stone-500 font-medium pr-5">Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.skuId} className="border-b border-stone-50 last:border-0 hover:bg-stone-50">
                <td className="px-5 py-3 font-medium text-stone-800">{row.skuName}</td>
                <td className="px-3 py-3 text-right text-stone-500">
                  {fmtCurrency(row.agreedUnitCost)}
                </td>
                <td className="px-3 py-3 text-right text-stone-500">
                  {fmtCurrency(row.invoiceUnitCost)}
                </td>
                <td className="px-3 py-3 text-center">
                  <MatchPill match={row.priceMatch} />
                </td>
                <td className="px-3 py-3 text-right text-stone-500">
                  {fmtQty(row.poQty)}
                </td>
                <td className="px-3 py-3 text-right text-stone-500">
                  {fmtQty(row.receivedQty)}
                </td>
                <td className="px-3 py-3 text-right text-stone-500">
                  {fmtQty(row.invoiceQty)}
                </td>
                <td className="px-3 py-3 text-center pr-5">
                  <MatchPill match={row.qtyMatch} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchPill({ match }: { match: boolean | null }) {
  if (match === null)
    return <span className="text-stone-300 text-base">—</span>;
  return match ? (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 text-[11px] font-bold">
      ✓
    </span>
  ) : (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-600 text-[11px] font-bold">
      ✗
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────

export default function MatchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const from = searchParams.get("from") as "invoice" | "receipt" | null;
  const id = searchParams.get("id");

  const [data, setData] = useState<MatchPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Selection state
  const [selectedReceiptIds, setSelectedReceiptIds] = useState<Set<string>>(new Set());
  const [selectedSourceDoc, setSelectedSourceDoc] = useState<{
    id: string;
    type: "po" | "wo";
  } | null>(null);

  const load = useCallback(async () => {
    if (!from || !id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/match?from=${from}&id=${id}`);
      if (!res.ok) throw new Error(await res.text());
      const payload: MatchPayload = await res.json();
      setData(payload);

      // Initialize receipt selection
      const initIds =
        payload.receipts.linkedIds.length > 0
          ? payload.receipts.linkedIds
          : payload.receipts.suggestedIds;
      setSelectedReceiptIds(new Set(initIds));

      // Initialize source doc selection
      if (payload.sourceDoc) {
        setSelectedSourceDoc({ id: payload.sourceDoc.id, type: payload.sourceDoc.type });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [from, id]);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleConfirm = async () => {
    if (!data || !selectedSourceDoc || selectedReceiptIds.size === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/match", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          id,
          sourceDocId: selectedSourceDoc.id,
          sourceDocType: selectedSourceDoc.type,
          selectedReceiptIds: [...selectedReceiptIds],
          ...(selectedInvoiceId ? { selectedInvoiceId } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to confirm");
      }
      showToast("Match confirmed");
      setTimeout(() => router.back(), 1200);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const handleSelectSourceDoc = (docId: string, type: "po" | "wo") => {
    setSelectedSourceDoc({ id: docId, type });
    if (data) {
      setData({ ...data, candidateSourceDocs: [] });
    }
    load();
  };

  const handleUnlinkSource = async () => {
    if (!from || !id) return;
    try {
      await fetch("/api/match", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlink_source", from, id }),
      });
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to unlink");
    }
  };

  const toggleReceipt = (receiptId: string) => {
    setSelectedReceiptIds((prev) => {
      const next = new Set(prev);
      next.has(receiptId) ? next.delete(receiptId) : next.add(receiptId);
      return next;
    });
  };

  // ── Render states ──

  if (loading) {
    return (
      <div className="fixed inset-0 bg-stone-50 flex items-center justify-center z-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-stone-500">Loading match data…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 bg-stone-50 flex items-center justify-center z-50">
        <div className="text-center max-w-sm">
          <p className="text-sm font-medium text-stone-800 mb-1">Failed to load</p>
          <p className="text-xs text-stone-500 mb-4">{error}</p>
          <button
            onClick={() => router.back()}
            className="text-sm text-stone-600 hover:text-stone-800 underline"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  // Resolve the effective source doc (either from data or from user selection)
  const effectiveSourceDoc =
    data.sourceDoc ??
    (selectedSourceDoc
      ? data.candidateSourceDocs.find((c) => c.id === selectedSourceDoc.id) ?? null
      : null);

  const hasSourceDoc = !!(data.sourceDoc || selectedSourceDoc);
  const canConfirm = hasSourceDoc && selectedReceiptIds.size > 0 && !saving;
  const hasDiscrepancy = data.checkStrip.some(
    (r) => r.priceMatch === false || r.qtyMatch === false
  );

  // Determine card layouts based on anchor type
  const anchorLabel = from === "invoice" ? "invoice" : "receipt";

  // Build the check strip using currently-selected receipts
  const selectedReceipts = data.receipts.available.filter((r) =>
    selectedReceiptIds.has(r.id)
  );

  // Anchor receipt data
  const anchorReceipt = from === "receipt"
    ? data.receipts.available.find((r) => r.id === id) ?? null
    : null;

  return (
    <div className="fixed inset-0 bg-stone-100 z-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="text-stone-400 hover:text-stone-700 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M12.5 15L7.5 10L12.5 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div>
            <p className="text-[10px] font-bold tracking-widest text-stone-400 uppercase">
              Match
            </p>
            <p className="text-sm font-semibold text-stone-800 leading-tight">
              {from === "invoice"
                ? data.invoice?.invoiceNumber || "Invoice"
                : anchorReceipt?.receiptNumber || "Receipt"}{" "}
              — link the triangle
            </p>
          </div>
        </div>

        {/* Status dots */}
        <div className="hidden sm:flex items-center gap-6 text-xs text-stone-500">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${data.invoice ? "bg-emerald-400" : "bg-amber-400"}`} />
            Invoice
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${hasSourceDoc ? "bg-emerald-400" : "bg-amber-400"}`} />
            {effectiveSourceDoc ? effectiveSourceDoc.number : "Source Doc"}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${selectedReceiptIds.size > 0 ? "bg-emerald-400" : "bg-amber-400"}`} />
            {selectedReceiptIds.size > 0
              ? `${selectedReceiptIds.size} receipt${selectedReceiptIds.size !== 1 ? "s" : ""}`
              : "Receipts"}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {hasDiscrepancy && canConfirm && (
            <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-200">
              Discrepancy — confirm to flag
            </span>
          )}
          <button
            onClick={() => router.back()}
            className="text-sm text-stone-500 hover:text-stone-700 px-3 py-1.5 rounded-lg hover:bg-stone-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`text-sm font-semibold px-5 py-2 rounded-lg transition-colors ${
              canConfirm
                ? "bg-stone-900 text-white hover:bg-stone-700"
                : "bg-stone-200 text-stone-400 cursor-not-allowed"
            }`}
          >
            {saving ? "Saving…" : "Confirm Match"}
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-hidden px-6 pt-5 pb-4 grid grid-cols-3 gap-4">
        {from === "invoice" ? (
          <>
            {/* Invoice (anchor) */}
            {data.invoice ? (
              <InvoiceCard invoice={data.invoice} isAnchor={true} />
            ) : (
              <Card state="amber" label="Invoice">
                <div className="px-5 py-4">
                  <p className="text-sm text-stone-400">Invoice not found.</p>
                </div>
              </Card>
            )}

            {/* Source doc */}
            <SourceDocCard
              sourceDoc={data.sourceDoc}
              candidates={data.candidateSourceDocs}
              isAnchor={false}
              onSelect={handleSelectSourceDoc}
              onUnlink={handleUnlinkSource}
            />

            {/* Receipts */}
            <ReceiptsCard
              available={data.receipts.available}
              selectedIds={selectedReceiptIds}
              suggestedIds={new Set(data.receipts.suggestedIds)}
              hasSourceDoc={hasSourceDoc}
              onToggle={toggleReceipt}
            />
          </>
        ) : (
          <>
            {/* Receipt (anchor) */}
            {anchorReceipt ? (
              <AnchorReceiptCard receipt={anchorReceipt} />
            ) : (
              <Card state="anchor" label="Receipt">
                <div className="px-5 py-4">
                  <p className="text-sm text-stone-400">Receipt data loading…</p>
                </div>
              </Card>
            )}

            {/* Source doc */}
            <SourceDocCard
              sourceDoc={data.sourceDoc}
              candidates={data.candidateSourceDocs}
              isAnchor={false}
              onSelect={handleSelectSourceDoc}
              onUnlink={handleUnlinkSource}
            />

            {/* Invoice */}
            {data.invoice ? (
              <InvoiceCard invoice={data.invoice} isAnchor={false} />
            ) : (
              <InvoiceSearchCard
                candidates={data.candidateInvoices}
                receiptSkuIds={
                  anchorReceipt?.lines
                    .map((l) => l.skuId)
                    .filter((id): id is string => id !== null) ?? []
                }
                onSelect={(invoiceId) => setSelectedInvoiceId(invoiceId)}
              />
            )}
          </>
        )}
      </div>

      {/* Check Strip */}
      {selectedReceipts.length > 0 && data.invoice && (
        <div className="px-6 pb-5 flex-shrink-0">
          <CheckStrip
            rows={
              // Recompute client-side with current selection
              // The server-computed strip may not reflect current selection
              data.checkStrip
            }
          />
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg z-[60]">
          {toast}
        </div>
      )}

      {/* Anchor label */}
      <div className="fixed bottom-6 left-6 text-[10px] text-stone-400 font-medium uppercase tracking-widest">
        Anchored on {anchorLabel}
      </div>

    </div>
  );
}
