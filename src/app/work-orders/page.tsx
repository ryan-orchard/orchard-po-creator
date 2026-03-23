"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface WorkOrder {
  id: string;
  woNumber: string;
  description: string;
  warehouse: string[];
  status: string;
  issuedDate: string;
  completedDate: string;
  lineItems: string[];
}

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

const STATUS_TABS = ["All", "Draft", "Issued", "In Progress", "Completed"] as const;

const statusColors: Record<string, string> = {
  Draft: "bg-warm-100 text-warm-800",
  Issued: "bg-gold-100 text-gold-800",
  "In Progress": "bg-blue-100 text-blue-800",
  Completed: "bg-sage-100 text-sage-800",
  Cancelled: "bg-gray-100 text-gray-500",
};

type SortField = "woNumber" | "warehouse" | "status" | "issuedDate";
type SortDir = "asc" | "desc";

export default function WorkOrderListPage() {
  const router = useRouter();
  const [wos, setWOs] = useState<WorkOrder[]>([]);
  const [warehouses, setWarehouses] = useState<Record<string, Warehouse>>({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("All");
  const [sortField, setSortField] = useState<SortField>("issuedDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    Promise.all([
      fetch("/api/work-orders").then((r) => r.json()),
      fetch("/api/ship-to").then((r) => r.json()),
    ]).then(([woData, warehouseData]) => {
      setWOs(woData);
      const whMap: Record<string, Warehouse> = {};
      warehouseData.forEach((w: Warehouse) => {
        whMap[w.id] = w;
      });
      setWarehouses(whMap);
      setLoading(false);
    });
  }, []);

  const handleDelete = async (woId: string, woNumber: string) => {
    if (!confirm(`Delete ${woNumber}? This cannot be undone.`)) return;
    setDeleting(woId);
    try {
      await fetch(`/api/work-orders/${woId}`, { method: "DELETE" });
      setWOs((prev) => prev.filter((w) => w.id !== woId));
    } catch {
      alert("Error deleting Work Order. Please try again.");
    } finally {
      setDeleting(null);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "issuedDate" ? "desc" : "asc");
    }
  };

  const filteredWOs = activeTab === "All"
    ? wos
    : wos.filter((wo) => wo.status === activeTab);

  const sortedWOs = [...filteredWOs].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "woNumber":
        cmp = (a.woNumber || "").localeCompare(b.woNumber || "", undefined, { numeric: true });
        break;
      case "warehouse": {
        const wA = a.warehouse?.[0] ? warehouses[a.warehouse[0]]?.code || "" : "";
        const wB = b.warehouse?.[0] ? warehouses[b.warehouse[0]]?.code || "" : "";
        cmp = wA.localeCompare(wB);
        break;
      }
      case "status":
        cmp = (a.status || "").localeCompare(b.status || "");
        break;
      case "issuedDate":
        cmp = (a.issuedDate || "").localeCompare(b.issuedDate || "");
        break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const tabCounts = STATUS_TABS.reduce((acc, tab) => {
    acc[tab] = tab === "All" ? wos.length : wos.filter((w) => w.status === tab).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Work Orders</h1>
            <p className="text-sm text-gray-500 mt-1">
              {wos.length} {wos.length === 1 ? "work order" : "work orders"}
            </p>
          </div>
          <button
            onClick={() => router.push("/work-orders/new")}
            className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
          >
            + Create Work Order
          </button>
        </div>

        {/* Summary Cards */}
        {!loading && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-900 text-white rounded-lg px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-wider opacity-70">Total WOs</p>
              <p className="text-2xl font-bold mt-1 tabular-nums">{wos.length}</p>
            </div>
            <div className="bg-warm-50 border border-warm-200 rounded-lg px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-wider text-warm-700">Draft</p>
              <p className="text-2xl font-bold mt-1 tabular-nums text-warm-900">{tabCounts["Draft"]}</p>
            </div>
            <div className="bg-gold-50 border border-gold-200 rounded-lg px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-wider text-gold-700">Issued</p>
              <p className="text-2xl font-bold mt-1 tabular-nums text-gold-900">{tabCounts["Issued"]}</p>
            </div>
            <div className="bg-sage-50 border border-sage-200 rounded-lg px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-wider text-sage-700">Complete</p>
              <p className="text-2xl font-bold mt-1 tabular-nums text-sage-800">{tabCounts["Completed"]}</p>
            </div>
          </div>
        )}

        {/* Status tabs */}
        <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab}
              <span className={`ml-1.5 text-xs ${activeTab === tab ? "text-gray-600" : "text-gray-400"}`}>
                {tabCounts[tab]}
              </span>
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : filteredWOs.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-4">
              {activeTab === "All" ? "No work orders yet." : `No ${activeTab.toLowerCase()} work orders.`}
            </p>
            {activeTab === "All" && (
              <button
                onClick={() => router.push("/work-orders/new")}
                className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
              >
                Create your first Work Order
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {([
                    { field: "woNumber" as SortField, label: "WO #", align: "text-left" },
                    { field: "warehouse" as SortField, label: "Warehouse", align: "text-left" },
                    { field: "status" as SortField, label: "Status", align: "text-left" },
                    { field: "issuedDate" as SortField, label: "Issued Date", align: "text-left" },
                  ]).map((col) => (
                    <th
                      key={col.field}
                      onClick={() => handleSort(col.field)}
                      className={`${col.align} px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none`}
                    >
                      {col.label}
                      {sortField === col.field && (
                        <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
                      )}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {sortedWOs.map((wo) => (
                  <tr
                    key={wo.id}
                    onClick={() => router.push(`/work-orders/${wo.id}`)}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {wo.woNumber}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {wo.warehouse?.[0] ? warehouses[wo.warehouse[0]]?.code || "—" : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[wo.status] || "bg-gray-100 text-gray-600"}`}
                      >
                        {wo.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {wo.issuedDate
                        ? new Date(wo.issuedDate + "T00:00:00").toLocaleDateString("en-US")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 truncate max-w-xs">
                      {wo.description || "—"}
                    </td>
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDelete(wo.id, wo.woNumber)}
                        disabled={deleting === wo.id}
                        className="text-red-300 hover:text-red-500 disabled:opacity-50 p-1"
                        title="Delete Work Order"
                      >
                        {deleting === wo.id ? (
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
