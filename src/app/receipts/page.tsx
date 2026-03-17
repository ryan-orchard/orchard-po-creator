"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

interface ReceiptLine {
  id: string;
  sku: string | null;
  skuId: string | null;
  qtyReceived: number;
  qtyExpected: number | null;
  threePlSku: string;
  lotNumber: string;
}

interface Receipt {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  purchaseOrder: string | null;
  purchaseOrderId: string | null;
  warehouse: string | null;
  externalReceiptId: string;
  lines: ReceiptLine[];
}

type Tab = "all" | "unmatched" | "matched";

export default function ReceiptsListPage() {
  const router = useRouter();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/receipts")
      .then((r) => r.json())
      .then((data) => {
        setReceipts(data);
        setLoading(false);
      });
  }, []);

  const unmatchedCount = receipts.filter((r) => !r.purchaseOrder).length;
  const matchedCount = receipts.filter((r) => !!r.purchaseOrder).length;

  const filteredReceipts = useMemo(() => {
    let result = receipts;

    // Tab filter
    if (activeTab === "unmatched") result = result.filter((r) => !r.purchaseOrder);
    if (activeTab === "matched") result = result.filter((r) => !!r.purchaseOrder);

    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((r) => {
        // Match against: receipt number, external receipt ID, PO number, SKU names, 3PL SKUs
        if (r.receiptNumber?.toLowerCase().includes(q)) return true;
        if (r.externalReceiptId?.toLowerCase().includes(q)) return true;
        if (r.purchaseOrder?.toLowerCase().includes(q)) return true;
        if (r.lines.some((l) => l.sku?.toLowerCase().includes(q))) return true;
        if (r.lines.some((l) => l.threePlSku?.toLowerCase().includes(q))) return true;
        return false;
      });
    }

    return result;
  }, [receipts, activeTab, search]);

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "All", count: receipts.length },
    { key: "unmatched", label: "Unmatched", count: unmatchedCount },
    { key: "matched", label: "Matched", count: matchedCount },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Receipts</h1>
            <p className="text-sm text-gray-500 mt-1">
              {receipts.length} {receipts.length === 1 ? "receipt" : "receipts"}
              {unmatchedCount > 0 && (
                <span className="text-amber-600 ml-1">
                  ({unmatchedCount} unmatched)
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {unmatchedCount > 0 && (
              <button
                onClick={() => router.push("/receipts/matching")}
                className="bg-amber-500 text-white px-4 py-2 text-sm rounded-md hover:bg-amber-600"
              >
                Match Receipts ({unmatchedCount})
              </button>
            )}
            <button
              onClick={() => router.push("/warehouse/data-ingestion")}
              className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
            >
              + Import from Stord
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : receipts.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-4">No receipts yet.</p>
            <p className="text-sm text-gray-400 mb-4">
              Import warehouse data from the Data Ingestion page to create receipt records.
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
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                      activeTab === tab.key
                        ? "bg-white text-gray-900 font-medium shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {tab.label}
                    <span className={`ml-1.5 text-xs ${
                      activeTab === tab.key ? "text-gray-500" : "text-gray-400"
                    }`}>
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Search */}
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
                  placeholder="Search by order #, PO, or SKU..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-md w-72 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Receipt
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Warehouse
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Received Date
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      PO
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      SKU
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Qty
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReceipts.map((receipt) => {
                    const totalQty = receipt.lines.reduce((sum, l) => sum + l.qtyReceived, 0);
                    const skuList = receipt.lines
                      .map((l) => l.sku || l.threePlSku || "Unknown")
                      .join(", ");
                    const isMatched = !!receipt.purchaseOrder;

                    return (
                      <tr
                        key={receipt.id}
                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                        onClick={() => router.push(`/receipts/${receipt.id}`)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-semibold text-gray-900">
                            {receipt.externalReceiptId || receipt.receiptNumber}
                          </div>
                          {receipt.externalReceiptId && (
                            <div className="text-xs text-gray-400 font-mono">
                              {receipt.receiptNumber}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                              isMatched
                                ? "bg-green-100 text-green-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {isMatched ? "Matched" : "Unmatched"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {receipt.warehouse || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {receipt.receivedDate
                            ? new Date(receipt.receivedDate + "T00:00:00").toLocaleDateString("en-US")
                            : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-600">
                          {receipt.purchaseOrder || (
                            <span className="text-amber-500 text-xs font-medium">Needs matching</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-xs truncate" title={skuList}>
                          {skuList || "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-900">
                          {totalQty.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredReceipts.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">
                  {search
                    ? `No receipts matching "${search}"`
                    : `No ${activeTab === "all" ? "" : activeTab} receipts found.`}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
