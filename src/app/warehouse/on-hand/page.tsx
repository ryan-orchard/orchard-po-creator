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
  unitCost: number | null;
  extendedValue: number | null;
  outOfStock: boolean;
}

interface OnHandResponse {
  items: OnHandItem[];
  summary: {
    totalSkus: number;
    totalOnHand: number;
    totalValue: number;
    totalIncoming: number;
  };
  costEffectiveDate: string;
  fetchedAt: string;
}

type SortField =
  | "sku"
  | "category"
  | "stordSku"
  | "totalOnHand"
  | "unitCost"
  | "extendedValue"
  | "incoming";
type SortDir = "asc" | "desc";

export default function OnHandInventoryPage() {
  const [data, setData] = useState<OnHandResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("extendedValue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showZero, setShowZero] = useState(false);

  const fetchData = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = forceRefresh
        ? "/api/warehouse/on-hand?refresh=1"
        : "/api/warehouse/on-hand";
      const res = await fetch(url);
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
      setSortDir(
        field === "sku" || field === "category" || field === "stordSku"
          ? "asc"
          : "desc"
      );
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
          return (
            (a.category || "zzz").localeCompare(b.category || "zzz") * dir
          );
        case "stordSku":
          return a.stordSku.localeCompare(b.stordSku) * dir;
        case "totalOnHand":
          return (a.totalOnHand - b.totalOnHand) * dir;
        case "unitCost":
          return ((a.unitCost ?? 0) - (b.unitCost ?? 0)) * dir;
        case "extendedValue":
          return ((a.extendedValue ?? 0) - (b.extendedValue ?? 0)) * dir;
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
        <span className="ml-1">
          {sortDir === "asc" ? "\u2191" : "\u2193"}
        </span>
      )}
    </th>
  );

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const fmtCompact = (n: number) =>
    n >= 1000 ? "$" + (n / 1000).toFixed(1) + "k" : fmt(n);

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
              Live inventory from Stord — quantities and valuation
              {data && (
                <>
                  <span className="ml-2 text-gray-400">
                    Costs as of{" "}
                    {new Date(
                      data.costEffectiveDate + "T00:00:00"
                    ).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span className="ml-2 text-gray-400">
                    &middot; Updated{" "}
                    {new Date(data.fetchedAt).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            onClick={() => fetchData(true)}
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">SKUs</p>
              <p className="text-xl font-semibold text-gray-500">
                {data.summary.totalSkus.toLocaleString()}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Units on Hand</p>
              <p className="text-xl font-semibold text-gray-900">
                {data.summary.totalOnHand.toLocaleString()}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Total Value</p>
              <p className="text-xl font-semibold text-gray-900">
                {fmt(data.summary.totalValue)}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Incoming</p>
              <p className="text-xl font-semibold text-amber-700">
                {data.summary.totalIncoming.toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* Search + Filters */}
        {data && (
          <div className="flex items-center gap-4 mb-4">
            <input
              type="text"
              placeholder="Search by SKU, product, or category..."
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
                    field="totalOnHand"
                    label="On-Hand"
                    align="right"
                  />
                  <SortHeader
                    field="unitCost"
                    label="Unit Cost"
                    align="right"
                  />
                  <SortHeader
                    field="extendedValue"
                    label="Value"
                    align="right"
                  />
                  <SortHeader
                    field="incoming"
                    label="Incoming"
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const displaySku = item.standardSku || item.stordSku;
                  const isMapped = !!item.standardSku;
                  const missingCost =
                    item.unitCost === null && item.totalOnHand > 0;

                  return (
                    <tr
                      key={`${item.facility}-${item.stordSku}`}
                      className={`border-b border-gray-100 hover:bg-gray-50 ${
                        missingCost ? "bg-red-50/40" : ""
                      }`}
                    >
                      {/* SKU */}
                      <td className="px-4 py-3">
                        <span className="font-semibold text-gray-900 text-xs">
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
                        {item.category || "\u2014"}
                      </td>
                      {/* Stord SKU */}
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {item.stordSku}
                      </td>
                      {/* On-Hand */}
                      <td className="px-4 py-3 text-right text-gray-900 font-semibold">
                        {item.totalOnHand.toLocaleString()}
                      </td>
                      {/* Unit Cost */}
                      <td className="px-4 py-3 text-right">
                        {item.unitCost !== null ? (
                          <span className="text-gray-700">
                            {fmt(item.unitCost)}
                          </span>
                        ) : missingCost ? (
                          <span className="text-red-500 text-xs font-medium">
                            Missing
                          </span>
                        ) : (
                          <span className="text-gray-300">{"\u2014"}</span>
                        )}
                      </td>
                      {/* Value */}
                      <td className="px-4 py-3 text-right font-semibold">
                        {item.extendedValue !== null ? (
                          <span className="text-gray-900">
                            {fmtCompact(item.extendedValue)}
                          </span>
                        ) : (
                          <span className="text-gray-300">{"\u2014"}</span>
                        )}
                      </td>
                      {/* Incoming */}
                      <td className="px-4 py-3 text-right text-amber-600">
                        {item.incoming > 0
                          ? item.incoming.toLocaleString()
                          : "\u2014"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Total row */}
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-300">
                  <td
                    colSpan={5}
                    className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  >
                    Total Inventory Value
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900 text-base">
                    {data ? fmt(data.summary.totalValue) : "\u2014"}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
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
