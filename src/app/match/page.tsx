"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// --- Types ---

interface MatchState {
  invoice: {
    id: string;
    invoiceNumber: string;
    supplier: string;
    invoiceDate: string;
    invoiceAmount: number;
    paymentStatus: string;
    invoiceType: string;
    matchStatus: string;
    poReference: string;
  };
  order: {
    type: "po" | "wo";
    id: string;
    number: string;
    status: string;
    date: string;
    supplier: string;
  } | null;
  noOrderConfirmed: boolean;
  receipts: {
    id: string;
    receiptNumber: string;
    receivedDate: string;
    warehouse: string;
    totalCartons: number;
    confirmed: boolean;
    lineCount: number;
    matchStatus: string;
  }[];
  summary: {
    invoiceLinked: boolean;
    orderLinked: boolean;
    receiptsConfirmed: boolean;
    confirmedCount: number;
    totalReceipts: number;
    totalCartons: number;
    linkedCount: number;
  };
}

interface POOption {
  id: string;
  poNumber: string;
  status: string;
  date: string;
  grandTotal: number;
  lineItems: string[];
}

interface POLineItem {
  id: string;
  sku: { standardSku: string; uom: string } | null;
  qtySticks: number;
  qtyCartons: number;
  unitCost: number;
}

interface WOOption {
  id: string;
  woNumber: string;
  status: string;
  issuedDate: string;
  description: string;
  lineItems: string[];
}

interface WOLineItem {
  id: string;
  sku: { standardSku: string; uom: string } | null;
  lineType: string;
  qty: number;
}

// --- Helpers ---

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(s: string | null | undefined) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// --- Progress Bar ---

function ProgressBar({ linkedCount }: { linkedCount: number }) {
  const steps = ["Invoice", "Order", "Receipts"];
  return (
    <div className="flex items-center mb-6">
      {steps.map((step, i) => {
        const done = i < linkedCount;
        const active = i === linkedCount && linkedCount < 3;
        return (
          <div key={step} className={`flex items-center ${i < 2 ? "flex-1" : ""}`}>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                ${done ? "bg-sage-600 text-white" : active ? "bg-amber-400 text-white" : "bg-gray-200 text-gray-500"}`}>
                {done ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (i + 1)}
              </div>
              <span className={`text-sm font-medium ${done ? "text-sage-700" : active ? "text-gray-900" : "text-gray-400"}`}>
                {step}
              </span>
            </div>
            {i < 2 && (
              <div className={`flex-1 h-px mx-4 ${done ? "bg-sage-500" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Selector Card ---

type CardId = "invoice" | "order" | "receipts";

interface SelectorCardProps {
  id: CardId;
  active: boolean;
  linked: boolean;
  partial?: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
}

function SelectorCard({ id, active, linked, partial, title, subtitle, onClick }: SelectorCardProps) {
  const statusDot = linked
    ? <span className="w-5 h-5 rounded-full bg-sage-100 flex items-center justify-center flex-shrink-0">
        <svg className="w-3 h-3 text-sage-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </span>
    : partial
    ? <span className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-amber-400" />
      </span>
    : <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-gray-300" />
      </span>;

  return (
    <button
      onClick={onClick}
      className={`flex-1 text-left p-4 rounded-xl border-2 transition-all cursor-pointer min-h-[100px]
        ${active
          ? "border-gray-900 bg-white shadow-sm"
          : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"}`}
    >
      <div className="flex items-start justify-between gap-2 h-full">
        <div className="min-w-0 flex flex-col">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{id}</p>
          <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
          <p className="text-xs text-gray-500 mt-1 leading-snug">{subtitle}</p>
        </div>
        {statusDot}
      </div>
    </button>
  );
}

// --- Invoice Panel ---

function InvoicePanel({ invoice }: { invoice: MatchState["invoice"] }) {
  const rows = [
    { label: "Invoice #", value: invoice.invoiceNumber },
    { label: "Supplier", value: invoice.supplier || "—" },
    { label: "Invoice Date", value: formatDate(invoice.invoiceDate) },
    { label: "Amount", value: formatCurrency(invoice.invoiceAmount) },
    { label: "Payment Status", value: invoice.paymentStatus || "—" },
    { label: "PO Reference", value: invoice.poReference || "—" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Invoice Details</h3>
        <Link
          href={`/invoices/${invoice.id}`}
          className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1"
        >
          View invoice
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
        {rows.map(({ label, value }) => (
          <div key={label}>
            <dt className="text-xs text-gray-400">{label}</dt>
            <dd className="text-sm font-medium text-gray-900 mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// --- Order Panel ---

function OrderPanel({
  order,
  noOrderConfirmed,
  invoiceId,
  onRefresh,
}: {
  order: MatchState["order"];
  noOrderConfirmed: boolean;
  invoiceId: string;
  onRefresh: () => void;
}) {
  const [mode, setMode] = useState<"summary" | "search-po" | "search-wo">("summary");
  const [query, setQuery] = useState("");
  const [pos, setPOs] = useState<POOption[]>([]);
  const [wos, setWOs] = useState<WOOption[]>([]);
  const [selectedPO, setSelectedPO] = useState<POOption | null>(null);
  const [selectedWO, setSelectedWO] = useState<WOOption | null>(null);
  const [selectedPOLines, setSelectedPOLines] = useState<POLineItem[]>([]);
  const [selectedWOLines, setSelectedWOLines] = useState<WOLineItem[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadPOs = useCallback(async () => {
    const res = await fetch("/api/purchase-orders");
    if (res.ok) {
      const data = await res.json();
      setPOs(Array.isArray(data) ? data : []);
    }
  }, []);

  const loadWOs = useCallback(async () => {
    const res = await fetch("/api/work-orders");
    if (res.ok) {
      const data = await res.json();
      setWOs(Array.isArray(data) ? data : []);
    }
  }, []);

  const selectPO = useCallback(async (po: POOption) => {
    if (selectedPO?.id === po.id) {
      setSelectedPO(null);
      setSelectedPOLines([]);
      return;
    }
    setSelectedPO(po);
    setSelectedPOLines([]);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedPOLines(data.lineItems || []);
      }
    } finally {
      setLoadingDetail(false);
    }
  }, [selectedPO]);

  const selectWO = useCallback(async (wo: WOOption) => {
    if (selectedWO?.id === wo.id) {
      setSelectedWO(null);
      setSelectedWOLines([]);
      return;
    }
    setSelectedWO(wo);
    setSelectedWOLines([]);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/work-orders/${wo.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedWOLines(data.lineItems || []);
      }
    } finally {
      setLoadingDetail(false);
    }
  }, [selectedWO]);

  const linkOrder = useCallback(async (type: "po" | "wo" | "none" | "unlink", id?: string) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/match/${invoiceId}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Failed");
      } else {
        onRefresh();
        setMode("summary");
        setQuery("");
        setSelectedPO(null);
        setSelectedWO(null);
        setSelectedPOLines([]);
        setSelectedWOLines([]);
      }
    } finally {
      setSaving(false);
    }
  }, [invoiceId, onRefresh]);

  const filteredPOs = pos.filter(p =>
    !query || p.poNumber?.toLowerCase().includes(query.toLowerCase())
  );
  const filteredWOs = wos.filter(w =>
    !query || w.woNumber?.toLowerCase().includes(query.toLowerCase()) ||
    w.description?.toLowerCase().includes(query.toLowerCase())
  );

  // Linked state
  if (order || noOrderConfirmed) {
    return (
      <div>
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Linked Order</h3>
          <button
            onClick={() => linkOrder("unlink")}
            disabled={saving}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            Remove link
          </button>
        </div>

        {noOrderConfirmed ? (
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
            <p className="text-sm font-semibold text-gray-900">No order</p>
            <p className="text-xs text-gray-500 mt-1">Credit card or direct purchase — no PO or WO.</p>
          </div>
        ) : order ? (
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-0.5">
                  {order.type === "po" ? "Purchase Order" : "Work Order"}
                </p>
                <p className="text-lg font-bold text-gray-900">{order.number}</p>
                {order.supplier && <p className="text-sm text-gray-500 mt-0.5">{order.supplier}</p>}
              </div>
              <div className="text-right">
                <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-sage-100 text-sage-700">
                  {order.status}
                </span>
                {order.date && <p className="text-xs text-gray-400 mt-1.5">{formatDate(order.date)}</p>}
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200">
              <Link
                href={order.type === "po" ? `/pos/${order.id}` : `/work-orders/${order.id}`}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"
              >
                View {order.type === "po" ? "PO" : "work order"}
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </Link>
            </div>
          </div>
        ) : null}

        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>
    );
  }

  // PO search
  if (mode === "search-po") {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => { setMode("summary"); setQuery(""); setSelectedPO(null); }}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h3 className="text-sm font-semibold text-gray-900">Select a Purchase Order</h3>
        </div>

        <input
          autoFocus
          type="text"
          placeholder="Search by PO number…"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedPO(null); }}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-gray-900"
        />

        <div className="space-y-1.5 max-h-48 overflow-y-auto mb-4">
          {filteredPOs.length === 0 && (
            <p className="text-sm text-gray-400 py-4 text-center">No purchase orders found</p>
          )}
          {filteredPOs.map(po => (
            <button
              key={po.id}
              onClick={() => selectPO(po)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors
                ${selectedPO?.id === po.id
                  ? "border-gray-900 bg-gray-50"
                  : "border-gray-200 hover:border-gray-300"}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{po.poNumber}</p>
                <span className="text-xs text-gray-400">{po.status}</span>
              </div>
              {po.date && <p className="text-xs text-gray-400 mt-0.5">{formatDate(po.date)}</p>}
            </button>
          ))}
        </div>

        {/* Selected PO detail + confirm */}
        {selectedPO && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 mb-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-base font-bold text-gray-900">{selectedPO.poNumber}</p>
                <p className="text-xs text-gray-500 mt-0.5">{formatDate(selectedPO.date)}</p>
              </div>
              <div className="text-right">
                {selectedPO.grandTotal > 0 && (
                  <p className="text-sm font-semibold text-gray-900">{formatCurrency(selectedPO.grandTotal)}</p>
                )}
                <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 mt-1">
                  {selectedPO.status}
                </span>
              </div>
            </div>

            {/* Line items */}
            {loadingDetail ? (
              <p className="text-xs text-gray-400 mb-3">Loading line items…</p>
            ) : selectedPOLines.length > 0 ? (
              <table className="w-full text-xs mb-4">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left font-medium text-gray-400 pb-1.5">SKU</th>
                    <th className="text-right font-medium text-gray-400 pb-1.5">Sticks</th>
                    <th className="text-right font-medium text-gray-400 pb-1.5">Cartons</th>
                    <th className="text-right font-medium text-gray-400 pb-1.5">Unit Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedPOLines.map(li => (
                    <tr key={li.id}>
                      <td className="py-1.5 font-medium text-gray-800">{li.sku?.standardSku ?? "—"}</td>
                      <td className="py-1.5 text-right text-gray-600">{li.qtySticks?.toLocaleString() ?? "—"}</td>
                      <td className="py-1.5 text-right text-gray-600">{li.qtyCartons?.toLocaleString() ?? "—"}</td>
                      <td className="py-1.5 text-right text-gray-600">{li.unitCost ? formatCurrency(li.unitCost) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            <button
              onClick={() => linkOrder("po", selectedPO.id)}
              disabled={saving}
              className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Linking…" : `Link to ${selectedPO.poNumber}`}
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  // WO search
  if (mode === "search-wo") {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => { setMode("summary"); setQuery(""); setSelectedWO(null); }}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h3 className="text-sm font-semibold text-gray-900">Select a Work Order</h3>
        </div>

        <input
          autoFocus
          type="text"
          placeholder="Search by WO number…"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedWO(null); }}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-gray-900"
        />

        <div className="space-y-1.5 max-h-48 overflow-y-auto mb-4">
          {filteredWOs.length === 0 && (
            <p className="text-sm text-gray-400 py-4 text-center">No work orders found</p>
          )}
          {filteredWOs.map(wo => (
            <button
              key={wo.id}
              onClick={() => selectWO(wo)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors
                ${selectedWO?.id === wo.id
                  ? "border-gray-900 bg-gray-50"
                  : "border-gray-200 hover:border-gray-300"}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{wo.woNumber}</p>
                <span className="text-xs text-gray-400">{wo.status}</span>
              </div>
              {wo.description && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">{wo.description}</p>
              )}
            </button>
          ))}
        </div>

        {/* Selected WO detail + confirm */}
        {selectedWO && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 mb-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-base font-bold text-gray-900">{selectedWO.woNumber}</p>
                {selectedWO.description && (
                  <p className="text-xs text-gray-500 mt-0.5">{selectedWO.description}</p>
                )}
              </div>
              <div className="text-right">
                <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-sage-100 text-sage-700">
                  {selectedWO.status}
                </span>
                {selectedWO.issuedDate && (
                  <p className="text-xs text-gray-400 mt-1">{formatDate(selectedWO.issuedDate)}</p>
                )}
              </div>
            </div>

            {/* Line items */}
            {loadingDetail ? (
              <p className="text-xs text-gray-400 mb-3">Loading line items…</p>
            ) : selectedWOLines.length > 0 ? (
              <table className="w-full text-xs mb-4">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left font-medium text-gray-400 pb-1.5">SKU</th>
                    <th className="text-left font-medium text-gray-400 pb-1.5">Type</th>
                    <th className="text-right font-medium text-gray-400 pb-1.5">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedWOLines.map(li => (
                    <tr key={li.id}>
                      <td className="py-1.5 font-medium text-gray-800">{li.sku?.standardSku ?? "—"}</td>
                      <td className="py-1.5 text-gray-500">{li.lineType}</td>
                      <td className="py-1.5 text-right text-gray-600">{li.qty?.toLocaleString() ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            <button
              onClick={() => linkOrder("wo", selectedWO.id)}
              disabled={saving}
              className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Linking…" : `Link to ${selectedWO.woNumber}`}
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  // Default: choose order type
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">Link an Order</h3>
      <p className="text-xs text-gray-500 mb-4">
        Select the PO or work order this invoice is for, or confirm there is no associated order.
      </p>
      <div className="space-y-2">
        <button
          onClick={async () => {
            setMode("search-po");
            await loadPOs();
          }}
          className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl border border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all text-left"
        >
          <div>
            <p className="text-sm font-semibold text-gray-900">Purchase Order</p>
            <p className="text-xs text-gray-400 mt-0.5">Supplier invoice with a PO</p>
          </div>
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
        <button
          onClick={async () => {
            setMode("search-wo");
            await loadWOs();
          }}
          className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl border border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all text-left"
        >
          <div>
            <p className="text-sm font-semibold text-gray-900">Work Order</p>
            <p className="text-xs text-gray-400 mt-0.5">ANS kitting or production invoice</p>
          </div>
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
        <button
          onClick={() => linkOrder("none")}
          disabled={saving}
          className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl border border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all text-left disabled:opacity-50"
        >
          <div>
            <p className="text-sm font-semibold text-gray-900">No order</p>
            <p className="text-xs text-gray-400 mt-0.5">Credit card or direct purchase — no PO or WO</p>
          </div>
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}

// --- Receipts Panel ---

function ReceiptsPanel({
  receipts,
  invoiceId,
  order,
  onRefresh,
}: {
  receipts: MatchState["receipts"];
  invoiceId: string;
  order: MatchState["order"] | null;
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const confirmedReceipts = receipts.filter(r => r.confirmed);
  const unconfirmedReceipts = receipts.filter(r => !r.confirmed);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmSelected = async () => {
    if (!selected.size) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/match/${invoiceId}/receipts/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptIds: [...selected] }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Failed to confirm");
      } else {
        setSelected(new Set());
        onRefresh();
      }
    } finally {
      setSaving(false);
    }
  };

  const removeReceipt = async (receiptId: string) => {
    setRemovingId(receiptId);
    setError("");
    try {
      const res = await fetch(`/api/match/${invoiceId}/receipts/confirm`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptId }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Failed to remove");
      } else {
        onRefresh();
      }
    } finally {
      setRemovingId(null);
    }
  };

  if (receipts.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Receipts</h3>
        <div className="py-8 text-center">
          <p className="text-sm text-gray-400">
            {order ? `No receipts found for this ${order.type === "po" ? "PO" : "work order"}.` : "No open receipts."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Receipts</h3>
        <p className="text-xs text-gray-500">
          {confirmedReceipts.length} of {receipts.length} confirmed
        </p>
      </div>

      {/* Unconfirmed */}
      {unconfirmedReceipts.length > 0 && (
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Available</p>
          <div className="space-y-1.5">
            {unconfirmedReceipts.map(r => (
              <label
                key={r.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors
                  ${selected.has(r.id) ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:border-gray-300"}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggleSelect(r.id)}
                  className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{r.receiptNumber}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatDate(r.receivedDate)}
                    {r.warehouse ? ` · ${r.warehouse}` : ""}
                  </p>
                </div>
              </label>
            ))}
          </div>
          <button
            onClick={confirmSelected}
            disabled={saving || selected.size === 0}
            className={`mt-3 w-full py-2.5 rounded-xl text-sm font-semibold transition-colors
              ${selected.size > 0
                ? "bg-gray-900 text-white hover:bg-gray-700"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}
          >
            {saving
              ? "Confirming…"
              : selected.size > 0
              ? `Confirm ${selected.size} Receipt${selected.size > 1 ? "s" : ""}`
              : "Select receipts to confirm"}
          </button>
        </div>
      )}

      {/* Confirmed */}
      {confirmedReceipts.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Confirmed</p>
          <div className="space-y-1.5">
            {confirmedReceipts.map(r => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-sage-200 bg-sage-50">
                <span className="w-5 h-5 rounded-full bg-sage-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-sage-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{r.receiptNumber}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatDate(r.receivedDate)}
                    {r.warehouse ? ` · ${r.warehouse}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => removeReceipt(r.id)}
                  disabled={removingId === r.id}
                  className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                  title="Remove confirmation"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}

// --- Main Page ---

function MatchPageContent() {
  const searchParams = useSearchParams();
  const invoiceId = searchParams.get("invoiceId");

  const [state, setState] = useState<MatchState | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCard, setActiveCard] = useState<CardId>("invoice");
  const [error, setError] = useState("");

  const loadState = useCallback(async () => {
    if (!invoiceId) return;
    try {
      const res = await fetch(`/api/match/${invoiceId}`);
      if (!res.ok) {
        setError("Failed to load match state");
        return;
      }
      const data: MatchState = await res.json();
      setState(data);
    } catch {
      setError("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => { loadState(); }, [loadState]);

  if (!invoiceId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">No invoice selected. Open Match from an invoice, PO, WO, or receipt.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-500">{error || "Something went wrong"}</p>
      </div>
    );
  }

  const { invoice, order, noOrderConfirmed, receipts, summary } = state;

  // Card summaries
  const invoiceCardTitle = invoice.invoiceNumber || "Invoice";
  const invoiceCardSub = invoice.supplier
    ? `${invoice.supplier} · ${formatCurrency(invoice.invoiceAmount)}`
    : formatCurrency(invoice.invoiceAmount);

  const orderCardTitle = noOrderConfirmed
    ? "No order"
    : order
    ? order.number
    : "Not linked";
  const orderCardSub = noOrderConfirmed
    ? "Credit card / direct purchase"
    : order
    ? order.status
    : "Link a PO, WO, or no order";

  const receiptCardTitle = summary.totalReceipts > 0
    ? `${summary.confirmedCount} of ${summary.totalReceipts} confirmed`
    : "No receipts";
  const receiptCardSub = summary.totalReceipts > 0
    ? `${summary.totalReceipts} receipt${summary.totalReceipts !== 1 ? "s" : ""} available`
    : order ? "No receipts for this order" : "Select to search receipts";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-6 py-8">

        {/* Back */}
        <Link href="/invoices" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Invoices
        </Link>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">Match Invoice</h1>
          <p className="text-sm text-gray-500 mt-0.5">{invoice.invoiceNumber} · {invoice.supplier}</p>
        </div>

        {/* Progress bar */}
        <ProgressBar linkedCount={summary.linkedCount} />

        {/* 3 Selector Cards */}
        <div className="flex gap-3 mb-4">
          <SelectorCard
            id="invoice"
            active={activeCard === "invoice"}
            linked={summary.invoiceLinked}
            title={invoiceCardTitle}
            subtitle={invoiceCardSub}
            onClick={() => setActiveCard("invoice")}
          />
          <SelectorCard
            id="order"
            active={activeCard === "order"}
            linked={summary.orderLinked}
            title={orderCardTitle}
            subtitle={orderCardSub}
            onClick={() => setActiveCard("order")}
          />
          <SelectorCard
            id="receipts"
            active={activeCard === "receipts"}
            linked={summary.receiptsConfirmed}
            partial={summary.confirmedCount > 0 && !summary.receiptsConfirmed}
            title={receiptCardTitle}
            subtitle={receiptCardSub}
            onClick={() => setActiveCard("receipts")}
          />
        </div>

        {/* Detail Panel */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          {activeCard === "invoice" && (
            <InvoicePanel invoice={invoice} />
          )}
          {activeCard === "order" && (
            <OrderPanel
              order={order}
              noOrderConfirmed={noOrderConfirmed}
              invoiceId={invoiceId}
              onRefresh={loadState}
            />
          )}
          {activeCard === "receipts" && (
            <ReceiptsPanel
              receipts={receipts}
              invoiceId={invoiceId}
              order={order}
              onRefresh={loadState}
            />
          )}
        </div>

      </div>
    </div>
  );
}

export default function MatchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
      </div>
    }>
      <MatchPageContent />
    </Suspense>
  );
}
