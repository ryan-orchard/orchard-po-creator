"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Invoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  poReference: string;
  salesOrder: string;
  supplier: string | null;
  invoiceAmount: number;
  status: string;
  lineCount: number;
}

type SortField = "invoiceNumber" | "supplier" | "invoiceDate" | "poReference" | "salesOrder" | "status" | "lineCount" | "invoiceAmount";
type SortDir = "asc" | "desc";

const statusColors: Record<string, string> = {
  "Pending Review": "bg-yellow-100 text-yellow-800",
  Matched: "bg-blue-100 text-blue-800",
  Discrepancy: "bg-red-100 text-red-800",
  Paid: "bg-green-100 text-green-800",
};

const COLUMNS: { field: SortField; label: string; align: string }[] = [
  { field: "invoiceNumber", label: "Invoice #", align: "text-left" },
  { field: "supplier", label: "Supplier", align: "text-left" },
  { field: "invoiceDate", label: "Date", align: "text-left" },
  { field: "poReference", label: "PO Ref", align: "text-left" },
  { field: "salesOrder", label: "Sales Order", align: "text-left" },
  { field: "status", label: "Status", align: "text-left" },
  { field: "lineCount", label: "Lines", align: "text-right" },
  { field: "invoiceAmount", label: "Amount", align: "text-right" },
];

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>("invoiceDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/invoices")
      .then((res) => res.json())
      .then((data) => {
        setInvoices(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "invoiceAmount" || field === "invoiceDate" || field === "lineCount" ? "desc" : "asc");
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const q = search.toLowerCase();
    return invoices.filter((inv) =>
      inv.invoiceNumber.toLowerCase().includes(q) ||
      (inv.supplier || "").toLowerCase().includes(q) ||
      inv.poReference.toLowerCase().includes(q) ||
      inv.salesOrder.toLowerCase().includes(q) ||
      inv.status.toLowerCase().includes(q)
    );
  }, [invoices, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "invoiceNumber":
          cmp = a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true });
          break;
        case "supplier":
          cmp = (a.supplier || "").localeCompare(b.supplier || "");
          break;
        case "invoiceDate":
          cmp = (a.invoiceDate || "").localeCompare(b.invoiceDate || "");
          break;
        case "poReference":
          cmp = a.poReference.localeCompare(b.poReference, undefined, { numeric: true });
          break;
        case "salesOrder":
          cmp = a.salesOrder.localeCompare(b.salesOrder, undefined, { numeric: true });
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "lineCount":
          cmp = (a.lineCount || 0) - (b.lineCount || 0);
          break;
        case "invoiceAmount":
          cmp = (a.invoiceAmount || 0) - (b.invoiceAmount || 0);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
            <p className="text-sm text-gray-500 mt-1">
              {invoices.length} {invoices.length === 1 ? "invoice" : "invoices"}
            </p>
          </div>
          <Link
            href="/invoices/import"
            className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
          >
            + Import Invoice
          </Link>
        </div>

        {/* Search */}
        {!loading && invoices.length > 0 && (
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search invoices..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-sm px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
            />
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-400">Loading invoices...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && invoices.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-300 mb-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
            <p className="text-gray-500 mb-4">No invoices yet</p>
            <Link
              href="/invoices/import"
              className="text-gray-900 font-medium hover:underline text-sm"
            >
              Import your first invoice
            </Link>
          </div>
        )}

        {/* Invoices Table */}
        {!loading && invoices.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {COLUMNS.map((col) => (
                    <th
                      key={col.field}
                      onClick={() => handleSort(col.field)}
                      className={`${col.align} px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none`}
                    >
                      {col.label}
                      {sortField === col.field && (
                        <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => router.push(`/invoices/${inv.id}`)}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono font-medium text-gray-900">
                      {inv.invoiceNumber}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {inv.supplier || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {inv.invoiceDate
                        ? new Date(inv.invoiceDate + "T00:00:00").toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-600 text-xs">
                      {inv.poReference || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-600 text-xs">
                      {inv.salesOrder || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          statusColors[inv.status] || "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {inv.lineCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-gray-900">
                      {inv.invoiceAmount
                        ? inv.invoiceAmount.toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                          })
                        : "—"}
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && search && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      No invoices match &ldquo;{search}&rdquo;
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
