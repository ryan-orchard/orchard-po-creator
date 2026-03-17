"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Invoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  poReference: string;
  supplier: string | null;
  invoiceAmount: number;
  status: string;
  lineCount: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/invoices")
      .then((r) => r.json())
      .then((data) => {
        setInvoices(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const pending = invoices.filter((i) => i.status === "Pending Review");
  const matched = invoices.filter((i) => i.status === "Matched");
  const discrepancy = invoices.filter((i) => i.status === "Discrepancy");
  const paid = invoices.filter((i) => i.status === "Paid");
  const pendingValue = pending.reduce((s, i) => s + (i.invoiceAmount || 0), 0);
  const totalValue = invoices.reduce((s, i) => s + (i.invoiceAmount || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Audit overview and action items</p>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="bg-gray-900 text-white rounded-lg px-5 py-5">
                <p className="text-xs font-medium uppercase tracking-wider opacity-70">Total Invoices</p>
                <p className="text-3xl font-bold mt-1 tabular-nums">{invoices.length}</p>
                <p className="text-xs opacity-50 mt-1">
                  {totalValue.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                </p>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-5 py-5">
                <p className="text-xs font-medium uppercase tracking-wider text-yellow-700">Pending Review</p>
                <p className="text-3xl font-bold mt-1 tabular-nums text-yellow-900">{pending.length}</p>
                <p className="text-xs text-yellow-600 mt-1">
                  {pendingValue.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                </p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-5">
                <p className="text-xs font-medium uppercase tracking-wider text-blue-700">Ready to Pay</p>
                <p className="text-3xl font-bold mt-1 tabular-nums text-blue-900">{matched.length}</p>
                <p className="text-xs text-blue-600 mt-1">Passed all checks</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg px-5 py-5">
                <p className="text-xs font-medium uppercase tracking-wider text-green-700">Paid</p>
                <p className="text-3xl font-bold mt-1 tabular-nums text-green-900">{paid.length}</p>
                <p className="text-xs text-green-600 mt-1">Complete</p>
              </div>
            </div>

            {/* Invoice Review */}
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Invoice Review</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {/* Invoice Match — Action */}
              <button
                onClick={() => {}}
                className="bg-white rounded-lg border-2 border-gray-900 p-5 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-yellow-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Invoice Match</p>
                      <p className="text-xs text-gray-500">Match invoices to POs and receipts</p>
                    </div>
                  </div>
                  {pending.length > 0 && (
                    <span className="bg-yellow-100 text-yellow-800 text-xs font-bold px-2.5 py-1 rounded-full tabular-nums">
                      {pending.length}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 italic">Coming soon</p>
              </button>

              {/* Stord Invoice Audit — Action */}
              <button
                onClick={() => {}}
                className="bg-white rounded-lg border border-gray-200 p-5 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Stord Invoice Audit</p>
                      <p className="text-xs text-gray-500">3PL charges vs actual activity</p>
                    </div>
                  </div>
                  {pending.length > 0 && (
                    <span className="bg-purple-100 text-purple-800 text-xs font-bold px-2.5 py-1 rounded-full tabular-nums">
                      {pending.length}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 italic">Coming soon</p>
              </button>
            </div>

            {/* Match Outcomes */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Ready to Pay</p>
                    <p className="text-xs text-gray-500">Passed all checks</p>
                  </div>
                </div>
                <span className="text-lg font-bold tabular-nums text-green-700">{matched.length}</span>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Resolve Discrepancy</p>
                    <p className="text-xs text-gray-500">Needs manual review</p>
                  </div>
                </div>
                <span className="text-lg font-bold tabular-nums text-red-700">{discrepancy.length}</span>
              </div>
            </div>

            {/* Invoices Pending Audit */}
            {pending.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">Invoices Pending Review</h2>
                  <button
                    onClick={() => router.push("/invoices")}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    View all →
                  </button>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Invoice #</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Supplier</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">PO Ref</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.slice(0, 10).map((inv) => (
                      <tr
                        key={inv.id}
                        onClick={() => router.push(`/invoices/${inv.id}`)}
                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-4 py-2.5 font-mono font-semibold text-gray-900">{inv.invoiceNumber}</td>
                        <td className="px-4 py-2.5 text-gray-600">{inv.supplier || "—"}</td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {inv.invoiceDate
                            ? new Date(inv.invoiceDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-gray-600 text-xs">{inv.poReference || "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-medium text-gray-900">
                          {inv.invoiceAmount
                            ? inv.invoiceAmount.toLocaleString("en-US", { style: "currency", currency: "USD" })
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
