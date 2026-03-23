"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface SKUDetail {
  standardSku: string;
  flavor: string;
  count: number | null;
  uom: string;
  category: string;
}

interface LineItem {
  id: string;
  skuId: string;
  sku: SKUDetail | null;
  lineType: string;
  qty: number;
}

interface LinkedShipment {
  id: string;
  shipmentNumber: string;
  shipDate: string | null;
  status: string | null;
}

interface LinkedReceipt {
  id: string;
  receiptNumber: string;
  receivedDate: string | null;
  warehouse: string | null;
}

interface LinkedInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  matchStatus: string | null;
  totalAmount: number | null;
}

interface WODetail {
  id: string;
  woNumber: string;
  description: string;
  status: string;
  issuedDate: string;
  completedDate: string;
  notes: string;
  warehouseId: string;
  warehouse: { id: string; name: string; code: string } | null;
  inputs: LineItem[];
  outputs: LineItem[];
  lineItems: LineItem[];
  shipments: LinkedShipment[];
  receipts: LinkedReceipt[];
  invoices: LinkedInvoice[];
}

const STATUSES = ["Draft", "Issued", "In Progress", "Completed", "Cancelled"];

const statusColors: Record<string, string> = {
  Draft: "bg-warm-100 text-warm-800",
  Issued: "bg-gold-100 text-gold-800",
  "In Progress": "bg-blue-100 text-blue-800",
  Completed: "bg-sage-100 text-sage-800",
  Cancelled: "bg-gray-100 text-gray-500",
};

export default function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [wo, setWO] = useState<WODetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    fetch(`/api/work-orders/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setWO(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [id]);

  const handleStatusChange = async (newStatus: string) => {
    if (!wo) return;
    setUpdatingStatus(true);
    setShowStatusMenu(false);
    try {
      await fetch(`/api/work-orders/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      setWO((prev) => prev ? { ...prev, status: newStatus } : prev);
    } catch {
      alert("Error updating status.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (error || !wo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Work Order not found.</p>
          <button
            onClick={() => router.push("/work-orders")}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← Back to Work Orders
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900">{wo.woNumber}</h1>
                <div className="relative">
                  <button
                    onClick={() => setShowStatusMenu(!showStatusMenu)}
                    disabled={updatingStatus}
                    className={`inline-block px-3 py-1 text-xs font-medium rounded-full cursor-pointer hover:opacity-80 ${statusColors[wo.status] || "bg-gray-100 text-gray-600"}`}
                  >
                    {updatingStatus ? "..." : wo.status}
                  </button>
                  {showStatusMenu && (
                    <div className="absolute z-20 mt-1 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[140px]">
                      {STATUSES.filter((s) => s !== wo.status).map((s) => (
                        <button
                          key={s}
                          onClick={() => handleStatusChange(s)}
                          className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {wo.description && (
                <p className="text-sm text-gray-500 mt-1">{wo.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {wo.status === "Draft" && (
              <button
                onClick={() => router.push(`/work-orders/${id}/edit`)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Edit
              </button>
            )}
            <button
              onClick={() => router.push("/work-orders")}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back to Work Orders
            </button>
          </div>
        </div>

        {/* WO Info Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Warehouse</p>
            <p className="text-sm font-semibold text-gray-900 mt-1">
              {wo.warehouse ? `${wo.warehouse.name} (${wo.warehouse.code})` : "—"}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Issued Date</p>
            <p className="text-sm font-semibold text-gray-900 mt-1">
              {wo.issuedDate
                ? new Date(wo.issuedDate + "T00:00:00").toLocaleDateString("en-US")
                : "—"}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-4">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Completed Date</p>
            <p className="text-sm font-semibold text-gray-900 mt-1">
              {wo.completedDate
                ? new Date(wo.completedDate + "T00:00:00").toLocaleDateString("en-US")
                : "—"}
            </p>
          </div>
        </div>

        {/* Notes */}
        {wo.notes && (
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 mb-6">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Notes</p>
            <p className="text-sm text-gray-700">{wo.notes}</p>
          </div>
        )}

        {/* Outputs Table */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Outputs — Finished Goods Produced
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-sage-800 text-white">
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">SKU</th>
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">Flavor</th>
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">Category</th>
                <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider">Qty</th>
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">UOM</th>
              </tr>
            </thead>
            <tbody>
              {wo.outputs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-gray-400 text-xs">
                    No output lines
                  </td>
                </tr>
              ) : (
                wo.outputs.map((li) => (
                  <tr key={li.id} className="border-b border-gray-100">
                    <td className="px-3 py-2 font-semibold text-gray-900 text-xs">
                      {li.sku?.standardSku || "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{li.sku?.flavor || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{li.sku?.category || "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-xs">
                      {li.qty.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{li.sku?.uom || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Inputs Table */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Inputs — Raw Materials Consumed
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-warm-800 text-white">
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">SKU</th>
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">Flavor</th>
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">Category</th>
                <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider">Qty</th>
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">UOM</th>
              </tr>
            </thead>
            <tbody>
              {wo.inputs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-gray-400 text-xs">
                    No input lines
                  </td>
                </tr>
              ) : (
                wo.inputs.map((li) => (
                  <tr key={li.id} className="border-b border-gray-100">
                    <td className="px-3 py-2 font-semibold text-gray-900 text-xs">
                      {li.sku?.standardSku || "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{li.sku?.flavor || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{li.sku?.category || "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-xs">
                      {li.qty.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{li.sku?.uom || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Linked Records */}
        {(wo.shipments.length > 0 || wo.receipts.length > 0 || wo.invoices.length > 0) && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Linked Records
            </h2>
            <div className="flex flex-wrap gap-2">
              {wo.shipments.map((s) => (
                <Link
                  key={s.id}
                  href={`/shipments/${s.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-800 rounded-full text-xs font-medium hover:bg-blue-100 transition-colors"
                >
                  <span>{s.shipmentNumber}</span>
                  {s.shipDate && (
                    <span className="text-blue-500">
                      {new Date(s.shipDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                </Link>
              ))}
              {wo.receipts.map((r) => (
                <Link
                  key={r.id}
                  href="/receipts"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sage-50 border border-sage-200 text-sage-800 rounded-full text-xs font-medium hover:bg-sage-100 transition-colors"
                >
                  <span>{r.receiptNumber}</span>
                  {r.receivedDate && (
                    <span className="text-sage-500">
                      {new Date(r.receivedDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                </Link>
              ))}
              {wo.invoices.map((inv) => (
                <Link
                  key={inv.id}
                  href={inv.matchStatus === "Open" || inv.matchStatus === "Discrepancy" ? `/invoices/${inv.id}/match` : "/invoices"}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-warm-50 border border-warm-200 text-warm-800 rounded-full text-xs font-medium hover:bg-warm-100 transition-colors"
                >
                  <span>{inv.invoiceNumber}</span>
                  {inv.matchStatus && (
                    <span className="text-warm-500">{inv.matchStatus}</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
