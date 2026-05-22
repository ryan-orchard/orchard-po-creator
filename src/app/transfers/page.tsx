"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

interface TransferLine {
  transferLineId: string;
  transferId: string;
  transferNumber: string;
  fromCode: string;
  fromName: string;
  toCode: string;
  toName: string;
  itemSku: string;
  itemName: string;
  shippedQty: number;
  receivedQty: number;
  uom: string | null;
  shipDate: string | null;
  expectedArrivalDate: string | null;
  carrier: string | null;
  status: string;
  hasVariance: boolean;
  poId: string | null;
  poNumber: string;
  lotNumber: string | null;
}

const statusColors: Record<string, string> = {
  in_transit: "bg-blue-100 text-blue-800",
  received: "bg-sage-100 text-sage-800",
  cancelled: "bg-gray-100 text-gray-600",
};

const statusLabels: Record<string, string> = {
  in_transit: "In Transit",
  received: "Received",
  cancelled: "Cancelled",
};

type TabKey = "in_transit" | "received" | "all";

const TABS: { key: TabKey; label: string; statuses: string[] }[] = [
  { key: "in_transit", label: "In Transit", statuses: ["in_transit"] },
  { key: "received", label: "Received", statuses: ["received"] },
  { key: "all", label: "All", statuses: [] },
];

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const yy = String(dt.getFullYear()).slice(2);
  return `${mm}/${dd}/${yy}`;
};

export default function TransfersPage() {
  const router = useRouter();
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("in_transit");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/transfers")
      .then((r) => r.json())
      .then((data) => {
        setLines(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { in_transit: 0, received: 0, all: lines.length };
    for (const l of lines) {
      for (const t of TABS) {
        if (t.key !== "all" && t.statuses.includes(l.status)) counts[t.key]++;
      }
    }
    return counts;
  }, [lines]);

  const tabConfig = TABS.find((t) => t.key === activeTab)!;

  const visible = useMemo(() => {
    let rows = tabConfig.statuses.length
      ? lines.filter((l) => tabConfig.statuses.includes(l.status))
      : lines;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((l) =>
        [l.transferNumber, l.itemSku, l.itemName, l.fromCode, l.toCode, l.poNumber]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return rows;
  }, [lines, tabConfig, search]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-screen-2xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Transfers</h1>
          <button
            onClick={() => router.push("/transfers/new")}
            className="bg-gray-900 text-white px-5 py-2 text-sm font-medium rounded-lg hover:bg-gray-800"
          >
            + Create Transfer
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  setSearch("");
                }}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                  active
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`inline-block px-1.5 py-0.5 text-xs rounded-full tabular-nums ${
                    active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {tabCounts[tab.key]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        {!loading && (
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1 max-w-md">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
                />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search transfer #, SKU, location, PO"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
              />
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : visible.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500">No transfers yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/40 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5">Transfer #</th>
                  <th className="text-left px-4 py-2.5">SKU</th>
                  <th className="text-left px-4 py-2.5">Description</th>
                  <th className="text-left px-4 py-2.5">From</th>
                  <th className="text-left px-4 py-2.5">To</th>
                  <th className="text-right px-4 py-2.5">Shipped</th>
                  <th className="text-right px-4 py-2.5">Received</th>
                  <th className="text-left px-4 py-2.5">Ship Date</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((line) => (
                  <tr
                    key={line.transferLineId}
                    onClick={() => router.push(`/transfers/${line.transferId}`)}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 cursor-pointer"
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                      {line.transferNumber}
                    </td>
                    <td className="px-4 py-2.5 text-gray-900" title={line.itemSku}>
                      {line.itemSku || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700" title={line.itemName}>
                      {line.itemName || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{line.fromCode || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{line.toCode || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">
                      {line.shippedQty.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className={line.hasVariance ? "text-burgundy-600 font-medium" : "text-gray-800"}>
                        {line.receivedQty.toLocaleString()}
                      </span>
                      {line.hasVariance && (
                        <span
                          className="ml-1 text-burgundy-500"
                          title={`Variance: shipped ${line.shippedQty}, received ${line.receivedQty}`}
                        >
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 tabular-nums whitespace-nowrap">
                      {fmtDate(line.shipDate)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                          statusColors[line.status] || "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {statusLabels[line.status] || line.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-2.5 border-t border-gray-100 text-xs text-gray-400">
              Showing {visible.length} {visible.length === 1 ? "line" : "lines"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
