"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";

// --- Types ---

interface POOptionLineItem {
  poLineItemId: string;
  sku: string;
  skuId: string;
  section: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyRemaining: number;
  isMatchable: boolean;
}

interface POOption {
  poId: string;
  poNumber: string;
  poStatus: string;
  poDate: string;
  supplier: string;
  lineItems: POOptionLineItem[];
}

interface SuggestedMatch {
  poId: string;
  poNumber: string;
  poLineItemId: string;
  poQty: number;
  hasPartialReceipts: boolean;
}

interface MatchingLine {
  id: string;
  receiptId: string;
  receiptDate: string;
  orderNumber: string;
  receiptNumber: string;
  sku: string;
  skuId: string | null;
  threePlSku: string | null;
  receiptQty: number;
  status: "open" | "review" | "matched" | "excluded";
  reviewNote: string | null;
  suggestedMatch: SuggestedMatch | null;
  matchedPO: {
    poId: string;
    poNumber: string;
    poLineItemId: string;
  } | null;
  poOptions: POOption[];
}

type Tab = "open" | "review" | "matched" | "excluded";

// --- Helpers ---

function formatDate(d: string) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

function formatFullDate(d: string) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// --- Main Page ---

export default function ReceiptsPage() {
  const router = useRouter();
  const [lines, setLines] = useState<MatchingLine[]>([]);
  const [counts, setCounts] = useState({
    open: 0,
    review: 0,
    matched: 0,
    excluded: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("open");
  const [search, setSearch] = useState("");
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [excluding, setExcluding] = useState<string | null>(null);
  const [unmatching, setUnmatching] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/receipt-lines/matching");
      const data = await res.json();
      setLines(data.lines || []);
      setCounts(data.counts || { open: 0, review: 0, matched: 0, excluded: 0 });
    } catch (err) {
      console.error("Failed to fetch matching data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredLines = useMemo(() => {
    let result = lines.filter((l) => l.status === activeTab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (l) =>
          l.orderNumber?.toLowerCase().includes(q) ||
          l.receiptNumber?.toLowerCase().includes(q) ||
          l.sku?.toLowerCase().includes(q) ||
          l.threePlSku?.toLowerCase().includes(q) ||
          l.suggestedMatch?.poNumber?.toLowerCase().includes(q) ||
          l.matchedPO?.poNumber?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [lines, activeTab, search]);

  const handleConfirm = async (
    line: MatchingLine,
    poId: string,
    poLineItemId: string
  ) => {
    setConfirming(line.id);
    try {
      const res = await fetch(`/api/receipts/${line.receiptId}/match`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseOrderId: poId,
          lineMatches: [
            { receiptLineId: line.id, poLineItemId },
          ],
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
        return;
      }
      setExpandedLineId(null);
      await fetchData();
    } catch {
      alert("Failed to confirm match.");
    } finally {
      setConfirming(null);
    }
  };

  const handleExclude = async (lineId: string) => {
    setExcluding(lineId);
    try {
      const res = await fetch(`/api/receipt-lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchStatus: "Excluded" }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
        return;
      }
      setExpandedLineId(null);
      await fetchData();
    } catch {
      alert("Failed to exclude.");
    } finally {
      setExcluding(null);
    }
  };

  const handleRestore = async (lineId: string) => {
    setExcluding(lineId);
    try {
      await fetch(`/api/receipt-lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchStatus: "Open" }),
      });
      setExpandedLineId(null);
      await fetchData();
    } catch {
      alert("Failed to restore.");
    } finally {
      setExcluding(null);
    }
  };

  const handleUnmatch = async (lineId: string) => {
    setUnmatching(lineId);
    try {
      const res = await fetch(`/api/receipt-lines/${lineId}/unmatch`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
        return;
      }
      await fetchData();
    } catch {
      alert("Failed to unmatch.");
    } finally {
      setUnmatching(null);
    }
  };

  const handleFlagForReview = async (lineId: string, note: string) => {
    try {
      const res = await fetch(`/api/receipt-lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchStatus: "Review", reviewNote: note }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
        return;
      }
      setExpandedLineId(null);
      await fetchData();
    } catch {
      alert("Failed to flag for review.");
    }
  };

  const handleResolve = async (lineId: string) => {
    try {
      const res = await fetch(`/api/receipt-lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchStatus: "Open", reviewNote: "" }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
        return;
      }
      await fetchData();
    } catch {
      alert("Failed to resolve.");
    }
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "open", label: "Open", count: counts.open },
    { key: "review", label: "Client Review", count: counts.review },
    { key: "matched", label: "Matched", count: counts.matched },
    { key: "excluded", label: "Excluded", count: counts.excluded },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Receipts</h1>
            <p className="text-sm text-gray-500 mt-1">
              Match receipt lines to purchase orders
            </p>
          </div>
          <button
            onClick={() => router.push("/warehouse/data-ingestion")}
            className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
          >
            + Import from Stord
          </button>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : lines.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-4">No receipts yet.</p>
            <p className="text-sm text-gray-400 mb-4">
              Import warehouse data from the Data Ingestion page to create
              receipt records.
            </p>
            <button
              onClick={() => router.push("/warehouse/data-ingestion")}
              className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
            >
              Go to Data Ingestion
            </button>
          </div>
        ) : (
          <>
            {/* Tabs + Search */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setActiveTab(tab.key);
                      setExpandedLineId(null);
                    }}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                      activeTab === tab.key
                        ? "bg-white text-gray-900 font-medium shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`ml-1.5 text-xs ${
                        activeTab === tab.key
                          ? "text-gray-500"
                          : "text-gray-400"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  placeholder="Search by order #, SKU, or PO..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-md w-72 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">
                      Date
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Order #
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Item
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
                      Receipt Qty
                    </th>
                    <th className="w-8"></th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {activeTab === "matched"
                        ? "Matched To"
                        : activeTab === "review"
                        ? "Note"
                        : "Match To"}
                    </th>
                    {activeTab === "open" && (
                      <>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
                          PO Qty
                        </th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">
                          Receiving
                        </th>
                      </>
                    )}
                    <th className="px-4 py-3 w-28"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredLines.map((line) => (
                    <ReceiptLineRow
                      key={line.id}
                      line={line}
                      isExpanded={expandedLineId === line.id}
                      isConfirming={confirming === line.id}
                      isExcluding={excluding === line.id}
                      activeTab={activeTab}
                      onToggleExpand={() =>
                        setExpandedLineId(
                          expandedLineId === line.id ? null : line.id
                        )
                      }
                      onConfirm={(poId, poLineItemId) =>
                        handleConfirm(line, poId, poLineItemId)
                      }
                      onExclude={() => handleExclude(line.id)}
                      onRestore={() => handleRestore(line.id)}
                      isUnmatching={unmatching === line.id}
                      onUnmatch={() => handleUnmatch(line.id)}
                      onFlagForReview={(note) =>
                        handleFlagForReview(line.id, note)
                      }
                      onResolve={() => handleResolve(line.id)}
                    />
                  ))}
                </tbody>
              </table>

              {filteredLines.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">
                  {search
                    ? `No results matching "${search}"`
                    : activeTab === "open"
                    ? "All receipt lines have been actioned!"
                    : activeTab === "review"
                    ? "No items flagged for client review."
                    : activeTab === "excluded"
                    ? "No excluded receipt lines."
                    : "No matched receipt lines yet."}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Receipt Line Row ---

function ReceiptLineRow({
  line,
  isExpanded,
  isConfirming,
  isExcluding,
  activeTab,
  onToggleExpand,
  onConfirm,
  onExclude,
  onRestore,
  isUnmatching,
  onUnmatch,
  onFlagForReview,
  onResolve,
}: {
  line: MatchingLine;
  isExpanded: boolean;
  isConfirming: boolean;
  isExcluding: boolean;
  activeTab: Tab;
  onToggleExpand: () => void;
  onConfirm: (poId: string, poLineItemId: string) => void;
  onExclude: () => void;
  onRestore: () => void;
  isUnmatching: boolean;
  onUnmatch: () => void;
  onFlagForReview: (note: string) => void;
  onResolve: () => void;
}) {
  // Determine receiving status for the suggested PO
  const receivingStatus = useMemo(() => {
    if (!line.suggestedMatch) return null;
    if (line.suggestedMatch.hasPartialReceipts) return "partial";
    return "new";
  }, [line.suggestedMatch]);

  return (
    <>
      {/* Main row */}
      <tr
        className={`cursor-pointer transition-colors ${
          isExpanded ? "bg-gold-50" : "hover:bg-gray-50"
        }`}
        onClick={onToggleExpand}
      >
        <td className="px-4 py-3 text-gray-600 w-20">
          {formatDate(line.receiptDate)}
        </td>
        <td className="px-4 py-3">
          <div className="font-medium text-gray-900 truncate max-w-48">
            {line.orderNumber || "—"}
          </div>
          <div className="text-xs text-gray-400">{line.receiptNumber}</div>
        </td>
        <td className="px-4 py-3 text-gray-900 truncate max-w-48">
          {line.sku}
        </td>
        <td className="px-4 py-3 text-right font-medium text-gray-900 w-24">
          {line.receiptQty.toLocaleString()}
        </td>
        <td className="w-8"></td>

        {/* Match To / Note */}
        <td className="px-4 py-3">
          {activeTab === "matched" && line.matchedPO ? (
            <span className="font-medium text-sage-700">
              {line.matchedPO.poNumber}
            </span>
          ) : activeTab === "excluded" ? (
            <span className="text-gray-400 italic text-xs">Excluded</span>
          ) : activeTab === "review" ? (
            <span className="text-sm text-gray-600">
              {line.reviewNote || "—"}
            </span>
          ) : line.suggestedMatch ? (
            <span className="font-medium text-gray-900">
              {line.suggestedMatch.poNumber}
            </span>
          ) : line.poOptions.length > 0 ? (
            <span className="text-warm-600 font-medium text-xs">
              Needs Review
            </span>
          ) : (
            <span className="text-gray-300 text-xs">No match found</span>
          )}
        </td>

        {/* PO Qty + Receiving Status (open tab only) */}
        {activeTab === "open" && (
          <>
            <td className="px-4 py-3 text-right text-gray-600 w-24">
              {line.suggestedMatch
                ? line.suggestedMatch.poQty.toLocaleString()
                : ""}
            </td>
            <td className="px-4 py-3 text-center w-28">
              {receivingStatus === "new" && (
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-sage-100 text-sage-700">
                  Not received
                </span>
              )}
              {receivingStatus === "partial" && (
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-warm-100 text-warm-700">
                  Partial
                </span>
              )}
            </td>
          </>
        )}

        {/* Action */}
        <td className="px-4 py-3 text-right w-28">
          {activeTab === "open" && line.suggestedMatch && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onConfirm(
                  line.suggestedMatch!.poId,
                  line.suggestedMatch!.poLineItemId
                );
              }}
              disabled={isConfirming}
              className="bg-sage-600 text-white px-4 py-1.5 text-xs font-semibold rounded hover:bg-sage-700 disabled:opacity-50 transition-colors"
            >
              {isConfirming ? "..." : "Confirm"}
            </button>
          )}
          {activeTab === "matched" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnmatch();
              }}
              disabled={isUnmatching}
              className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              {isUnmatching ? "..." : "Unmatch"}
            </button>
          )}
          {activeTab === "review" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResolve();
              }}
              className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50"
            >
              Resolve
            </button>
          )}
          {activeTab === "excluded" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRestore();
              }}
              disabled={isExcluding}
              className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              {isExcluding ? "..." : "Restore"}
            </button>
          )}
          {activeTab === "open" &&
            !line.suggestedMatch &&
            line.poOptions.length > 0 && (
              <span className="text-xs text-gray-400">
                {line.poOptions.length} PO
                {line.poOptions.length !== 1 ? "s" : ""}
              </span>
            )}
        </td>
      </tr>

      {/* Expanded panel with mini PO card */}
      {isExpanded && (activeTab === "open" || activeTab === "review") && (
        <tr>
          <td colSpan={9} className="p-0">
            <ExpandedPOPanel
              line={line}
              isConfirming={isConfirming}
              isExcluding={isExcluding}
              onConfirm={onConfirm}
              onExclude={onExclude}
              onFlagForReview={onFlagForReview}
              onClose={onToggleExpand}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// --- Expanded Panel with Mini PO Card ---

function ExpandedPOPanel({
  line,
  isConfirming,
  isExcluding,
  onConfirm,
  onExclude,
  onFlagForReview,
  onClose,
}: {
  line: MatchingLine;
  isConfirming: boolean;
  isExcluding: boolean;
  onConfirm: (poId: string, poLineItemId: string) => void;
  onExclude: () => void;
  onFlagForReview: (note: string) => void;
  onClose: () => void;
}) {
  const [selectedPOId, setSelectedPOId] = useState<string>(
    line.suggestedMatch?.poId || line.poOptions[0]?.poId || ""
  );
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagNote, setFlagNote] = useState("");

  const selectedPO = line.poOptions.find((o) => o.poId === selectedPOId);

  if (line.poOptions.length === 0) {
    return (
      <div className="bg-gray-50 border-t border-gray-200 px-6 py-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-gray-500">
            No open Purchase Orders found with{" "}
            <span className="font-medium text-gray-700">{line.sku}</span>.
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="text-gray-400 hover:text-gray-600"
          >
            <XIcon />
          </button>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExclude();
          }}
          disabled={isExcluding}
          className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >
          {isExcluding ? "Excluding..." : "Exclude this receipt line"}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border-t border-gray-200 px-6 py-5">
      {/* Close button */}
      <div className="flex justify-end mb-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="text-gray-400 hover:text-gray-600"
        >
          <XIcon />
        </button>
      </div>

      {/* PO Tabs */}
      {line.poOptions.length > 1 && (
        <div className="flex gap-1.5 mb-4">
          {line.poOptions.map((po) => {
            const isActive = po.poId === selectedPOId;
            const isSuggested = line.suggestedMatch?.poId === po.poId;
            return (
              <button
                key={po.poId}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPOId(po.poId);
                }}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  isActive
                    ? "bg-white border-gray-300 text-gray-900 font-medium shadow-sm"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                {po.poNumber}
                {isSuggested && (
                  <span className="ml-1 text-[10px] text-sage-600">
                    Suggested
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Mini PO Card */}
      {selectedPO && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {/* PO Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
            <span className="font-semibold text-gray-900">
              {selectedPO.poNumber}
            </span>
            <span
              className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                selectedPO.poStatus === "Issued"
                  ? "bg-sage-100 text-sage-700"
                  : "bg-warm-100 text-warm-700"
              }`}
            >
              {selectedPO.poStatus}
            </span>
            <span className="text-sm text-gray-400">
              {formatFullDate(selectedPO.poDate)}
            </span>
            {selectedPO.supplier && (
              <>
                <span className="text-gray-300">&middot;</span>
                <span className="text-sm text-gray-500">
                  {selectedPO.supplier}
                </span>
              </>
            )}
          </div>

          {/* PO Line Items */}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
                  Ordered
                </th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
                  Received
                </th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
                  Remaining
                </th>
                <th className="px-4 py-2 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {selectedPO.lineItems.map((li) => {
                const isMatch = li.isMatchable;
                const qtyMatch = li.qtyOrdered === line.receiptQty && li.qtyReceived === 0;
                const overReceipt = isMatch && line.receiptQty > li.qtyRemaining;

                return (
                  <tr
                    key={li.poLineItemId}
                    className={
                      isMatch
                        ? "bg-gold-50/50"
                        : "text-gray-400"
                    }
                  >
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          isMatch
                            ? "font-medium text-gray-900"
                            : "text-gray-400"
                        }
                      >
                        {li.sku}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {li.qtyOrdered.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {li.qtyReceived > 0 ? (
                        <span className="text-warm-600">
                          {li.qtyReceived.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-gray-300">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {li.qtyRemaining.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {isMatch && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onConfirm(selectedPO.poId, li.poLineItemId);
                          }}
                          disabled={isConfirming}
                          className={`text-white px-4 py-1 text-xs font-semibold rounded transition-colors disabled:opacity-50 ${
                            qtyMatch
                              ? "bg-green-600 hover:bg-sage-700"
                              : overReceipt
                              ? "bg-gold-500 hover:bg-gold-600"
                              : "bg-gold-600 hover:bg-gold-700"
                          }`}
                        >
                          {isConfirming ? "..." : "Match"}
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

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExclude();
            }}
            disabled={isExcluding}
            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            {isExcluding ? "Excluding..." : "Exclude"}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowFlagForm(!showFlagForm);
            }}
            className="text-xs text-warm-600 hover:text-warm-800"
          >
            Flag for client review
          </button>
        </div>
      </div>

      {/* Flag for review form */}
      {showFlagForm && (
        <div
          className="mt-3 flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            placeholder="Note (e.g., Missing PO, Qty mismatch)"
            value={flagNote}
            onChange={(e) => setFlagNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && flagNote.trim()) {
                onFlagForReview(flagNote.trim());
              }
            }}
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400"
            autoFocus
          />
          <button
            onClick={() => {
              if (flagNote.trim()) onFlagForReview(flagNote.trim());
            }}
            disabled={!flagNote.trim()}
            className="bg-gold-500 text-white px-4 py-1.5 text-xs font-semibold rounded hover:bg-gold-600 disabled:opacity-50 transition-colors"
          >
            Flag
          </button>
          <button
            onClick={() => {
              setShowFlagForm(false);
              setFlagNote("");
            }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// --- Icons ---

function XIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}
