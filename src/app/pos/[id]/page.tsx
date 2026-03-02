"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";

interface PODetail {
  id: string;
  poNumber: string;
  date: string;
  status: string;
  deliveryDate: string;
  shippingTerms: string;
  paymentTerms: string;
  notes: string;
  grandTotal: number;
  supplier: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  shipTo: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  lineItems: {
    id: string;
    sku: {
      standardSku: string;
      flavor: string;
      count: string;
      category: string;
    } | null;
    section: string;
    qtySticks: number;
    qtyCartons: number;
    unitCost: number;
    costBasis: string;
    totalPrice: number;
  }[];
}

const statusColors: Record<string, string> = {
  Draft: "bg-yellow-100 text-yellow-800",
  Issued: "bg-blue-100 text-blue-800",
  "Partially Received": "bg-orange-100 text-orange-800",
  Received: "bg-green-100 text-green-800",
  Closed: "bg-gray-100 text-gray-600",
};

export default function PODetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const [po, setPO] = useState<PODetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const justCreated = searchParams.get("created") === "1";

  useEffect(() => {
    fetch(`/api/purchase-orders/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setPO(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [params.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (error || !po) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Purchase order not found.</p>
          <button
            onClick={() => router.push("/pos")}
            className="text-sm text-gray-700 underline hover:text-gray-900"
          >
            ← Back to POs
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Success banner */}
        {justCreated && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
            PO <span className="font-semibold">{po.poNumber}</span> created
            successfully.
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 font-mono">
                {po.poNumber}
              </h1>
              <span
                className={`inline-block px-2.5 py-0.5 text-xs font-medium rounded-full ${statusColors[po.status] || "bg-gray-100 text-gray-600"}`}
              >
                {po.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {po.date
                ? new Date(po.date + "T00:00:00").toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : "No date"}
            </p>
          </div>
          <button
            onClick={() => router.push("/pos")}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to POs
          </button>
        </div>

        {/* PO Details */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          {/* Supplier */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Supplier
            </h2>
            {po.supplier ? (
              <div>
                <p className="font-semibold text-gray-900">
                  {po.supplier.name}
                </p>
                {po.supplier.address && (
                  <p className="text-sm text-gray-600 mt-1">
                    {po.supplier.address}
                    <br />
                    {po.supplier.city}, {po.supplier.state} {po.supplier.zip}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No supplier</p>
            )}
          </div>

          {/* Ship To */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Ship To
            </h2>
            {po.shipTo ? (
              <div>
                <p className="font-semibold text-gray-900">{po.shipTo.name}</p>
                {po.shipTo.address && (
                  <p className="text-sm text-gray-600 mt-1">
                    {po.shipTo.address}
                    <br />
                    {po.shipTo.city}, {po.shipTo.state} {po.shipTo.zip}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No ship-to location</p>
            )}
          </div>
        </div>

        {/* Terms */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-4 gap-6">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Delivery Date
              </p>
              <p className="text-sm text-gray-900">
                {po.deliveryDate
                  ? new Date(
                      po.deliveryDate + "T00:00:00"
                    ).toLocaleDateString("en-US")
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Payment Terms
              </p>
              <p className="text-sm text-gray-900">
                {po.paymentTerms || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Shipping Terms
              </p>
              <p className="text-sm text-gray-900">
                {po.shippingTerms || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Notes
              </p>
              <p className="text-sm text-gray-900">{po.notes || "—"}</p>
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  SKU
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  Section
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  Qty (Sticks)
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  Qty (Ctns)
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  Unit Cost
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  Cost Basis
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {po.lineItems.map((item) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="px-4 py-3">
                    <span className="font-mono font-semibold text-gray-900">
                      {item.sku?.standardSku || "—"}
                    </span>
                    {item.sku?.flavor && (
                      <span className="text-gray-500 ml-2 text-xs">
                        {item.sku.flavor}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.section}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {item.qtySticks?.toLocaleString() || "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                    {item.qtyCartons?.toLocaleString() || "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    $
                    {item.unitCost?.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }) || "0.00"}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500">
                    {item.costBasis}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    $
                    {item.totalPrice?.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }) || "0.00"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Grand Total */}
          <div className="flex justify-end px-4 py-4 border-t border-gray-200 bg-gray-50">
            <div className="text-right">
              <p className="text-xs text-gray-500 uppercase tracking-wider">
                Grand Total
              </p>
              <p className="text-2xl font-bold text-gray-900 tabular-nums">
                $
                {po.grandTotal?.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }) || "0.00"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
