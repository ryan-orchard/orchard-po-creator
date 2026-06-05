"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import LinkInvoiceModal, { ReceiptLineSummary } from "@/components/LinkInvoiceModal";

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
    shipTo: string | null;
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
  confidence: "high" | "medium" | "low" | null;
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
  const [findDifferentInvoice, setFindDifferentInvoice] = useState(false);
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

  const openPanel = useCallback(async (group: LineGroup, invoiceId: string, invoiceLineId: string, confidence?: "high" | "medium" | "low") => {
    setPanel({ group, invoiceId, invoiceLineId, confidence: confidence ?? null });
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

                    const inv = line.linkedInvoice ?? line.suggestedInvoice;
                    const rowConfidence = line.suggestedInvoice?.confidence;

                    return (
                      <tr
                        key={line.groupKey}
                        onClick={() => inv && openPanel(line, inv.invoiceId, inv.invoiceLineId, rowConfidence)}
                        className={`transition-colors ${inv ? "cursor-pointer" : ""} ${isPanelOpen ? "bg-blue-50" : "hover:bg-gray-50"}`}
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
                            <span className="flex items-center gap-2">
                              <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              <span className="text-gray-700 font-medium">{line.linkedInvoice.invoiceNumber}</span>
                              {line.linkedInvoice.unitCost > 0 && (
                                <span className="text-xs text-gray-400">${line.linkedInvoice.unitCost.toFixed(2)}/unit</span>
                              )}
                            </span>
                          ) : line.suggestedInvoice ? (
                            <span className="flex items-center gap-2">
                              <span className="font-medium text-gray-900">{line.suggestedInvoice.invoiceNumber}</span>
                              {line.suggestedInvoice.unitCost > 0 && (
                                <span className="text-xs text-gray-500">${line.suggestedInvoice.unitCost.toFixed(2)}/unit</span>
                              )}
                              <ConfidenceBadge confidence={line.suggestedInvoice.confidence} />
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">No match found</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {line.invoiceStatus !== "matched" && line.suggestedInvoice && (
                            <button
                              onClick={e => { e.stopPropagation(); handleConfirm(line, line.suggestedInvoice!.invoiceLineId); }}
                              disabled={isConfirming}
                              className="px-3 py-1 text-xs font-medium text-white bg-gray-900 rounded hover:bg-gray-700 disabled:opacity-50 transition-colors"
                            >
                              {isConfirming ? "..." : "Confirm"}
                            </button>
                          )}
                          {line.invoiceStatus !== "matched" && !line.suggestedInvoice && (
                            <button
                              onClick={e => { e.stopPropagation(); openPanel(line, "", ""); }}
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

      {/* Find different invoice modal */}
      {findDifferentInvoice && panel && (
        <LinkInvoiceModal
          receiptLineIds={panel.group.lineIds}
          receiptSummaries={[{
            itemSku: panel.group.sku || "Unknown",
            qty: panel.group.totalQty,
            ref: panel.group.orderRef,
          } as ReceiptLineSummary]}
          onClose={() => setFindDifferentInvoice(false)}
          onSuccess={async (result) => {
            setFindDifferentInvoice(false);
            closePanel();
            showToast(`Linked to ${result.invoiceNumber}`);
            await fetchLines();
          }}
        />
      )}

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
          <div className="fixed inset-0 bg-black/20 z-30" onClick={closePanel} />

          {/* Panel */}
          <div className="fixed right-0 top-0 bottom-0 w-[520px] bg-slate-50 shadow-2xl z-40 flex flex-col overflow-hidden border-l border-gray-200">

            {/* Close */}
            <button
              onClick={closePanel}
              className="absolute top-4 right-4 z-10 text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-white/70 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {panelLoading ? (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div>
            ) : panelCtx ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-3">

                {/* ── Invoice card ── */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 pt-5 pb-4 border-b border-gray-100">
                    <div className="text-sm font-semibold text-gray-900 mb-3">Invoice</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <span className="text-gray-400">Invoice #</span>
                      <span className="text-gray-900 font-medium tabular-nums">{panelCtx.invoice.invoiceNumber}</span>
                      {panelCtx.invoice.invoiceDate && (
                        <>
                          <span className="text-gray-400">Invoice Date</span>
                          <span className="text-gray-700">{formatDateLong(panelCtx.invoice.invoiceDate)}</span>
                        </>
                      )}
                      <span className="text-gray-400">Supplier</span>
                      <span className="text-gray-700">{panelCtx.invoice.supplier ?? "—"}</span>
                      {panelCtx.invoice.poReference && (
                        <>
                          <span className="text-gray-400">PO Reference</span>
                          <span className="text-gray-700">{panelCtx.invoice.poReference}</span>
                        </>
                      )}
                      {panelCtx.invoice.shipTo && (
                        <>
                          <span className="text-gray-400">Ship To</span>
                          <span className="text-gray-700 leading-relaxed">{panelCtx.invoice.shipTo}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="px-5 py-4">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Line Items ({panelCtx.invoice.lines.length})
                    </div>
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Description</th>
                          <th className="text-left pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wide pl-2">SKU</th>
                          <th className="text-right pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wide w-12">Qty</th>
                          <th className="text-right pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wide w-14">Cost</th>
                          <th className="text-right pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {panelCtx.invoice.lines.map(l => {
                          const isTarget = l.isTarget;
                          return (
                            <tr key={l.id} className={`border-b border-gray-50 ${isTarget ? "bg-amber-50" : ""}`}>
                              <td className={`py-2 pr-2 text-xs truncate max-w-[100px] ${isTarget ? "font-medium text-gray-900" : "text-gray-500"}`}>
                                {l.description || "—"}
                              </td>
                              <td className={`py-2 pl-2 text-xs truncate max-w-[80px] ${isTarget ? "font-medium text-gray-900" : "text-gray-500"}`}>
                                {l.sku || l.ansItemNumber || "—"}
                              </td>
                              <td className={`py-2 text-right text-xs tabular-nums ${isTarget ? "font-medium text-gray-900" : "text-gray-500"}`}>
                                {l.qty.toLocaleString()}
                              </td>
                              <td className={`py-2 text-right text-xs tabular-nums ${isTarget ? "font-medium text-gray-900" : "text-gray-500"}`}>
                                {l.unitPrice > 0 ? `$${l.unitPrice.toFixed(2)}` : "—"}
                              </td>
                              <td className={`py-2 text-right text-xs tabular-nums ${isTarget ? "font-medium text-gray-900" : "text-gray-500"}`}>
                                {l.unitPrice > 0
                                  ? `$${(l.qty * l.unitPrice).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="mt-2 space-y-1 text-xs">
                      {panelCtx.invoice.freight > 0 && (
                        <div className="flex justify-between text-gray-400">
                          <span>Freight</span>
                          <span className="tabular-nums">${panelCtx.invoice.freight.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      {panelCtx.invoice.tax > 0 && (
                        <div className="flex justify-between text-gray-400">
                          <span>Tax</span>
                          <span className="tabular-nums">${panelCtx.invoice.tax.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      {panelCtx.invoice.totalAmount != null && (
                        <div className="flex justify-between font-semibold text-gray-900 pt-1.5 border-t border-gray-100 text-sm">
                          <span>Total</span>
                          <span className="tabular-nums">${panelCtx.invoice.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Receipt card ── */}
                <div className="bg-amber-50 rounded-xl border border-amber-100 px-5 py-4">
                  <div className="text-sm font-semibold text-gray-900 mb-3">Receipt</div>
                  <div className="text-base font-semibold text-gray-900 leading-tight">
                    {panel.group.warehouse || panel.group.source.toUpperCase()}
                    {panel.group.orderRef && <span className="text-gray-500 font-normal"> · {panel.group.orderRef}</span>}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{formatDateLong(panel.group.date)}</div>
                  <div className="mt-3 pt-3 border-t border-amber-100 flex items-baseline justify-between">
                    <span className="text-sm text-gray-700">{panel.group.sku || "Unknown"}</span>
                    <span className="text-lg font-bold text-gray-900 tabular-nums">{panel.group.totalQty.toLocaleString()}</span>
                  </div>
                </div>

                {/* ── Comparison card ── */}
                <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
                  <div className="text-sm font-semibold text-gray-900 mb-3">Comparison</div>

                  {/* Match confidence */}
                  {panel.confidence && (
                    <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
                      <span className="text-xs text-gray-500">AI match confidence</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        panel.confidence === "high"
                          ? "bg-green-100 text-green-700"
                          : panel.confidence === "medium"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-orange-100 text-orange-600"
                      }`}>
                        {panel.confidence}
                      </span>
                    </div>
                  )}

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Invoice line qty</span>
                      <span className="tabular-nums text-gray-800 font-medium">{panelCtx.targetLine.qty.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Receipt qty</span>
                      <span className="tabular-nums text-gray-800 font-medium">{panel.group.totalQty.toLocaleString()}</span>
                    </div>
                    {panelCtx.targetLine.alreadyMatchedQty > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Already matched</span>
                        <span className="tabular-nums text-gray-600">{panelCtx.targetLine.alreadyMatchedQty.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-medium pt-2 border-t border-gray-100">
                      <span className="text-gray-500">Remaining after</span>
                      {(() => {
                        const r = panelCtx.targetLine.remainingQty - panel.group.totalQty;
                        const color = r === 0 ? "text-green-600" : r < 0 ? "text-red-500" : "text-amber-500";
                        const suffix = r === 0 ? " ✓" : r < 0 ? " over" : "";
                        return (
                          <span className={`tabular-nums ${color}`}>
                            {Math.abs(r).toLocaleString()}{suffix}
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  {panelCtx.targetLine.matchedReceiptLines.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
                      <div className="text-xs text-gray-400 mb-1.5">Other receipts on this line</div>
                      {panelCtx.targetLine.matchedReceiptLines.map(r => (
                        <div key={r.receiptLineId} className="flex justify-between text-xs text-gray-500">
                          <span>{r.orderRef || r.source.toUpperCase()} · {formatDate(r.date)}</span>
                          <span className="tabular-nums">{r.qty.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {panel.group.invoiceStatus !== "matched" && (
                    <button
                      onClick={() => setFindDifferentInvoice(true)}
                      className="mt-3 pt-3 border-t border-gray-100 w-full text-xs text-gray-400 hover:text-gray-600 text-left transition-colors"
                    >
                      Find a different invoice →
                    </button>
                  )}
                </div>

              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                Could not load invoice.
              </div>
            )}

            {/* Confirm */}
            {panel.invoiceLineId && panel.group.invoiceStatus !== "matched" && (
              <div className="p-5 pt-0 flex-shrink-0">
                <button
                  onClick={() => handleConfirm(panel.group, panel.invoiceLineId)}
                  disabled={confirmingKeys.has(panel.group.groupKey)}
                  className="w-full py-3 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {confirmingKeys.has(panel.group.groupKey) ? "Confirming…" : "Confirm Match"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
