"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";

// --- Types ---

interface ComparisonLine {
  skuName: string;
  invoiceQty: number;
  receiptQty: number;
  qtyMatch: boolean;
  invoiceUnitCost: number;
  poUnitCost: number;
  priceMatch: boolean;
}

interface InvoiceMatch {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplier: string;
  poReference: string;
  invoiceAmount: number;
  matchStatus: "open" | "matched" | "discrepancy";
  paymentStatus: string;
  lineCount: number;
  po: { poId: string; poNumber: string; status: string } | null;
  suggestedReceipt: {
    receiptId: string;
    receiptNumber: string;
    receivedDate: string;
  } | null;
  matchedReceipt: {
    receiptId: string;
    receiptNumber: string;
  } | null;
  comparison: {
    receiptId: string;
    lines: ComparisonLine[];
    allPass: boolean;
    discrepancyCount: number;
  } | null;
  flags: string[];
}

type Tab = "open" | "matched" | "discrepancy" | "paid";

type SortKey = "invoiceNumber" | "invoiceDate" | "poReference" | "invoiceAmount" | "paymentStatus";
type SortDir = "asc" | "desc";

// --- Helpers ---

function formatDate(d: string) {
  if (!d) return "\u2014";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

function formatCurrency(n: number) {
  if (!n) return "\u2014";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const paymentStatusColors: Record<string, string> = {
  Unpaid: "bg-gray-100 text-gray-600",
  Paid: "bg-green-100 text-green-700",
  Disputed: "bg-orange-100 text-orange-700",
};

// --- Main Page ---

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceMatch[]>([]);
  const [counts, setCounts] = useState({
    open: 0,
    matched: 0,
    discrepancy: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("open");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [unmatching, setUnmatching] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("invoiceDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/invoices/matching");
      const data = await res.json();
      setInvoices(data.invoices || []);
      setCounts(data.counts || { open: 0, matched: 0, discrepancy: 0 });
    } catch (err) {
      console.error("Failed to fetch invoice matching data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredInvoices = useMemo(() => {
    let result: InvoiceMatch[];
    if (activeTab === "paid") {
      result = invoices.filter((i) => i.paymentStatus === "Paid");
    } else if (activeTab === "open") {
      result = invoices.filter(
        (i) => i.matchStatus === "open" && i.paymentStatus !== "Paid"
      );
    } else {
      result = invoices.filter((i) => i.matchStatus === activeTab);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (i) =>
          i.invoiceNumber.toLowerCase().includes(q) ||
          i.poReference.toLowerCase().includes(q) ||
          i.po?.poNumber.toLowerCase().includes(q) ||
          i.matchedReceipt?.receiptNumber.toLowerCase().includes(q) ||
          i.suggestedReceipt?.receiptNumber.toLowerCase().includes(q)
      );
    }
    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "invoiceNumber":
          cmp = a.invoiceNumber.localeCompare(b.invoiceNumber);
          break;
        case "invoiceDate":
          cmp = a.invoiceDate.localeCompare(b.invoiceDate);
          break;
        case "poReference":
          cmp = (a.poReference || "").localeCompare(b.poReference || "");
          break;
        case "invoiceAmount":
          cmp = a.invoiceAmount - b.invoiceAmount;
          break;
        case "paymentStatus":
          cmp = (a.paymentStatus || "").localeCompare(b.paymentStatus || "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [invoices, activeTab, search, sortKey, sortDir]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const unpaidInvoices = invoices.filter((i) => i.paymentStatus !== "Paid");
    const totalUnpaid = unpaidInvoices.reduce(
      (sum, i) => sum + i.invoiceAmount,
      0
    );
    const readyToPay = unpaidInvoices.filter(
      (i) => i.matchStatus === "matched"
    );
    const totalReadyToPay = readyToPay.reduce(
      (sum, i) => sum + i.invoiceAmount,
      0
    );
    const needsReview = invoices.filter(
      (i) =>
        i.matchStatus === "discrepancy" ||
        (i.matchStatus === "open" && i.paymentStatus !== "Paid")
    );
    const totalNeedsReview = needsReview.reduce(
      (sum, i) => sum + i.invoiceAmount,
      0
    );
    return { totalUnpaid, totalReadyToPay, totalNeedsReview };
  }, [invoices]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "invoiceAmount" ? "desc" : "asc");
    }
  };

  const paidCount = useMemo(
    () => invoices.filter((i) => i.paymentStatus === "Paid").length,
    [invoices]
  );

  const openCount = useMemo(
    () =>
      invoices.filter(
        (i) => i.matchStatus === "open" && i.paymentStatus !== "Paid"
      ).length,
    [invoices]
  );

  const handleUnmatch = async (invoiceId: string) => {
    setUnmatching(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/unmatch`, {
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

  const handleRowClick = (invoice: InvoiceMatch) => {
    if (activeTab === "matched" || activeTab === "paid") {
      // Toggle inline expansion for matched/paid invoices
      setExpandedId(expandedId === invoice.id ? null : invoice.id);
    } else {
      // Navigate to three-panel match view for open and discrepancy
      router.push(`/invoices/${invoice.id}/match`);
    }
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "open", label: "Open", count: openCount },
    { key: "matched", label: "Matched", count: counts.matched },
    { key: "discrepancy", label: "Discrepancy", count: counts.discrepancy },
    { key: "paid", label: "Paid", count: paidCount },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
            <p className="text-sm text-gray-500 mt-1">
              Match invoices to receipts &mdash; verify qty and price
            </p>
          </div>
          <button
            onClick={() => router.push("/invoices/import")}
            className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
          >
            + Import Invoice
          </button>
        </div>

        {/* Summary Cards */}
        {!loading && invoices.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-gray-200 px-5 py-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total Unpaid
              </p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {formatCurrency(summaryStats.totalUnpaid)}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 px-5 py-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Ready to Pay
              </p>
              <p className="text-2xl font-bold text-green-700 mt-1">
                {formatCurrency(summaryStats.totalReadyToPay)}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 px-5 py-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Needs Review
              </p>
              <p className="text-2xl font-bold text-amber-600 mt-1">
                {formatCurrency(summaryStats.totalNeedsReview)}
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : invoices.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-4">No invoices yet.</p>
            <p className="text-sm text-gray-400 mb-4">
              Import ANS invoices from the Import page.
            </p>
            <button
              onClick={() => router.push("/invoices/import")}
              className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
            >
              Import Invoice
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
                      setExpandedId(null);
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
                  placeholder="Search by invoice #, PO, or receipt..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-md w-72 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    <SortableHeader label="Invoice #" sortKey="invoiceNumber" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[18%]" />
                    <SortableHeader label="Date" sortKey="invoiceDate" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[10%]" />
                    <SortableHeader label="PO Ref" sortKey="poReference" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[14%]" />
                    <SortableHeader label="Amount" sortKey="invoiceAmount" currentKey={sortKey} dir={sortDir} onSort={handleSort} align="right" className="w-[14%]" />
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-[18%]">
                      Review Status
                    </th>
                    <SortableHeader label="Payment" sortKey="paymentStatus" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[12%]" />
                    <th className="px-4 py-3 w-[14%]"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredInvoices.map((invoice) => (
                    <InvoiceRow
                      key={invoice.id}
                      invoice={invoice}
                      isExpanded={expandedId === invoice.id}
                      activeTab={activeTab}
                      onClick={() => handleRowClick(invoice)}
                      onToggleExpand={() =>
                        setExpandedId(
                          expandedId === invoice.id ? null : invoice.id
                        )
                      }
                      isUnmatching={unmatching === invoice.id}
                      onUnmatch={() => handleUnmatch(invoice.id)}
                    />
                  ))}
                </tbody>
              </table>

              {filteredInvoices.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">
                  {search
                    ? `No results matching "${search}"`
                    : activeTab === "open"
                    ? "All invoices have been actioned!"
                    : activeTab === "discrepancy"
                    ? "No invoices with discrepancies."
                    : activeTab === "paid"
                    ? "No paid invoices yet."
                    : "No matched invoices yet."}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Invoice Row ---

function InvoiceRow({
  invoice,
  isExpanded,
  activeTab,
  onClick,
  onToggleExpand,
  isUnmatching,
  onUnmatch,
}: {
  invoice: InvoiceMatch;
  isExpanded: boolean;
  activeTab: Tab;
  onClick: () => void;
  onToggleExpand: () => void;
  isUnmatching: boolean;
  onUnmatch: () => void;
}) {
  return (
    <>
      <tr
        className={`cursor-pointer transition-colors ${
          isExpanded ? "bg-blue-50" : "hover:bg-gray-50"
        }`}
        onClick={onClick}
      >
        <td className="px-4 py-3">
          <div className="font-medium text-gray-900">
            {invoice.invoiceNumber}
          </div>
          {invoice.supplier && (
            <div className="text-xs text-gray-400">{invoice.supplier}</div>
          )}
        </td>
        <td className="px-4 py-3 text-gray-600">
          {formatDate(invoice.invoiceDate)}
        </td>
        <td className="px-4 py-3">
          {invoice.poReference ? (
            <span className="text-gray-700">
              {invoice.poReference}
            </span>
          ) : (
            <span className="text-gray-300 text-xs">No ref</span>
          )}
        </td>
        <td className="px-4 py-3 text-right font-medium text-gray-900">
          {formatCurrency(invoice.invoiceAmount)}
        </td>

        {/* Status / Receipt column */}
        <td className="px-4 py-3">
          {(activeTab === "matched" || activeTab === "discrepancy") &&
          invoice.matchedReceipt ? (
            <span
              className={`font-medium ${
                activeTab === "matched" ? "text-green-700" : "text-amber-700"
              }`}
            >
              {invoice.matchedReceipt.receiptNumber}
            </span>
          ) : invoice.flags.length > 0 ? (
            <span className="text-amber-600 text-xs font-medium">
              {invoice.flags[0]}
            </span>
          ) : invoice.suggestedReceipt ? (
            <span className="text-xs text-gray-500">
              Suggested: {invoice.suggestedReceipt.receiptNumber}
            </span>
          ) : (
            <span className="text-gray-300 text-xs">No match found</span>
          )}
        </td>

        {/* Payment Status */}
        <td className="px-4 py-3">
          {invoice.paymentStatus ? (
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                paymentStatusColors[invoice.paymentStatus] ||
                "bg-gray-100 text-gray-600"
              }`}
            >
              {invoice.paymentStatus}
            </span>
          ) : (
            <span className="text-gray-300 text-xs">&mdash;</span>
          )}
        </td>

        {/* Action */}
        <td className="px-4 py-3 text-right">
          {activeTab === "open" && (
            <span className="text-xs text-blue-600 font-medium">
              Review &rarr;
            </span>
          )}
          {activeTab === "discrepancy" && (
            <span className="text-xs text-amber-600 font-medium">
              Review &rarr;
            </span>
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
          {activeTab === "paid" && (
            <span className="text-xs text-gray-400">Paid</span>
          )}
        </td>
      </tr>

      {/* Expanded panel — Matched tab only (read-only comparison) */}
      {isExpanded && activeTab === "matched" && invoice.comparison && (
        <tr>
          <td colSpan={7} className="p-0">
            <div className="bg-gray-50 border-t border-gray-200 px-6 py-5">
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-900">
                    {invoice.po?.poNumber}
                  </span>
                  <span className="text-gray-300">&middot;</span>
                  <span className="text-sm text-gray-500">
                    {invoice.matchedReceipt?.receiptNumber}
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
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
                </button>
              </div>
              <ComparisonTable lines={invoice.comparison.lines} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// --- Sortable Header ---

function SortableHeader({
  label,
  sortKey,
  currentKey,
  dir,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const isActive = currentKey === sortKey;
  return (
    <th
      className={`text-${align} px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (
          <span className="text-gray-400">
            {dir === "asc" ? "\u2191" : "\u2193"}
          </span>
        )}
      </span>
    </th>
  );
}

// --- Comparison Table (read-only, for matched inline expansion) ---

function ComparisonTable({ lines }: { lines: ComparisonLine[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-100">
          <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            SKU
          </th>
          <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
            Invoice Qty
          </th>
          <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
            Receipt Qty
          </th>
          <th className="text-center px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider w-16">
            Qty
          </th>
          <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
            Invoice Price
          </th>
          <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
            PO Price
          </th>
          <th className="text-center px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider w-16">
            Price
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {lines.map((line, idx) => (
          <tr key={idx}>
            <td className="px-4 py-2.5">
              <span className="text-xs font-medium text-gray-900">
                {line.skuName}
              </span>
            </td>
            <td className="px-4 py-2.5 text-right text-gray-900">
              {line.invoiceQty.toLocaleString()}
            </td>
            <td className="px-4 py-2.5 text-right text-gray-600">
              {line.receiptQty > 0 ? (
                line.receiptQty.toLocaleString()
              ) : (
                <span className="text-gray-300">0</span>
              )}
            </td>
            <td className="px-4 py-2.5 text-center">
              {line.qtyMatch ? (
                <span className="text-green-600 font-medium text-xs">
                  &#10003;
                </span>
              ) : (
                <span className="text-amber-600 text-xs font-medium">
                  {line.invoiceQty - line.receiptQty > 0 ? "+" : ""}
                  {(line.invoiceQty - line.receiptQty).toLocaleString()}
                </span>
              )}
            </td>
            <td className="px-4 py-2.5 text-right text-gray-900 text-xs">
              {formatCurrency(line.invoiceUnitCost)}
            </td>
            <td className="px-4 py-2.5 text-right text-gray-600 text-xs">
              {line.poUnitCost > 0 ? (
                formatCurrency(line.poUnitCost)
              ) : (
                <span className="text-gray-300">&mdash;</span>
              )}
            </td>
            <td className="px-4 py-2.5 text-center">
              {line.poUnitCost === 0 ? (
                <span className="text-gray-300">&mdash;</span>
              ) : line.priceMatch ? (
                <span className="text-green-600 font-medium text-xs">
                  &#10003;
                </span>
              ) : (
                <span className="text-amber-600 text-xs font-medium">
                  $
                  {Math.abs(line.invoiceUnitCost - line.poUnitCost).toFixed(2)}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
