"use client";

import { useEffect, useMemo, useState } from "react";

interface SelectedItem {
  itemId: string;
  sku: string;
}

interface CandidateLine {
  invoiceLineId: string;
  itemId: string | null;
  sku: string | null;
  ansItemNumber: string;
  description: string;
  qty: number;
  unitPrice: number;
  total: number;
  isOverlap: boolean;
}

interface Candidate {
  invoiceId: string;
  invoiceNumber: string;
  supplier: string;
  invoiceDate: string;
  total: number;
  poReference: string;
  shipTo: string;
  invoiceType: string;
  matchStatus: string;
  skuOverlap: number;
  poRefMatches: boolean;
  supplierMatches: boolean;
  lines: CandidateLine[];
}

interface CandidatesResponse {
  candidates: Candidate[];
  selectedItems: SelectedItem[];
  selectedRefs: string[];
  message?: string;
}

export interface ReceiptLineSummary {
  itemSku: string;
  qty: number;
  ref: string | null;
}

interface Props {
  receiptLineIds: string[];
  receiptSummaries: ReceiptLineSummary[];
  onClose: () => void;
  onSuccess: (result: {
    invoiceNumber: string;
    linksCreated: number;
    skippedCount: number;
  }) => void;
}

function formatDate(d: string) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function CheckIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 12.75l6 6 9-13.5"
      />
    </svg>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <div className="text-sm text-gray-900">{children}</div>
    </div>
  );
}

export default function LinkInvoiceModal({
  receiptLineIds,
  receiptSummaries,
  onClose,
  onSuccess,
}: Props) {
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
    null
  );
  const [checkedLineIds, setCheckedLineIds] = useState<Set<string>>(new Set());
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Receipt summary rollup: SKU → total qty, plus distinct refs
  const { skuTotals, totalUnits, refSummary } = useMemo(() => {
    const totals: Record<string, number> = {};
    let units = 0;
    const refs: string[] = [];
    const seenRefs = new Set<string>();
    for (const r of receiptSummaries) {
      totals[r.itemSku] = (totals[r.itemSku] || 0) + r.qty;
      units += r.qty;
      if (r.ref && !seenRefs.has(r.ref)) {
        seenRefs.add(r.ref);
        refs.push(r.ref);
      }
    }
    return { skuTotals: totals, totalUnits: units, refSummary: refs };
  }, [receiptSummaries]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = `/api/receipt-lines/link-invoice/candidates?receiptLineIds=${encodeURIComponent(
      receiptLineIds.join(",")
    )}`;
    fetch(url)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          setError(d.error || "Failed to load candidates.");
          return;
        }
        setData(d as CandidatesResponse);
        if (d.candidates && d.candidates.length > 0) {
          const first: Candidate = d.candidates[0];
          setSelectedInvoiceId(first.invoiceId);
          setCheckedLineIds(
            new Set(
              first.lines
                .filter((l) => l.isOverlap)
                .map((l) => l.invoiceLineId)
            )
          );
        }
      })
      .catch(() => setError("Failed to load candidates."))
      .finally(() => setLoading(false));
  }, [receiptLineIds]);

  const selectedCandidate = useMemo(
    () =>
      data?.candidates.find((c) => c.invoiceId === selectedInvoiceId) ?? null,
    [data, selectedInvoiceId]
  );

  const handleSelectInvoice = (c: Candidate) => {
    setSelectedInvoiceId(c.invoiceId);
    setCheckedLineIds(
      new Set(c.lines.filter((l) => l.isOverlap).map((l) => l.invoiceLineId))
    );
  };

  const toggleLine = (invoiceLineId: string) => {
    setCheckedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceLineId)) next.delete(invoiceLineId);
      else next.add(invoiceLineId);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!selectedInvoiceId || checkedLineIds.size === 0) return;
    setLinking(true);
    setError(null);
    try {
      const res = await fetch("/api/receipt-lines/link-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptLineIds,
          invoiceLineIds: Array.from(checkedLineIds),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error || "Failed to link invoice.");
        return;
      }
      onSuccess({
        invoiceNumber:
          result.invoiceNumber || selectedCandidate?.invoiceNumber || "",
        linksCreated: result.linksCreated || 0,
        skippedCount: (result.skipped || []).length,
      });
    } catch {
      setError("Failed to link invoice.");
    } finally {
      setLinking(false);
    }
  };

  const skuEntries = Object.entries(skuTotals);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-start justify-between px-8 pt-6 pb-5 border-b border-gray-100">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Link to Invoice</h2>
            <p className="text-sm text-gray-500 mt-1">
              {receiptLineIds.length} receipt line
              {receiptLineIds.length === 1 ? "" : "s"} ·{" "}
              {totalUnits.toLocaleString()} units
              {refSummary.length > 0 && (
                <>
                  {" · "}
                  <span className="font-medium text-gray-700">
                    {refSummary.join(", ")}
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* ── Selected receipt SKUs ──────────────────────── */}
        <div className="px-8 py-5 border-b border-gray-100 bg-gray-50/60">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Selected Receipts
          </p>
          <div className="space-y-1.5">
            {skuEntries.map(([sku, qty]) => (
              <div
                key={sku}
                className="flex items-center justify-between text-sm"
              >
                <span className="font-medium text-gray-900">{sku}</span>
                <span className="text-gray-600 tabular-nums">
                  {qty.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Candidate invoices ─────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {loading ? (
            <p className="text-sm text-gray-500">Loading candidates...</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : !data || data.candidates.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-base font-medium text-gray-700">
                No matching invoices found.
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {data?.message ||
                  "No unmatched invoices contain these SKUs."}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
                {data.candidates.length} Candidate Invoice
                {data.candidates.length === 1 ? "" : "s"}
              </p>
              <div className="space-y-3">
                {data.candidates.map((c) => {
                  const isSelected = selectedInvoiceId === c.invoiceId;
                  return (
                    <div
                      key={c.invoiceId}
                      className={`bg-white rounded-lg border transition-all ${
                        isSelected
                          ? "border-gray-900 shadow-sm"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {/* Card body — clickable selector */}
                      <button
                        onClick={() => handleSelectInvoice(c)}
                        className="w-full text-left p-5"
                      >
                        {/* Top row: radio + invoice # / total */}
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <input
                              type="radio"
                              checked={isSelected}
                              onChange={() => handleSelectInvoice(c)}
                              className="text-gray-900 focus:ring-gray-400"
                            />
                            <h3 className="text-base font-semibold text-gray-900">
                              {c.invoiceNumber}
                            </h3>
                          </div>
                          <div className="text-right">
                            <p className="text-base font-semibold text-gray-900 tabular-nums">
                              {formatCurrency(c.total)}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {c.skuOverlap} of {c.lines.length} line
                              {c.lines.length === 1 ? "" : "s"} match
                            </p>
                          </div>
                        </div>

                        {/* Meta grid — labeled fields */}
                        <div className="grid grid-cols-2 gap-x-6 gap-y-3 pl-7">
                          <Field label="Vendor">{c.supplier || "—"}</Field>
                          <Field label="Invoice Date">
                            {formatDate(c.invoiceDate)}
                          </Field>
                          <Field label="PO Ref">
                            <div className="flex items-center gap-2">
                              <span>{c.poReference || "—"}</span>
                              {c.poRefMatches && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-sage-700 bg-sage-50 border border-sage-200 px-1.5 py-0.5 rounded">
                                  <CheckIcon className="w-3 h-3" />
                                  Matches
                                </span>
                              )}
                            </div>
                          </Field>
                          <Field label="Ship To">{c.shipTo || "—"}</Field>
                        </div>
                      </button>

                      {/* Line items — only when selected */}
                      {isSelected && (
                        <div className="border-t border-gray-100">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50">
                                <th className="w-10 px-5 py-2.5"></th>
                                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                  SKU
                                </th>
                                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                  Description
                                </th>
                                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                  Qty
                                </th>
                                <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                  Unit
                                </th>
                                <th className="text-right px-5 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                  Amount
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.lines.map((line) => {
                                const isChecked = checkedLineIds.has(
                                  line.invoiceLineId
                                );
                                return (
                                  <tr
                                    key={line.invoiceLineId}
                                    className="border-t border-gray-100"
                                  >
                                    <td className="w-10 px-5 py-3 align-top">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() =>
                                          toggleLine(line.invoiceLineId)
                                        }
                                        className="rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                                      />
                                    </td>
                                    <td className="px-3 py-3 align-top">
                                      <div className="text-sm font-medium text-gray-900">
                                        {line.sku ||
                                          line.ansItemNumber ||
                                          "Unknown"}
                                      </div>
                                      {line.ansItemNumber && line.sku && (
                                        <div className="text-xs text-gray-400 mt-0.5">
                                          {line.ansItemNumber}
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-3 py-3 align-top text-sm text-gray-600">
                                      {line.description || "—"}
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums text-sm text-gray-900 align-top">
                                      {line.qty.toLocaleString()}
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums text-sm text-gray-500 align-top">
                                      {formatCurrency(line.unitPrice)}
                                    </td>
                                    <td className="px-5 py-3 text-right tabular-nums text-sm font-medium text-gray-900 align-top">
                                      {formatCurrency(line.total)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────── */}
        <div className="flex items-center justify-between px-8 py-4 border-t border-gray-100 bg-gray-50/60">
          <div className="text-xs text-gray-500">
            {selectedCandidate && checkedLineIds.size > 0 && (
              <>
                {checkedLineIds.size} line
                {checkedLineIds.size === 1 ? "" : "s"} selected on{" "}
                <span className="font-medium text-gray-700">
                  {selectedCandidate.invoiceNumber}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={
                !selectedInvoiceId || checkedLineIds.size === 0 || linking
              }
              className="px-5 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {linking
                ? "Linking..."
                : `Link ${checkedLineIds.size || ""} Line${
                    checkedLineIds.size === 1 ? "" : "s"
                  }`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
