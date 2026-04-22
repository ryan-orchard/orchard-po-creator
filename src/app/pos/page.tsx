"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface PO {
  id: string;
  poNumber: string;
  date: string;
  deliveryDate: string;
  status: string;
  supplier: string[];
  grandTotal: number;
  totalSkus: number;
  totalUnits: number;
}

interface Supplier {
  id: string;
  name: string;
}

const statusColors: Record<string, string> = {
  Draft: "bg-warm-100 text-warm-800",
  Issued: "bg-gold-100 text-gold-800",
  Accepted: "bg-blue-100 text-blue-800",
  Shipped: "bg-blue-100 text-blue-800",
  "Partially Received": "bg-gold-100 text-gold-800",
  Received: "bg-sage-100 text-sage-800",
  Closed: "bg-gray-100 text-gray-600",
  Cancelled: "bg-gray-100 text-gray-600",
};

const statusDotColors: Record<string, string> = {
  Draft: "bg-warm-400",
  Issued: "bg-gold-500",
  Accepted: "bg-blue-500",
  Shipped: "bg-blue-500",
  "Partially Received": "bg-gold-500",
  Received: "bg-sage-500",
  Closed: "bg-gray-400",
  Cancelled: "bg-gray-400",
};

const OPEN_STATUSES = ["Draft", "Issued", "Accepted", "Shipped", "Partially Received"];

// Status groups for the summary card
const STATUS_GROUPS = [
  { label: "Open", statuses: ["Draft", "Issued"], dotColor: "bg-gold-500" },
  { label: "In Production", statuses: ["Accepted"], dotColor: "bg-blue-500" },
  { label: "Post Production", statuses: ["Shipped", "Partially Received", "Received", "Closed", "Cancelled"], dotColor: "bg-sage-500" },
];

type SortField = "poNumber" | "supplier" | "status" | "grandTotal" | "date" | "deliveryDate";
type SortDir = "asc" | "desc";

export default function POListPage() {
  const router = useRouter();
  const [pos, setPOs] = useState<PO[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "grandTotal" || field === "date" ? "desc" : "asc");
    }
  };

  // Count by status
  const statusCounts: Record<string, number> = {};
  for (const po of pos) {
    statusCounts[po.status] = (statusCounts[po.status] || 0) + 1;
  }

  const openPOs = pos.filter((p) => OPEN_STATUSES.includes(p.status));
  const openPOValue = openPOs.reduce((s, p) => s + (p.grandTotal || 0), 0);

  // Filter by status group
  const activeGroup = STATUS_GROUPS.find((g) => g.label === statusFilter);
  const filteredPOs = activeGroup
    ? pos.filter((po) => activeGroup.statuses.includes(po.status))
    : pos;

  const sortedPOs = [...filteredPOs].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "poNumber":
        cmp = a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true });
        break;
      case "supplier": {
        const sA = a.supplier?.[0] ? suppliers[a.supplier[0]] || "" : "";
        const sB = b.supplier?.[0] ? suppliers[b.supplier[0]] || "" : "";
        cmp = sA.localeCompare(sB);
        break;
      }
      case "status":
        cmp = (a.status || "").localeCompare(b.status || "");
        break;
      case "grandTotal":
        cmp = (a.grandTotal || 0) - (b.grandTotal || 0);
        break;
      case "date":
        cmp = (a.date || "").localeCompare(b.date || "");
        break;
      case "deliveryDate":
        cmp = (a.deliveryDate || "").localeCompare(b.deliveryDate || "");
        break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const fmtDate = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const fmt = (n: number) =>
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  // Group counts for the card
  const groupCounts = STATUS_GROUPS.map((g) => ({
    ...g,
    count: pos.filter((p) => g.statuses.includes(p.status)).length,
  }));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
          <button
            onClick={() => router.push("/pos/new")}
            className="bg-gray-900 text-white px-5 py-2.5 text-sm font-medium rounded-lg hover:bg-gray-800"
          >
            + Create PO
          </button>
        </div>

        {/* Summary Cards */}
        {!loading && (
          <div className="grid grid-cols-2 gap-4 mb-8">
            {/* Orders by Status */}
            <div className="bg-white rounded-lg border border-gray-200 px-6 py-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
                Purchase Orders by Status
              </p>
              <div className="space-y-2.5">
                {groupCounts.map((group) => (
                  <button
                    key={group.label}
                    onClick={() => setStatusFilter(statusFilter === group.label ? null : group.label)}
                    className={`flex items-center justify-between w-full text-left px-2 py-1.5 rounded-md transition-colors ${
                      statusFilter === group.label
                        ? "bg-gray-100"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className={`w-2 h-2 rounded-full ${group.count > 0 ? group.dotColor : "bg-gray-200"}`} />
                      <span className={`text-sm ${group.count > 0 ? "text-gray-700" : "text-gray-400"}`}>{group.label}</span>
                    </span>
                    <span className={`text-sm tabular-nums ${group.count > 0 ? "font-semibold text-gray-900" : "text-gray-300"}`}>
                      {group.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Open PO Value */}
            <div className="bg-white rounded-lg border border-gray-200 px-6 py-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Open PO Value
              </p>
              <p className="text-3xl font-bold text-gray-900 tabular-nums">
                {fmt(openPOValue)}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                Across {openPOs.length} open {openPOs.length === 1 ? "order" : "orders"}
              </p>
            </div>
          </div>
        )}

        {/* Active filter indicator */}
        {statusFilter && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-gray-500">Showing:</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
              {statusFilter}
            </span>
            <button
              onClick={() => setStatusFilter(null)}
              className="text-xs text-gray-400 hover:text-gray-600 ml-1"
            >
              Clear
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : sortedPOs.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-4">
              {statusFilter ? `No ${statusFilter.toLowerCase()} purchase orders.` : "No purchase orders yet."}
            </p>
            {!statusFilter && (
              <button
                onClick={() => router.push("/pos/new")}
                className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
              >
                Create your first PO
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  {([
                    { field: "poNumber" as SortField, label: "PO Number", align: "text-left" },
                    { field: "status" as SortField, label: "Status", align: "text-left" },
                    { field: "supplier" as SortField, label: "Supplier", align: "text-left" },
                    { field: "date" as SortField, label: "Created Date", align: "text-left" },
                    { field: "deliveryDate" as SortField, label: "Expected Delivery", align: "text-left" },
                    { field: "grandTotal" as SortField, label: "Total Value", align: "text-right" },
                  ]).map((col) => (
                    <th
                      key={col.field}
                      onClick={() => handleSort(col.field)}
                      className={`${col.align} px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-600 select-none`}
                    >
                      {col.label}
                      {sortField === col.field && (
                        <span className="ml-1">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
                      )}
                    </th>
                  ))}
                  <th className="text-right px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    SKUs / Units
                  </th>
                  <th className="px-3 py-3.5 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {sortedPOs.map((po) => (
                  <tr
                    key={po.id}
                    onClick={() => router.push(`/pos/${po.id}`)}
                    className="border-b border-gray-100 hover:bg-gray-50/80 cursor-pointer"
                  >
                    <td className="px-5 py-4 font-semibold text-gray-900">
                      {po.poNumber}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-block px-2.5 py-0.5 text-xs font-medium rounded-full ${statusColors[po.status] || "bg-gray-100 text-gray-600"}`}
                      >
                        {po.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-600">
                      {po.supplier?.[0] ? suppliers[po.supplier[0]] || "\u2014" : "\u2014"}
                    </td>
                    <td className="px-5 py-4 text-gray-600">
                      {po.date ? fmtDate(po.date) : "\u2014"}
                    </td>
                    <td className="px-5 py-4 text-gray-600">
                      {po.deliveryDate ? fmtDate(po.deliveryDate) : "\u2014"}
                    </td>
                    <td className="px-5 py-4 text-right font-semibold text-gray-900 tabular-nums">
                      {po.grandTotal != null ? fmt(po.grandTotal) : "\u2014"}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="text-gray-900 font-semibold">{po.totalSkus} SKUs</span>
                      <br />
                      <span className="text-gray-400 text-xs">{po.totalUnits.toLocaleString()} Units</span>
                    </td>
                    <td className="px-3 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDelete(po.id, po.poNumber)}
                        disabled={deleting === po.id}
                        className="text-gray-300 hover:text-red-500 disabled:opacity-50 p-1"
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
            <div className="px-5 py-3 border-t border-gray-100 text-sm text-gray-400">
              Showing {sortedPOs.length} {sortedPOs.length === 1 ? "order" : "orders"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
