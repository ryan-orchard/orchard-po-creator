"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface ReceiptSummary {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  purchaseOrder: string | null;
  warehouse: string | null;
  externalReceiptId: string;
  lines: {
    id: string;
    sku: string | null;
    qtyReceived: number;
    threePlSku: string;
  }[];
}

interface ReceiptLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  uom: string | null;
  qtyReceived: number;
  threePlSku: string | null;
  lotNumber: string | null;
  matched: boolean;
}

interface ComparisonLine {
  poLineItemId: string;
  skuId: string | null;
  skuName: string;
  uom: string;
  qtyOrdered: number;
  qtyAlreadyReceived: number;
  qtyThisReceipt: number;
  variance: number;
  receiptLineIds: string[];
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

interface AvailableItem {
  id: string;
  standardSku: string;
}

interface SuggestPOResponse {
  receipt: {
    id: string;
    receiptNumber: string;
    receivedDate: string;
    externalReceiptId: string;
  };
  receiptLines: ReceiptLine[];
  suggestedPO: { id: string; poNumber: string } | null;
  comparison: ComparisonData | null;
  rankedPOs: RankedPO[];
  otherPOs: RankedPO[];
  availableItems: AvailableItem[];
}

export default function ReceiptMatchingPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Loading...</p></div>}>
      <ReceiptMatchingPage />
    </Suspense>
  );
}

function ReceiptMatchingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedReceiptId = searchParams.get("receipt");

  // State
  const [receipts, setReceipts] = useState<ReceiptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(
    preselectedReceiptId
  );
  const [matchData, setMatchData] = useState<SuggestPOResponse | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showAllPOs, setShowAllPOs] = useState(false);
  const [checkedLines, setCheckedLines] = useState<Set<number>>(new Set());
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [savingLineId, setSavingLineId] = useState<string | null>(null);

  // Fetch unmatched receipts
  useEffect(() => {
    fetch("/api/receipts")
      .then((r) => r.json())
      .then((data: ReceiptSummary[]) => {
        const unmatched = data.filter((r) => !r.purchaseOrder);
        setReceipts(unmatched);
        setLoading(false);
        if (preselectedReceiptId && unmatched.some((r) => r.id === preselectedReceiptId)) {
          loadMatchData(preselectedReceiptId);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMatchData = useCallback(async (receiptId: string, poId?: string) => {
    setMatchLoading(true);
    setMatchData(null);
    setShowAllPOs(false);
    try {
      const url = poId
        ? `/api/receipts/${receiptId}/suggest-po?poId=${poId}`
        : `/api/receipts/${receiptId}/suggest-po`;
      const res = await fetch(url);
      const data: SuggestPOResponse = await res.json();
      setMatchData(data);
      // Check all matched lines by default
      if (data.comparison) {
        setCheckedLines(new Set(data.comparison.matchedLines.map((_, i) => i)));
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
  }, []);

  const handleSelectReceipt = (receiptId: string) => {
    setSelectedReceiptId(receiptId);
    setSelectedPOId(null);
    loadMatchData(receiptId);
  };

  const handleSelectPO = (poId: string) => {
    if (!selectedReceiptId) return;
    setSelectedPOId(poId);
    loadMatchData(selectedReceiptId, poId);
  };

  const handleConfirmMatch = async () => {
    if (!selectedReceiptId || !selectedPOId || !matchData?.comparison) return;
    setConfirming(true);

    // Build line-level matches from checked comparison lines only
    const lineMatches: { receiptLineId: string; poLineItemId: string }[] = [];
    matchData.comparison.matchedLines.forEach((line, idx) => {
      if (checkedLines.has(idx) && line.poLineItemId && line.receiptLineIds.length > 0) {
        for (const receiptLineId of line.receiptLineIds) {
          lineMatches.push({ receiptLineId, poLineItemId: line.poLineItemId });
        }
      }
    });

    try {
      const res = await fetch(`/api/receipts/${selectedReceiptId}/match`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseOrderId: selectedPOId, lineMatches }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
        return;
      }
      const result = await res.json();
      setReceipts((prev) => prev.filter((r) => r.id !== selectedReceiptId));
      setSelectedReceiptId(null);
      setMatchData(null);
      setSelectedPOId(null);
      const poStatusMsg = result.poStatus !== "Issued"
        ? ` PO status updated to "${result.poStatus}".`
        : "";
      alert(`Receipt matched successfully!${poStatusMsg}`);
    } catch {
      alert("Failed to confirm match. Please try again.");
    } finally {
      setConfirming(false);
    }
  };

  const handleUpdateLineSku = async (receiptLineId: string, newSkuId: string) => {
    setSavingLineId(receiptLineId);
    try {
      const res = await fetch(`/api/receipt-lines/${receiptLineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuId: newSkuId }),
      });
      if (!res.ok) {
        alert("Failed to update SKU.");
        return;
      }
      setEditingLineId(null);
      // Reload match data to reflect the change
      if (selectedReceiptId) {
        loadMatchData(selectedReceiptId, selectedPOId || undefined);
      }
    } catch {
      alert("Failed to update SKU.");
    } finally {
      setSavingLineId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Receipt Matching</h1>
            <p className="text-sm text-gray-500 mt-1">
              Link receipts to Purchase Orders
            </p>
          </div>
          <button
            onClick={() => router.push("/receipts")}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Back to Receipts
          </button>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : receipts.length === 0 && !selectedReceiptId ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <div className="text-sage-500 mb-3">
              <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-gray-700 font-medium mb-2">All receipts are matched!</p>
            <p className="text-sm text-gray-400">
              Import more receipts from the Data Ingestion page or check the Receipts list.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-6">
            {/* Left: Unmatched receipts list */}
            <div className="col-span-4">
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <h2 className="text-sm font-semibold text-gray-700">
                    Unmatched Receipts ({receipts.length})
                  </h2>
                </div>
                <div className="divide-y divide-gray-100 max-h-[calc(100vh-200px)] overflow-y-auto">
                  {receipts.map((receipt) => {
                    const isSelected = selectedReceiptId === receipt.id;
                    const totalUnits = receipt.lines.reduce((s, l) => s + l.qtyReceived, 0);

                    return (
                      <button
                        key={receipt.id}
                        onClick={() => handleSelectReceipt(receipt.id)}
                        className={`w-full text-left px-4 py-3 transition-colors ${
                          isSelected
                            ? "bg-gold-50 border-l-2 border-l-gold-500"
                            : "hover:bg-gray-50 border-l-2 border-l-transparent"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-gray-900">
                            {receipt.externalReceiptId || "No order #"}
                          </span>
                          <span className="text-xs text-gray-400">
                            {receipt.receivedDate
                              ? new Date(receipt.receivedDate + "T00:00:00").toLocaleDateString("en-US")
                              : "—"}
                          </span>
                        </div>
                        <div className="space-y-0.5 mt-1">
                          {receipt.lines.map((l, i) => (
                            <div key={i} className="flex items-center justify-between text-xs text-gray-600">
                              <span>{l.sku || l.threePlSku || "Unknown"}</span>
                              <span className="text-gray-500">{l.qtyReceived.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-1.5 text-right">
                          <span className="text-xs text-gray-500">
                            {totalUnits.toLocaleString()} total units
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: Matching workspace */}
            <div className="col-span-8">
              {!selectedReceiptId ? (
                <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                  <p className="text-gray-400">Select a receipt from the left to begin matching.</p>
                </div>
              ) : matchLoading ? (
                <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                  <p className="text-gray-500">Loading match data...</p>
                </div>
              ) : matchData ? (
                <div className="space-y-4">
                  {/* Receipt details — compact, SKU-focused */}
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-gray-900">
                        {matchData.receipt.externalReceiptId || "Receipt Items"}
                      </h3>
                      <span className="text-xs text-gray-500">
                        {matchData.receipt.receivedDate
                          ? new Date(matchData.receipt.receivedDate + "T00:00:00").toLocaleDateString("en-US")
                          : "—"}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {matchData.receiptLines.map((line) => {
                        const isEditing = editingLineId === line.id;
                        const isSaving = savingLineId === line.id;
                        return (
                          <div
                            key={line.id}
                            className={`rounded-md px-3 py-2 border ${
                              line.matched
                                ? "bg-sage-50 border-sage-200"
                                : "bg-gray-50 border-gray-200"
                            }`}
                          >
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <select
                                  defaultValue={line.skuId || ""}
                                  disabled={isSaving}
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleUpdateLineSku(line.id, e.target.value);
                                    }
                                  }}
                                  className="text-xs border border-gray-300 rounded px-1.5 py-1 max-w-[200px]"
                                  autoFocus
                                >
                                  <option value="">Select SKU...</option>
                                  {matchData.availableItems.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.standardSku}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => setEditingLineId(null)}
                                  className="text-gray-400 hover:text-gray-600 text-xs px-1"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className={`text-sm font-medium ${
                                  line.matched ? "text-sage-700" : "text-gray-900"
                                }`}>
                                  {line.skuName || line.threePlSku || "Unknown"}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {line.qtyReceived.toLocaleString()} {line.uom || "units"}
                                </span>
                                {line.matched && (
                                  <span className="text-[10px] text-sage-600">Matched</span>
                                )}
                                {!line.matched && (
                                  <button
                                    onClick={() => setEditingLineId(line.id)}
                                    className="text-gray-300 hover:text-gray-500 ml-0.5"
                                    title="Edit SKU"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* PO Selection — ranked by SKU overlap */}
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h3 className="font-semibold text-gray-900 mb-3">
                      {matchData.rankedPOs.length > 0
                        ? "Matching Purchase Orders"
                        : "No POs match these SKUs"}
                    </h3>

                    {/* Ranked POs with SKU overlap */}
                    {matchData.rankedPOs.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {matchData.rankedPOs.map((po) => {
                          const isSelected = selectedPOId === po.id;
                          const isSuggested = matchData.suggestedPO?.id === po.id;
                          return (
                            <button
                              key={po.id}
                              onClick={() => handleSelectPO(po.id)}
                              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                                isSelected
                                  ? "border-gold-400 bg-gold-50"
                                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-sm text-gray-900">
                                    {po.poNumber}
                                  </span>
                                  <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                    po.status === "Issued"
                                      ? "bg-gold-100 text-gold-700"
                                      : "bg-warm-100 text-warm-700"
                                  }`}>
                                    {po.status}
                                  </span>
                                  {isSuggested && (
                                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-100 text-sage-700">
                                      PO # Match
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
                                      .filter((name) => !po.overlapSkuNames.includes(name))
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
                                    ? "border-gold-400 bg-gold-50"
                                    : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                                }`}
                              >
                                <span className="font-medium text-gray-700">{po.poNumber}</span>
                                <span className="text-gray-400 ml-2">{po.status}</span>
                                <span className="text-gray-400 ml-2">{po.skuNames.join(", ")}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Comparison table — split into matched and other PO lines */}
                  {matchData.comparison && (
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-gray-900">
                          Comparison: {matchData.comparison.poNumber}
                        </h3>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          matchData.comparison.poStatus === "Issued"
                            ? "bg-gold-100 text-gold-800"
                            : "bg-warm-100 text-warm-800"
                        }`}>
                          {matchData.comparison.poStatus}
                        </span>
                      </div>

                      {/* Matched lines — these will be linked */}
                      {matchData.comparison.matchedLines.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                            Matching Lines ({matchData.comparison.matchedLines.length})
                          </p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-gray-50 border-b border-gray-200">
                                  <th className="w-8 px-3 py-2">
                                    <input
                                      type="checkbox"
                                      checked={checkedLines.size === matchData.comparison.matchedLines.length}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setCheckedLines(new Set(matchData.comparison!.matchedLines.map((_, i) => i)));
                                        } else {
                                          setCheckedLines(new Set());
                                        }
                                      }}
                                      className="rounded border-gray-300"
                                    />
                                  </th>
                                  <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">SKU</th>
                                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Ordered</th>
                                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Prev. Received</th>
                                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">This Receipt</th>
                                  <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Variance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {matchData.comparison.matchedLines.map((line, idx) => {
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
                                        <span className="text-xs text-gray-900">{line.skuName}</span>
                                        {!line.poLineItemId && (
                                          <span className="ml-1.5 text-[10px] bg-warm-100 text-warm-700 px-1 py-0.5 rounded">
                                            Not on PO
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-right text-gray-600">
                                        {line.qtyOrdered > 0 ? line.qtyOrdered.toLocaleString() : "—"}
                                      </td>
                                      <td className="px-3 py-2 text-right text-gray-600">
                                        {line.qtyAlreadyReceived > 0 ? line.qtyAlreadyReceived.toLocaleString() : "—"}
                                      </td>
                                      <td className="px-3 py-2 text-right text-gray-900 font-medium">
                                        {line.qtyThisReceipt > 0 ? line.qtyThisReceipt.toLocaleString() : "—"}
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        <span
                                          className={`text-xs font-medium ${
                                            line.variance === 0
                                              ? "text-sage-600"
                                              : line.variance > 0
                                              ? "text-gold-600"
                                              : "text-warm-600"
                                          }`}
                                        >
                                          {line.variance > 0 ? "+" : ""}
                                          {line.variance.toLocaleString()}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Other PO lines — not matched by this receipt */}
                      {matchData.comparison.otherLines.length > 0 && (
                        <div className="border-t border-gray-100 pt-3">
                          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
                            Other PO Lines ({matchData.comparison.otherLines.length}) — not in this receipt
                          </p>
                          <div className="space-y-1">
                            {matchData.comparison.otherLines.map((line, idx) => (
                              <div key={idx} className="flex items-center justify-between px-3 py-1.5 text-xs text-gray-400">
                                <span className="">{line.skuName}</span>
                                <span className="">{line.qtyOrdered.toLocaleString()} ordered</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <p className="text-[10px] text-gray-400 mt-3">
                        Variance = This Receipt - (Ordered - Previously Received). Only matching lines will be linked.
                      </p>
                    </div>
                  )}

                  {/* Confirm button */}
                  {selectedPOId && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">
                        {checkedLines.size} of {matchData?.comparison?.matchedLines.length || 0} lines selected
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            setSelectedReceiptId(null);
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
