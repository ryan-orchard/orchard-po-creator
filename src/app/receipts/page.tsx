"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import LinkInvoiceModal, { ReceiptLineSummary } from "@/components/LinkInvoiceModal";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = "unmatched" | "matched" | "excluded";

interface ReceiptSummary {
  receiptId: string;
  source: string;
  date: string | null;
  warehouse: string | null;
  orderRef: string | null;
  totalLines: number;
  unmatchedCount: number;
  matchedCount: number;
  excludedCount: number;
}

interface LinkedInvoice {
  invoiceId: string;
  invoiceNumber: string;
  unitCost: number;
  overheadPerUnit: number;
  landedUnitCost: number;
}

interface SuggestedInvoice extends LinkedInvoice {
  invoiceLineId: string;
  confidence: "high" | "medium" | "low";
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
  linkedInvoice: LinkedInvoice | null;
  suggestedInvoice: SuggestedInvoice | null;
}

interface ReceiptDetail {
  id: string;
  receiptNumber: string | null;
  receivedDate: string | null;
  externalReceiptId: string | null;
  warehouse: string | null;
  lines: ReceiptLineDetail[];
  matchedLineCount: number;
  unmatchedLineCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

function detailUrl(receipt: ReceiptSummary): string {
  if (receipt.source === "stord") {
    return `/api/receipts/${receipt.receiptId}`;
  }
  return `/api/receipts/${receipt.receiptId}?source=${encodeURIComponent(receipt.source)}&doc=${encodeURIComponent(receipt.orderRef ?? "")}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-green-50 text-green-700 border border-green-200",
    medium: "bg-yellow-50 text-yellow-700 border border-yellow-200",
    low: "bg-gray-100 text-gray-500 border border-gray-200",
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${styles[confidence]}`}>
      {confidence}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<ReceiptSummary[]>([]);
  const [counts, setCounts] = useState({ unmatched: 0, matched: 0, excluded: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("unmatched");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Map<string, ReceiptDetail>>(new Map());
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [confirmingIds, setConfirmingIds] = useState<Set<string>>(new Set());
  const [linkModalState, setLinkModalState] = useState<{
    receiptId: string;
    receiptLineId: string;
    itemSku: string;
    qty: number;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // ── Fetch summary ──────────────────────────────────────────────────────────

  const fetchSummary = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/receipts/summary");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || `Server error (${res.status})`);
        return;
      }
      const data = await res.json();
      setReceipts(data.receipts ?? []);
      setCounts(data.counts ?? { unmatched: 0, matched: 0, excluded: 0 });
    } catch {
      setError("Failed to connect to server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // ── Fetch detail ───────────────────────────────────────────────────────────

  const loadDetail = useCallback(async (receipt: ReceiptSummary) => {
    setDetailLoading(receipt.receiptId);
    try {
      const res = await fetch(detailUrl(receipt));
      if (!res.ok) return;
      const detail: ReceiptDetail = await res.json();
      setDetailCache(prev => new Map(prev).set(receipt.receiptId, detail));
    } finally {
      setDetailLoading(null);
    }
  }, []);

  const fetchDetailIfNeeded = useCallback(
    async (receipt: ReceiptSummary) => {
      if (!detailCache.has(receipt.receiptId)) {
        await loadDetail(receipt);
      }
    },
    [detailCache, loadDetail],
  );

  // ── Expand / collapse ──────────────────────────────────────────────────────

  const handleToggle = (receipt: ReceiptSummary) => {
    if (expandedId === receipt.receiptId) {
      setExpandedId(null);
    } else {
      setExpandedId(receipt.receiptId);
      fetchDetailIfNeeded(receipt);
    }
  };

  // ── Confirm AI suggestion ──────────────────────────────────────────────────

  const handleConfirm = async (receipt: ReceiptSummary, line: ReceiptLineDetail) => {
    if (!line.suggestedInvoice) return;
    const lineId = line.id;

    setConfirmingIds(prev => new Set(prev).add(lineId));
    try {
      const res = await fetch("/api/receipt-lines/link-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptLineIds: [lineId],
          invoiceLineIds: [line.suggestedInvoice!.invoiceLineId],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(`Failed: ${(err as { error?: string }).error ?? "Unknown error"}`);
        return;
      }

      const result = await res.json();
      showToast(`Linked to ${result.invoiceNumber}`);

      // Optimistic update — mark line as matched in cache
      setDetailCache(prev => {
        const cached = prev.get(receipt.receiptId);
        if (!cached) return prev;
        const updated: ReceiptDetail = {
          ...cached,
          lines: cached.lines.map(l =>
            l.id === lineId
              ? {
                  ...l,
                  invoiceStatus: "matched",
                  linkedInvoice: {
                    invoiceId: l.suggestedInvoice!.invoiceId,
                    invoiceNumber: l.suggestedInvoice!.invoiceNumber,
                    unitCost: l.suggestedInvoice!.unitCost,
                    overheadPerUnit: l.suggestedInvoice!.overheadPerUnit,
                    landedUnitCost: l.suggestedInvoice!.landedUnitCost,
                  },
                  suggestedInvoice: null,
                }
              : l
          ),
          matchedLineCount: cached.matchedLineCount + 1,
          unmatchedLineCount: Math.max(0, cached.unmatchedLineCount - 1),
        };
        return new Map(prev).set(receipt.receiptId, updated);
      });

      // Update summary row counts
      setReceipts(prev =>
        prev.map(r =>
          r.receiptId === receipt.receiptId
            ? {
                ...r,
                unmatchedCount: Math.max(0, r.unmatchedCount - 1),
                matchedCount: r.matchedCount + 1,
              }
            : r
        )
      );
    } finally {
      setConfirmingIds(prev => {
        const next = new Set(prev);
        next.delete(lineId);
        return next;
      });
    }
  };

  // ── Manual link success ────────────────────────────────────────────────────

  const handleLinkSuccess = async (result: {
    invoiceNumber: string;
    linksCreated: number;
    skippedCount: number;
  }) => {
    const receiptId = linkModalState?.receiptId;
    setLinkModalState(null);

    const skippedNote =
      result.skippedCount > 0
        ? ` (${result.skippedCount} line${result.skippedCount === 1 ? "" : "s"} skipped)`
        : "";
    showToast(`Linked ${result.linksCreated} line${result.linksCreated === 1 ? "" : "s"} to ${result.invoiceNumber}${skippedNote}`);

    // Reload detail and summary
    if (receiptId) {
      const expandedReceipt = receipts.find(r => r.receiptId === receiptId);
      if (expandedReceipt) await loadDetail(expandedReceipt);
    }
    await fetchSummary();
  };

  // ── Toast ──────────────────────────────────────────────────────────────────

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  // ── Filter by tab ──────────────────────────────────────────────────────────

  const filteredReceipts = useMemo(() => {
    return receipts.filter(r => {
      if (activeTab === "unmatched") return r.unmatchedCount > 0;
      if (activeTab === "matched") return r.unmatchedCount === 0 && r.excludedCount === 0 && r.matchedCount > 0;
      return r.excludedCount > 0 && r.unmatchedCount === 0;
    });
  }, [receipts, activeTab]);

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "unmatched", label: "unmatched", count: counts.unmatched },
    { key: "matched", label: "matched", count: counts.matched },
    { key: "excluded", label: "excluded", count: counts.excluded },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Receipts</h1>
          <p className="text-sm text-gray-500 mt-1">Match receipt lines to invoices</p>
        </div>

        {/* Loading */}
        {loading && <p className="text-gray-500">Loading...</p>}

        {/* Error */}
        {!loading && error && (
          <div className="bg-red-50 rounded-lg border border-red-200 p-12 text-center">
            <p className="text-red-700 mb-4">Failed to load receipts</p>
            <p className="text-sm text-red-500 mb-4">{error}</p>
            <button
              onClick={() => { setLoading(true); fetchSummary(); }}
              className="px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50"
            >
              Retry
            </button>
          </div>
        )}

        {/* Main content */}
        {!loading && !error && (
          <>
            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-4">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => { setActiveTab(tab.key); setExpandedId(null); }}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    activeTab === tab.key
                      ? "bg-white text-gray-900 font-medium shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab.label}
                  <span className={`ml-1.5 text-xs ${activeTab === tab.key ? "text-gray-500" : "text-gray-400"}`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">Source</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Order Ref</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">Lines</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">Unmatched</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredReceipts.map(receipt => {
                    const isExpanded = expandedId === receipt.receiptId;
                    const detail = detailCache.get(receipt.receiptId);
                    const isLoadingDetail = detailLoading === receipt.receiptId;

                    return (
                      <React.Fragment key={receipt.receiptId}>
                        {/* Receipt row */}
                        <tr
                          onClick={() => handleToggle(receipt)}
                          className={`cursor-pointer transition-colors ${
                            isExpanded ? "bg-gray-50 border-b-0" : "hover:bg-gray-50"
                          }`}
                        >
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                            {formatDate(receipt.date)}
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-700">
                            {receipt.warehouse || receipt.source.toUpperCase()}
                          </td>
                          <td className="px-4 py-3 text-gray-900 max-w-xs">
                            <span className="truncate block" title={receipt.orderRef ?? undefined}>
                              {receipt.orderRef || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center text-gray-500">
                            {receipt.totalLines}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {receipt.unmatchedCount > 0 ? (
                              <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 text-xs font-medium bg-amber-50 text-amber-700 rounded-full px-1.5 border border-amber-200">
                                {receipt.unmatchedCount}
                              </span>
                            ) : (
                              <span className="text-green-500 text-sm">✓</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-gray-400">
                            <svg
                              className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? "rotate-180" : ""}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </td>
                        </tr>

                        {/* Expanded detail panel */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} className="bg-gray-50 border-b border-gray-200 p-0">
                              {isLoadingDetail ? (
                                <div className="px-8 py-5 text-sm text-gray-400">Loading lines...</div>
                              ) : detail && detail.lines.length > 0 ? (
                                <div className="px-6 pt-2 pb-4">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr>
                                        <th className="text-left pb-2 pt-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">Item</th>
                                        <th className="text-right pb-2 pt-1 text-xs font-semibold text-gray-400 uppercase tracking-wider w-28">Qty</th>
                                        <th className="text-left pb-2 pt-1 text-xs font-semibold text-gray-400 uppercase tracking-wider pl-8">Invoice</th>
                                        <th className="text-right pb-2 pt-1 w-28" />
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {detail.lines.map(line => (
                                        <tr key={line.id} className="hover:bg-white transition-colors">
                                          <td className="py-2.5 pr-4">
                                            <div className="font-medium text-gray-900">
                                              {line.sku || "Unknown"}
                                            </div>
                                            {line.threePlSku && line.threePlSku !== line.sku && (
                                              <div className="text-xs text-gray-400">{line.threePlSku}</div>
                                            )}
                                          </td>
                                          <td className="py-2.5 text-right font-medium text-gray-900">
                                            {line.qtyReceived.toLocaleString()}
                                          </td>
                                          <td className="py-2.5 pl-8">
                                            {line.invoiceStatus === "matched" && line.linkedInvoice ? (
                                              <span className="flex items-center gap-2 text-gray-500">
                                                <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                </svg>
                                                <span className="text-gray-700">{line.linkedInvoice.invoiceNumber}</span>
                                                {line.linkedInvoice.unitCost > 0 && (
                                                  <span className="text-xs text-gray-400">
                                                    ${line.linkedInvoice.unitCost.toFixed(2)}/unit
                                                  </span>
                                                )}
                                              </span>
                                            ) : line.suggestedInvoice ? (
                                              <span className="flex items-center gap-2">
                                                <span className="font-medium text-gray-900">
                                                  {line.suggestedInvoice.invoiceNumber}
                                                </span>
                                                {line.suggestedInvoice.unitCost > 0 && (
                                                  <span className="text-xs text-gray-500">
                                                    ${line.suggestedInvoice.unitCost.toFixed(2)}/unit
                                                  </span>
                                                )}
                                                <ConfidenceBadge confidence={line.suggestedInvoice.confidence} />
                                              </span>
                                            ) : (
                                              <span className="text-gray-400 text-xs">No match found</span>
                                            )}
                                          </td>
                                          <td className="py-2.5 text-right">
                                            {line.invoiceStatus !== "matched" && (
                                              line.suggestedInvoice ? (
                                                <button
                                                  onClick={e => {
                                                    e.stopPropagation();
                                                    handleConfirm(receipt, line);
                                                  }}
                                                  disabled={confirmingIds.has(line.id)}
                                                  className="px-3 py-1 text-xs font-medium text-white bg-gray-900 rounded hover:bg-gray-700 disabled:opacity-50 transition-colors"
                                                >
                                                  {confirmingIds.has(line.id) ? "..." : "Confirm"}
                                                </button>
                                              ) : (
                                                <button
                                                  onClick={e => {
                                                    e.stopPropagation();
                                                    setLinkModalState({
                                                      receiptId: receipt.receiptId,
                                                      receiptLineId: line.id,
                                                      itemSku: line.sku || "Unknown",
                                                      qty: line.qtyReceived,
                                                    });
                                                  }}
                                                  className="px-3 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                                                >
                                                  Link
                                                </button>
                                              )
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : detail ? (
                                <div className="px-8 py-5 text-sm text-gray-400">No line data.</div>
                              ) : (
                                <div className="px-8 py-5 text-sm text-gray-400">Could not load lines.</div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>

              {/* Empty state */}
              {filteredReceipts.length === 0 && (
                <div className="p-12 text-center text-gray-400 text-sm">
                  {activeTab === "unmatched"
                    ? "All caught up — no unmatched receipts."
                    : activeTab === "matched"
                    ? "No matched receipts yet."
                    : "No excluded receipts."}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* Manual link modal */}
      {linkModalState && (
        <LinkInvoiceModal
          receiptLineIds={[linkModalState.receiptLineId]}
          receiptSummaries={[
            {
              itemSku: linkModalState.itemSku,
              qty: linkModalState.qty,
              ref: null,
            } as ReceiptLineSummary,
          ]}
          onClose={() => setLinkModalState(null)}
          onSuccess={handleLinkSuccess}
        />
      )}
    </div>
  );
}
