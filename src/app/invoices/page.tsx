"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";

// --- Types ---

interface Invoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  supplier: string | null;
  poReference: string;
  invoiceAmount: number;
  matchStatus: string;
  paymentStatus: string;
  invoiceType: string;
  lineCount: number;
  linkedLineCount: number;
  skuSummary: string;
}

type Tab = "all" | "unpaid" | "paid";
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

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadInvoicesCsv(rows: Invoice[]) {
  const headers = [
    "Invoice #",
    "Invoice Type",
    "Payment Status",
    "Match Status",
    "Vendor",
    "PO Reference",
    "SKU Summary",
    "Invoice Date",
    "Due Date",
    "Amount",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      csvEscape(r.invoiceNumber),
      csvEscape(r.invoiceType),
      csvEscape(r.paymentStatus),
      csvEscape(r.matchStatus),
      csvEscape(r.supplier),
      csvEscape(r.poReference),
      csvEscape(r.skuSummary),
      csvEscape(r.invoiceDate),
      csvEscape(r.dueDate),
      csvEscape(r.invoiceAmount),
    ].join(","));
  }
  const csv = lines.join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().split("T")[0];
  a.href = url;
  a.download = `invoices-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const INVOICE_TYPE_COLORS: Record<string, string> = {
  Supplier: "bg-gray-100 text-gray-600",
  Packaging: "bg-warm-100 text-warm-700",
  Freight: "bg-blue-100 text-blue-700",
  Customs: "bg-orange-100 text-orange-700",
  "Work Order": "bg-gold-100 text-gold-700",
};

const paymentStatusColors: Record<string, string> = {
  Unpaid: "bg-gray-100 text-gray-600",
  Paid: "bg-sage-100 text-sage-700",
  Disputed: "bg-burgundy-100 text-burgundy-700",
};

// --- Main Page ---

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("invoiceDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/invoices");
      const data = await res.json();
      setInvoices(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch invoices:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredInvoices = useMemo(() => {
    let result = [...invoices];

    // Tab filter
    if (activeTab === "unpaid") {
      result = result.filter((i) => i.paymentStatus !== "Paid");
    } else if (activeTab === "paid") {
      result = result.filter((i) => i.paymentStatus === "Paid");
    }

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (i) =>
          i.invoiceNumber.toLowerCase().includes(q) ||
          (i.supplier || "").toLowerCase().includes(q) ||
          i.poReference.toLowerCase().includes(q) ||
          i.skuSummary.toLowerCase().includes(q)
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
  }, [invoices, activeTab, search, sortKey, sortDir]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const unpaid = invoices.filter((i) => i.paymentStatus !== "Paid");
    const totalUnpaid = unpaid.reduce((sum, i) => sum + i.invoiceAmount, 0);
    const pastDue = unpaid.filter((i) => i.dueDate && i.dueDate <= today);
    const totalPastDue = pastDue.reduce((sum, i) => sum + i.invoiceAmount, 0);
    return { totalUnpaid, totalPastDue, pastDueCount: pastDue.length };
  }, [invoices]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "invoiceAmount" ? "desc" : "asc");
    }
  };

  const unpaidCount = useMemo(() => invoices.filter((i) => i.paymentStatus !== "Paid").length, [invoices]);
  const paidCount = useMemo(() => invoices.filter((i) => i.paymentStatus === "Paid").length, [invoices]);

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "All", count: invoices.length },
    { key: "unpaid", label: "Unpaid", count: unpaidCount },
    { key: "paid", label: "Paid", count: paidCount },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
            <p className="text-sm text-gray-500 mt-1">{invoices.length} invoice{invoices.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadInvoicesCsv(filteredInvoices)}
              disabled={filteredInvoices.length === 0}
              className="border border-gray-300 bg-white text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Export CSV
            </button>
            <button
              onClick={() => router.push("/invoices/import")}
              className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
            >
              + Add Invoice
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        {!loading && invoices.length > 0 && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 px-6 py-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Unpaid</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{formatCurrency(summaryStats.totalUnpaid)}</p>
              <p className="text-sm text-gray-500 mt-1">{unpaidCount} invoice{unpaidCount !== 1 ? "s" : ""}</p>
            </div>
            <div className={`rounded-xl border px-6 py-5 ${summaryStats.pastDueCount > 0 ? "bg-burgundy-50 border-burgundy-200" : "bg-white border-gray-200"}`}>
              <p className={`text-xs font-semibold uppercase tracking-wider ${summaryStats.pastDueCount > 0 ? "text-burgundy-500" : "text-gray-400"}`}>Past Due</p>
              <p className={`text-3xl font-bold mt-1 ${summaryStats.pastDueCount > 0 ? "text-burgundy-700" : "text-gray-400"}`}>{formatCurrency(summaryStats.totalPastDue)}</p>
              <p className={`text-sm mt-1 ${summaryStats.pastDueCount > 0 ? "text-burgundy-500" : "text-gray-400"}`}>
                {summaryStats.pastDueCount} invoice{summaryStats.pastDueCount !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : invoices.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-4">No invoices yet.</p>
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

              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search by invoice #, vendor, PO, or SKU..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-md w-80 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
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
                    <SortableHeader label="Invoice #" sortKey="invoiceNumber" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[11%]" />
                    <SortableHeader label="Payment" sortKey="paymentStatus" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[8%]" />
                    <SortableHeader label="Vendor" sortKey="supplier" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[11%]" />
                    <SortableHeader label="PO Ref" sortKey="poReference" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[8%]" />
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-[18%]">SKU</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-[7%]">Receipt</th>
                    <SortableHeader label="Date" sortKey="invoiceDate" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[8%]" />
                    <SortableHeader label="Due" sortKey="dueDate" currentKey={sortKey} dir={sortDir} onSort={handleSort} className="w-[8%]" />
                    <SortableHeader label="Amount" sortKey="invoiceAmount" currentKey={sortKey} dir={sortDir} onSort={handleSort} align="right" className="w-[10%]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredInvoices.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => router.push(`/invoices/${invoice.id}`)}
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

                      {/* Payment Status */}
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentStatusColors[invoice.paymentStatus] || "bg-gray-100 text-gray-600"}`}>
                          {invoice.paymentStatus}
                        </span>
                      </td>

                      {/* Vendor */}
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {invoice.supplier || <span className="text-gray-300">&mdash;</span>}
                      </td>

                      {/* PO Ref */}
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {invoice.poReference || <span className="text-gray-300">&mdash;</span>}
                      </td>

                      {/* SKU */}
                      <td className="px-4 py-3 text-sm text-gray-600 truncate max-w-0">
                        {invoice.skuSummary ? (
                          <span title={invoice.skuSummary}>{invoice.skuSummary}</span>
                        ) : (
                          <span className="text-gray-300">&mdash;</span>
                        )}
                      </td>

                      {/* Receipt match coverage */}
                      <td className="px-4 py-3 text-center text-sm">
                        {invoice.lineCount === 0 ? (
                          <span className="text-gray-300">&mdash;</span>
                        ) : invoice.linkedLineCount === invoice.lineCount ? (
                          <span
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-sage-100 text-sage-700"
                            title={`All ${invoice.lineCount} lines linked to receipts`}
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </span>
                        ) : (
                          <span
                            className={`text-xs font-medium ${invoice.linkedLineCount === 0 ? "text-gray-400" : "text-gold-700"}`}
                            title={`${invoice.linkedLineCount} of ${invoice.lineCount} invoice lines linked to receipts`}
                          >
                            {invoice.linkedLineCount}/{invoice.lineCount}
                          </span>
                        )}
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
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredInvoices.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">
                  {search ? `No results matching "${search}"` : "No invoices in this view."}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
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
