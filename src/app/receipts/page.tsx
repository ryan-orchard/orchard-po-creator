"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface ReceiptLine {
  id: string;
  sku: string | null;
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
  warehouse: string | null;
  externalReceiptId: string;
  lines: ReceiptLine[];
}

export default function ReceiptsListPage() {
  const router = useRouter();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/receipts")
      .then((r) => r.json())
      .then((data) => {
        setReceipts(data);
        setLoading(false);
      });
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Receipts</h1>
            <p className="text-sm text-gray-500 mt-1">
              {receipts.length} {receipts.length === 1 ? "receipt" : "receipts"}
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
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Receipt #
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
                {receipts.map((receipt) => {
                  const totalQty = receipt.lines.reduce((sum, l) => sum + l.qtyReceived, 0);
                  const skuList = receipt.lines
                    .map((l) => l.sku || l.threePlSku || "Unknown")
                    .join(", ");

                  return (
                    <tr
                      key={receipt.id}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                        {receipt.receiptNumber}
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
                        {receipt.purchaseOrder || "—"}
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
          </div>
        )}
      </div>
    </div>
  );
}
