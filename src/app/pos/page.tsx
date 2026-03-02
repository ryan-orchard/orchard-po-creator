"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface PO {
  id: string;
  poNumber: string;
  date: string;
  status: string;
  supplier: string[];
  grandTotal: number;
}

interface Supplier {
  id: string;
  name: string;
}

const statusColors: Record<string, string> = {
  Draft: "bg-yellow-100 text-yellow-800",
  Issued: "bg-blue-100 text-blue-800",
  "Partially Received": "bg-orange-100 text-orange-800",
  Received: "bg-green-100 text-green-800",
  Closed: "bg-gray-100 text-gray-600",
};

export default function POListPage() {
  const router = useRouter();
  const [pos, setPOs] = useState<PO[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/purchase-orders").then((r) => r.json()),
      fetch("/api/suppliers").then((r) => r.json()),
    ]).then(([poData, supplierData]) => {
      setPOs(poData);
      const supplierMap: Record<string, string> = {};
      supplierData.forEach((s: Supplier) => {
        supplierMap[s.id] = s.name;
      });
      setSuppliers(supplierMap);
      setLoading(false);
    });
  }, []);

  const handleDelete = async (poId: string, poNumber: string) => {
    if (!confirm(`Delete ${poNumber}? This cannot be undone.`)) return;
    setDeleting(poId);
    try {
      await fetch(`/api/purchase-orders/${poId}`, { method: "DELETE" });
      setPOs((prev) => prev.filter((p) => p.id !== poId));
    } catch {
      alert("Error deleting PO. Please try again.");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Purchase Orders
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {pos.length} {pos.length === 1 ? "order" : "orders"}
            </p>
          </div>
          <button
            onClick={() => router.push("/pos/new")}
            className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
          >
            + New PO
          </button>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : pos.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-4">No purchase orders yet.</p>
            <button
              onClick={() => router.push("/pos/new")}
              className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
            >
              Create your first PO
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    PO Number
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Supplier
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {pos.map((po) => (
                  <tr
                    key={po.id}
                    onClick={() => router.push(`/pos/${po.id}`)}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                      {po.poNumber}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {po.date
                        ? new Date(po.date + "T00:00:00").toLocaleDateString("en-US")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {po.supplier?.[0] ? suppliers[po.supplier[0]] || "—" : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[po.status] || "bg-gray-100 text-gray-600"}`}
                      >
                        {po.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {po.grandTotal != null
                        ? `$${po.grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDelete(po.id, po.poNumber)}
                        disabled={deleting === po.id}
                        className="text-red-300 hover:text-red-500 disabled:opacity-50 p-1"
                        title="Delete PO"
                      >
                        {deleting === po.id ? (
                          <span className="text-xs">...</span>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
