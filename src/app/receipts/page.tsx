"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = "unmatched" | "matched" | "excluded";

interface SuggestedInvoice {
  invoiceId: string;
  invoiceLineId: string;
  invoiceNumber: string;
  unitCost: number;
  overheadPerUnit: number;
  landedUnitCost: number;
  confidence: "high" | "medium" | "low";
}

interface LinkedInvoice {
  invoiceId: string;
  invoiceLineId: string;
  invoiceNumber: string;
  unitCost: number;
  overheadPerUnit: number;
  landedUnitCost: number;
}

interface LineGroup {
  groupKey: string;
  lineIds: string[];
  sku: string | null;
  itemId: string | null;
  threePlSku: string | null;
  date: string | null;
  warehouse: string | null;
  source: string;
  orderRef: string | null;
  totalQty: number;
  invoiceStatus: "unmatched" | "matched" | "excluded";
  linkedInvoice: LinkedInvoice | null;
  suggestedInvoice: SuggestedInvoice | null;
}

interface InvoiceLine {
  id: string;
  sku: string | null;
  description: string | null;
  ansItemNumber: string | null;
  qty: number;
  unitPrice: number;
  isTarget: boolean;
}

interface InvoiceContext {
  invoice: {
    id: string;
    invoiceNumber: string;
    supplier: string | null;
    invoiceDate: string | null;
    poReference: string | null;
    freight: number;
    tax: number;
    totalAmount: number | null;
    lines: InvoiceLine[];
  };
  targetLine: {
    id: string;
    sku: string | null;
    qty: number;
    unitPrice: number;
    overheadPerUnit: number;
    landedUnitCost: number;
    alreadyMatchedQty: number;
    remainingQty: number;
    matchedReceiptLines: Array<{
      receiptLineId: string;
      qty: number;
      date: string | null;
      source: string;
      orderRef: string | null;
    }>;
  };
}

interface PanelState {
  group: LineGroup;
  invoiceId: string;
  invoiceLineId: string;
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

function formatDateLong(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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
  const [lines, setLines] = useState<LineGroup[]>([]);
  const [counts, setCounts] = useState({ unmatched: 0, matched: 0, excluded: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("unmatched");

  // Panel state
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [panelCtx, setPanelCtx] = useState<InvoiceContext | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);

  // Action state
  const [confirmingKeys, setConfirmingKeys] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  // ── Fetch lines ──────────────────────────────────────────────────────────────

  const fetchLines = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/receipt-lines/suggested");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error || `Server error (${res.status})`);
        return;
      }
      const data = await res.json();
      setLines(data.lines ?? []);
      setCounts(data.counts ?? { unmatched: 0, matched: 0, excluded: 0 });
    } catch {
      setError("Failed to connect to server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLines();
  }, [fetchLines]);

  // ── Open invoice panel ───────────────────────────────────────────────────────

  const openPanel = useCallback(async (group: LineGroup, invoiceId: string, invoiceLineId: string) => {
    setPanel({ group, invoiceId, invoiceLineId });
    setPanelCtx(null);
    setPanelLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/line-context?invoiceLineId=${invoiceLineId}`);
      if (!res.ok) return;
      const ctx: InvoiceContext = await res.json();
      setPanelCtx(ctx);
    } finally {
      setPanelLoading(false);
    }
  }, []);

  const closePanel = () => {
    setPanel(null);
    setPanelCtx(null);
  };

  // ── Confirm match ────────────────────────────────────────────────────────────

  const handleConfirm = useCallback(async (group: LineGroup, invoiceLineId: string) => {
    setConfirmingKeys(prev => new Set(prev).add(group.groupKey));
    try {
      const res = await fetch("/api/receipt-lines/link-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptLineIds: group.lineIds,
          invoiceLineIds: [invoiceLineId],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(`Failed: ${(err as { error?: string }).error ?? "Unknown error"}`);
        return;
      }

      const result = await res.json();
      showToast(`Linked to ${result.invoiceNumber}`);
      closePanel();

      // Optimistic update
      setLines(prev => prev.map(l =>
        l.groupKey === group.groupKey
          ? {
              ...l,
              invoiceStatus: "matched" as const,
              suggestedInvoice: null,
              linkedInvoice: {
                invoiceId: group.suggestedInvoice?.invoiceId ?? panel?.invoiceId ?? "",
                invoiceLineId,
                invoiceNumber: result.invoiceNumber,
                unitCost: group.suggestedInvoice?.unitCost ?? 0,
                overheadPerUnit: group.suggestedInvoice?.overheadPerUnit ?? 0,
                landedUnitCost: group.suggestedInvoice?.landedUnitCost ?? 0,
              },
            }
          : l
      ));
      setCounts(prev => ({
        ...prev,
        unmatched: Math.max(0, prev.unmatched - 1),
        matched: prev.matched + 1,
      }));
    } finally {
      setConfirmingKeys(prev => {
        const next = new Set(prev);
        next.delete(group.groupKey);
        return next;
      });
    }
  }, [panel]);

  // ── Toast ────────────────────────────────────────────────────────────────────

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  // ── Filtered lines ───────────────────────────────────────────────────────────

  const filteredLines = useMemo(
    () => lines.filter(l => l.invoiceStatus === activeTab),
    [lines, activeTab],
  );

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "unmatched", label: "unmatched", count: counts.unmatched },
    { key: "matched", label: "matched", count: counts.matched },
    { key: "excluded", label: "excluded", count: counts.excluded },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Receipts</h1>
          <p className="text-sm text-gray-500 mt-1">Match receipt lines to invoices</p>
        </div>

        {loading && <p className="text-gray-500">Loading...</p>}

        {!loading && error && (
          <div className="bg-red-50 rounded-lg border border-red-200 p-12 text-center">
            <p className="text-red-700 mb-4">Failed to load receipts</p>
            <p className="text-sm text-red-500 mb-4">{error}</p>
            <button
              onClick={() => { setLoading(true); fetchLines(); }}
              className="px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-4">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
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
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Item</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">Qty</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Invoice</th>
                    <th className="w-28" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredLines.map(line => {
                    const isConfirming = confirmingKeys.has(line.groupKey);
                    const isPanelOpen = panel?.group.groupKey === line.groupKey;

                    return (
                      <tr
                        key={line.groupKey}
                        className={`transition-colors ${isPanelOpen ? "bg-blue-50" : "hover:bg-gray-50"}`}
                      >
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                          {formatDate(line.date)}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {line.warehouse || line.source.toUpperCase()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{line.sku || "Unknown"}</div>
                          {line.threePlSku && (
                            <div className="text-xs text-gray-400">{line.threePlSku}</div>
                          )}
                          {line.orderRef && (
                            <div className="text-xs text-gray-400">{line.orderRef}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {line.totalQty.toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          {line.invoiceStatus === "matched" && line.linkedInvoice ? (
                            <button
                              onClick={() => openPanel(line, line.linkedInvoice!.invoiceId, line.linkedInvoice!.invoiceLineId)}
                              className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
                            >
                              <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              <span className="text-gray-700 font-medium">{line.linkedInvoice.invoiceNumber}</span>
                              {line.linkedInvoice.unitCost > 0 && (
                                <span className="text-xs text-gray-400">${line.linkedInvoice.unitCost.toFixed(2)}/unit</span>
                              )}
                            </button>
                          ) : line.suggestedInvoice ? (
                            <button
                              onClick={() => openPanel(line, line.suggestedInvoice!.invoiceId, line.suggestedInvoice!.invoiceLineId)}
                              className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
                            >
                              <span className="font-medium text-gray-900">{line.suggestedInvoice.invoiceNumber}</span>
                              {line.suggestedInvoice.unitCost > 0 && (
                                <span className="text-xs text-gray-500">${line.suggestedInvoice.unitCost.toFixed(2)}/unit</span>
                              )}
                              <ConfidenceBadge confidence={line.suggestedInvoice.confidence} />
                            </button>
                          ) : (
                            <span className="text-gray-400 text-xs">No match found</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {line.invoiceStatus !== "matched" && line.suggestedInvoice && (
                            <button
                              onClick={() => handleConfirm(line, line.suggestedInvoice!.invoiceLineId)}
                              disabled={isConfirming}
                              className="px-3 py-1 text-xs font-medium text-white bg-gray-900 rounded hover:bg-gray-700 disabled:opacity-50 transition-colors"
                            >
                              {isConfirming ? "..." : "Confirm"}
                            </button>
                          )}
                          {line.invoiceStatus !== "matched" && !line.suggestedInvoice && (
                            <button
                              onClick={() => openPanel(line, "", "")}
                              className="px-3 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                            >
                              Link
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredLines.length === 0 && (
                <div className="p-12 text-center text-gray-400 text-sm">
                  {activeTab === "unmatched"
                    ? "All caught up — no unmatched receipt lines."
                    : activeTab === "matched"
                    ? "No matched receipt lines yet."
                    : "No excluded receipt lines."}
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

      {/* Invoice slide panel */}
      {panel && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/20 z-30"
            onClick={closePanel}
          />

          {/* Panel */}
          <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-white shadow-2xl z-40 flex flex-col overflow-hidden">
            {/* Panel header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4 flex-shrink-0">
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Invoice</div>
                <div className="text-lg font-bold text-gray-900">
                  {panelCtx?.invoice.invoiceNumber ?? panel.invoiceId}
                </div>
                {panelCtx && (
                  <div className="flex items-center gap-2 mt-1 text-sm text-gray-500 flex-wrap">
                    {panelCtx.invoice.supplier && <span>{panelCtx.invoice.supplier}</span>}
                    {panelCtx.invoice.supplier && panelCtx.invoice.invoiceDate && (
                      <span className="text-gray-300">·</span>
                    )}
                    {panelCtx.invoice.invoiceDate && (
                      <span>{formatDateLong(panelCtx.invoice.invoiceDate)}</span>
                    )}
                    {panelCtx.invoice.poReference && (
                      <>
                        <span className="text-gray-300">·</span>
                        <span>PO: {panelCtx.invoice.poReference}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={closePanel}
                className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors flex-shrink-0 mt-0.5"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {panelLoading ? (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                Loading invoice...
              </div>
            ) : panelCtx ? (
              <div className="flex-1 overflow-y-auto">
                {/* Receipt being matched */}
                <div className="px-6 py-4 bg-blue-50 border-b border-blue-100">
                  <div className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-2">
                    Matching this receipt line
                  </div>
                  <div className="flex items-baseline justify-between">
                    <div>
                      <span className="font-medium text-gray-900">{panel.group.sku || "Unknown"}</span>
                      {panel.group.orderRef && (
                        <span className="text-sm text-gray-500 ml-2">{panel.group.orderRef}</span>
                      )}
                    </div>
                    <div className="text-lg font-bold text-gray-900">
                      {panel.group.totalQty.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {panel.group.warehouse || panel.group.source.toUpperCase()} · {formatDateLong(panel.group.date)}
                  </div>
                </div>

                {/* Invoice lines */}
                <div className="px-6 py-4 border-b border-gray-100">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Invoice lines
                  </div>
                  <div className="space-y-1">
                    {panelCtx.invoice.lines.map(l => (
                      <div
                        key={l.id}
                        className={`flex items-center justify-between py-1.5 px-2 rounded text-sm ${
                          l.isTarget
                            ? "bg-blue-50 border border-blue-200"
                            : "text-gray-500"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className={l.isTarget ? "font-medium text-gray-900" : ""}>
                            {l.sku || l.description || l.ansItemNumber || "—"}
                          </span>
                          {l.isTarget && (
                            <span className="ml-2 text-xs text-blue-600 font-medium">← this line</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 ml-4 flex-shrink-0">
                          <span className={l.isTarget ? "font-medium text-gray-900" : ""}>
                            {l.qty.toLocaleString()}
                          </span>
                          {l.unitPrice > 0 && (
                            <span className="text-gray-400 w-16 text-right">${l.unitPrice.toFixed(2)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {(panelCtx.invoice.freight > 0 || panelCtx.invoice.tax > 0) && (
                    <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5 text-xs text-gray-400">
                      {panelCtx.invoice.freight > 0 && (
                        <div className="flex justify-between">
                          <span>Freight</span>
                          <span>${panelCtx.invoice.freight.toFixed(2)}</span>
                        </div>
                      )}
                      {panelCtx.invoice.tax > 0 && (
                        <div className="flex justify-between">
                          <span>Tax</span>
                          <span>${panelCtx.invoice.tax.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Match summary */}
                <div className="px-6 py-4 border-b border-gray-100">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Match summary
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Invoice line qty</span>
                      <span className="font-medium text-gray-900">
                        {panelCtx.targetLine.qty.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">This receipt</span>
                      <span className={`font-medium ${
                        panel.group.totalQty === panelCtx.targetLine.qty - panelCtx.targetLine.alreadyMatchedQty
                          ? "text-green-600"
                          : "text-gray-900"
                      }`}>
                        {panel.group.totalQty.toLocaleString()}
                        {panel.group.totalQty === panelCtx.targetLine.qty - panelCtx.targetLine.alreadyMatchedQty && (
                          <span className="ml-1.5 text-xs font-normal">exact match</span>
                        )}
                      </span>
                    </div>
                    {panelCtx.targetLine.alreadyMatchedQty > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Already matched</span>
                        <span className="text-gray-700">
                          {panelCtx.targetLine.alreadyMatchedQty.toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1 border-t border-gray-100">
                      <span className="text-gray-500">Remaining after</span>
                      <span className={`font-medium ${
                        panelCtx.targetLine.remainingQty - panel.group.totalQty === 0
                          ? "text-green-600"
                          : "text-gray-900"
                      }`}>
                        {Math.max(0, panelCtx.targetLine.remainingQty - panel.group.totalQty).toLocaleString()}
                      </span>
                    </div>
                    {panelCtx.targetLine.landedUnitCost > 0 && (
                      <div className="flex justify-between text-xs text-gray-400 pt-1">
                        <span>Landed cost</span>
                        <span>${panelCtx.targetLine.landedUnitCost.toFixed(4)}/unit</span>
                      </div>
                    )}
                  </div>

                  {/* Already-matched receipt lines */}
                  {panelCtx.targetLine.matchedReceiptLines.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div className="text-xs text-gray-400 mb-2">Other receipts on this line:</div>
                      <div className="space-y-1">
                        {panelCtx.targetLine.matchedReceiptLines.map(r => (
                          <div key={r.receiptLineId} className="flex justify-between text-xs text-gray-500">
                            <span>{r.orderRef || r.source.toUpperCase()} · {formatDate(r.date)}</span>
                            <span>{r.qty.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                Could not load invoice details.
              </div>
            )}

            {/* Confirm button */}
            {panel.invoiceLineId && panel.group.invoiceStatus !== "matched" && (
              <div className="px-6 py-4 border-t border-gray-200 flex-shrink-0">
                <button
                  onClick={() => handleConfirm(panel.group, panel.invoiceLineId)}
                  disabled={confirmingKeys.has(panel.group.groupKey)}
                  className="w-full py-2.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {confirmingKeys.has(panel.group.groupKey) ? "Confirming..." : "Confirm Match"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
