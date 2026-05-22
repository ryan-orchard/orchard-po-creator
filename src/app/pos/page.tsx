"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

interface POLine {
  poLineId: string;
  poId: string;
  poNumber: string;
  orderDate: string | null;
  poShipDate: string | null;
  supplierName: string;
  supplierCode: string;
  itemSku: string;
  itemName: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
  lineState: string;
  expectedShipDate: string | null;
  expectedReceiveDate: string | null;
  actualShipDate: string | null;
  receivedDate: string | null;
  cancelledQty: number;
  notes: string | null;
}

const stateColors: Record<string, string> = {
  ordered: "bg-warm-100 text-warm-800",
  confirmed: "bg-gold-100 text-gold-800",
  complete: "bg-sage-100 text-sage-800",
  cancelled: "bg-gray-100 text-gray-600",
};

const stateLabels: Record<string, string> = {
  ordered: "Ordered",
  confirmed: "Confirmed",
  complete: "Complete",
  cancelled: "Cancelled",
};

type TabKey = "ordered" | "confirmed" | "complete" | "all";

// PO line statuses. "All" includes complete.
const TABS: { key: TabKey; label: string; states: string[] }[] = [
  { key: "ordered", label: "Ordered", states: ["ordered"] },
  { key: "confirmed", label: "Confirmed", states: ["confirmed"] },
  { key: "complete", label: "Complete", states: ["complete"] },
  { key: "all", label: "All", states: ["ordered", "confirmed", "complete"] },
];

const OPEN_STATES = ["ordered", "confirmed"];

// Only these columns are filterable
type FilterField = "poNumber" | "itemSku" | "supplierName";
const FILTER_FIELDS: { field: FilterField; label: string }[] = [
  { field: "poNumber", label: "PO #" },
  { field: "itemSku", label: "SKU" },
  { field: "supplierName", label: "Supplier" },
];

type SortField =
  | "poNumber"
  | "itemSku"
  | "itemName"
  | "supplierName"
  | "qty"
  | "unitCost"
  | "lineTotal"
  | "lineState"
  | "poShipDate"
  | "xShipDate"
  | "actualShipDate"
  | "receivedDate";
type SortDir = "asc" | "desc";

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const yy = String(dt.getFullYear()).slice(2);
  return `${mm}/${dd}/${yy}`;
};

const fmtMoney0 = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

const fmtMoney2 = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Generic outside-click hook
function useClickOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onClose]);
}

// ---- Value picker for a single filter ----
function ValuePicker({
  values,
  selected,
  onChange,
}: {
  values: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? values.filter((v) => v.toLowerCase().includes(q)) : values;
  }, [values, search]);

  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  };

  return (
    <div className="w-60 py-1">
      <div className="px-2 py-1.5">
        <input
          autoFocus
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
      </div>
      <div className="flex items-center justify-between px-3 py-1 text-[11px] text-gray-500 border-b border-gray-100">
        <button onClick={() => onChange(new Set(filtered))} className="hover:text-gray-900">
          Select all
        </button>
        <button onClick={() => onChange(new Set())} className="hover:text-gray-900">
          Clear
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-400">No values</div>
        ) : (
          filtered.map((v) => (
            <label
              key={v}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(v)}
                onChange={() => toggle(v)}
                className="rounded border-gray-300"
              />
              <span className="truncate">{v || "(empty)"}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

// ---- "+ Filter" button: opens menu of fields you can filter on ----
function AddFilterMenu({
  available,
  onPick,
  onClose,
}: {
  available: { field: FilterField; label: string }[];
  onPick: (field: FilterField) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose);
  const [search, setSearch] = useState("");
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? available.filter((a) => a.label.toLowerCase().includes(q)) : available;
  }, [available, search]);

  return (
    <div
      ref={ref}
      className="absolute z-20 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg py-1"
    >
      <div className="px-2 py-1.5">
        <input
          autoFocus
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filters…"
          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
      </div>
      <div className="py-1">
        {list.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-400">No matches</div>
        ) : (
          list.map((a) => (
            <button
              key={a.field}
              onClick={() => onPick(a.field)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 text-left"
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h18l-7 9v6l-4 2v-8L3 4.5z" />
              </svg>
              {a.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ---- Active filter chip with popover ----
function FilterChip({
  label,
  values,
  selected,
  onChange,
  onRemove,
}: {
  label: string;
  values: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const summary =
    selected.size === 0 ? "Any" : selected.size === 1 ? Array.from(selected)[0] : `${selected.size} selected`;

  return (
    <div ref={ref} className="relative inline-flex">
      <div className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-md text-xs">
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 hover:bg-gray-50 rounded-l-md"
        >
          <span className="text-gray-500">{label}:</span>
          <span className="text-gray-900 font-medium truncate max-w-[120px]">{summary}</span>
          <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          onClick={onRemove}
          className="px-1.5 py-1 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-r-md"
          aria-label={`Remove ${label} filter`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
          <ValuePicker values={values} selected={selected} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

export default function POLinesPage() {
  const router = useRouter();
  const [lines, setLines] = useState<POLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<FilterField[]>([]);
  const [filterValues, setFilterValues] = useState<Record<FilterField, Set<string>>>({
    poNumber: new Set(),
    itemSku: new Set(),
    supplierName: new Set(),
  });
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const addFilterAnchorRef = useRef<HTMLDivElement>(null);

  const [sortField, setSortField] = useState<SortField>("xShipDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    fetch("/api/po-lines")
      .then((r) => r.json())
      .then((data) => {
        setLines(data);
        setLoading(false);
      });
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortField(field);
      setSortDir(field === "lineTotal" || field === "qty" ? "desc" : "asc");
    }
  };

  // Tab filter
  const tabConfig = TABS.find((t) => t.key === activeTab)!;
  const stateFilteredLines = useMemo(() => {
    if (tabConfig.states.length === 0) return lines;
    return lines.filter((l) => tabConfig.states.includes(l.lineState));
  }, [lines, tabConfig]);

  const valueFor = (l: POLine, col: FilterField): string => {
    switch (col) {
      case "poNumber":
        return l.poNumber;
      case "itemSku":
        return l.itemSku;
      case "supplierName":
        return l.supplierName;
    }
  };

  // Apply filter chips
  const chipFiltered = useMemo(() => {
    return stateFilteredLines.filter((l) => {
      for (const field of activeFilters) {
        const set = filterValues[field];
        if (set.size === 0) continue;
        if (!set.has(valueFor(l, field))) return false;
      }
      return true;
    });
  }, [stateFilteredLines, activeFilters, filterValues]);

  // Free-text search across visible row content
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return chipFiltered;
    return chipFiltered.filter((l) => {
      const hay = [
        l.poNumber,
        l.itemSku,
        l.itemName,
        l.supplierName,
        stateLabels[l.lineState] || l.lineState,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [chipFiltered, search]);

  const sortedLines = useMemo(() => {
    const arr = [...searched];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "poNumber":
          cmp = a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true });
          break;
        case "itemSku":
          cmp = a.itemSku.localeCompare(b.itemSku);
          break;
        case "itemName":
          cmp = a.itemName.localeCompare(b.itemName);
          break;
        case "supplierName":
          cmp = a.supplierName.localeCompare(b.supplierName);
          break;
        case "qty":
          cmp = a.qty - b.qty;
          break;
        case "unitCost":
          cmp = a.unitCost - b.unitCost;
          break;
        case "lineTotal":
          cmp = a.lineTotal - b.lineTotal;
          break;
        case "lineState":
          cmp = a.lineState.localeCompare(b.lineState);
          break;
        case "poShipDate":
          cmp = (a.poShipDate || "9999").localeCompare(b.poShipDate || "9999");
          break;
        case "xShipDate": {
          const ax = a.expectedShipDate || a.poShipDate || "9999";
          const bx = b.expectedShipDate || b.poShipDate || "9999";
          cmp = ax.localeCompare(bx);
          break;
        }
        case "actualShipDate":
          cmp = (a.actualShipDate || "9999").localeCompare(b.actualShipDate || "9999");
          break;
        case "receivedDate":
          cmp = (a.receivedDate || "9999").localeCompare(b.receivedDate || "9999");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [searched, sortField, sortDir]);

  // Summary
  const openPOIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of lines) if (OPEN_STATES.includes(l.lineState)) ids.add(l.poId);
    return ids;
  }, [lines]);

  const openPOValue = useMemo(() => {
    let total = 0;
    for (const l of lines) {
      if (openPOIds.has(l.poId) && OPEN_STATES.includes(l.lineState)) total += l.lineTotal;
    }
    return total;
  }, [lines, openPOIds]);

  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { ordered: 0, confirmed: 0, complete: 0, all: 0 };
    for (const l of lines) {
      if (l.lineState === "ordered") counts.ordered++;
      else if (l.lineState === "confirmed") counts.confirmed++;
      else if (l.lineState === "complete") counts.complete++;
    }
    counts.all = counts.ordered + counts.confirmed + counts.complete;
    return counts;
  }, [lines]);

  // Available filter fields (only show ones not already active)
  const availableFilters = useMemo(
    () => FILTER_FIELDS.filter((f) => !activeFilters.includes(f.field)),
    [activeFilters]
  );

  // Unique values per filterable column (computed off stateFilteredLines for relevance)
  const uniqueValuesFor = (col: FilterField): string[] => {
    const set = new Set<string>();
    for (const l of stateFilteredLines) set.add(valueFor(l, col));
    return [...set].filter((v) => v !== "").sort();
  };

  // Column config
  type Col = { field: SortField; label: string; align: string; width: string };
  const baseCols: Col[] = [
    { field: "poNumber",     label: "PO #",        align: "text-left",  width: "w-24" },
    { field: "itemSku",      label: "SKU",         align: "text-left",  width: "w-44" },
    { field: "itemName",     label: "Description", align: "text-left",  width: "" },
    { field: "supplierName", label: "Supplier",    align: "text-left",  width: "w-24" },
    { field: "qty",          label: "Qty",         align: "text-right", width: "w-20" },
    { field: "unitCost",     label: "Unit Cost",   align: "text-right", width: "w-24" },
    { field: "lineTotal",    label: "Total",       align: "text-right", width: "w-24" },
    { field: "lineState",    label: "Status",      align: "text-left",  width: "w-28" },
    { field: "poShipDate",   label: "PO Ship",     align: "text-left",  width: "w-24" },
  ];

  const cols: Col[] = [
    ...baseCols,
    { field: "xShipDate", label: "X-Ship", align: "text-left", width: "w-24" },
  ];

  // X-Ship falls back to PO Ship Date when expected_ship_date is blank
  // (e.g. ANS "TBD" lines, or non-ANS suppliers)
  const xShipFor = (l: POLine) => l.expectedShipDate || l.poShipDate;

  const dateCellFor = (l: POLine) => fmtDate(xShipFor(l));

  const exportCsv = () => {
    const escape = (v: string | number | null | undefined) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = cols.map((c) => c.label);
    const rows = sortedLines.map((l) =>
      cols.map((c) => {
        switch (c.field) {
          case "poNumber": return l.poNumber;
          case "itemSku": return l.itemSku;
          case "itemName": return l.itemName;
          case "supplierName": return l.supplierName;
          case "qty": return l.qty;
          case "unitCost": return l.unitCost.toFixed(2);
          case "lineTotal": return l.lineTotal.toFixed(2);
          case "lineState": return stateLabels[l.lineState] || l.lineState;
          case "poShipDate": return fmtDate(l.poShipDate);
          case "xShipDate": return fmtDate(xShipFor(l));
          case "actualShipDate": return fmtDate(l.actualShipDate);
          case "receivedDate": return fmtDate(l.receivedDate);
        }
      })
    );
    const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-orders-${activeTab}-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const addFilter = (field: FilterField) => {
    setActiveFilters((prev) => (prev.includes(field) ? prev : [...prev, field]));
    setAddFilterOpen(false);
  };

  const removeFilter = (field: FilterField) => {
    setActiveFilters((prev) => prev.filter((f) => f !== field));
    setFilterValues((prev) => ({ ...prev, [field]: new Set() }));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-screen-2xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Purchase Orders</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              disabled={loading || sortedLines.length === 0}
              className="inline-flex items-center gap-1.5 border border-gray-300 text-gray-700 px-4 py-2 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              Export CSV
            </button>
            <button
              onClick={() => router.push("/pos/new")}
              className="bg-gray-900 text-white px-5 py-2 text-sm font-medium rounded-lg hover:bg-gray-800"
            >
              + Create PO
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        {!loading && (
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-white rounded-lg border border-gray-200 px-6 py-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
                Lines by Status
              </p>
              <div className="space-y-2.5">
                {TABS.filter((t) => t.key !== "all").map((tab) => {
                  const count = tabCounts[tab.key];
                  const dot = tab.key === "ordered" ? "bg-warm-500" : "bg-gold-500";
                  return (
                    <div key={tab.key} className="flex items-center justify-between px-2 py-1.5">
                      <span className="flex items-center gap-2.5">
                        <span className={`w-2 h-2 rounded-full ${count > 0 ? dot : "bg-gray-200"}`} />
                        <span className={`text-sm ${count > 0 ? "text-gray-700" : "text-gray-400"}`}>{tab.label}</span>
                      </span>
                      <span className={`text-sm tabular-nums ${count > 0 ? "font-semibold text-gray-900" : "text-gray-300"}`}>
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 px-6 py-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Open PO Value
              </p>
              <p className="text-3xl font-bold text-gray-900 tabular-nums">{fmtMoney0(openPOValue)}</p>
              <p className="text-sm text-gray-400 mt-1">
                Across {openPOIds.size} open {openPOIds.size === 1 ? "PO" : "POs"}
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            const count = tabCounts[tab.key];
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  setActiveFilters([]);
                  setFilterValues({ poNumber: new Set(), itemSku: new Set(), supplierName: new Set() });
                  setSearch("");
                }}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                  active ? "bg-gray-900 text-white" : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`inline-block px-1.5 py-0.5 text-xs rounded-full tabular-nums ${
                    active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Toolbar: search + filter */}
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
              />
            </div>

            <div className="relative" ref={addFilterAnchorRef}>
              <button
                onClick={() => setAddFilterOpen(!addFilterOpen)}
                className="inline-flex items-center justify-center w-9 h-9 bg-white border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50"
                aria-label="Add filter"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h18l-7 9v6l-4 2v-8L3 4.5z" />
                </svg>
              </button>
              {addFilterOpen && availableFilters.length > 0 && (
                <AddFilterMenu
                  available={availableFilters}
                  onPick={addFilter}
                  onClose={() => setAddFilterOpen(false)}
                />
              )}
            </div>

            {/* Active filter chips */}
            {activeFilters.map((field) => {
              const meta = FILTER_FIELDS.find((f) => f.field === field)!;
              return (
                <FilterChip
                  key={field}
                  label={meta.label}
                  values={uniqueValuesFor(field)}
                  selected={filterValues[field]}
                  onChange={(next) => setFilterValues((prev) => ({ ...prev, [field]: next }))}
                  onRemove={() => removeFilter(field)}
                />
              );
            })}
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : sortedLines.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500">No lines match.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                {cols.map((c) => (
                  <col key={c.field} className={c.width} />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/40">
                  {cols.map((col) => (
                    <th
                      key={col.field}
                      onClick={() => handleSort(col.field)}
                      className={`${col.align} px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {sortField === col.field && (
                          <span className="text-gray-400">{sortDir === "asc" ? "↑" : "↓"}</span>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedLines.map((line) => (
                  <tr
                    key={line.poLineId}
                    onClick={() => router.push(`/pos/${line.poId}`)}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 cursor-pointer"
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{line.poNumber}</td>
                    <td className="px-4 py-2.5 text-gray-900 truncate" title={line.itemSku}>
                      {line.itemSku || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700 truncate" title={line.itemName}>
                      {line.itemName || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 truncate" title={line.supplierName}>
                      {line.supplierCode || line.supplierName || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">
                      {line.qty.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                      {line.unitCost ? fmtMoney2(line.unitCost) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900 tabular-nums">
                      {line.lineTotal ? fmtMoney0(line.lineTotal) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full ${stateColors[line.lineState] || "bg-gray-100 text-gray-600"}`}
                      >
                        {stateLabels[line.lineState] || line.lineState}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 tabular-nums whitespace-nowrap">{fmtDate(line.poShipDate)}</td>
                    <td className="px-4 py-2.5 text-gray-600 tabular-nums whitespace-nowrap">{dateCellFor(line)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-2.5 border-t border-gray-100 text-xs text-gray-400">
              Showing {sortedLines.length} {sortedLines.length === 1 ? "line" : "lines"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
