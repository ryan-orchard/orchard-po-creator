"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface PO {
  id: string;
  poNumber: string;
  status: string;
  grandTotal: number;
  date: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [pos, setPOs] = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/purchase-orders")
      .then((r) => r.json())
      .then((data) => {
        setPOs(data);
        setLoading(false);
      });
  }, []);

  const statusCounts = pos.reduce(
    (acc, po) => {
      acc[po.status] = (acc[po.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const totalValue = pos.reduce((sum, po) => sum + (po.grandTotal || 0), 0);
  const openPOs = pos.filter((p) => p.status !== "Closed").length;

  const cards = [
    { label: "Total POs", value: pos.length, color: "bg-gray-900 text-white" },
    { label: "Open", value: openPOs, color: "bg-blue-50 text-blue-900" },
    { label: "Draft", value: statusCounts["Draft"] || 0, color: "bg-yellow-50 text-yellow-900" },
    { label: "Issued", value: statusCounts["Issued"] || 0, color: "bg-blue-50 text-blue-900" },
    { label: "Received", value: statusCounts["Received"] || 0, color: "bg-green-50 text-green-900" },
    { label: "Closed", value: statusCounts["Closed"] || 0, color: "bg-gray-50 text-gray-600" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Magna overview</p>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-6 gap-3 mb-8">
              {cards.map((card) => (
                <div
                  key={card.label}
                  className={`rounded-lg px-4 py-4 ${card.color}`}
                >
                  <p className="text-xs font-medium uppercase tracking-wider opacity-70">
                    {card.label}
                  </p>
                  <p className="text-2xl font-bold mt-1 tabular-nums">
                    {card.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Total value */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Total PO Value
                  </p>
                  <p className="text-3xl font-bold text-gray-900 mt-1 tabular-nums">
                    ${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <button
                  onClick={() => router.push("/pos")}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  View all POs →
                </button>
              </div>
            </div>

            {/* Recent POs */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-900">Recent Purchase Orders</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">PO #</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.slice(0, 5).map((po) => (
                    <tr
                      key={po.id}
                      onClick={() => router.push(`/pos/${po.id}`)}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-mono font-semibold text-gray-900">{po.poNumber}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                          { Draft: "bg-yellow-100 text-yellow-800", Issued: "bg-blue-100 text-blue-800", Received: "bg-green-100 text-green-800", Closed: "bg-gray-100 text-gray-600" }[po.status] || "bg-gray-100 text-gray-600"
                        }`}>
                          {po.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                        {po.grandTotal != null ? `$${po.grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {po.date ? new Date(po.date + "T00:00:00").toLocaleDateString("en-US") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
