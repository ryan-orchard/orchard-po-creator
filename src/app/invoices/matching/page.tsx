"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  poReference: string;
  purchaseOrder: string | null;
  invoiceAmount: number;
  status: string;
  lineCount: number;
}

interface InvoiceLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  uom: string | null;
  ansItemNumber: string | null;
  qtyBilled: number;
  unitCost: number;
  amount: number;
  batchNumber: string | null;
  matched: boolean;
}

interface ComparisonLine {
  poLineItemId: string;
  skuId: string | null;
  skuName: string;
  uom: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyBilled: number;
  variance: number;
  unitCost: number;
  amount: number;
  invoiceLineIds: string[];
}

interface ComparisonData {
  poId: string;
  poNumber: string;
  poStatus: string;
  matchedLines: ComparisonLine[];
  otherLines: ComparisonLine[];
}

interface RankedPO {
  id: string;
  poNumber: string;
  status: string;
  skuCount: number;
  overlapCount: number;
  overlapSkuNames: string[];
  score: number;
  skuNames: string[];
}

interface SuggestPOResponse {
  invoice: {
    id: string;
    invoiceNumber: string;
    poReference: string;
    invoiceDate: string;
    totalAmount: number;
  };
  invoiceLines: InvoiceLine[];
  suggestedPO: { id: string; poNumber: string } | null;
  comparison: ComparisonData | null;
  rankedPOs: RankedPO[];
  otherPOs: RankedPO[];
}

export default function InvoiceMatchingPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <p className="text-gray-500">Loading...</p>
        </div>
      }
    >
      <InvoiceMatchingPage />
    </Suspense>
  );
}

function InvoiceMatchingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedInvoiceId = searchParams.get("invoice");

  // State
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
    preselectedInvoiceId
  );
  const [matchData, setMatchData] = useState<SuggestPOResponse | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showAllPOs, setShowAllPOs] = useState(false);
  const [checkedLines, setCheckedLines] = useState<Set<number>>(new Set());

  // Fetch unmatched invoices
  useEffect(() => {
    fetch("/api/invoices")
      .then((r) => r.json())
      .then((data: InvoiceSummary[]) => {
        const unmatched = data.filter((inv) => !inv.purchaseOrder);
        setInvoices(unmatched);
        setLoading(false);
        if (
          preselectedInvoiceId &&
          unmatched.some((inv) => inv.id === preselectedInvoiceId)
        ) {
          loadMatchData(preselectedInvoiceId);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMatchData = useCallback(
    async (invoiceId: string, poId?: string) => {
      setMatchLoading(true);
      setMatchData(null);
      setShowAllPOs(false);
      try {
        const url = poId
          ? `/api/invoices/${invoiceId}/suggest-po?poId=${poId}`
          : `/api/invoices/${invoiceId}/suggest-po`;
        const res = await fetch(url);
        const data: SuggestPOResponse = await res.json();
        setMatchData(data);
        // Check all matched lines by default
        if (data.comparison) {
          setCheckedLines(
            new Set(data.comparison.matchedLines.map((_, i) => i))
          );
        } else {
          setCheckedLines(new Set());
        }
        if (data.suggestedPO && !poId) {
          setSelectedPOId(data.suggestedPO.id);
        } else if (poId) {
          setSelectedPOId(poId);
        }
      } catch (err) {
        console.error("Failed to load match data:", err);
      } finally {
        setMatchLoading(false);
      }
    },
    []
  );

  const handleSelectInvoice = (invoiceId: string) => {
    setSelectedInvoiceId(invoiceId);
    setSelectedPOId(null);
    loadMatchData(invoiceId);
  };

  const handleSelectPO = (poId: string) => {
    if (!selectedInvoiceId) return;
    setSelectedPOId(poId);
    loadMatchData(selectedInvoiceId, poId);
  };

  const handleConfirmMatch = async () => {
    if (!selectedInvoiceId || !selectedPOId || !matchData?.comparison) return;
    setConfirming(true);

    // Build line-level matches from checked comparison lines only
    const lineMatches: { invoiceLineId: string; poLineItemId: string }[] = [];
    let hasDiscrepancy = false;

    matchData.comparison.matchedLines.forEach((line, idx) => {
      if (
        checkedLines.has(idx) &&
        line.poLineItemId &&
        line.invoiceLineIds.length > 0
      ) {
        for (const invoiceLineId of line.invoiceLineIds) {
          lineMatches.push({
            invoiceLineId,
            poLineItemId: line.poLineItemId,
          });
        }
        if (line.variance !== 0) {
          hasDiscrepancy = true;
        }
      }
    });

    // Lines not on PO are also a discrepancy
    matchData.comparison.matchedLines.forEach((line, idx) => {
      if (checkedLines.has(idx) && !line.poLineItemId) {
        hasDiscrepancy = true;
      }
    });

    try {
      const res = await fetch(`/api/invoices/${selectedInvoiceId}/match`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseOrderId: selectedPOId,
          lineMatches,
          hasDiscrepancy,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
        return;
      }
      const result = await res.json();
      setInvoices((prev) =>
        prev.filter((inv) => inv.id !== selectedInvoiceId)
      );
      setSelectedInvoiceId(null);
      setMatchData(null);
      setSelectedPOId(null);
      alert(
        `Invoice matched to ${result.poNumber}! Status: ${result.status}.`
      );
    } catch {
      alert("Failed to confirm match. Please try again.");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Invoice Matching
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Link invoices to Purchase Orders (3-way match)
            </p>
          </div>
          <button
            onClick={() => router.push("/invoices")}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Back to Invoices
          </button>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : invoices.length === 0 && !selectedInvoiceId ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <div className="text-green-500 mb-3">
              <svg
                className="w-12 h-12 mx-auto"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <p className="text-gray-700 font-medium mb-2">
              All invoices are matched!
            </p>
            <p className="text-sm text-gray-400">
              Import more invoices or check the Invoices list.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-6">
            {/* Left: Unmatched invoices list */}
            <div className="col-span-4">
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <h2 className="text-sm font-semibold text-gray-700">
                    Unmatched Invoices ({invoices.length})
                  </h2>
                </div>
                <div className="divide-y divide-gray-100 max-h-[calc(100vh-200px)] overflow-y-auto">
                  {invoices.map((inv) => {
                    const isSelected = selectedInvoiceId === inv.id;
                    return (
                      <button
                        key={inv.id}
                        onClick={() => handleSelectInvoice(inv.id)}
                        className={`w-full text-left px-4 py-3 transition-colors ${
                          isSelected
                            ? "bg-blue-50 border-l-2 border-l-blue-500"
                            : "hover:bg-gray-50 border-l-2 border-l-transparent"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-gray-900">
                            #{inv.invoiceNumber}
                          </span>
                          <span className="text-xs text-gray-400">
                            {inv.invoiceDate
                              ? new Date(
                                  inv.invoiceDate + "T00:00:00"
                                ).toLocaleDateString("en-US")
                              : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span className="font-mono">
                            {inv.poReference || "No PO ref"}
                          </span>
                          <span className="font-mono font-medium text-gray-700">
                            {inv.invoiceAmount
                              ? inv.invoiceAmount.toLocaleString("en-US", {
                                  style: "currency",
                                  currency: "USD",
                                })
                              : "—"}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {inv.lineCount} line{inv.lineCount !== 1 ? "s" : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: Matching workspace */}
            <div className="col-span-8">
              {!selectedInvoiceId ? (
                <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                  <p className="text-gray-400">
                    Select an invoice from the left to begin matching.
                  </p>
                </div>
              ) : matchLoading ? (
                <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                  <p className="text-gray-500">Loading match data...</p>
                </div>
              ) : matchData ? (
                <div className="space-y-4">
                  {/* Invoice summary strip */}
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-gray-900">
                        Invoice #{matchData.invoice.invoiceNumber}
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span>
                          PO Ref:{" "}
                          <span className="font-mono font-medium text-gray-700">
                            {matchData.invoice.poReference || "—"}
                          </span>
                        </span>
                        <span>
                          {matchData.invoice.invoiceDate
                            ? new Date(
                                matchData.invoice.invoiceDate + "T00:00:00"
                              ).toLocaleDateString("en-US")
                            : "—"}
                        </span>
                        <span className="font-mono font-medium text-gray-900">
                          {matchData.invoice.totalAmount.toLocaleString(
                            "en-US",
                            { style: "currency", currency: "USD" }
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {matchData.invoiceLines.map((line) => (
                        <div
                          key={line.id}
                          className={`rounded-md px-3 py-2 border ${
                            line.matched
                              ? "bg-green-50 border-green-200"
                              : line.skuId
                              ? "bg-gray-50 border-gray-200"
                              : "bg-amber-50 border-amber-200"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`font-mono text-sm font-medium ${
                                line.matched
                                  ? "text-green-700"
                                  : "text-gray-900"
                              }`}
                            >
                              {line.skuName ||
                                line.ansItemNumber ||
                                "Unmapped"}
                            </span>
                            <span className="text-xs text-gray-500">
                              {line.qtyBilled.toLocaleString()}{" "}
                              {line.uom || "units"}
                            </span>
                            {line.matched && (
                              <span className="text-[10px] text-green-600">
                                Matched
                              </span>
                            )}
                            {!line.skuId && !line.matched && (
                              <span className="text-[10px] text-amber-600">
                                Unmapped
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* PO Selection — ranked by SKU overlap */}
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h3 className="font-semibold text-gray-900 mb-3">
                      {matchData.rankedPOs.length > 0
                        ? "Matching Purchase Orders"
                        : "No POs match these SKUs"}
                    </h3>

                    {matchData.rankedPOs.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {matchData.rankedPOs.map((po) => {
                          const isSelected = selectedPOId === po.id;
                          const isSuggested =
                            matchData.suggestedPO?.id === po.id;
                          return (
                            <button
                              key={po.id}
                              onClick={() => handleSelectPO(po.id)}
                              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                                isSelected
                                  ? "border-blue-400 bg-blue-50"
                                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-semibold text-sm text-gray-900">
                                    {po.poNumber}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                      po.status === "Issued"
                                        ? "bg-blue-100 text-blue-700"
                                        : po.status === "Received"
                                        ? "bg-green-100 text-green-700"
                                        : "bg-amber-100 text-amber-700"
                                    }`}
                                  >
                                    {po.status}
                                  </span>
                                  {isSuggested && (
                                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-100 text-green-700">
                                      PO Ref Match
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs text-gray-500">
                                  {po.overlapCount}/{po.skuCount} SKUs match
                                </span>
                              </div>
                              <p className="text-xs text-gray-500">
                                <span className="text-gray-700 font-medium">
                                  {po.overlapSkuNames.join(", ")}
                                </span>
                                {po.skuNames.length > po.overlapCount && (
                                  <span className="text-gray-400">
                                    {" + "}
                                    {po.skuNames
                                      .filter(
                                        (name) =>
                                          !po.overlapSkuNames.includes(name)
                                      )
                                      .join(", ")}
                                  </span>
                                )}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Show all POs toggle */}
                    {matchData.otherPOs.length > 0 && (
                      <div>
                        <button
                          onClick={() => setShowAllPOs(!showAllPOs)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          {showAllPOs
                            ? "Hide other POs"
                            : `Show ${matchData.otherPOs.length} other PO(s) without matching SKUs`}
                        </button>
                        {showAllPOs && (
                          <div className="mt-2 space-y-1">
                            {matchData.otherPOs.map((po) => (
                              <button
                                key={po.id}
                                onClick={() => handleSelectPO(po.id)}
                                className={`w-full text-left rounded border px-3 py-2 text-xs transition-colors ${
                                  selectedPOId === po.id
                                    ? "border-blue-400 bg-blue-50"
                                    : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                                }`}
                              >
                                <span className="font-mono font-medium text-gray-700">
                                  {po.poNumber}
                                </span>
                                <span className="text-gray-400 ml-2">
                                  {po.status}
                                </span>
                                <span className="text-gray-400 ml-2">
                                  {po.skuNames.join(", ")}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 3-Way Comparison table */}
                  {matchData.comparison && (
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-gray-900">
                          3-Way Comparison: {matchData.comparison.poNumber}
                        </h3>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            matchData.comparison.poStatus === "Issued"
                              ? "bg-blue-100 text-blue-800"
                              : matchData.comparison.poStatus === "Received"
                              ? "bg-green-100 text-green-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {matchData.comparison.poStatus}
                        </span>
                      </div>

                      {/* Matched lines */}
                      {matchData.comparison.matchedLines.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                            Matching Lines (
                            {matchData.comparison.matchedLines.length})
                          </p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-gray-50 border-b border-gray-200">
                                  <th className="w-8 px-3 py-2">
                                    <input
                                      type="checkbox"
                                      checked={
                                        checkedLines.size ===
                                        matchData.comparison.matchedLines.length
                                      }
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setCheckedLines(
                                            new Set(
                                              matchData.comparison!.matchedLines.map(
                                                (_, i) => i
                                              )
                                            )
                                          );
                                        } else {
                                          setCheckedLines(new Set());
                                        }
                                      }}
                                      className="rounded border-gray-300"
                                    />
                                  </th>
                                  <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                                    SKU
                                  </th>
                                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                                    PO Qty
                                  </th>
                                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                                    Received
                                  </th>
                                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                                    Billed
                                  </th>
                                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                                    Variance
                                  </th>
                                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                                    Unit Cost
                                  </th>
                                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                                    Amount
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {matchData.comparison.matchedLines.map(
                                  (line, idx) => {
                                    const isChecked = checkedLines.has(idx);
                                    return (
                                      <tr
                                        key={idx}
                                        className={`border-b border-gray-100 ${!isChecked ? "opacity-40" : ""}`}
                                      >
                                        <td className="w-8 px-3 py-2">
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => {
                                              setCheckedLines((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(idx)) {
                                                  next.delete(idx);
                                                } else {
                                                  next.add(idx);
                                                }
                                                return next;
                                              });
                                            }}
                                            className="rounded border-gray-300"
                                          />
                                        </td>
                                        <td className="px-3 py-2">
                                          <span className="font-mono text-xs text-gray-900">
                                            {line.skuName}
                                          </span>
                                          {!line.poLineItemId && (
                                            <span className="ml-1.5 text-[10px] bg-yellow-100 text-yellow-700 px-1 py-0.5 rounded">
                                              Not on PO
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-gray-600">
                                          {line.qtyOrdered > 0
                                            ? line.qtyOrdered.toLocaleString()
                                            : "—"}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-gray-600">
                                          {line.qtyReceived > 0
                                            ? line.qtyReceived.toLocaleString()
                                            : "—"}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-gray-900 font-medium">
                                          {line.qtyBilled > 0
                                            ? line.qtyBilled.toLocaleString()
                                            : "—"}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          <span
                                            className={`font-mono text-xs font-medium ${
                                              line.variance === 0
                                                ? "text-green-600"
                                                : line.variance > 0
                                                ? "text-amber-600"
                                                : "text-amber-600"
                                            }`}
                                          >
                                            {line.variance > 0 ? "+" : ""}
                                            {line.variance.toLocaleString()}
                                          </span>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-xs text-gray-600">
                                          {line.unitCost > 0
                                            ? line.unitCost.toLocaleString(
                                                "en-US",
                                                {
                                                  style: "currency",
                                                  currency: "USD",
                                                }
                                              )
                                            : "—"}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-xs text-gray-900 font-medium">
                                          {line.amount > 0
                                            ? line.amount.toLocaleString(
                                                "en-US",
                                                {
                                                  style: "currency",
                                                  currency: "USD",
                                                }
                                              )
                                            : "—"}
                                        </td>
                                      </tr>
                                    );
                                  }
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Other PO lines — not on this invoice */}
                      {matchData.comparison.otherLines.length > 0 && (
                        <div className="border-t border-gray-100 pt-3">
                          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
                            Other PO Lines (
                            {matchData.comparison.otherLines.length}) — not on
                            this invoice
                          </p>
                          <div className="space-y-1">
                            {matchData.comparison.otherLines.map(
                              (line, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between px-3 py-1.5 text-xs text-gray-400"
                                >
                                  <span className="font-mono">
                                    {line.skuName}
                                  </span>
                                  <div className="flex gap-4">
                                    <span className="font-mono">
                                      {line.qtyOrdered.toLocaleString()} ordered
                                    </span>
                                    {line.qtyReceived > 0 && (
                                      <span className="font-mono">
                                        {line.qtyReceived.toLocaleString()}{" "}
                                        received
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}

                      <p className="text-[10px] text-gray-400 mt-3">
                        Variance = Billed - Received. Green = exact match, amber
                        = discrepancy. Only matching lines will be linked.
                      </p>
                    </div>
                  )}

                  {/* Confirm button */}
                  {selectedPOId && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">
                        {checkedLines.size} of{" "}
                        {matchData?.comparison?.matchedLines.length || 0} lines
                        selected
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            setSelectedInvoiceId(null);
                            setMatchData(null);
                            setSelectedPOId(null);
                          }}
                          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleConfirmMatch}
                          disabled={confirming || checkedLines.size === 0}
                          className="bg-gray-900 text-white px-6 py-2 text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
                        >
                          {confirming
                            ? "Matching..."
                            : `Match ${checkedLines.size} Line${checkedLines.size !== 1 ? "s" : ""} to ${matchData?.comparison?.poNumber || "PO"}`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
