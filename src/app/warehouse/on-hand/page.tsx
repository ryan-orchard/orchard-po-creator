"use client";

import { useState, useEffect, useMemo } from "react";

interface OnHandItem {
  standardSku: string;
  stordSku: string | null;
  category: string | null;
  productName: string;
  warehouse: string;
  totalOnHand: number;
  incoming: number;
  unitCost: number | null;
  extendedValue: number | null;
}

interface WarehouseInfo {
  code: string;
  name: string;
  sourceType: "api" | "calculated" | "snapshot";
  sourceLabel: string;
  asOf: string | null;
}

interface OnHandResponse {
  items: OnHandItem[];
  summary: {
    totalSkus: number;
    totalOnHand: number;
    totalValue: number;
    totalIncoming: number;
  };
  warehouses: WarehouseInfo[];
  costEffectiveDate: string;
  fetchedAt: string;
}

// Pivoted row: one SKU across all warehouses
interface PivotRow {
  standardSku: string;
  stordSku: string | null;
  category: string | null;
  productName: string;
  ans: number;
  stord: number;
  bmc: number;
  total: number;
  incoming: number;
  unitCost: number | null;
  totalValue: number | null;
}

type WarehouseTab = "ALL" | "ANS" | "STORD" | "BMC";

const TABS: { key: WarehouseTab; label: string }[] = [
  { key: "ALL", label: "All Locations" },
  { key: "ANS", label: "ANS" },
  { key: "STORD", label: "Stord" },
  { key: "BMC", label: "BMC" },
];

type SortField = "sku" | "category" | "totalOnHand" | "unitCost" | "totalValue" | "incoming";
type SortDir = "asc" | "desc";

export default function OnHandInventoryPage() {
  const [data, setData] = useState<OnHandResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("totalValue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showZero, setShowZero] = useState(false);
  const [activeTab, setActiveTab] = useState<WarehouseTab>("ALL");

  const fetchData = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (forceRefresh) params.set("refresh", "1");
      const url = `/api/warehouse/on-hand?${params}`;
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

  // Build pivot rows for "All Locations" view
  const pivotRows = useMemo((): PivotRow[] => {
    if (!data) return [];
    const bySkuMap = new Map<string, PivotRow>();

    for (const item of data.items) {
      const key = item.standardSku;
      let row = bySkuMap.get(key);
      if (!row) {
        row = {
          standardSku: item.standardSku,
          stordSku: item.stordSku,
          category: item.category,
          productName: item.productName || item.standardSku,
          ans: 0,
          stord: 0,
          bmc: 0,
          total: 0,
          incoming: 0,
          unitCost: item.unitCost,
          totalValue: null,
        };
        bySkuMap.set(key, row);
      }

      if (item.warehouse === "ANS") row.ans += item.totalOnHand;
      else if (item.warehouse === "STORD") row.stord += item.totalOnHand;
      else if (item.warehouse === "BMC") row.bmc += item.totalOnHand;
      row.incoming += item.incoming;

      // Prefer non-null unit cost
      if (item.unitCost !== null) row.unitCost = item.unitCost;
    }

    // Calculate totals
    for (const row of bySkuMap.values()) {
      row.total = row.ans + row.stord + row.bmc;
      row.totalValue =
        row.unitCost !== null && row.total > 0
          ? Math.round(row.unitCost * row.total * 100) / 100
          : null;
    }

    return Array.from(bySkuMap.values());
  }, [data]);

  // Filter items for single-warehouse tabs
  const singleWarehouseItems = useMemo(() => {
    if (!data || activeTab === "ALL") return [];
    return data.items.filter((item) => item.warehouse === activeTab);
  }, [data, activeTab]);

  // Filtered + sorted pivot rows (All tab)
  const filteredPivot = useMemo(() => {
    let rows = pivotRows;
    if (!showZero) rows = rows.filter((r) => r.total > 0);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.standardSku.toLowerCase().includes(q) ||
          (r.stordSku?.toLowerCase().includes(q) ?? false) ||
          (r.category?.toLowerCase().includes(q) ?? false) ||
          r.productName.toLowerCase().includes(q)
      );
    }
    return rows.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortField) {
        case "sku":
          return a.standardSku.localeCompare(b.standardSku) * dir;
        case "category":
          return (a.category || "zzz").localeCompare(b.category || "zzz") * dir;
        case "totalOnHand":
          return (a.total - b.total) * dir;
        case "unitCost":
          return ((a.unitCost ?? 0) - (b.unitCost ?? 0)) * dir;
        case "totalValue":
          return ((a.totalValue ?? 0) - (b.totalValue ?? 0)) * dir;
        case "incoming":
          return (a.incoming - b.incoming) * dir;
        default:
          return 0;
      }
    });
  }, [pivotRows, showZero, search, sortField, sortDir]);

  // Filtered + sorted items (single warehouse tab)
  const filteredSingle = useMemo(() => {
    let items = singleWarehouseItems;
    if (!showZero) items = items.filter((i) => i.totalOnHand > 0);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.standardSku.toLowerCase().includes(q) ||
          (i.stordSku?.toLowerCase().includes(q) ?? false) ||
          (i.category?.toLowerCase().includes(q) ?? false) ||
          i.productName.toLowerCase().includes(q)
      );
    }
    return items.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortField) {
        case "sku":
          return a.standardSku.localeCompare(b.standardSku) * dir;
        case "category":
          return (a.category || "zzz").localeCompare(b.category || "zzz") * dir;
        case "totalOnHand":
          return (a.totalOnHand - b.totalOnHand) * dir;
        case "unitCost":
          return ((a.unitCost ?? 0) - (b.unitCost ?? 0)) * dir;
        case "totalValue":
          return ((a.extendedValue ?? 0) - (b.extendedValue ?? 0)) * dir;
        case "incoming":
          return (a.incoming - b.incoming) * dir;
        default:
          return 0;
      }
    });
  }, [singleWarehouseItems, showZero, search, sortField, sortDir]);

  // Summary for current view
  const viewSummary = useMemo(() => {
    if (activeTab === "ALL") {
      return {
        totalSkus: filteredPivot.length,
        totalOnHand: filteredPivot.reduce((s, r) => s + r.total, 0),
        totalValue: filteredPivot.reduce((s, r) => s + (r.totalValue ?? 0), 0),
        totalIncoming: filteredPivot.reduce((s, r) => s + r.incoming, 0),
      };
    }
    return {
      totalSkus: filteredSingle.length,
      totalOnHand: filteredSingle.reduce((s, i) => s + i.totalOnHand, 0),
      totalValue: filteredSingle.reduce((s, i) => s + (i.extendedValue ?? 0), 0),
      totalIncoming: filteredSingle.reduce((s, i) => s + i.incoming, 0),
    };
  }, [activeTab, filteredPivot, filteredSingle]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "sku" || field === "category" ? "asc" : "desc");
    }
  };

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

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const fmtCost = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const activeWarehouse = data?.warehouses?.find((w) => w.code === activeTab);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Inventory
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Inventory across all locations
              {data && (
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

        {/* Warehouse Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === tab.key
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Data Source Indicators */}
        {data?.warehouses && data.warehouses.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-4">
            {data.warehouses.map((wh) => (
              <span
                key={wh.code}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
                  activeTab === "ALL" || activeTab === wh.code
                    ? "bg-gray-100 text-gray-600"
                    : "bg-gray-50 text-gray-400"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    wh.sourceType === "api"
                      ? "bg-green-500"
                      : wh.sourceType === "calculated"
                      ? "bg-blue-500"
                      : "bg-amber-500"
                  }`}
                />
                {wh.name}: {wh.sourceLabel}
              </span>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* Summary Cards */}
        {data && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Inventory Value</p>
              <p className="text-xl font-semibold text-gray-900">
                {fmt(viewSummary.totalValue)}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Units on Hand</p>
              <p className="text-xl font-semibold text-gray-900">
                {viewSummary.totalOnHand.toLocaleString()}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">SKUs</p>
              <p className="text-xl font-semibold text-gray-500">
                {viewSummary.totalSkus.toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* Search + Filters */}
        {data && (
          <div className="flex items-center gap-4 mb-4">
            <input
              type="text"
              placeholder="Search by SKU, name, or category..."
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
              {activeTab === "ALL" ? filteredPivot.length : filteredSingle.length} items
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500">Loading inventory...</p>
          </div>
        )}

        {/* === ALL LOCATIONS — Pivot Table === */}
        {activeTab === "ALL" && filteredPivot.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <SortHeader field="sku" label="SKU" />
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <SortHeader field="category" label="Type" />
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">ANS</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Stord</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">BMC</th>
                  <SortHeader field="totalOnHand" label="Total" align="right" />
                  <SortHeader field="unitCost" label="Unit Cost" align="right" />
                  <SortHeader field="totalValue" label="Value" align="right" />
                </tr>
              </thead>
              <tbody>
                {filteredPivot.map((row) => {
                  const missingCost = row.unitCost === null && row.total > 0;
                  return (
                    <tr
                      key={row.standardSku}
                      className={`border-b border-gray-100 hover:bg-gray-50 ${
                        missingCost ? "bg-red-50/40" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-semibold text-gray-900 text-xs">
                          {row.standardSku}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-xs">
                        {row.productName !== row.standardSku ? row.productName : "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {row.category || "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {row.ans > 0 ? row.ans.toLocaleString() : <span className="text-gray-300">{"\u2014"}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {row.stord > 0 ? row.stord.toLocaleString() : <span className="text-gray-300">{"\u2014"}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {row.bmc > 0 ? row.bmc.toLocaleString() : <span className="text-gray-300">{"\u2014"}</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 font-semibold tabular-nums">
                        {row.total.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.unitCost !== null ? (
                          <span className="text-gray-700">{fmtCost(row.unitCost)}</span>
                        ) : missingCost ? (
                          <span className="text-red-500 text-xs font-medium">Missing</span>
                        ) : (
                          <span className="text-gray-300">{"\u2014"}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {row.totalValue !== null ? (
                          <span className="text-gray-900">{fmt(row.totalValue)}</span>
                        ) : (
                          <span className="text-gray-300">{"\u2014"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-300">
                  <td colSpan={3} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Totals
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900 tabular-nums">
                    {filteredPivot.reduce((s, r) => s + r.ans, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900 tabular-nums">
                    {filteredPivot.reduce((s, r) => s + r.stord, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900 tabular-nums">
                    {filteredPivot.reduce((s, r) => s + r.bmc, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900 tabular-nums">
                    {viewSummary.totalOnHand.toLocaleString()}
                  </td>
                  <td></td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900 text-base">
                    {fmt(viewSummary.totalValue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* === SINGLE WAREHOUSE — Simple Table === */}
        {activeTab !== "ALL" && filteredSingle.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <SortHeader field="sku" label="SKU" />
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <SortHeader field="category" label="Type" />
                  <SortHeader field="totalOnHand" label="On-Hand" align="right" />
                  <SortHeader field="unitCost" label="Unit Cost" align="right" />
                  <SortHeader field="totalValue" label="Value" align="right" />
                  {activeTab === "STORD" && (
                    <SortHeader field="incoming" label="Incoming" align="right" />
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredSingle.map((item, idx) => {
                  const missingCost = item.unitCost === null && item.totalOnHand > 0;
                  return (
                    <tr
                      key={`${item.warehouse}-${item.standardSku}-${item.stordSku || idx}`}
                      className={`border-b border-gray-100 hover:bg-gray-50 ${
                        missingCost ? "bg-red-50/40" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-semibold text-gray-900 text-xs">
                          {item.standardSku}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-xs">
                        {item.productName !== item.standardSku ? item.productName : "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {item.category || "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 font-semibold tabular-nums">
                        {item.totalOnHand.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {item.unitCost !== null ? (
                          <span className="text-gray-700">{fmtCost(item.unitCost)}</span>
                        ) : missingCost ? (
                          <span className="text-red-500 text-xs font-medium">Missing</span>
                        ) : (
                          <span className="text-gray-300">{"\u2014"}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {item.extendedValue !== null ? (
                          <span className="text-gray-900">{fmt(item.extendedValue)}</span>
                        ) : (
                          <span className="text-gray-300">{"\u2014"}</span>
                        )}
                      </td>
                      {activeTab === "STORD" && (
                        <td className="px-4 py-3 text-right text-amber-600">
                          {item.incoming > 0 ? item.incoming.toLocaleString() : "\u2014"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-300">
                  <td
                    colSpan={activeTab === "STORD" ? 6 : 5}
                    className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  >
                    Total
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900 text-base">
                    {fmt(viewSummary.totalValue)}
                  </td>
                  {activeTab === "STORD" && <td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Empty state */}
        {data &&
          !loading &&
          ((activeTab === "ALL" && filteredPivot.length === 0) ||
            (activeTab !== "ALL" && filteredSingle.length === 0)) && (
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
              <p className="text-gray-500">
                {search
                  ? "No items match your search."
                  : activeTab === "BMC"
                  ? "No inventory data for BMC. Upload a snapshot via Data Ingestion."
                  : "No inventory items found."}
              </p>
            </div>
          )}
      </div>
    </div>
  );
}
