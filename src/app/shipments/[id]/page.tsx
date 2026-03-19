"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";

interface ShipmentDetail {
  id: string;
  shipmentNumber: string;
  purchaseOrderId: string | null;
  poNumber: string | null;
  supplierName: string | null;
  shipDate: string;
  expectedDeliveryDate: string;
  carrier: string;
  carrierReference: string;
  trackingNumber: string;
  notes: string;
  shipToId: string | null;
  shipTo: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  status: string;
  lineItems: {
    id: string;
    skuId: string | null;
    sku: {
      standardSku: string;
      flavor: string;
      count: string;
      category: string;
    } | null;
    qtyShipped: number;
    poLineItemId: string | null;
  }[];
}

const STATUSES = ["Created", "In Transit", "Delivered"] as const;

const statusColors: Record<string, string> = {
  Created: "bg-warm-100 text-warm-800",
  "In Transit": "bg-gold-100 text-gold-800",
  Delivered: "bg-sage-100 text-sage-800",
};

export default function ShipmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    fetch(`/api/shipments/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setShipment(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [id]);

  const handleStatusChange = async (newStatus: string) => {
    if (!shipment || newStatus === shipment.status) {
      setStatusDropdownOpen(false);
      return;
    }
    setUpdatingStatus(true);
    try {
      await fetch(`/api/shipments/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      setShipment((prev) => (prev ? { ...prev, status: newStatus } : prev));
    } catch {
      alert("Failed to update status.");
    } finally {
      setUpdatingStatus(false);
      setStatusDropdownOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!shipment) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Shipment not found.</p>
      </div>
    );
  }

  const totalQtyShipped = shipment.lineItems.reduce(
    (sum, li) => sum + (li.qtyShipped || 0),
    0
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 font-mono">
                {shipment.shipmentNumber}
              </h1>
              {/* Status dropdown */}
              <div className="relative">
                <button
                  onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                  disabled={updatingStatus}
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full cursor-pointer ${
                    statusColors[shipment.status] || "bg-gray-100 text-gray-600"
                  }`}
                >
                  {updatingStatus ? "..." : shipment.status}
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {statusDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-[140px]">
                    {STATUSES.map((status) => (
                      <button
                        key={status}
                        onClick={() => handleStatusChange(status)}
                        className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                          status === shipment.status
                            ? "font-medium text-gray-900"
                            : "text-gray-600"
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {shipment.shipDate
                ? new Date(shipment.shipDate + "T00:00:00").toLocaleDateString(
                    "en-US",
                    { year: "numeric", month: "long", day: "numeric" }
                  )
                : ""}
            </p>
          </div>
          <button
            onClick={() => router.push("/shipments")}
            className="border border-gray-300 text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50"
          >
            Back
          </button>
        </div>

        {/* Info Cards */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-2 gap-6">
            {/* Left column */}
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Purchase Order
                </p>
                <p className="text-sm text-gray-900">
                  {shipment.poNumber ? (
                    <button
                      onClick={() =>
                        router.push(`/pos/${shipment.purchaseOrderId}`)
                      }
                      className="font-mono font-semibold text-gold-600 hover:text-gold-800 hover:underline"
                    >
                      {shipment.poNumber}
                    </button>
                  ) : (
                    "—"
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Supplier
                </p>
                <p className="text-sm text-gray-900">
                  {shipment.supplierName || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Carrier
                </p>
                <p className="text-sm text-gray-900">
                  {shipment.carrier || "—"}
                </p>
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Ship To
                </p>
                <p className="text-sm text-gray-900">
                  {shipment.shipTo?.name || "—"}
                </p>
                {shipment.shipTo?.address && (
                  <p className="text-xs text-gray-500">
                    {shipment.shipTo.address}
                    {shipment.shipTo.city && `, ${shipment.shipTo.city}`}
                    {shipment.shipTo.state && `, ${shipment.shipTo.state}`}
                    {shipment.shipTo.zip && ` ${shipment.shipTo.zip}`}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Expected Delivery
                </p>
                <p className="text-sm text-gray-900">
                  {shipment.expectedDeliveryDate
                    ? new Date(
                        shipment.expectedDeliveryDate + "T00:00:00"
                      ).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Carrier Reference
                </p>
                <p className="text-sm text-gray-900 font-mono">
                  {shipment.carrierReference || "—"}
                </p>
              </div>
              {shipment.trackingNumber && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                    Tracking Number
                  </p>
                  <p className="text-sm text-gray-900 font-mono">
                    {shipment.trackingNumber}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900">
              Shipment Items
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  SKU
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Description
                </th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Qty Shipped
                </th>
              </tr>
            </thead>
            <tbody>
              {shipment.lineItems.map((li) => (
                <tr key={li.id} className="border-b border-gray-100">
                  <td className="px-6 py-3 font-mono text-gray-900">
                    {li.sku?.standardSku || "—"}
                  </td>
                  <td className="px-6 py-3 text-gray-600">
                    {li.sku?.flavor || "—"}
                  </td>
                  <td className="px-6 py-3 text-right font-semibold tabular-nums">
                    {(li.qtyShipped || 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200">
                <td
                  colSpan={2}
                  className="px-6 py-3 text-sm font-bold text-gray-900"
                >
                  Total
                </td>
                <td className="px-6 py-3 text-right font-bold tabular-nums text-gray-900">
                  {totalQtyShipped.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
