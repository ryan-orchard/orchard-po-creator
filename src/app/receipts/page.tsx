"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import LinkInvoiceModal, { ReceiptLineSummary } from "@/components/LinkInvoiceModal";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type Status = "unmatched" | "matched" | "excluded";

interface ReceiptLine {
  id: string;
  receiptId: string;
  date: string;
  warehouse: string | null;
  item: string;
  itemId: string | null;
  threePlSku: string | null;
  qty: number;
  orderRef: string | null;
  poNumber: string | null;
  stordReceiptId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  status: Status;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatDate(d: string) {
  if (!d) return "\u2014";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

// ─────────────────────────────────────────────────────────────
// Sort
// ─────────────────────────────────────────────────────────────

type SortField = "date" | "warehouse" | "item" | "qty" | "orderRef";
type SortDir = "asc" | "desc";

function sortLines(
  lines: ReceiptLine[],
  field: SortField,
  dir: SortDir
): ReceiptLine[] {
  return [...lines].sort((a, b) => {
    let aVal: string | number = "";
    let bVal: string | number = "";
    switch (field) {
      case "date":
        aVal = a.date || "";
        bVal = b.date || "";
        break;
      case "warehouse":
        aVal = a.warehouse || "";
        bVal = b.warehouse || "";
        break;
      case "item":
        aVal = a.item || "";
        bVal = b.item || "";
        break;
      case "qty":
        aVal = a.qty;
        bVal = b.qty;
        break;
      case "orderRef":
        aVal = a.poNumber || a.orderRef || "";
        bVal = b.poNumber || b.orderRef || "";
        break;
    }
    if (aVal < bVal) return dir === "asc" ? -1 : 1;
    if (aVal > bVal) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default function ReceiptsPage() {
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Status>("unmatched");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    field: SortField;
    dir: SortDir;
  }>({ field: "date", dir: "desc" });

  // ── Data fetching ──────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/receipt-lines");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Server error (${res.status})`);
        return;
      }
      const data = await res.json();
      setLines(data.lines || data || []);
    } catch {
      setError("Failed to connect to server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Tab counts ─────────────────────────────────────────────

  const counts = useMemo(() => {
    const c = { unmatched: 0, matched: 0, excluded: 0 };
    for (const l of lines) {
      if (l.status in c) c[l.status]++;
    }
    return c;
  }, [lines]);

  // ── Filtering + sorting ────────────────────────────────────

  const filteredLines = useMemo(() => {
    let result = lines.filter((l) => l.status === activeTab);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (l) =>
          l.item?.toLowerCase().includes(q) ||
          l.orderRef?.toLowerCase().includes(q) ||
          l.poNumber?.toLowerCase().includes(q) ||
          l.stordReceiptId?.toLowerCase().includes(q) ||
          l.invoiceNumber?.toLowerCase().includes(q)
      );
    }
    return sortLines(result, sortConfig.field, sortConfig.dir);
  }, [lines, activeTab, search, sortConfig]);

  // ── Selection ──────────────────────────────────────────────

  // Clear selection when switching tabs
  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredLines.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLines.map((l) => l.id)));
    }
  };

  const allSelected =
    filteredLines.length > 0 && selectedIds.size === filteredLines.length;

  // ── Actions ────────────────────────────────────────────────

  const handleExclude = async () => {
    setActionLoading(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/receipt-lines/${id}/exclude`, { method: "POST" })
        )
      );
      setSelectedIds(new Set());
      await fetchData();
    } catch {
      alert("Failed to exclude receipt lines.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestore = async () => {
    setActionLoading(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/receipt-lines/${id}/restore`, { method: "POST" })
        )
      );
      setSelectedIds(new Set());
      await fetchData();
    } catch {
      alert("Failed to restore receipt lines.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleLinkInvoice = () => {
    if (selectedIds.size === 0) return;
    setLinkModalOpen(true);
  };

  const handleLinkSuccess = async (result: {
    invoiceNumber: string;
    linksCreated: number;
    skippedCount: number;
  }) => {
    setLinkModalOpen(false);
    const skippedNote =
      result.skippedCount > 0
        ? ` (${result.skippedCount} receipt line${
            result.skippedCount === 1 ? "" : "s"
          } skipped — no SKU match)`
        : "";
    setToast(
      `Linked ${result.linksCreated} line${
        result.linksCreated === 1 ? "" : "s"
      } to invoice ${result.invoiceNumber}${skippedNote}`
    );
    setSelectedIds(new Set());
    await fetchData();
    setTimeout(() => setToast(null), 4000);
  };

  const selectedReceiptSummaries: ReceiptLineSummary[] = useMemo(
    () =>
      lines
        .filter((l) => selectedIds.has(l.id))
        .map((l) => ({
          itemSku: l.item,
          qty: l.qty,
          ref: l.poNumber || l.orderRef || null,
        })),
    [lines, selectedIds]
  );

  // ── Sort ───────────────────────────────────────────────────

  const handleSort = (field: SortField) => {
    setSortConfig((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "asc" }
    );
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortConfig.field !== field)
      return <span className="ml-1 text-gray-300">&uarr;&darr;</span>;
    return (
      <span className="ml-1">
        {sortConfig.dir === "asc" ? "\u2191" : "\u2193"}
      </span>
    );
  };

  // ── Tabs config ────────────────────────────────────────────

  const tabs: { key: Status; label: string; count: number }[] = [
    { key: "unmatched", label: "unmatched", count: counts.unmatched },
    { key: "matched", label: "matched", count: counts.matched },
    { key: "excluded", label: "excluded", count: counts.excluded },
  ];

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Receipts</h1>
            <p className="text-sm text-gray-500 mt-1">
              Match receipt lines to invoices
            </p>
          </div>
        </div>

        {/* Loading */}
        {loading && <p className="text-gray-500">Loading...</p>}

        {/* Error */}
        {!loading && error && (
          <div className="bg-red-50 rounded-lg border border-red-200 p-12 text-center">
            <p className="text-red-700 mb-4">Failed to load receipts</p>
            <p className="text-sm text-red-500 mb-4">{error}</p>
            <button
              onClick={() => {
                setLoading(true);
                fetchData();
              }}
              className="px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-md hover:bg-red-50"
            >
              Retry
            </button>
          </div>
        )}

        {/* Main content */}
        {!loading && !error && (
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
                  placeholder="Search by item, order #, or receipt #..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-md w-80 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                      />
                    </th>
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700"
                      onClick={() => handleSort("date")}
                    >
                      Date
                      <SortIcon field="date" />
                    </th>
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700"
                      onClick={() => handleSort("warehouse")}
                    >
                      Warehouse
                      <SortIcon field="warehouse" />
                    </th>
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700"
                      onClick={() => handleSort("item")}
                    >
                      Item
                      <SortIcon field="item" />
                    </th>
                    <th
                      className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24 cursor-pointer select-none hover:text-gray-700"
                      onClick={() => handleSort("qty")}
                    >
                      Qty
                      <SortIcon field="qty" />
                    </th>
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700"
                      onClick={() => handleSort("orderRef")}
                    >
                      PO / Order #
                      <SortIcon field="orderRef" />
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {activeTab === "matched" ? "Invoice #" : "Stord ID"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredLines.map((line) => (
                    <tr
                      key={line.id}
                      className={`hover:bg-gray-50 transition-colors ${
                        selectedIds.has(line.id) ? "bg-gray-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(line.id)}
                          onChange={() => toggleSelect(line.id)}
                          className="rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm whitespace-nowrap">
                        {formatDate(line.date)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">
                        {line.warehouse || "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        <div>{line.item}</div>
                        {line.threePlSku && (
                          <div className="text-xs text-gray-400">
                            {line.threePlSku}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900 w-24">
                        {line.qty.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {line.poNumber || line.orderRef || "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-xs truncate max-w-32">
                        {activeTab === "matched" ? (
                          line.invoiceId && line.invoiceNumber ? (
                            <Link
                              href={`/invoices/${line.invoiceId}`}
                              className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                            >
                              {line.invoiceNumber}
                            </Link>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )
                        ) : (
                          <span className="text-gray-400 font-mono">
                            {line.stordReceiptId || "\u2014"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Empty states */}
              {filteredLines.length === 0 && (
                <div className="p-12 text-center text-gray-400 text-sm">
                  {search ? (
                    `No results matching "${search}"`
                  ) : activeTab === "unmatched" ? (
                    "All caught up \u2014 no unmatched receipts."
                  ) : activeTab === "matched" ? (
                    "No matched receipts yet."
                  ) : (
                    "No excluded receipts."
                  )}
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

      {/* Link Invoice modal */}
      {linkModalOpen && (
        <LinkInvoiceModal
          receiptLineIds={Array.from(selectedIds)}
          receiptSummaries={selectedReceiptSummaries}
          onClose={() => setLinkModalOpen(false)}
          onSuccess={handleLinkSuccess}
        />
      )}

      {/* Floating action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl shadow-lg px-5 py-3">
            <span className="text-sm text-gray-500">
              {selectedIds.size} selected
            </span>
            <div className="w-px h-5 bg-gray-200" />
            {activeTab === "excluded" ? (
              <button
                onClick={handleRestore}
                disabled={actionLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                {actionLoading ? "Restoring..." : "Restore"}
              </button>
            ) : (
              <>
                <button
                  onClick={handleLinkInvoice}
                  disabled={actionLoading}
                  className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-gray-800 disabled:opacity-50"
                >
                  Link Invoice
                </button>
                <button
                  onClick={handleExclude}
                  disabled={actionLoading}
                  className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-gray-300 rounded-md hover:bg-red-50 hover:border-red-300 disabled:opacity-50"
                >
                  {actionLoading ? "Excluding..." : "Exclude"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
