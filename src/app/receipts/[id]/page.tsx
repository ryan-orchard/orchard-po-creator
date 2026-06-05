"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import LinkInvoiceModal, { ReceiptLineSummary } from "@/components/LinkInvoiceModal";

// ─── types ────────────────────────────────────────────────────────────────────

interface InvoiceCost {
  invoiceId: string;
  invoiceNumber: string;
  unitCost: number;
  overheadPerUnit: number;
  landedUnitCost: number;
}

interface InvoiceSuggestion extends InvoiceCost {
  invoiceLineId: string;
  confidence: "high" | "medium" | "low";
}

interface TransferSummary {
  transferId: string;
  transferNumber: string;
  totalShippedQty: number;
  totalReceivedQty: number;
}

interface ReceiptLineDetail {
  id: string;
  sku: string | null;
  itemId: string | null;
  qtyReceived: number;
  lotNumber: string | null;
  threePlSku: string | null;
  transferStatus: string;
  invoiceStatus: string;
  linkedInvoice: InvoiceCost | null;
  suggestedInvoice: InvoiceSuggestion | null;
}

interface ReceiptDetail {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  externalReceiptId: string | null;
  warehouse: string | null;
  notes: string | null;
  transfers: TransferSummary[];
  lines: ReceiptLineDetail[];
  matchedLineCount: number;
  unmatchedLineCount: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

function fmtCurrency(n: number) {
  if (n === 0) return "$0";
  return `$${n.toFixed(4).replace(/\.?0+$/, "")}`;
}

// ─── component ────────────────────────────────────────────────────────────────

export default function ReceiptDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null); // lineId being confirmed
  const [modalLine, setModalLine] = useState<{ ids: string[]; summaries: ReceiptLineSummary[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/receipts/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setReceipt(data.error ? null : data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleConfirm = async (line: ReceiptLineDetail) => {
    if (!line.suggestedInvoice) return;
    setConfirming(line.id);
    try {
      const res = await fetch("/api/receipt-lines/link-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptLineIds: [line.id],
          invoiceLineIds: [line.suggestedInvoice.invoiceLineId],
        }),
      });
      if (!res.ok) throw new Error("Link failed");
      load();
    } catch {
      alert("Failed to confirm invoice match. Please try again.");
    } finally {
      setConfirming(null);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/receipts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      router.push("/receipts");
    } catch {
      alert("Failed to delete receipt.");
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Receipt not found.</p>
      </div>
    );
  }

  const allMatched = receipt.unmatchedLineCount === 0 && receipt.lines.length > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-screen-2xl mx-auto px-6 py-8">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {receipt.externalReceiptId || receipt.receiptNumber}
              </h1>
              <span
                className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${
                  allMatched
                    ? "bg-sage-100 text-sage-800"
                    : "bg-warm-100 text-warm-800"
                }`}
              >
                {allMatched ? "matched" : `${receipt.unmatchedLineCount} unmatched`}
              </span>
            </div>
            {receipt.externalReceiptId && (
              <p className="text-sm text-gray-500 mt-1">{receipt.receiptNumber}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {showDeleteConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Delete this receipt?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-red-600 text-white px-3 py-1.5 text-sm rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Confirm"}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="border border-red-200 text-red-600 px-4 py-2 text-sm rounded-md hover:bg-red-50"
              >
                Delete
              </button>
            )}
            <button
              onClick={() => router.push("/receipts")}
              className="border border-gray-300 text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50"
            >
              Back
            </button>
          </div>
        </div>

        {/* ── Info card ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Received Date
              </p>
              <p className="text-sm text-gray-900">{fmt(receipt.receivedDate)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Warehouse
              </p>
              <p className="text-sm text-gray-900">{receipt.warehouse || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Invoice Match
              </p>
              <p className="text-sm text-gray-900">
                {receipt.lines.length === 0 ? (
                  <span className="text-gray-400">No lines</span>
                ) : (
                  <>
                    {receipt.matchedLineCount > 0 && (
                      <span className="text-sage-700">{receipt.matchedLineCount} matched</span>
                    )}
                    {receipt.matchedLineCount > 0 && receipt.unmatchedLineCount > 0 && ", "}
                    {receipt.unmatchedLineCount > 0 && (
                      <span className="text-warm-600">{receipt.unmatchedLineCount} unmatched</span>
                    )}
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* ── Transfer section ───────────────────────────────────────────── */}
        {receipt.transfers.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">
              Transfer{receipt.transfers.length > 1 ? "s" : ""}
            </h2>
            <div className="space-y-2">
              {receipt.transfers.map((t) => {
                const variance = t.totalReceivedQty - t.totalShippedQty;
                return (
                  <div key={t.transferId} className="flex items-center gap-6 text-sm">
                    <button
                      onClick={() => router.push(`/transfers/${t.transferId}`)}
                      className="font-medium text-gold-600 hover:text-gold-800 hover:underline"
                    >
                      {t.transferNumber}
                    </button>
                    <span className="text-gray-500">
                      Shipped {t.totalShippedQty.toLocaleString()} · Received {t.totalReceivedQty.toLocaleString()}
                    </span>
                    {variance !== 0 && (
                      <span className={`text-xs font-medium ${variance < 0 ? "text-warm-600" : "text-sage-700"}`}>
                        {variance > 0 ? "+" : ""}{variance.toLocaleString()} variance
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Lines table ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              Lines ({receipt.lines.length})
            </h2>
          </div>

          {receipt.lines.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-gray-400">
              No lines found for this receipt.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      SKU
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Qty
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Invoice
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Unit Cost
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Overhead/unit
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Landed Unit Cost
                    </th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {receipt.lines.map((line) => {
                    const isConfirming = confirming === line.id;
                    const cost = line.linkedInvoice ?? line.suggestedInvoice;

                    return (
                      <tr key={line.id} className="border-b border-gray-100 hover:bg-gray-50">

                        {/* SKU */}
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {line.sku ?? (
                            <span className="text-burgundy-500 text-xs">No SKU</span>
                          )}
                          {line.lotNumber && (
                            <span className="ml-2 text-xs text-gray-400">
                              lot {line.lotNumber}
                            </span>
                          )}
                        </td>

                        {/* Qty */}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                          {line.qtyReceived.toLocaleString()}
                        </td>

                        {/* Invoice */}
                        <td className="px-4 py-3">
                          {line.linkedInvoice ? (
                            <button
                              onClick={() => router.push(`/invoices/${line.linkedInvoice!.invoiceId}`)}
                              className="text-gold-600 hover:text-gold-800 hover:underline font-medium"
                            >
                              {line.linkedInvoice.invoiceNumber} ↗
                            </button>
                          ) : line.suggestedInvoice ? (
                            <span className="text-gray-500 text-xs italic">
                              {line.suggestedInvoice.invoiceNumber}
                              {line.suggestedInvoice.confidence === "high" && (
                                <span className="ml-1 text-sage-600 not-italic font-medium">·</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>

                        {/* Unit Cost */}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                          {cost ? fmtCurrency(cost.unitCost) : <span className="text-gray-300">$0</span>}
                        </td>

                        {/* Overhead/unit */}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                          {cost ? fmtCurrency(cost.overheadPerUnit) : <span className="text-gray-300">$0</span>}
                        </td>

                        {/* Landed Unit Cost */}
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                          {cost ? fmtCurrency(cost.landedUnitCost) : <span className="text-gray-300">$0</span>}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3 text-center">
                          {line.invoiceStatus === "matched" ? (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-sage-100 text-sage-800">
                              Matched
                            </span>
                          ) : line.suggestedInvoice ? (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gold-100 text-gold-800">
                              Suggested
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">
                              Unmatched
                            </span>
                          )}
                        </td>

                        {/* Action */}
                        <td className="px-4 py-3 text-right">
                          {line.invoiceStatus === "matched" ? null : line.suggestedInvoice ? (
                            <button
                              onClick={() => handleConfirm(line)}
                              disabled={isConfirming}
                              className="px-3 py-1 text-xs font-medium bg-sage-600 text-white rounded hover:bg-sage-700 disabled:opacity-50 whitespace-nowrap"
                            >
                              {isConfirming ? "Saving…" : "Confirm"}
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                if (!line.itemId || !line.sku) return;
                                setModalLine({
                                  ids: [line.id],
                                  summaries: [{ itemSku: line.sku, qty: line.qtyReceived, ref: receipt.externalReceiptId }],
                                });
                              }}
                              className="px-3 py-1 text-xs font-medium border border-gray-300 text-gray-700 rounded hover:bg-gray-50 whitespace-nowrap"
                            >
                              Link Invoice
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Link Invoice Modal (fallback for lines with no suggestion) ───── */}
      {modalLine && (
        <LinkInvoiceModal
          receiptLineIds={modalLine.ids}
          receiptSummaries={modalLine.summaries}
          onClose={() => setModalLine(null)}
          onSuccess={() => {
            setModalLine(null);
            load();
          }}
        />
      )}
    </div>
  );
}
