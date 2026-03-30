"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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

const INVOICE_TYPE_COLORS: Record<string, string> = {
  Supplier: "bg-gray-100 text-gray-600",
  Packaging: "bg-warm-100 text-warm-700",
  Freight: "bg-blue-100 text-blue-700",
  Customs: "bg-orange-100 text-orange-700",
  "Work Order": "bg-gold-100 text-gold-700",
};

interface InvoiceMatch {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  supplier: string;
  poReference: string;
  invoiceAmount: number;
  matchStatus: "open" | "pending-receipt" | "discrepancy" | "approved";
  paymentStatus: string;
  invoiceType: string;
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

type Tab = "needs-action" | "discrepancy" | "complete" | "paid";

type CardFilter = "all-unpaid" | "past-due" | "upcoming" | "ready-to-pay" | null;
type SortKey = "invoiceNumber" | "supplier" | "invoiceDate" | "dueDate" | "poReference" | "invoiceAmount" | "paymentStatus";
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
  Paid: "bg-sage-100 text-sage-700",
  Disputed: "bg-burgundy-100 text-burgundy-700",
};

// --- Main Page ---

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceMatch[]>([]);
  const [counts, setCounts] = useState({
    open: 0,
    pendingReceipt: 0,
    discrepancy: 0,
    approved: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("needs-action");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [unmatching, setUnmatching] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("invoiceDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [cardFilter, setCardFilter] = useState<CardFilter>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/invoices/matching");
      const data = await res.json();
      setInvoices(data.invoices || []);
      setCounts(data.counts || { open: 0, pendingReceipt: 0, discrepancy: 0, approved: 0 });
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
    const today = new Date().toISOString().split("T")[0];
    let result: InvoiceMatch[];

    if (cardFilter) {
      switch (cardFilter) {
        case "all-unpaid":
          result = invoices.filter((i) => i.paymentStatus !== "Paid");
          break;
        case "past-due":
          result = invoices.filter((i) => i.paymentStatus !== "Paid" && i.dueDate && i.dueDate <= today);
          break;
        case "upcoming":
          result = invoices.filter((i) => i.paymentStatus !== "Paid" && i.dueDate && i.dueDate > today);
          break;
        case "ready-to-pay":
          result = invoices.filter((i) => i.matchStatus === "approved" && i.paymentStatus !== "Paid");
          break;
        default:
          result = [...invoices];
      }
    } else if (activeTab === "paid") {
      result = invoices.filter((i) => i.paymentStatus === "Paid");
    } else if (activeTab === "needs-action") {
      result = invoices.filter((i) => (i.matchStatus === "open" || i.matchStatus === "pending-receipt") && i.paymentStatus !== "Paid");
    } else if (activeTab === "discrepancy") {
      result = invoices.filter((i) => i.matchStatus === "discrepancy");
    } else if (activeTab === "complete") {
      result = invoices.filter((i) => i.matchStatus === "approved" && i.paymentStatus !== "Paid");
    } else {
      result = [...invoices];
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
        case "supplier":
          cmp = (a.supplier || "").localeCompare(b.supplier || "");
          break;
        case "invoiceDate":
          cmp = a.invoiceDate.localeCompare(b.invoiceDate);
          break;
        case "dueDate":
          cmp = (a.dueDate || "").localeCompare(b.dueDate || "");
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
  }, [invoices, activeTab, cardFilter, search, sortKey, sortDir]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const unpaidInvoices = invoices.filter((i) => i.paymentStatus !== "Paid");
    const totalUnpaid = unpaidInvoices.reduce(
      (sum, i) => sum + i.invoiceAmount,
      0
    );
    const readyToPay = unpaidInvoices.filter(
      (i) => i.matchStatus === "approved"
    );
    const totalReadyToPay = readyToPay.reduce(
      (sum, i) => sum + i.invoiceAmount,
      0
    );
    const pastDue = unpaidInvoices.filter(
      (i) => i.dueDate && i.dueDate <= today
    );
    const totalPastDue = pastDue.reduce(
      (sum, i) => sum + i.invoiceAmount,
      0
    );
    const upcoming = unpaidInvoices.filter(
      (i) => i.dueDate && i.dueDate > today
    );
    const totalUpcoming = upcoming.reduce(
      (sum, i) => sum + i.invoiceAmount,
      0
    );
    return {
      totalUnpaid,
      totalReadyToPay,
      totalPastDue,
      pastDueCount: pastDue.length,
      totalUpcoming,
      upcomingCount: upcoming.length,
    };
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

  const needsActionCount = useMemo(
    () => invoices.filter((i) => (i.matchStatus === "open" || i.matchStatus === "pending-receipt") && i.paymentStatus !== "Paid").length,
    [invoices]
  );

  const completeCount = useMemo(
    () => invoices.filter((i) => i.matchStatus === "approved" && i.paymentStatus !== "Paid").length,
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
    router.push(`/invoices/${invoice.id}`);
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "needs-action", label: "Needs Action", count: needsActionCount },
    { key: "discrepancy", label: "Discrepancy", count: counts.discrepancy },
    { key: "complete", label: "Complete", count: completeCount },
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
            + Add Invoice
          </button>
        </div>

        {/* Summary Cards */}
        {!loading && invoices.length > 0 && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <button
              onClick={() => setCardFilter(cardFilter === "all-unpaid" ? null : "all-unpaid")}
              className={`text-left rounded-lg border px-5 py-4 transition-colors ${cardFilter === "all-unpaid" ? "bg-gray-900 border-gray-900" : "bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50"}`}
            >
              <p className={`text-xs font-medium uppercase tracking-wider ${cardFilter === "all-unpaid" ? "text-gray-400" : "text-gray-500"}`}>
                Total Unpaid
              </p>
              <p className={`text-2xl font-bold mt-1 ${cardFilter === "all-unpaid" ? "text-white" : "text-gray-900"}`}>
                {formatCurrency(summaryStats.totalUnpaid)}
              </p>
            </button>
            <button
              onClick={() => setCardFilter(cardFilter === "past-due" ? null : "past-due")}
              className={`text-left rounded-lg border px-5 py-4 transition-colors ${cardFilter === "past-due" ? "bg-burgundy-600 border-burgundy-600" : "bg-white border-burgundy-200 hover:border-burgundy-300 hover:bg-burgundy-50"}`}
            >
              <p className={`text-xs font-medium uppercase tracking-wider ${cardFilter === "past-due" ? "text-burgundy-200" : "text-burgundy-500"}`}>
                Past Due
              </p>
              <p className={`text-2xl font-bold mt-1 ${cardFilter === "past-due" ? "text-white" : "text-burgundy-600"}`}>
                {formatCurrency(summaryStats.totalPastDue)}
              </p>
              <p className={`text-xs mt-0.5 ${cardFilter === "past-due" ? "text-burgundy-200" : "text-burgundy-300"}`}>
                {summaryStats.pastDueCount} invoice{summaryStats.pastDueCount !== 1 ? "s" : ""}
              </p>
            </button>
            <button
              onClick={() => setCardFilter(cardFilter === "upcoming" ? null : "upcoming")}
              className={`text-left rounded-lg border px-5 py-4 transition-colors ${cardFilter === "upcoming" ? "bg-warm-600 border-warm-600" : "bg-white border-gray-200 hover:border-warm-300 hover:bg-warm-50"}`}
            >
              <p className={`text-xs font-medium uppercase tracking-wider ${cardFilter === "upcoming" ? "text-warm-200" : "text-gray-500"}`}>
                Upcoming
              </p>
              <p className={`text-2xl font-bold mt-1 ${cardFilter === "upcoming" ? "text-white" : "text-warm-600"}`}>
                {formatCurrency(summaryStats.totalUpcoming)}
              </p>
              <p className={`text-xs mt-0.5 ${cardFilter === "upcoming" ? "text-warm-200" : "text-gray-400"}`}>
                {summaryStats.upcomingCount} invoice{summaryStats.upcomingCount !== 1 ? "s" : ""}
              </p>
            </button>
            <button
              onClick={() => setCardFilter(cardFilter === "ready-to-pay" ? null : "ready-to-pay")}
              className={`text-left rounded-lg border px-5 py-4 transition-colors ${cardFilter === "ready-to-pay" ? "bg-sage-700 border-sage-700" : "bg-white border-gray-200 hover:border-sage-300 hover:bg-sage-50"}`}
            >
              <p className={`text-xs font-medium uppercase tracking-wider ${cardFilter === "ready-to-pay" ? "text-sage-200" : "text-gray-500"}`}>
                Ready to Pay
              </p>
              <p className={`text-2xl font-bold mt-1 ${cardFilter === "ready-to-pay" ? "text-white" : "text-sage-700"}`}>
                {formatCurrency(summaryStats.totalReadyToPay)}
              </p>
            </button>
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
                      setCardFilter(null);
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

            {/* Card filter label */}
            {cardFilter && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm text-gray-600">
                  Showing:{" "}
                  <span className="font-medium text-gray-900">
                    {cardFilter === "all-unpaid" && "All Unpaid"}
                    {cardFilter === "past-due" && "Past Due"}
                    {cardFilter === "upcoming" && "Upcoming"}
                    {cardFilter === "ready-to-pay" && "Ready to Pay"}
                  </span>
                </span>
                <button
                  onClick={() => setCardFilter(null)}
                  className="text-xs text-gray-400 hover:text-gray-600 underline"
                >
                  Clear
                </button>
              </div>
            )}

            {/* Table */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <SortableHeader label="Invoice #" sortKey="invoiceNumber" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[13%]" />
                    <SortableHeader label="Payment" sortKey="paymentStatus" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[9%]" />
                    <SortableHeader label="Vendor" sortKey="supplier" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[16%]" />
                    <SortableHeader label="Date" sortKey="invoiceDate" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[8%]" />
                    <SortableHeader label="Due" sortKey="dueDate" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[8%]" />
                    <SortableHeader label="Amount" sortKey="invoiceAmount" currentKey={sortKey} dir={sortDir} onSort={handleSort} align="right" className="w-[10%]" />
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-[8%]">Price</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-[8%]">Receipt</th>
                    <th className="px-4 py-3 w-[8%]"></th>
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
                    : activeTab === "needs-action"
                    ? "All invoices have been actioned."
                    : activeTab === "discrepancy"
                    ? "No invoices with discrepancies."
                    : activeTab === "complete"
                    ? "No completed invoices yet."
                    : activeTab === "paid"
                    ? "No paid invoices yet."
                    : ""}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Invoice Check Helpers ---

function getChecks(invoice: InvoiceMatch) {
  const hasPriceIssue = invoice.comparison?.lines.some((l) => !l.priceMatch) ?? false;
  const priceValidated = invoice.matchStatus === "approved" || invoice.matchStatus === "discrepancy";
  return {
    priceOk: priceValidated && !hasPriceIssue,
    priceFlag: hasPriceIssue,
    receiptLinked: invoice.matchedReceipt !== null,
  };
}

function CheckIcon({ ok, flag }: { ok: boolean; flag?: boolean }) {
  if (flag) {
    return (
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-warm-100">
        <svg className="w-3.5 h-3.5 text-warm-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    );
  }
  if (ok) {
    return (
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-sage-100">
        <svg className="w-3.5 h-3.5 text-sage-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100">
      <span className="w-2.5 h-0.5 bg-gray-300 rounded-full block" />
    </span>
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
  activeTab: "needs-action" | "discrepancy" | "complete" | "paid";
  onClick: () => void;
  onToggleExpand: () => void;
  isUnmatching: boolean;
  onUnmatch: () => void;
}) {
  return (
    <>
      <tr
        className={`cursor-pointer transition-colors ${
          isExpanded ? "bg-gold-50" : "hover:bg-gray-50"
        }`}
        onClick={onClick}
      >
        {/* Invoice # + type badge */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-gray-900 text-sm">
              {invoice.invoiceNumber}
            </span>
            {invoice.invoiceType && invoice.invoiceType !== "Supplier" && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${INVOICE_TYPE_COLORS[invoice.invoiceType] || "bg-gray-100 text-gray-600"}`}>
                {invoice.invoiceType}
              </span>
            )}
          </div>
        </td>

        {/* Payment Status — moved next to Invoice # */}
        <td className="px-4 py-3">
          {invoice.paymentStatus ? (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentStatusColors[invoice.paymentStatus] || "bg-gray-100 text-gray-600"}`}>
              {invoice.paymentStatus}
            </span>
          ) : (
            <span className="text-gray-300 text-xs">&mdash;</span>
          )}
        </td>

        {/* Vendor */}
        <td className="px-4 py-3 text-sm text-gray-600">
          {invoice.supplier || <span className="text-gray-300">&mdash;</span>}
        </td>

        {/* Date */}
        <td className="px-4 py-3 text-sm text-gray-500">
          {formatDate(invoice.invoiceDate)}
        </td>

        {/* Due */}
        <td className="px-4 py-3 text-sm">
          {invoice.dueDate ? (
            <span className={
              invoice.paymentStatus !== "Paid" &&
              invoice.dueDate < new Date().toISOString().split("T")[0]
                ? "text-burgundy-600 font-semibold"
                : "text-gray-500"
            }>
              {formatDate(invoice.dueDate)}
            </span>
          ) : (
            <span className="text-gray-300">&mdash;</span>
          )}
        </td>

        {/* Amount */}
        <td className="px-4 py-3 text-right font-semibold text-gray-900 text-sm">
          {formatCurrency(invoice.invoiceAmount)}
        </td>

        {/* Price check + Receipt check */}
        {(() => { const c = getChecks(invoice); return (
          <>
            <td className="px-4 py-3 text-center">
              <div className="flex justify-center">
                <CheckIcon ok={c.priceOk} flag={c.priceFlag} />
              </div>
            </td>
            <td className="px-4 py-3 text-center">
              <div className="flex justify-center">
                <CheckIcon ok={c.receiptLinked} />
              </div>
            </td>
          </>
        ); })()}

        {/* Action */}
        <td className="px-4 py-3 text-right">
          {activeTab === "needs-action" && (
            <Link
              href={`/match?invoiceId=${invoice.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-gold-600 font-medium hover:text-gold-700"
            >
              Match &rarr;
            </Link>
          )}
          {activeTab === "discrepancy" && (
            <Link
              href={`/match?invoiceId=${invoice.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-warm-600 font-medium hover:text-warm-700"
            >
              Resolve &rarr;
            </Link>
          )}
          {activeTab === "complete" && (
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

      {/* Expanded panel — Complete/Paid tab only (read-only comparison) */}
      {isExpanded && (activeTab === "complete" || activeTab === "paid") && invoice.comparison && (
        <tr>
          <td colSpan={9} className="p-0">
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
                <span className="text-sage-600 font-medium text-xs">
                  &#10003;
                </span>
              ) : (
                <span className="text-warm-600 text-xs font-medium">
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
                <span className="text-sage-600 font-medium text-xs">
                  &#10003;
                </span>
              ) : (
                <span className="text-warm-600 text-xs font-medium">
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
