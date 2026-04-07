"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";

// ── Types ────────────────────────────────────────────────────────────────────

interface InvoiceLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  ansItemNumber: string;
  description: string;
  qtyBilled: number;
  unitCost: number;
  amount: number;
}

interface POLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  qtyOrdered: number;
  unitCost: number;
  costBasis: string;
}

interface WOLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  lineType: "Input" | "Output";
  qty: number;
}

interface ReceiptLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  qtyReceived: number;
}

interface Receipt {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  lines: ReceiptLine[];
}

interface CheckStripRow {
  skuName: string;
  invoiceQty: number | null;
  invoicePrice: number | null;
  poQty: number | null;
  poPrice: number | null;
  receiptQty: number | null;
  priceMatch: boolean | null;
  qtyMatch: boolean | null;
}

interface MatchPayload {
  invoice: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    supplier: string;
    supplierId: string | null;
    invoiceType: string;
    salesOrder: string;
    poReference: string;
    paymentTerms: string;
    trackingNumber: string;
    shipTo: string;
    subtotal: number;
    freight: number;
    tax: number;
    invoiceAmount: number;
    matchStatus: string;
    paymentStatus: string;
    notes: string;
    lines: InvoiceLine[];
  };
  po: {
    id: string;
    poNumber: string;
    status: string;
    supplier: string;
    lines: POLine[];
  } | null;
  wo: {
    id: string;
    woNumber: string;
    status: string;
    description: string;
    lines: WOLine[];
  } | null;
  receipts: Receipt[];
  checkStrip: CheckStripRow[];
}

interface POSearchResult {
  id: string;
  poNumber: string;
  status: string;
  skus: string[];
}

interface WOSearchResult {
  id: string;
  woNumber: string;
  status: string;
  outputSkus: string[];
}

interface ReceiptSearchResult {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  purchaseOrder: string | null;
  warehouse: string | null;
  lines: { id: string }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatusBadge({ status, type = "match" }: { status: string; type?: "match" | "payment" }) {
  const colors: Record<string, string> = {
    Open: "bg-stone-100 text-stone-500",
    Matched: "bg-emerald-50 text-emerald-700",
    Discrepancy: "bg-amber-50 text-amber-700",
    Unpaid: "bg-stone-100 text-stone-500",
    Paid: "bg-emerald-50 text-emerald-700",
    Disputed: "bg-red-50 text-red-700",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colors[status] ?? "bg-stone-100 text-stone-500"}`}>
      {type === "payment" ? `💳 ${status}` : status}
    </span>
  );
}

// ── Search Dropdowns ──────────────────────────────────────────────────────────

function SearchDropdown<T>({
  items,
  loading,
  query,
  onQueryChange,
  renderItem,
  onSelect,
  onCancel,
  placeholder,
}: {
  items: T[];
  loading: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  renderItem: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
  onCancel: () => void;
  placeholder: string;
}) {
  return (
    <div className="mt-3 border border-stone-200 rounded-lg overflow-hidden bg-white shadow-sm">
      <div className="p-3 border-b border-stone-200">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          className="w-full text-sm outline-none placeholder:text-stone-400"
        />
      </div>
      <div className="max-h-52 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-xs text-stone-400 text-center">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-xs text-stone-400 text-center">No results</div>
        ) : (
          items.slice(0, 20).map((item, i) => (
            <button
              key={i}
              onClick={() => onSelect(item)}
              className="w-full px-3 py-2.5 text-left hover:bg-stone-50 border-b border-stone-100 last:border-0"
            >
              {renderItem(item)}
            </button>
          ))
        )}
      </div>
      <div className="p-2 border-t border-stone-100">
        <button onClick={onCancel} className="text-[11px] text-stone-400 hover:text-stone-600">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Check Strip ───────────────────────────────────────────────────────────────

function CheckStrip({ rows, hasReceipts }: { rows: CheckStripRow[]; hasReceipts: boolean }) {
  if (rows.length === 0) return null;

  // Split into invoice-present rows and receipt-only rows
  const invoiceRows = rows.filter((r) => r.invoiceQty !== null);
  const extraRows = rows.filter((r) => r.invoiceQty === null);

  const renderPill = (row: CheckStripRow) => {
    const priceWarn = row.priceMatch === false;
    const qtyWarn = row.qtyMatch === false;
    return (
      <div
        key={row.skuName}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${
          priceWarn || qtyWarn
            ? "bg-amber-50 border-amber-200 text-amber-800"
            : "bg-emerald-50 border-emerald-200 text-emerald-800"
        }`}
      >
        <span className="text-stone-600 font-normal">{row.skuName}</span>
        {row.priceMatch !== null && (
          <span className={row.priceMatch ? "text-emerald-600" : "text-amber-600"}>
            Price {row.priceMatch ? "✓" : "⚠"}
          </span>
        )}
        {row.qtyMatch !== null && (
          <span className={row.qtyMatch ? "text-emerald-600" : "text-amber-600"}>
            Qty {row.qtyMatch
              ? "✓"
              : `⚠ ${row.invoiceQty} billed / ${row.receiptQty ?? row.poQty} ${hasReceipts ? "received" : "ordered"}`
            }
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="px-5 py-4">
      <p className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase mb-3">
        Price &amp; Qty Check
      </p>
      <div className="flex flex-wrap gap-2">
        {invoiceRows.map(renderPill)}
      </div>
      {extraRows.length > 0 && (
        <div className="mt-3 pt-3 border-t border-stone-100">
          <p className="text-[10px] text-stone-400 mb-2">
            In receipts but not on this invoice:
          </p>
          <div className="flex flex-wrap gap-2">
            {extraRows.map((row) => (
              <div
                key={row.skuName}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-stone-200 bg-stone-50 text-[11px] text-stone-500"
              >
                {row.skuName}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Invoice Card ──────────────────────────────────────────────────────────────

function InvoiceCard({ data }: { data: MatchPayload["invoice"] }) {
  const [showAll, setShowAll] = useState(false);
  const displayLines = showAll ? data.lines : data.lines.slice(0, 3);

  const hasBreakdown = data.freight > 0 || data.tax > 0;

  return (
    <div className="flex flex-col bg-white rounded-xl border-2 border-stone-200 overflow-hidden h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-stone-100">
        <div className="flex items-start justify-between mb-3">
          <span className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase">Invoice</span>
          <div className="flex items-center gap-1.5">
            <StatusBadge status={data.matchStatus} />
            <StatusBadge status={data.paymentStatus} type="payment" />
          </div>
        </div>
        <p className="text-base font-semibold text-stone-900 mb-1">{data.invoiceNumber}</p>
        <div className="space-y-0.5 text-xs text-stone-500">
          <p><span className="text-stone-400">Supplier</span> {data.supplier || "—"}</p>
          <p><span className="text-stone-400">Date</span> {fmtDate(data.invoiceDate) || "—"}</p>
          <p><span className="text-stone-400">Type</span> {data.invoiceType}</p>
          {data.salesOrder && <p><span className="text-stone-400">Sales Order</span> {data.salesOrder}</p>}
          {data.poReference && <p><span className="text-stone-400">PO Reference</span> {data.poReference}</p>}
          {data.paymentTerms && <p><span className="text-stone-400">Terms</span> {data.paymentTerms}</p>}
          {data.trackingNumber && <p><span className="text-stone-400">Tracking</span> {data.trackingNumber}</p>}
          {data.shipTo && <p><span className="text-stone-400">Ship To</span> {data.shipTo}</p>}
        </div>
        {/* Amount breakdown */}
        <div className="mt-3 pt-3 border-t border-stone-100">
          {hasBreakdown ? (
            <div className="space-y-0.5 text-xs">
              <div className="flex justify-between text-stone-500">
                <span>Subtotal</span><span>{fmt(data.subtotal)}</span>
              </div>
              {data.freight > 0 && (
                <div className="flex justify-between text-stone-500">
                  <span>Freight</span><span>{fmt(data.freight)}</span>
                </div>
              )}
              {data.tax > 0 && (
                <div className="flex justify-between text-stone-500">
                  <span>Tax</span><span>{fmt(data.tax)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-stone-800 pt-1 border-t border-stone-100">
                <span>Total</span><span>{fmt(data.invoiceAmount)}</span>
              </div>
            </div>
          ) : (
            <div className="flex justify-between text-sm font-semibold text-stone-800">
              <span>Total</span><span>{fmt(data.invoiceAmount)}</span>
            </div>
          )}
        </div>
        {data.notes && (
          <p className="mt-2 text-[11px] text-stone-400 italic">{data.notes}</p>
        )}
      </div>

      {/* Lines */}
      <div className="px-5 py-4 flex-1">
        <p className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase mb-3">Line Items</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-stone-400 text-[10px] border-b border-stone-100">
              <th className="text-left pb-1.5 font-medium">SKU</th>
              <th className="text-right pb-1.5 pl-4 font-medium">Qty</th>
              <th className="text-right pb-1.5 pl-4 font-medium">Rate</th>
              <th className="text-right pb-1.5 pl-4 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {displayLines.map((l) => (
              <tr key={l.id} className="border-b border-stone-50 last:border-0">
                <td className="py-1.5 text-stone-700 font-medium">
                  {l.skuName || l.description || l.ansItemNumber || "—"}
                  {l.description && l.skuName && (
                    <span className="block text-[10px] text-stone-400 font-normal">{l.description}</span>
                  )}
                </td>
                <td className="py-1.5 pl-4 text-stone-500 text-right">{l.qtyBilled}</td>
                <td className="py-1.5 pl-4 text-stone-500 text-right">{fmt(l.unitCost)}</td>
                <td className="py-1.5 pl-4 text-stone-700 font-medium text-right">{fmt(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.lines.length > 3 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-[11px] text-stone-400 hover:text-stone-600 mt-2"
          >
            {showAll ? "Show matched lines ↑" : `Show all ${data.lines.length} lines ↓`}
          </button>
        )}
        <p className="text-[11px] text-stone-400 mt-3">
          {data.lines.length} line{data.lines.length !== 1 ? "s" : ""} · {fmt(data.invoiceAmount)}
        </p>
      </div>
    </div>
  );
}

// ── PO / WO Card ──────────────────────────────────────────────────────────────

function SourceDocCard({
  po,
  wo,
  invoiceSkuNames,
  onLinkPO,
  onUnlinkPO,
  onLinkWO,
  onUnlinkWO,
  onExclude,
}: {
  po: MatchPayload["po"];
  wo: MatchPayload["wo"];
  invoiceSkuNames: string[];
  onLinkPO: () => void;
  onUnlinkPO: () => void;
  onLinkWO: () => void;
  onUnlinkWO: () => void;
  onExclude: () => void;
}) {
  const [showPOSearch, setShowPOSearch] = useState(false);
  const [showWOSearch, setShowWOSearch] = useState(false);
  const [poResults, setPOResults] = useState<POSearchResult[]>([]);
  const [woResults, setWOResults] = useState<WOSearchResult[]>([]);
  const [poLoading, setPOLoading] = useState(false);
  const [woLoading, setWOLoading] = useState(false);
  const [poQuery, setPOQuery] = useState("");
  const [woQuery, setWOQuery] = useState("");
  const [showAllLines, setShowAllLines] = useState(false);
  const [showAllPO, setShowAllPO] = useState(false);
  const [showAllWO, setShowAllWO] = useState(false);

  const linked = !!(po || wo);

  const openPOSearch = () => {
    setShowWOSearch(false);
    setShowAllPO(false);
    setShowPOSearch(true);
    setPOLoading(true);
    fetch("/api/purchase-orders")
      .then((r) => r.json())
      .then((data: POSearchResult[]) => { setPOResults(data); setPOLoading(false); });
  };

  const openWOSearch = () => {
    setShowPOSearch(false);
    setShowAllWO(false);
    setShowWOSearch(true);
    setWOLoading(true);
    fetch("/api/work-orders")
      .then((r) => r.json())
      .then((data: WOSearchResult[]) => { setWOResults(data); setWOLoading(false); });
  };

  // Filter by query text
  const queryFilteredPO = poResults.filter((p) => {
    if (!poQuery) return true;
    const q = poQuery.toLowerCase();
    return p.poNumber?.toLowerCase().includes(q) || p.skus?.some((s) => s.toLowerCase().includes(q));
  });

  const queryFilteredWO = woResults.filter((w) => {
    if (!woQuery) return true;
    const q = woQuery.toLowerCase();
    return w.woNumber?.toLowerCase().includes(q) || w.outputSkus?.some((s) => s.toLowerCase().includes(q));
  });

  // Split into SKU-matched and all others
  const matchesPOSku = (p: POSearchResult) =>
    invoiceSkuNames.length === 0 || p.skus?.some((s) => invoiceSkuNames.includes(s));
  const matchesWOSku = (w: WOSearchResult) =>
    invoiceSkuNames.length === 0 || w.outputSkus?.some((s) => invoiceSkuNames.includes(s));

  const filterPO = poQuery
    ? queryFilteredPO
    : showAllPO
      ? queryFilteredPO
      : queryFilteredPO.filter(matchesPOSku);

  const filterWO = woQuery
    ? queryFilteredWO
    : showAllWO
      ? queryFilteredWO
      : queryFilteredWO.filter(matchesWOSku);

  const hiddenPOCount = !poQuery && !showAllPO
    ? queryFilteredPO.filter((p) => !matchesPOSku(p)).length
    : 0;
  const hiddenWOCount = !woQuery && !showAllWO
    ? queryFilteredWO.filter((w) => !matchesWOSku(w)).length
    : 0;

  const handleSelectPO = (p: POSearchResult) => {
    setShowPOSearch(false);
    setPOQuery("");
    onLinkPO();
    // Pass selected PO back via closure captured in parent
    (window as Window & { __pendingPoId?: string }).__pendingPoId = p.id;
  };

  const handleSelectWO = (w: WOSearchResult) => {
    setShowWOSearch(false);
    setWOQuery("");
    (window as Window & { __pendingWoId?: string }).__pendingWoId = w.id;
    onLinkWO();
  };

  const lines = po ? po.lines : wo ? wo.lines.filter((l) => l.lineType === "Output") : [];
  const displayLines = showAllLines ? lines : lines.slice(0, 3);

  return (
    <div className={`flex flex-col bg-white rounded-xl border-2 overflow-hidden h-full ${
      linked ? "border-emerald-300" : "border-amber-300"
    }`}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-stone-100">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase">
            {wo ? "Work Order" : "Purchase Order"}
          </span>
          {linked && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
              {po?.poNumber || wo?.woNumber}
            </span>
          )}
        </div>

        {po && (
          <div className="space-y-0.5 text-xs text-stone-500">
            <p className="text-base font-semibold text-stone-900 mb-1">{po.poNumber}</p>
            <p><span className="text-stone-400">Supplier</span> {po.supplier || "—"}</p>
            <p><span className="text-stone-400">Status</span> {po.status}</p>
            <button
              onClick={onUnlinkPO}
              className="mt-2 text-[11px] text-stone-400 hover:text-red-500 transition-colors"
            >
              Unlink PO
            </button>
          </div>
        )}

        {wo && (
          <div className="space-y-0.5 text-xs text-stone-500">
            <p className="text-base font-semibold text-stone-900 mb-1">{wo.woNumber}</p>
            {wo.description && <p className="text-stone-500">{wo.description}</p>}
            <p><span className="text-stone-400">Status</span> {wo.status}</p>
            <button
              onClick={onUnlinkWO}
              className="mt-2 text-[11px] text-stone-400 hover:text-red-500 transition-colors"
            >
              Unlink Work Order
            </button>
          </div>
        )}

        {!linked && (
          <div className="space-y-2">
            <p className="text-sm text-stone-500">No source document linked. Find the PO or Work Order this invoice belongs to.</p>
            <button
              onClick={openPOSearch}
              className="w-full py-1.5 px-3 text-xs font-medium bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg transition-colors"
            >
              Search Purchase Orders
            </button>
            <button
              onClick={openWOSearch}
              className="w-full py-1.5 px-3 text-xs font-medium bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg transition-colors"
            >
              Search Work Orders
            </button>
            <button
              onClick={onExclude}
              className="w-full py-1.5 px-3 text-xs font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-50 border border-stone-200 rounded-lg transition-colors"
            >
              No source doc (exclude)
            </button>
          </div>
        )}

        {showPOSearch && (
          <div className="mt-3 border border-stone-200 rounded-lg overflow-hidden bg-white shadow-sm">
            <div className="p-3 border-b border-stone-200">
              <input
                autoFocus
                type="text"
                value={poQuery}
                onChange={(e) => { setPOQuery(e.target.value); setShowAllPO(true); }}
                placeholder="Search by PO number or SKU…"
                className="w-full text-sm outline-none placeholder:text-stone-400"
              />
            </div>
            {!poQuery && filterPO.length === 0 && !poLoading && (
              <div className="px-3 py-2 text-[11px] text-stone-400">
                No POs contain the invoice SKUs.
              </div>
            )}
            <div className="max-h-52 overflow-y-auto">
              {poLoading ? (
                <div className="p-4 text-xs text-stone-400 text-center">Loading…</div>
              ) : (
                filterPO.slice(0, 20).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectPO(p)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-stone-50 border-b border-stone-100 last:border-0"
                  >
                    <div>
                      <span className="text-xs font-semibold text-stone-800">{p.poNumber}</span>
                      {p.skus?.length > 0 && (
                        <span className="ml-2 text-[11px] text-stone-400">{p.skus.slice(0, 3).join(", ")}</span>
                      )}
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{p.status}</span>
                  </button>
                ))
              )}
            </div>
            {hiddenPOCount > 0 && (
              <div className="px-3 py-2 border-t border-stone-100">
                <button
                  onClick={() => setShowAllPO(true)}
                  className="text-[11px] text-stone-400 hover:text-stone-600"
                >
                  Show {hiddenPOCount} more POs without matching SKUs
                </button>
              </div>
            )}
            <div className="p-2 border-t border-stone-100">
              <button onClick={() => setShowPOSearch(false)} className="text-[11px] text-stone-400 hover:text-stone-600">
                Cancel
              </button>
            </div>
          </div>
        )}

        {showWOSearch && (
          <div className="mt-3 border border-stone-200 rounded-lg overflow-hidden bg-white shadow-sm">
            <div className="p-3 border-b border-stone-200">
              <input
                autoFocus
                type="text"
                value={woQuery}
                onChange={(e) => { setWOQuery(e.target.value); setShowAllWO(true); }}
                placeholder="Search by WO number or SKU…"
                className="w-full text-sm outline-none placeholder:text-stone-400"
              />
            </div>
            {!woQuery && filterWO.length === 0 && !woLoading && (
              <div className="px-3 py-2 text-[11px] text-stone-400">
                No Work Orders contain the invoice SKUs.
              </div>
            )}
            <div className="max-h-52 overflow-y-auto">
              {woLoading ? (
                <div className="p-4 text-xs text-stone-400 text-center">Loading…</div>
              ) : (
                filterWO.slice(0, 20).map((w) => (
                  <button
                    key={w.id}
                    onClick={() => handleSelectWO(w)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-stone-50 border-b border-stone-100 last:border-0"
                  >
                    <div>
                      <span className="text-xs font-semibold text-stone-800">{w.woNumber}</span>
                      {w.outputSkus?.length > 0 && (
                        <span className="ml-2 text-[11px] text-stone-400">{w.outputSkus.slice(0, 3).join(", ")}</span>
                      )}
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">{w.status}</span>
                  </button>
                ))
              )}
            </div>
            {hiddenWOCount > 0 && (
              <div className="px-3 py-2 border-t border-stone-100">
                <button
                  onClick={() => setShowAllWO(true)}
                  className="text-[11px] text-stone-400 hover:text-stone-600"
                >
                  Show {hiddenWOCount} more Work Orders without matching SKUs
                </button>
              </div>
            )}
            <div className="p-2 border-t border-stone-100">
              <button onClick={() => setShowWOSearch(false)} className="text-[11px] text-stone-400 hover:text-stone-600">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lines */}
      {linked && lines.length > 0 && (
        <div className="px-5 py-4 flex-1">
          <p className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase mb-3">
            {wo ? "Output Lines" : "Line Items"}
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-stone-400 text-[10px] border-b border-stone-100">
                <th className="text-left pb-1.5 font-medium">SKU</th>
                <th className="text-right pb-1.5 font-medium w-16">Qty</th>
                <th className="text-right pb-1.5 font-medium w-14">Rate</th>
              </tr>
            </thead>
            <tbody>
              {displayLines.map((l) => {
                if ("qtyOrdered" in l) {
                  const pl = l as POLine;
                  return (
                    <tr key={pl.id} className="border-b border-stone-50 last:border-0">
                      <td className="py-1.5 text-stone-700 font-medium">{pl.skuName || "—"}</td>
                      <td className="py-1.5 text-stone-500 text-right">
                        {pl.qtyOrdered} {pl.costBasis === "Per Carton" ? "ctn" : pl.costBasis === "Per Stick" ? "stk" : "ea"}
                      </td>
                      <td className="py-1.5 text-stone-500 text-right">{fmt(pl.unitCost)}</td>
                    </tr>
                  );
                } else {
                  const wl = l as WOLine;
                  return (
                    <tr key={wl.id} className="border-b border-stone-50 last:border-0">
                      <td className="py-1.5 text-stone-700 font-medium">{wl.skuName || "—"}</td>
                      <td className="py-1.5 text-stone-500 text-right">{wl.qty}</td>
                      <td className="py-1.5 text-stone-400 text-right">—</td>
                    </tr>
                  );
                }
              })}
            </tbody>
          </table>
          {lines.length > 3 && (
            <button
              onClick={() => setShowAllLines(!showAllLines)}
              className="text-[11px] text-stone-400 hover:text-stone-600 mt-2"
            >
              {showAllLines ? "Show less ↑" : `Show all ${lines.length} lines ↓`}
            </button>
          )}
          <p className="text-[11px] text-stone-400 mt-3">
            {lines.length} line{lines.length !== 1 ? "s" : ""}
            {po && lines.length > 0 ? ` · ${lines.length} matched` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Receipts Card ─────────────────────────────────────────────────────────────

function ReceiptsCard({
  receipts,
  onSearchReceipts,
}: {
  receipts: Receipt[];
  onSearchReceipts: () => void;
}) {
  const [expandedReceipts, setExpandedReceipts] = useState<Set<string>>(new Set());
  const linked = receipts.length > 0;
  const totalUnits = receipts.flatMap((r) => r.lines).reduce((sum, l) => sum + l.qtyReceived, 0);

  const toggle = (id: string) => {
    setExpandedReceipts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className={`flex flex-col bg-white rounded-xl border-2 overflow-hidden h-full ${
      linked ? "border-emerald-300" : "border-amber-300"
    }`}>
      <div className="px-5 pt-5 pb-4 border-b border-stone-100">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-semibold tracking-widest text-stone-400 uppercase">Receipts</span>
          {linked && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
              {receipts.length} receipt{receipts.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {!linked && (
          <div className="space-y-2">
            <p className="text-sm text-stone-500">No receipts linked to this invoice.</p>
            <button
              onClick={onSearchReceipts}
              className="w-full py-1.5 px-3 text-xs font-medium bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg transition-colors"
            >
              Search Receipts
            </button>
          </div>
        )}
      </div>

      {linked && (
        <div className="px-5 py-4 flex-1 space-y-4">
          {receipts.map((r) => {
            const expanded = expandedReceipts.has(r.id);
            const displayLines = expanded ? r.lines : r.lines.slice(0, 2);
            return (
              <div key={r.id} className="border-b border-stone-100 pb-4 last:border-0 last:pb-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-stone-700">{r.receiptNumber}</span>
                  <span className="text-[11px] text-stone-400">{fmtDate(r.receivedDate)}</span>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {displayLines.map((l) => (
                      <tr key={l.id} className="border-b border-stone-50 last:border-0">
                        <td className="py-1.5 text-stone-700">{l.skuName || "—"}</td>
                        <td className="py-1.5 text-stone-500 text-right w-16">{l.qtyReceived}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {r.lines.length > 2 && (
                  <button
                    onClick={() => toggle(r.id)}
                    className="text-[11px] text-stone-400 hover:text-stone-600 mt-1.5"
                  >
                    {expanded ? "Show less ↑" : `Show all ${r.lines.length} lines ↓`}
                  </button>
                )}
              </div>
            );
          })}
          <p className="text-[11px] text-stone-400">
            {receipts.length} receipt{receipts.length !== 1 ? "s" : ""} · {totalUnits.toLocaleString()} units total
          </p>
        </div>
      )}
    </div>
  );
}

// ── Receipt Search Modal ───────────────────────────────────────────────────────

function ReceiptSearchModal({
  onSelect,
  onCancel,
}: {
  onSelect: (r: ReceiptSearchResult) => void;
  onCancel: () => void;
}) {
  const [results, setResults] = useState<ReceiptSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/receipts")
      .then((r) => r.json())
      .then((data: ReceiptSearchResult[]) => { setResults(data); setLoading(false); });
  }, []);

  const filtered = results.filter((r) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      r.receiptNumber?.toLowerCase().includes(q) ||
      r.purchaseOrder?.toLowerCase().includes(q) ||
      r.warehouse?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200">
          <p className="text-sm font-semibold text-stone-800 mb-3">Search Receipts</p>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by receipt number, PO, or warehouse…"
            className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 outline-none focus:border-stone-400 placeholder:text-stone-400"
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-xs text-stone-400 text-center">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-xs text-stone-400 text-center">No receipts found</div>
          ) : (
            filtered.slice(0, 30).map((r) => (
              <button
                key={r.id}
                onClick={() => onSelect(r)}
                className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-stone-50 border-b border-stone-100 last:border-0"
              >
                <div>
                  <span className="text-xs font-semibold text-stone-800">{r.receiptNumber}</span>
                  {r.purchaseOrder && (
                    <span className="ml-2 text-[11px] text-stone-400">{r.purchaseOrder}</span>
                  )}
                  {r.warehouse && !r.purchaseOrder && (
                    <span className="ml-2 text-[11px] text-stone-400">{r.warehouse}</span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-stone-500">{fmtDate(r.receivedDate)}</span>
                  <span className="ml-2 text-[10px] text-stone-400">{r.lines?.length ?? 0} lines</span>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="px-5 py-3 border-t border-stone-100 flex justify-end">
          <button onClick={onCancel} className="text-xs text-stone-500 hover:text-stone-700">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MatchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const from = searchParams.get("from") || "invoice";
  const id = searchParams.get("id");

  const [data, setData] = useState<MatchPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReceiptSearch, setShowReceiptSearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/match?from=${from}&id=${id}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [from, id]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const doAction = useCallback(async (body: Record<string, unknown>) => {
    if (!id) return false;
    setSaving(true);
    try {
      const res = await fetch(`/api/match?from=${from}&id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
      return true;
    } catch (e) {
      showToast("Error: " + (e instanceof Error ? e.message : "unknown"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [id, from, load]);

  // PO/WO linking — the search dropdown sets a pending ID on window, then calls the action
  const handleLinkPO = useCallback(async () => {
    const poId = (window as Window & { __pendingPoId?: string }).__pendingPoId;
    if (!poId) return;
    delete (window as Window & { __pendingPoId?: string }).__pendingPoId;
    const ok = await doAction({ action: "link-po", poId });
    if (ok) showToast("PO linked");
  }, [doAction]);

  const handleLinkWO = useCallback(async () => {
    const woId = (window as Window & { __pendingWoId?: string }).__pendingWoId;
    if (!woId) return;
    delete (window as Window & { __pendingWoId?: string }).__pendingWoId;
    const ok = await doAction({ action: "link-wo", woId });
    if (ok) showToast("Work Order linked");
  }, [doAction]);

  const handleSelectReceipt = async (r: ReceiptSearchResult) => {
    setShowReceiptSearch(false);
    // Receipt linking without PO/WO is a note for now — show toast explaining
    showToast(`Receipt ${r.receiptNumber} selected — confirm match to link line-by-line`);
    // TODO: stage the receipt and write line-level links on confirm
  };

  const handleConfirm = async () => {
    const ok = await doAction({ action: "confirm" });
    if (ok) { showToast("Match confirmed"); router.back(); }
  };

  const handleFlagDiscrepancy = async () => {
    const ok = await doAction({ action: "flag-discrepancy" });
    if (ok) showToast("Flagged as discrepancy");
  };

  const handleExclude = async () => {
    if (!confirm("Mark as excluded (no source document)?")) return;
    const ok = await doAction({ action: "exclude" });
    if (ok) showToast("Marked as excluded");
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!id) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-stone-500 text-sm">No record specified. Use <code>?from=invoice&id=...</code></p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-stone-400 text-sm animate-pulse">Loading…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-red-500 text-sm">{error || "Something went wrong"}</p>
      </div>
    );
  }

  const hasSourceDoc = !!(data.po || data.wo);
  const allGreen = hasSourceDoc && data.receipts.length > 0;
  const hasDiscrepancy = data.checkStrip.some((r) => r.priceMatch === false || r.qtyMatch === false);

  return (
    <div className="min-h-screen bg-stone-100">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-sm text-stone-500 hover:text-stone-800 flex items-center gap-1.5 transition-colors"
          >
            ← Back
          </button>
          <span className="text-stone-300">/</span>
          <span className="text-sm font-semibold text-stone-800">
            {data.invoice.invoiceNumber}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-stone-400">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${hasSourceDoc ? "bg-emerald-400" : "bg-amber-400"}`} />
            {data.po ? "PO" : data.wo ? "WO" : "Source Doc"}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${data.receipts.length > 0 ? "bg-emerald-400" : "bg-amber-400"}`} />
            Receipts
          </div>
        </div>
      </div>

      {/* Cards */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-3 gap-5 items-start">
          <InvoiceCard data={data.invoice} />

          <SourceDocCard
            po={data.po}
            wo={data.wo}
            invoiceSkuNames={data.invoice.lines.map((l) => l.skuName).filter(Boolean) as string[]}
            onLinkPO={handleLinkPO}
            onUnlinkPO={() => doAction({ action: "unlink-po" }).then((ok) => ok && showToast("PO unlinked"))}
            onLinkWO={handleLinkWO}
            onUnlinkWO={() => doAction({ action: "unlink-wo" }).then((ok) => ok && showToast("WO unlinked"))}
            onExclude={handleExclude}
          />

          <ReceiptsCard
            receipts={data.receipts}
            onSearchReceipts={() => setShowReceiptSearch(true)}
          />
        </div>

        {/* Check Strip */}
        {data.checkStrip.length > 0 && (
          <div className="mt-5 bg-white rounded-xl border border-stone-200 overflow-hidden">
            <CheckStrip rows={data.checkStrip} hasReceipts={data.receipts.length > 0} />
          </div>
        )}

        {/* Action Bar */}
        <div className="mt-4 flex items-center justify-between">
          <div>
            {hasDiscrepancy && (
              <p className="text-xs text-amber-600 flex items-center gap-1.5">
                ⚠ Discrepancy detected — review before confirming
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {hasDiscrepancy && (
              <button
                onClick={handleFlagDiscrepancy}
                disabled={saving}
                className="px-4 py-2 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors disabled:opacity-50"
              >
                Flag Discrepancy
              </button>
            )}
            <button
              onClick={handleConfirm}
              disabled={saving || !allGreen}
              className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={!allGreen ? "Link a source document and receipts before confirming" : undefined}
            >
              {saving ? "Saving…" : "Confirm Match"}
            </button>
          </div>
        </div>
      </div>

      {/* Receipt Search Modal */}
      {showReceiptSearch && (
        <ReceiptSearchModal
          onSelect={handleSelectReceipt}
          onCancel={() => setShowReceiptSearch(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-800 text-white text-xs px-4 py-2.5 rounded-full shadow-lg z-50 pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}
