"use client";

import { useState, useEffect } from "react";

interface OnHandItem {
  stordSku: string;
  standardSku: string | null;
  category: string | null;
  productName: string;
  facility: string;
  available: number;
  allocated: number;
  locked: number;
  incoming: number;
  damaged: number;
  totalOnHand: number;
  outOfStock: boolean;
}

interface OnHandSummary {
  totalSkus: number;
  totalOnHand: number;
  totalAvailable: number;
  totalAllocated: number;
  totalIncoming: number;
  outOfStockCount: number;
}

interface OnHandResponse {
  items: OnHandItem[];
  summary: OnHandSummary;
  fetchedAt: string;
}

type SortField =
  | "sku"
  | "category"
  | "stordSku"
  | "available"
  | "allocated"
  | "totalOnHand"
  | "incoming";
type SortDir = "asc" | "desc";

export default function OnHandInventoryPage() {
  const [data, setData] = useState<OnHandResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("sku");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showZero, setShowZero] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/on-hand");
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to fetch inventory");
      }
      const json: OnHandResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "sku" || field === "category" || field === "stordSku" ? "asc" : "desc");
    }
  };

  const filtered = data?.items
    .filter((item) => {
      if (!showZero && item.totalOnHand <= 0) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        item.stordSku.toLowerCase().includes(q) ||
        (item.standardSku?.toLowerCase().includes(q) ?? false) ||
        item.productName.toLowerCase().includes(q) ||
        (item.category?.toLowerCase().includes(q) ?? false)
      );
    })
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortField) {
        case "sku":
          return (
            (a.standardSku || a.stordSku).localeCompare(
              b.standardSku || b.stordSku
            ) * dir
          );
        case "category":
          return (a.category || "zzz").localeCompare(b.category || "zzz") * dir;
        case "stordSku":
          return a.stordSku.localeCompare(b.stordSku) * dir;
        case "available":
          return (a.available - b.available) * dir;
        case "allocated":
          return (a.allocated - b.allocated) * dir;
        case "totalOnHand":
          return (a.totalOnHand - b.totalOnHand) * dir;
        case "incoming":
          return (a.incoming - b.incoming) * dir;
        default:
          return 0;
      }
    });

  const SortHeader = ({
    field,
    label,
    align = "left",
  }: {
    field: SortField;
    label: string;
    align?: "left" | "right";
  }) => (
    <th
      onClick={() => handleSort(field)}
      className={`${
        align === "right" ? "text-right" : "text-left"
      } px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none`}
    >
      {label}
      {sortField === field && (
        <span className="ml-1">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
      )}
    </th>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              On-Hand Inventory
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Live inventory from Stord (Reno warehouse)
              {data && (
                <span className="ml-2 text-gray-400">
                  Updated{" "}
                  {new Date(data.fetchedAt).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* Summary Cards */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <SummaryCard
              label="Total SKUs"
              value={data.summary.totalSkus}
              muted
            />
            <SummaryCard
              label="Total On-Hand"
              value={data.summary.totalOnHand}
            />
            <SummaryCard
              label="Available"
              value={data.summary.totalAvailable}
              color="green"
            />
            <SummaryCard
              label="Allocated"
              value={data.summary.totalAllocated}
              color="blue"
            />
            <SummaryCard
              label="Incoming"
              value={data.summary.totalIncoming}
              color="amber"
            />
          </div>
        )}

        {/* Search + Filters */}
        {data && (
          <div className="flex items-center gap-4 mb-4">
            <input
              type="text"
              placeholder="Search by SKU or product name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-sm px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
            />
            <label className="flex items-center gap-2 text-sm text-gray-500 whitespace-nowrap">
              <input
                type="checkbox"
                checked={showZero}
                onChange={(e) => setShowZero(e.target.checked)}
                className="rounded border-gray-300"
              />
              Show zero-stock
            </label>
            <p className="text-sm text-gray-400 ml-auto">
              {filtered?.length ?? 0} items
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500">Loading inventory from Stord...</p>
          </div>
        )}

        {/* Table */}
        {filtered && filtered.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <SortHeader field="sku" label="SKU" />
                  <SortHeader field="category" label="Category" />
                  <SortHeader field="stordSku" label="Stord SKU" />
                  <SortHeader
                    field="available"
                    label="Available"
                    align="right"
                  />
                  <SortHeader
                    field="allocated"
                    label="Allocated"
                    align="right"
                  />
                  <SortHeader
                    field="totalOnHand"
                    label="On-Hand"
                    align="right"
                  />
                  <SortHeader
                    field="incoming"
                    label="Incoming"
                    align="right"
                  />
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const displaySku = item.standardSku || item.stordSku;
                  const isMapped = !!item.standardSku;

                  return (
                    <tr
                      key={`${item.facility}-${item.stordSku}`}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      {/* SKU */}
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-gray-900 text-xs">
                          {displaySku}
                        </span>
                        {!isMapped && (
                          <span className="ml-2 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full font-medium">
                            Unmapped
                          </span>
                        )}
                      </td>
                      {/* Category */}
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {item.category || "—"}
                      </td>
                      {/* Stord SKU */}
                      <td className="px-4 py-3 font-mono text-gray-500 text-xs">
                        {item.stordSku}
                      </td>
                      {/* Available */}
                      <td className="px-4 py-3 text-right font-mono text-green-700 font-medium">
                        {item.available.toLocaleString()}
                      </td>
                      {/* Allocated */}
                      <td className="px-4 py-3 text-right font-mono text-blue-600">
                        {item.allocated > 0
                          ? item.allocated.toLocaleString()
                          : "—"}
                      </td>
                      {/* Total On-Hand */}
                      <td className="px-4 py-3 text-right font-mono text-gray-900 font-semibold">
                        {item.totalOnHand.toLocaleString()}
                      </td>
                      {/* Incoming */}
                      <td className="px-4 py-3 text-right font-mono text-amber-600">
                        {item.incoming > 0
                          ? item.incoming.toLocaleString()
                          : "—"}
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3">
                        {item.outOfStock ? (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-50 text-red-700">
                            Out of Stock
                          </span>
                        ) : item.available <= 0 && item.totalOnHand > 0 ? (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-50 text-amber-700">
                            Locked
                          </span>
                        ) : item.totalOnHand > 0 ? (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-50 text-green-700">
                            In Stock
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">
                            Zero
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty state */}
        {filtered && filtered.length === 0 && !loading && (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500">
              {search
                ? "No items match your search."
                : "No inventory items found."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
  muted,
}: {
  label: string;
  value: number;
  color?: "green" | "blue" | "amber" | "red";
  muted?: boolean;
}) {
  const valueColor = muted
    ? "text-gray-500"
    : color === "green"
    ? "text-green-700"
    : color === "blue"
    ? "text-blue-700"
    : color === "amber"
    ? "text-amber-700"
    : color === "red"
    ? "text-red-700"
    : "text-gray-900";

  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-semibold ${valueColor}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
