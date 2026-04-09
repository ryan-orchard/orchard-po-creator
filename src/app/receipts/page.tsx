"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type Status = "open" | "linked" | "matched" | "excluded";

interface MatchingLine {
  id: string;
  receiptId: string;
  receiptDate: string;
  orderNumber: string;
  receiptNumber: string;
  sourceLineId: string | null;
  sku: string;
  skuId: string | null;
  receiptQty: number;
  status: Status;
  warehouse: string | null;
  matchedPO: { poId: string; poNumber: string; poLineItemId: string } | null;
  matchedWO: { woId: string; woNumber: string; woLineItemId: string } | null;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatDate(d: string) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default function ReceiptsPage() {
  const searchParams = useSearchParams();
  const [lines, setLines] = useState<MatchingLine[]>([]);
  const [counts, setCounts] = useState({ open: 0, linked: 0, matched: 0, excluded: 0 });
  const [loading, setLoading] = useState(true);
  const initialTab = (searchParams.get("tab") as Status) || "open";
  const [activeTab, setActiveTab] = useState<Status>(initialTab);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [excluding, setExcluding] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  type SortField = "date" | "receiptNumber" | "sku" | "qty";
  type SortDir = "asc" | "desc";
  const [sortConfig, setSortConfig] = useState<{ field: SortField; dir: SortDir } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/receipt-lines/matching");
      const data = await res.json();
      setLines(data.lines || []);
      setCounts(data.counts || { open: 0, linked: 0, matched: 0, excluded: 0 });
    } catch (err) {
      console.error("Failed to fetch receipts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const handleExclude = async (lineId: string) => {
    setExcluding(lineId);
    try {
      await fetch(`/api/receipt-lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchStatus: "Excluded" }),
      });
      await fetchData();
    } catch {
      alert("Failed to exclude.");
    } finally {
      setExcluding(null);
    }
  };

  const handleRestore = async (lineId: string) => {
    setRestoring(lineId);
    try {
      await fetch(`/api/receipt-lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchStatus: "Open" }),
      });
      await fetchData();
    } catch {
      alert("Failed to restore.");
    } finally {
      setRestoring(null);
    }
  };

  const handleSort = (field: SortField) => {
    setSortConfig((prev) =>
      prev?.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "asc" }
    );
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (!sortConfig || sortConfig.field !== field)
      return <span className="ml-1 text-gray-300">↕</span>;
    return <span className="ml-1">{sortConfig.dir === "asc" ? "↑" : "↓"}</span>;
  };

  const filteredLines = useMemo(() => {
    let result = lines.filter((l) => l.status === activeTab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (l) =>
          l.orderNumber?.toLowerCase().includes(q) ||
          l.receiptNumber?.toLowerCase().includes(q) ||
          l.sku?.toLowerCase().includes(q)
      );
    }
    if (sortConfig) {
      result = [...result].sort((a, b) => {
        let aVal: string | number = "";
        let bVal: string | number = "";
        if (sortConfig.field === "date") { aVal = a.receiptDate; bVal = b.receiptDate; }
        else if (sortConfig.field === "receiptNumber") { aVal = a.receiptNumber; bVal = b.receiptNumber; }
        else if (sortConfig.field === "sku") { aVal = a.sku; bVal = b.sku; }
        else if (sortConfig.field === "qty") { aVal = a.receiptQty; bVal = b.receiptQty; }
        if (aVal < bVal) return sortConfig.dir === "asc" ? -1 : 1;
        if (aVal > bVal) return sortConfig.dir === "asc" ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [lines, activeTab, search, sortConfig]);

  const tabs = [
    { key: "open" as Status, label: "Open", count: counts.open },
    { key: "linked" as Status, label: "Source Linked", count: counts.linked },
    { key: "matched" as Status, label: "Matched", count: counts.matched },
    { key: "excluded" as Status, label: "Excluded", count: counts.excluded },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Receipts</h1>
            <p className="text-sm text-gray-500 mt-1">
              Link receipt lines to purchase orders and invoices
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <Link
              href="/receipts/new"
              className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-gray-800"
            >
              + Add Receipt
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : lines.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-4">No receipts yet.</p>
            <p className="text-sm text-gray-400">
              Receipts arrive automatically via Stord webhook, or upload manually from Data Ingestion.
            </p>
          </div>
        ) : (
          <>
            {/* Tabs + Search */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
                {tabs.map((tab) => (
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
                    <span
                      className={`ml-1.5 text-xs ${
                        activeTab === tab.key ? "text-gray-500" : "text-gray-400"
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
                  placeholder="Search by order #, SKU, or receipt #..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-md w-72 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-20 cursor-pointer select-none hover:text-gray-700"
                      onClick={() => handleSort("date")}
                    >
                      Date<SortIcon field="date" />
                    </th>
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700"
                      onClick={() => handleSort("receiptNumber")}
                    >
                      Order #<SortIcon field="receiptNumber" />
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
                      Warehouse
                    </th>
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700"
                      onClick={() => handleSort("sku")}
                    >
                      Item<SortIcon field="sku" />
                    </th>
                    <th
                      className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24 cursor-pointer select-none hover:text-gray-700"
                      onClick={() => handleSort("qty")}
                    >
                      Qty<SortIcon field="qty" />
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {activeTab === "open" ? "Action" : "Linked To"}
                    </th>
                    <th className="px-4 py-3 w-24"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredLines.map((line) => (
                    <tr key={line.id} className="hover:bg-gray-50 transition-colors">
                      {/* Date */}
                      <td className="px-4 py-3 text-gray-500 text-sm">
                        {formatDate(line.receiptDate)}
                      </td>

                      {/* Order # */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 truncate max-w-48">
                          {line.orderNumber || "—"}
                        </div>
                        <div className="text-xs text-gray-400">{line.receiptNumber}</div>
                      </td>

                      {/* Warehouse */}
                      <td className="px-4 py-3 text-gray-500 text-sm w-24">
                        {line.warehouse || "—"}
                      </td>

                      {/* Item */}
                      <td className="px-4 py-3 text-gray-900">
                        <div>{line.sku}</div>
                        {line.sourceLineId && (
                          <div className="text-xs text-gray-400">{line.sourceLineId}</div>
                        )}
                      </td>

                      {/* Qty */}
                      <td className="px-4 py-3 text-right font-medium text-gray-900 w-24">
                        {line.receiptQty.toLocaleString()}
                      </td>

                      {/* Linked To / Action */}
                      <td className="px-4 py-3">
                        {line.status === "open" && (
                          <Link
                            href={`/match?from=receipt&id=${line.receiptId}`}
                            className="text-sm font-medium text-stone-700 hover:text-stone-900 underline underline-offset-2"
                          >
                            Link →
                          </Link>
                        )}
                        {(line.status === "linked" || line.status === "matched") && (
                          <div className="flex items-center gap-2">
                            {line.matchedPO && (
                              <span className="text-sm font-medium text-gray-800">
                                {line.matchedPO.poNumber}
                              </span>
                            )}
                            {line.matchedWO && (
                              <span className="text-sm font-medium text-gray-800">
                                {line.matchedWO.woNumber}
                              </span>
                            )}
                            {!line.matchedPO && !line.matchedWO && (
                              <span className="text-sm text-gray-500">Linked</span>
                            )}
                            {line.status === "matched" && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                + Invoice
                              </span>
                            )}
                          </div>
                        )}
                        {line.status === "excluded" && (
                          <span className="text-gray-400 italic text-xs">Excluded</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right w-24">
                        <div className="flex items-center justify-end gap-2">
                          {(line.status === "linked" || line.status === "matched") && (
                            <Link
                              href={`/match?from=receipt&id=${line.receiptId}`}
                              className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                            >
                              Re-link
                            </Link>
                          )}
                          {line.status === "open" && (
                            <button
                              onClick={() => handleExclude(line.id)}
                              disabled={excluding === line.id}
                              className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                            >
                              {excluding === line.id ? "…" : "Exclude"}
                            </button>
                          )}
                          {line.status === "excluded" && (
                            <button
                              onClick={() => handleRestore(line.id)}
                              disabled={restoring === line.id}
                              className="text-xs text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-50"
                            >
                              {restoring === line.id ? "…" : "Restore"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredLines.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">
                  {search
                    ? `No results matching "${search}"`
                    : activeTab === "open"
                    ? "All receipt lines have been actioned."
                    : activeTab === "linked"
                    ? "No source-linked receipt lines yet."
                    : activeTab === "matched"
                    ? "No fully matched receipt lines yet."
                    : "No excluded receipt lines."}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
