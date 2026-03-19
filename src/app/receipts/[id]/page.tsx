"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";

interface ReceiptLine {
  id: string;
  skuId: string | null;
  sku: string | null;
  uom: string | null;
  qtyReceived: number;
  qtyExpected: number | null;
  threePlSku: string | null;
  lotNumber: string | null;
  matched: boolean;
}

interface AvailableItem {
  id: string;
  standardSku: string;
}

interface ReceiptDetail {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  externalReceiptId: string | null;
  notes: string | null;
  purchaseOrder: string | null;
  purchaseOrderId: string | null;
  warehouse: string | null;
  warehouseId: string | null;
  lines: ReceiptLine[];
  availableItems: AvailableItem[];
}

export default function ReceiptDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [savingLineId, setSavingLineId] = useState<string | null>(null);

  const loadReceipt = useCallback(() => {
    fetch(`/api/receipts/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setReceipt(null);
        } else {
          setReceipt(data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadReceipt();
  }, [loadReceipt]);

  const handleUpdateLineSku = async (lineId: string, newSkuId: string) => {
    setSavingLineId(lineId);
    try {
      await fetch(`/api/receipt-lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuId: newSkuId }),
      });
      loadReceipt();
    } catch {
      alert("Failed to update SKU.");
    } finally {
      setSavingLineId(null);
      setEditingLineId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Receipt not found.</p>
      </div>
    );
  }

  const totalQty = receipt.lines.reduce((sum, l) => sum + l.qtyReceived, 0);
  const isMatched = !!receipt.purchaseOrder;
  const matchedLineCount = receipt.lines.filter((l) => l.matched).length;
  const unmatchedLineCount = receipt.lines.length - matchedLineCount;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {receipt.externalReceiptId || receipt.receiptNumber}
              </h1>
              <span
                className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${
                  isMatched
                    ? "bg-sage-100 text-sage-800"
                    : "bg-warm-100 text-warm-800"
                }`}
              >
                {isMatched ? "Matched" : "Unmatched"}
              </span>
            </div>
            {receipt.externalReceiptId && (
              <p className="text-sm text-gray-500 mt-1 font-mono">
                {receipt.receiptNumber}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {!isMatched && unmatchedLineCount > 0 && (
              <button
                onClick={() => router.push(`/receipts/matching?receipt=${receipt.id}`)}
                className="bg-gold-500 text-white px-4 py-2 text-sm rounded-md hover:bg-gold-600"
              >
                Match to PO
              </button>
            )}
            <button
              onClick={() => router.push("/receipts")}
              className="border border-gray-300 text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50"
            >
              Back
            </button>
          </div>
        </div>

        {/* Info Card */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-2 gap-6">
            {/* Left column */}
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Purchase Order
                </p>
                <p className="text-sm text-gray-900">
                  {receipt.purchaseOrderId ? (
                    <button
                      onClick={() => router.push(`/pos/${receipt.purchaseOrderId}`)}
                      className="font-mono font-semibold text-gold-600 hover:text-gold-800 hover:underline"
                    >
                      {receipt.purchaseOrder}
                    </button>
                  ) : (
                    <span className="text-warm-600 text-xs font-medium">Not matched</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Warehouse
                </p>
                <p className="text-sm text-gray-900">
                  {receipt.warehouse || "—"}
                </p>
              </div>
              {receipt.notes && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                    Notes
                  </p>
                  <p className="text-sm text-gray-900">{receipt.notes}</p>
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Received Date
                </p>
                <p className="text-sm text-gray-900">
                  {receipt.receivedDate
                    ? new Date(receipt.receivedDate + "T00:00:00").toLocaleDateString(
                        "en-US",
                        { year: "numeric", month: "long", day: "numeric" }
                      )
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  External Receipt ID
                </p>
                <p className="text-sm text-gray-900 font-mono">
                  {receipt.externalReceiptId || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Line Matching
                </p>
                <p className="text-sm text-gray-900">
                  {matchedLineCount > 0 && (
                    <span className="text-sage-700">{matchedLineCount} matched</span>
                  )}
                  {matchedLineCount > 0 && unmatchedLineCount > 0 && ", "}
                  {unmatchedLineCount > 0 && (
                    <span className="text-warm-600">{unmatchedLineCount} unmatched</span>
                  )}
                  {receipt.lines.length === 0 && "No lines"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900">
              Receipt Lines ({receipt.lines.length})
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  SKU
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  3PL SKU
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Lot #
                </th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Qty Received
                </th>
                <th className="text-center px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((line) => (
                <tr key={line.id} className="border-b border-gray-100">
                  <td className="px-6 py-3">
                    {editingLineId === line.id ? (
                      <select
                        autoFocus
                        className="text-sm border border-gray-300 rounded px-2 py-1 w-full max-w-[220px]"
                        defaultValue={line.skuId || ""}
                        onChange={(e) => {
                          if (e.target.value) {
                            handleUpdateLineSku(line.id, e.target.value);
                          }
                        }}
                        onBlur={() => setEditingLineId(null)}
                      >
                        <option value="" disabled>
                          Select SKU...
                        </option>
                        {receipt.availableItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.standardSku}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-gray-900">
                          {savingLineId === line.id
                            ? "Saving..."
                            : line.sku || (
                                <span className="text-burgundy-500 text-xs">No SKU</span>
                              )}
                        </span>
                        <button
                          onClick={() => setEditingLineId(line.id)}
                          className="text-gray-400 hover:text-gray-600"
                          title="Edit SKU"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-gray-500 font-mono text-xs">
                    {line.threePlSku || "—"}
                  </td>
                  <td className="px-6 py-3 text-gray-600">
                    {line.lotNumber || "—"}
                  </td>
                  <td className="px-6 py-3 text-right font-semibold tabular-nums text-gray-900">
                    {line.qtyReceived.toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-center">
                    {line.matched ? (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-sage-100 text-sage-800">
                        Matched
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">
                        Unmatched
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200">
                <td colSpan={3} className="px-6 py-3 text-sm font-bold text-gray-900">
                  Total
                </td>
                <td className="px-6 py-3 text-right font-bold tabular-nums text-gray-900">
                  {totalQty.toLocaleString()}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
