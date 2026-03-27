"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

// --- Types ---

type MatchType = "po" | "wo" | "shipment";

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplier: string;
  poReference: string;
  invoiceAmount: number;
  invoiceType?: string;
  lines: {
    id: string;
    skuName: string | null;
    ansItemNumber: string;
    description: string;
    qtyBilled: number;
    unitCost: number;
    amount: number;
  }[];
  purchaseOrder: { id: string; poNumber: string; status: string } | null;
  linkedWorkOrder: { id: string; woNumber: string } | null;
  linkedShipment: { id: string; shipmentNumber: string } | null;
}

interface PODetail {
  id: string;
  poNumber: string;
  date: string;
  status: string;
  grandTotal: number;
  supplier: { name: string } | null;
  lineItems: {
    id: string;
    skuId: string | null;
    sku: { standardSku: string; uom: string } | null;
    qtySticks: number;
    qtyCartons: number;
    unitCost: number;
  }[];
}

interface ReceiptDetail {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  warehouse: string | null;
  lines: {
    id: string;
    skuId: string | null;
    sku: string | null;
    qtyReceived: number;
  }[];
}

interface WODetail {
  id: string;
  woNumber: string;
  status: string;
  issuedDate: string;
  completedDate: string;
  warehouse: { id: string; name: string; code: string } | null;
  outputs: {
    id: string;
    skuId: string | null;
    sku: { standardSku: string; flavor: string; uom: string } | null;
    qty: number;
  }[];
  receipts: { id: string; receiptNumber: string; receivedDate: string | null; warehouse: string | null }[];
}

interface ShipmentDetail {
  id: string;
  shipmentNumber: string;
  status: string;
  carrier: string;
  carrierReference: string;
  shipDate: string;
  poNumber: string | null;
  purchaseOrderId: string | null;
  receipts: { id: string; receiptNumber: string; receivedDate: string }[];
}

interface MatchInfo {
  matchStatus: "open" | "pending-receipt" | "discrepancy" | "approved";
  po: { poId: string; poNumber: string; status: string } | null;
  suggestedReceipt: { receiptId: string; receiptNumber: string; receivedDate: string } | null;
  matchedReceipt: { receiptId: string; receiptNumber: string } | null;
  receiptOptions: { receiptId: string; receiptNumber: string; receivedDate: string; overlapScore: number }[];
  flags: string[];
}

interface POComparisonRow {
  skuName: string;
  invoiceQty: number;
  invoiceUnitCost: number;
  poQty: number;
  poUnitCost: number;
  receiptQty: number;
  qtyMatch: boolean;
  priceMatch: boolean;
  invoiceLineId: string;
  receiptLineId: string;
  poLineItemId: string;
  hasInvoice: boolean;
  hasPO: boolean;
  hasReceipt: boolean;
}

interface WOComparisonRow {
  skuName: string;
  invoiceQty: number;
  invoiceUnitCost: number;
  woExpectedQty: number;
  receiptQty: number;
  qtyMatch: boolean;
  invoiceLineId: string;
  receiptLineId: string;
  woOutputId: string;
  hasInvoice: boolean;
  hasWO: boolean;
  hasReceipt: boolean;
}

// --- Helpers ---

function formatDate(d: string | null | undefined) {
  if (!d) return "\u2014";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(n: number | null | undefined) {
  if (n == null) return "\u2014";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function getPoQty(line: PODetail["lineItems"][0]): number {
  if (!line.sku) return line.qtyCartons || line.qtySticks || 0;
  return line.sku.uom === "Carton"
    ? line.qtyCartons || 0
    : line.qtySticks || line.qtyCartons || 0;
}

function buildPOComparison(
  invoice: InvoiceDetail | null,
  po: PODetail | null,
  receipt: ReceiptDetail | null
): POComparisonRow[] {
  if (!invoice) return [];
  const invoiceMap: Record<string, InvoiceDetail["lines"][0]> = {};
  for (const l of invoice.lines) { if (l.skuName) invoiceMap[l.skuName] = l; }
  const poMap: Record<string, PODetail["lineItems"][0]> = {};
  if (po) { for (const l of po.lineItems) { if (l.sku?.standardSku) poMap[l.sku.standardSku] = l; } }
  const receiptMap: Record<string, ReceiptDetail["lines"][0]> = {};
  if (receipt) { for (const l of receipt.lines) { if (l.sku) receiptMap[l.sku] = l; } }

  return Object.keys(invoiceMap).map((skuName) => {
    const inv = invoiceMap[skuName];
    const poLine = poMap[skuName];
    const rec = receiptMap[skuName];
    const invoiceQty = inv?.qtyBilled || 0;
    const invoiceUnitCost = inv?.unitCost || 0;
    const receiptQty = rec?.qtyReceived || 0;
    const poQty = poLine ? getPoQty(poLine) : 0;
    const poUnitCost = poLine?.unitCost || 0;
    return {
      skuName, invoiceQty, invoiceUnitCost, poQty, poUnitCost, receiptQty,
      qtyMatch: !!inv && !!rec && invoiceQty === receiptQty,
      priceMatch: !!inv && !!poLine && poUnitCost > 0 && invoiceUnitCost === poUnitCost,
      invoiceLineId: inv?.id || "", receiptLineId: rec?.id || "", poLineItemId: poLine?.id || "",
      hasInvoice: !!inv, hasPO: !!poLine, hasReceipt: !!rec,
    };
  });
}

function buildWOComparison(
  invoice: InvoiceDetail | null,
  wo: WODetail | null,
  receipt: ReceiptDetail | null
): WOComparisonRow[] {
  if (!invoice) return [];
  const invoiceMap: Record<string, InvoiceDetail["lines"][0]> = {};
  for (const l of invoice.lines) { if (l.skuName) invoiceMap[l.skuName] = l; }
  const woMap: Record<string, WODetail["outputs"][0]> = {};
  if (wo) { for (const l of wo.outputs) { if (l.sku?.standardSku) woMap[l.sku.standardSku] = l; } }
  const receiptMap: Record<string, ReceiptDetail["lines"][0]> = {};
  if (receipt) { for (const l of receipt.lines) { if (l.sku) receiptMap[l.sku] = l; } }

  return Object.keys(invoiceMap).map((skuName) => {
    const inv = invoiceMap[skuName];
    const woLine = woMap[skuName];
    const rec = receiptMap[skuName];
    const invoiceQty = inv?.qtyBilled || 0;
    const invoiceUnitCost = inv?.unitCost || 0;
    const woExpectedQty = woLine?.qty || 0;
    const receiptQty = rec?.qtyReceived || 0;
    return {
      skuName, invoiceQty, invoiceUnitCost, woExpectedQty, receiptQty,
      qtyMatch: !!inv && !!rec && invoiceQty === receiptQty,
      invoiceLineId: inv?.id || "", receiptLineId: rec?.id || "", woOutputId: woLine?.id || "",
      hasInvoice: !!inv, hasWO: !!woLine, hasReceipt: !!rec,
    };
  });
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3 h-3 shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

// --- Invoice picker (shown when no invoiceId in URL) ---

interface InvoicePickerItem {
  id: string;
  invoiceNumber: string;
  supplier: string;
  invoiceDate: string;
  invoiceAmount: number;
  invoiceType: string;
  matchStatus: string;
}

function InvoicePicker({ onSelect }: { onSelect: (id: string) => void }) {
  const [invoices, setInvoices] = useState<InvoicePickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/invoices")
      .then(r => r.json())
      .then(data => {
        // Filter to only unmatched / needs action
        setInvoices(
          (data as InvoicePickerItem[])
            .filter(i => !["Approved"].includes(i.matchStatus))
            .sort((a, b) => b.invoiceNumber.localeCompare(a.invoiceNumber))
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = invoices.filter(i =>
    search === "" ||
    i.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
    i.supplier.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading invoices...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <Link href="/invoices" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-6">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Invoices
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Match Invoice</h1>
        <p className="text-sm text-gray-500 mb-6">Select an invoice to match.</p>
        <input
          type="text"
          placeholder="Search by invoice # or supplier..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-gold-400"
          autoFocus
        />
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
          {filtered.map(inv => (
            <button
              key={inv.id}
              onClick={() => onSelect(inv.id)}
              className="w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors flex items-center justify-between gap-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{inv.invoiceNumber}</span>
                  {inv.invoiceType && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{inv.invoiceType}</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{inv.supplier} · {formatDate(inv.invoiceDate)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-gray-900">{formatCurrency(inv.invoiceAmount)}</p>
                {inv.matchStatus && (
                  <span className="text-[10px] font-medium text-gray-400">{inv.matchStatus}</span>
                )}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-400">No invoices found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main match tool ---

function MatchTool({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [matchType, setMatchType] = useState<MatchType>("po");

  // PO flow
  const [poDetail, setPODetail] = useState<PODetail | null>(null);
  const [receiptDetail, setReceiptDetail] = useState<ReceiptDetail | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [showPoPicker, setShowPoPicker] = useState(false);
  const [availablePOs, setAvailablePOs] = useState<{ id: string; poNumber: string; date: string; status: string; grandTotal: number; skus: string[] }[]>([]);
  const [manualReceiptOptions, setManualReceiptOptions] = useState<{ receiptId: string; receiptNumber: string; receivedDate: string; overlapScore: number }[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  // WO flow
  const [woDetail, setWODetail] = useState<WODetail | null>(null);
  const [showWoPicker, setShowWoPicker] = useState(false);
  const [availableWOs, setAvailableWOs] = useState<{ id: string; woNumber: string; status: string; issuedDate: string; completedDate: string; description: string; outputSkus: string[] }[]>([]);
  const [woReceiptDetail, setWOReceiptDetail] = useState<ReceiptDetail | null>(null);
  const [confirmingWO, setConfirmingWO] = useState(false);

  // Shipment flow
  const [shipmentDetail, setShipmentDetail] = useState<ShipmentDetail | null>(null);
  const [showShipmentPicker, setShowShipmentPicker] = useState(false);
  const [availableShipments, setAvailableShipments] = useState<{ id: string; shipmentNumber: string; status: string; shipDate: string }[]>([]);
  const [confirmingShipment, setConfirmingShipment] = useState(false);

  const [unmatching, setUnmatching] = useState(false);

  useEffect(() => { loadData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [invoiceId]);

  async function loadData() {
    try {
      const [invoiceRes, matchingRes] = await Promise.all([
        fetch(`/api/invoices/${invoiceId}`),
        fetch(`/api/invoices/matching`),
      ]);
      const invoiceData = await invoiceRes.json();
      const matchingData = await matchingRes.json();
      setInvoice(invoiceData);

      const type: MatchType = invoiceData.invoiceType === "Work Order" ? "wo"
        : (invoiceData.invoiceType === "Freight" || invoiceData.invoiceType === "Customs") ? "shipment"
        : "po";
      setMatchType(type);

      if (invoiceData.linkedWorkOrder) {
        const woRes = await fetch(`/api/work-orders/${invoiceData.linkedWorkOrder.id}`);
        const woData = await woRes.json();
        setWODetail(woData);
        if (woData.receipts?.length > 0) {
          const rRes = await fetch(`/api/receipts/${woData.receipts[0].id}`);
          setWOReceiptDetail(await rRes.json());
        }
      }

      if (invoiceData.linkedShipment) {
        const shipRes = await fetch(`/api/shipments/${invoiceData.linkedShipment.id}`);
        const shipData = await shipRes.json();
        setShipmentDetail(shipData);
        if (shipData.receipts?.length > 0) {
          const rRes = await fetch(`/api/receipts/${shipData.receipts[0].id}`);
          setReceiptDetail(await rRes.json());
          setSelectedReceiptId(shipData.receipts[0].id);
        }
      }

      const match = matchingData.invoices?.find((i: { id: string }) => i.id === invoiceId);
      setMatchInfo(match || null);

      const poId = invoiceData.purchaseOrder?.id || match?.po?.poId;
      const receiptId = match?.matchedReceipt?.receiptId || match?.suggestedReceipt?.receiptId;

      const [poRes, receiptRes] = await Promise.all([
        poId ? fetch(`/api/purchase-orders/${poId}`) : Promise.resolve(null),
        receiptId && type === "po" ? fetch(`/api/receipts/${receiptId}`) : Promise.resolve(null),
      ]);
      if (poRes) setPODetail(await poRes.json());
      if (receiptRes) { setReceiptDetail(await receiptRes.json()); setSelectedReceiptId(receiptId || null); }
    } catch (err) {
      console.error("Failed to load match data:", err);
    } finally {
      setLoading(false);
    }
  }

  // --- Derived comparison data ---

  const poRows = useMemo(() => buildPOComparison(invoice, poDetail, receiptDetail), [invoice, poDetail, receiptDetail]);
  const poDiscrepancyCount = poRows.filter(r => r.hasInvoice && (!r.qtyMatch || !r.priceMatch)).length;
  const poAllPass = poDiscrepancyCount === 0 && poRows.length > 0;

  const woRows = useMemo(() => buildWOComparison(invoice, woDetail, woReceiptDetail), [invoice, woDetail, woReceiptDetail]);
  const woDiscrepancyCount = woRows.filter(r => r.hasInvoice && !r.qtyMatch).length;
  const woAllPass = woDiscrepancyCount === 0 && woRows.length > 0;

  const isApproved = matchInfo?.matchStatus === "approved";
  const isPendingReceipt = matchInfo?.matchStatus === "pending-receipt";
  const isDiscrepancy = matchInfo?.matchStatus === "discrepancy";
  const isProcessed = isApproved || isPendingReceipt || isDiscrepancy;
  const receiptOptions = manualReceiptOptions || matchInfo?.receiptOptions || [];

  // --- PO handlers ---

  async function handleOpenPoPicker() {
    if (!availablePOs.length) {
      const res = await fetch("/api/purchase-orders");
      const data = await res.json();
      setAvailablePOs(
        data
          .filter((po: { status: string }) => ["Issued", "Partially Received", "Received"].includes(po.status))
          .sort((a: { poNumber: string }, b: { poNumber: string }) => b.poNumber.localeCompare(a.poNumber))
          .map((po: { id: string; poNumber: string; date: string; status: string; grandTotal: number; skus: string[] }) => ({
            id: po.id, poNumber: po.poNumber, date: po.date, status: po.status, grandTotal: po.grandTotal, skus: po.skus || [],
          }))
      );
    }
    setShowPoPicker(true);
  }

  async function handlePoSelected(poId: string) {
    setShowPoPicker(false);
    const res = await fetch(`/api/purchase-orders/${poId}`);
    const data = await res.json();
    setPODetail(data);
    const options = (data.receipts as { id: string; receiptNumber: string; receivedDate: string | null }[] || [])
      .map(r => ({ receiptId: r.id, receiptNumber: r.receiptNumber, receivedDate: r.receivedDate || "", overlapScore: 0 }));
    setManualReceiptOptions(options);
    if (options.length > 0) {
      setSelectedReceiptId(options[0].receiptId);
      const rRes = await fetch(`/api/receipts/${options[0].receiptId}`);
      setReceiptDetail(await rRes.json());
    } else {
      setSelectedReceiptId(null);
      setReceiptDetail(null);
    }
  }

  async function handleReceiptChange(receiptId: string) {
    setSelectedReceiptId(receiptId);
    const res = await fetch(`/api/receipts/${receiptId}`);
    setReceiptDetail(await res.json());
  }

  async function handleConfirmPO() {
    if (!selectedReceiptId) return;
    setConfirming(true);
    try {
      const lineMatches = poRows
        .filter(r => r.invoiceLineId && r.receiptLineId && r.poLineItemId)
        .map(r => ({ invoiceLineId: r.invoiceLineId, receiptLineId: r.receiptLineId, poLineItemId: r.poLineItemId }));
      const res = await fetch(`/api/invoices/${invoiceId}/match`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptId: selectedReceiptId, lineMatches, hasDiscrepancy: !poAllPass }),
      });
      if (!res.ok) { alert(`Error: ${(await res.json()).error}`); return; }
      router.push(`/invoices/${invoiceId}`);
    } catch { alert("Failed to confirm match."); }
    finally { setConfirming(false); }
  }

  async function handlePendingPO() {
    if (!poDetail) return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/match`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId: poDetail.id, pendingReceipt: true }),
      });
      if (!res.ok) { alert(`Error: ${(await res.json()).error}`); return; }
      router.push(`/invoices/${invoiceId}`);
    } catch { alert("Failed to save PO link."); }
    finally { setConfirming(false); }
  }

  async function handleApprove() {
    setConfirming(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/match`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve: true }),
      });
      if (!res.ok) { alert(`Error: ${(await res.json()).error}`); return; }
      router.push(`/invoices/${invoiceId}`);
    } catch { alert("Failed to approve invoice."); }
    finally { setConfirming(false); }
  }

  // --- WO handlers ---

  async function handleOpenWoPicker() {
    if (!availableWOs.length) {
      const res = await fetch("/api/work-orders");
      const data = await res.json();
      setAvailableWOs(
        data.map((wo: { id: string; woNumber: string; status: string; issuedDate: string; completedDate: string; description: string; outputSkus: string[] }) => ({
          id: wo.id, woNumber: wo.woNumber, status: wo.status,
          issuedDate: wo.issuedDate, completedDate: wo.completedDate, description: wo.description, outputSkus: wo.outputSkus || [],
        }))
      );
    }
    setShowWoPicker(true);
  }

  async function handleWoSelected(woId: string) {
    setShowWoPicker(false);
    try {
      const res = await fetch(`/api/work-orders/${woId}`);
      const data = await res.json();
      setWODetail(data);
      setWOReceiptDetail(null);
      if (data.receipts?.length > 0) {
        const rRes = await fetch(`/api/receipts/${data.receipts[0].id}`);
        setWOReceiptDetail(await rRes.json());
      }
    } catch (err) { console.error("Failed to load WO:", err); }
  }

  async function handleConfirmWO() {
    if (!woDetail) return;
    setConfirmingWO(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/match`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId: woDetail.id }),
      });
      if (!res.ok) { alert(`Error: ${(await res.json()).error}`); return; }
      router.push(`/invoices/${invoiceId}`);
    } catch { alert("Failed to match to Work Order."); }
    finally { setConfirmingWO(false); }
  }

  // --- Shipment handlers ---

  async function handleOpenShipmentPicker() {
    if (!availableShipments.length) {
      const res = await fetch("/api/shipments");
      const data = await res.json();
      setAvailableShipments(
        data
          .sort((a: { shipmentNumber: string }, b: { shipmentNumber: string }) => b.shipmentNumber.localeCompare(a.shipmentNumber))
          .map((s: { id: string; shipmentNumber: string; status: string; shipDate: string }) => ({
            id: s.id, shipmentNumber: s.shipmentNumber, status: s.status, shipDate: s.shipDate,
          }))
      );
    }
    setShowShipmentPicker(true);
  }

  async function handleShipmentSelected(shipmentId: string) {
    setShowShipmentPicker(false);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}`);
      const data = await res.json();
      setShipmentDetail(data);
      setReceiptDetail(null);
      setSelectedReceiptId(null);
      if (data.receipts?.length > 0) {
        const rRes = await fetch(`/api/receipts/${data.receipts[0].id}`);
        setReceiptDetail(await rRes.json());
        setSelectedReceiptId(data.receipts[0].id);
      }
    } catch (err) { console.error("Failed to load shipment:", err); }
  }

  async function handleConfirmShipment() {
    if (!shipmentDetail) return;
    setConfirmingShipment(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/match`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId: shipmentDetail.id }),
      });
      if (!res.ok) { alert(`Error: ${(await res.json()).error}`); return; }
      router.push(`/invoices/${invoiceId}`);
    } catch { alert("Failed to match to Shipment."); }
    finally { setConfirmingShipment(false); }
  }

  async function handleUnmatch() {
    setUnmatching(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/unmatch`, { method: "POST" });
      if (!res.ok) { alert(`Error: ${(await res.json()).error}`); return; }
      router.push(`/invoices/${invoiceId}`);
    } catch { alert("Failed to unmatch."); }
    finally { setUnmatching(false); }
  }

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Loading...</p></div>;
  }
  if (!invoice) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">Invoice not found.</p></div>;
  }

  const activeReceipt = matchType === "wo" ? woReceiptDetail : receiptDetail;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="mb-6">
          <Link href={`/invoices/${invoiceId}`} className="text-sm text-gray-500 hover:text-gray-700 mb-2 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {invoice.invoiceNumber}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Match Invoice {invoice.invoiceNumber}</h1>
          {matchInfo?.flags && matchInfo.flags.length > 0 && (
            <div className="mt-2">
              {matchInfo.flags.map((flag, i) => <p key={i} className="text-sm text-warm-600 font-medium">{flag}</p>)}
            </div>
          )}
        </div>

        {/* Match type selector */}
        <div className="flex gap-2 mb-5">
          {(["po", "wo", "shipment"] as const).map((type) => (
            <button key={type} onClick={() => setMatchType(type)}
              className={`px-4 py-1.5 text-sm font-medium rounded-full border transition-colors ${
                matchType === type ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-300 hover:border-gray-500"
              }`}>
              {type === "po" ? "Purchase Order" : type === "wo" ? "Work Order" : "Shipment"}
            </button>
          ))}
        </div>

        {/* ─── 3-column document cards ─── */}
        <div className="grid grid-cols-3 gap-4 mb-6 items-start">

          {/* ── Invoice card ── */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="bg-gray-900 px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-white uppercase tracking-wider">Invoice</span>
              <a href={`/invoices/${invoice.id}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-gray-300 hover:text-white">
                {invoice.invoiceNumber} <ExternalLinkIcon />
              </a>
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs text-gray-500">{formatDate(invoice.invoiceDate)}</p>
                  <p className="text-sm font-medium text-gray-800 mt-0.5">{invoice.supplier || "\u2014"}</p>
                  {invoice.poReference && (
                    <p className="text-xs text-gray-400 mt-0.5">PO Ref: <span className="font-medium text-gray-600">{invoice.poReference}</span></p>
                  )}
                  {invoice.invoiceType && (
                    <span className="inline-block mt-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-gray-100 text-gray-600">
                      {invoice.invoiceType}
                    </span>
                  )}
                </div>
                <p className="text-base font-bold text-gray-900">{formatCurrency(invoice.invoiceAmount)}</p>
              </div>

              {invoice.lines.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <div className="max-h-44 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-100">
                          <th className="text-left pb-1.5 font-medium">SKU</th>
                          <th className="text-right pb-1.5 font-medium">Qty</th>
                          <th className="text-right pb-1.5 font-medium">Unit $</th>
                          <th className="text-right pb-1.5 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {invoice.lines.map((line) => (
                          <tr key={line.id}>
                            <td className="py-1.5 text-gray-700 font-medium">{line.skuName || line.description || "\u2014"}</td>
                            <td className="py-1.5 text-right text-gray-600">{line.qtyBilled.toLocaleString()}</td>
                            <td className="py-1.5 text-right text-gray-600">{formatCurrency(line.unitCost)}</td>
                            <td className="py-1.5 text-right text-gray-900 font-medium">{formatCurrency(line.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Middle card: PO / WO / Shipment ── */}
          {matchType === "po" && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="bg-gold-600 px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-white uppercase tracking-wider">Purchase Order</span>
                <div className="flex items-center gap-2">
                  {poDetail && (
                    <a href={`/purchase-orders/${poDetail.id}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-gold-200 hover:text-white">
                      {poDetail.poNumber} <ExternalLinkIcon />
                    </a>
                  )}
                  {!isApproved && !isDiscrepancy && (
                    <button onClick={handleOpenPoPicker} className="text-xs text-gold-200 hover:text-white border border-gold-500 rounded px-2 py-0.5">
                      {poDetail ? "Change" : "Select"}
                    </button>
                  )}
                </div>
              </div>

              {showPoPicker ? (
                <div className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-500">Select a Purchase Order</p>
                    <button onClick={() => setShowPoPicker(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>
                  <div className="border border-gray-200 rounded overflow-hidden max-h-64 overflow-y-auto divide-y divide-gray-100">
                    {availablePOs.map(po => {
                      const isRecommended = !!(invoice?.poReference && po.poNumber === invoice.poReference);
                      return (
                        <button key={po.id} onClick={() => handlePoSelected(po.id)}
                          className={`w-full text-left px-3 py-2.5 transition-colors ${isRecommended ? "bg-gold-50 hover:bg-gold-100" : "hover:bg-gray-50"}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900">{po.poNumber}</span>
                              {isRecommended && (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-gold-500 text-white">Best match</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {po.grandTotal > 0 && <span className="text-xs font-medium text-gray-700">{formatCurrency(po.grandTotal)}</span>}
                              <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                                po.status === "Received" ? "bg-sage-100 text-sage-700" : "bg-gold-100 text-gold-700"
                              }`}>{po.status}</span>
                            </div>
                          </div>
                          {po.date && <p className="text-xs text-gray-400 mt-0.5">{formatDate(po.date)}</p>}
                          {po.skus.length > 0 && (
                            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{po.skus.join(" · ")}</p>
                          )}
                        </button>
                      );
                    })}
                    {availablePOs.length === 0 && <p className="px-3 py-4 text-xs text-gray-400 text-center">No open POs found</p>}
                  </div>
                </div>
              ) : poDetail ? (
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-xs text-gray-500">{formatDate(poDetail.date)}</p>
                      <p className="text-sm font-medium text-gray-800 mt-0.5">{poDetail.supplier?.name || "\u2014"}</p>
                      <span className={`inline-block mt-1 px-2 py-0.5 text-[10px] font-medium rounded-full ${
                        poDetail.status === "Received" ? "bg-sage-100 text-sage-700" : "bg-gold-100 text-gold-700"
                      }`}>{poDetail.status}</span>
                    </div>
                    <p className="text-base font-bold text-gray-900">{formatCurrency(poDetail.grandTotal)}</p>
                  </div>
                  {poDetail.lineItems.length > 0 && (
                    <div className="border-t border-gray-100 pt-3">
                      <div className="max-h-44 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400 border-b border-gray-100">
                              <th className="text-left pb-1.5 font-medium">SKU</th>
                              <th className="text-right pb-1.5 font-medium">Qty</th>
                              <th className="text-right pb-1.5 font-medium">Unit $</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {poDetail.lineItems.map(line => (
                              <tr key={line.id}>
                                <td className="py-1.5 text-gray-700 font-medium">{line.sku?.standardSku || "\u2014"}</td>
                                <td className="py-1.5 text-right text-gray-600">{getPoQty(line).toLocaleString()}</td>
                                <td className="py-1.5 text-right text-gray-600">{formatCurrency(line.unitCost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-400 text-sm">No PO selected</p>
                  <p className="text-gray-300 text-xs mt-1">
                    {invoice.poReference ? `No match for "${invoice.poReference}"` : "No PO reference on invoice"}
                  </p>
                </div>
              )}
            </div>
          )}

          {matchType === "wo" && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="bg-gold-600 px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-white uppercase tracking-wider">Work Order</span>
                <div className="flex items-center gap-2">
                  {woDetail && (
                    <a href={`/work-orders/${woDetail.id}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-gold-200 hover:text-white">
                      {woDetail.woNumber} <ExternalLinkIcon />
                    </a>
                  )}
                  {!isApproved && !isDiscrepancy && (
                    <button onClick={handleOpenWoPicker} className="text-xs text-gold-200 hover:text-white border border-gold-500 rounded px-2 py-0.5">
                      {woDetail ? "Change" : "Select"}
                    </button>
                  )}
                </div>
              </div>

              {showWoPicker ? (
                <div className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-500">Select a Work Order</p>
                    <button onClick={() => setShowWoPicker(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>
                  <div className="border border-gray-200 rounded overflow-hidden max-h-64 overflow-y-auto divide-y divide-gray-100">
                    {availableWOs.map(wo => {
                      const invoiceSkus = new Set(invoice?.lines.map(l => l.skuName).filter(Boolean) || []);
                      const overlap = wo.outputSkus.some(s => invoiceSkus.has(s));
                      return (
                        <button key={wo.id} onClick={() => handleWoSelected(wo.id)}
                          className={`w-full text-left px-3 py-2.5 transition-colors ${overlap ? "bg-gold-50 hover:bg-gold-100" : "hover:bg-gray-50"}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900">{wo.woNumber}</span>
                              {overlap && (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-gold-500 text-white">SKUs match</span>
                              )}
                            </div>
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-gold-100 text-gold-700">{wo.status}</span>
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5 flex gap-2">
                            {wo.issuedDate && <span>Issued {formatDate(wo.issuedDate)}</span>}
                            {wo.completedDate && <span>· Done {formatDate(wo.completedDate)}</span>}
                          </div>
                          {wo.outputSkus.length > 0 && (
                            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{wo.outputSkus.join(" · ")}</p>
                          )}
                          {wo.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{wo.description}</p>}
                        </button>
                      );
                    })}
                    {availableWOs.length === 0 && <p className="px-3 py-4 text-xs text-gray-400 text-center">No work orders found</p>}
                  </div>
                </div>
              ) : woDetail ? (
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-1.5">
                        {woDetail.issuedDate && <p className="text-xs text-gray-500">Issued {formatDate(woDetail.issuedDate)}</p>}
                      </div>
                      {woDetail.completedDate && <p className="text-xs text-gray-400 mt-0.5">Completed {formatDate(woDetail.completedDate)}</p>}
                      {woDetail.warehouse && <p className="text-sm font-medium text-gray-800 mt-1">{woDetail.warehouse.name}</p>}
                      <span className="inline-block mt-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-gold-100 text-gold-700">
                        {woDetail.status}
                      </span>
                    </div>
                  </div>
                  {woDetail.outputs.length > 0 && (
                    <div className="border-t border-gray-100 pt-3">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Outputs</p>
                      <div className="max-h-44 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400 border-b border-gray-100">
                              <th className="text-left pb-1.5 font-medium">SKU</th>
                              <th className="text-right pb-1.5 font-medium">Expected Qty</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {woDetail.outputs.map(line => (
                              <tr key={line.id}>
                                <td className="py-1.5 text-gray-700 font-medium">{line.sku?.standardSku || "\u2014"}</td>
                                <td className="py-1.5 text-right text-gray-600">{line.qty?.toLocaleString()} {line.sku?.uom}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-400 text-sm">No work order selected</p>
                  <p className="text-gray-300 text-xs mt-1">Click &ldquo;Select&rdquo; above</p>
                </div>
              )}
            </div>
          )}

          {matchType === "shipment" && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="bg-gold-600 px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-white uppercase tracking-wider">Shipment</span>
                <div className="flex items-center gap-2">
                  {shipmentDetail && (
                    <a href={`/shipments/${shipmentDetail.id}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-gold-200 hover:text-white">
                      {shipmentDetail.shipmentNumber} <ExternalLinkIcon />
                    </a>
                  )}
                  {!isApproved && !isDiscrepancy && (
                    <button onClick={handleOpenShipmentPicker} className="text-xs text-gold-200 hover:text-white border border-gold-500 rounded px-2 py-0.5">
                      {shipmentDetail ? "Change" : "Select"}
                    </button>
                  )}
                </div>
              </div>

              {showShipmentPicker ? (
                <div className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-500">Select a Shipment</p>
                    <button onClick={() => setShowShipmentPicker(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>
                  <div className="border border-gray-200 rounded overflow-hidden max-h-64 overflow-y-auto divide-y divide-gray-100">
                    {availableShipments.map(s => (
                      <button key={s.id} onClick={() => handleShipmentSelected(s.id)}
                        className="w-full text-left px-3 py-2.5 hover:bg-gold-50 transition-colors">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-900">{s.shipmentNumber}</span>
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-gold-100 text-gold-700">{s.status}</span>
                        </div>
                        {s.shipDate && <p className="text-xs text-gray-400 mt-0.5">Shipped {formatDate(s.shipDate)}</p>}
                      </button>
                    ))}
                    {availableShipments.length === 0 && <p className="px-3 py-4 text-xs text-gray-400 text-center">No shipments found</p>}
                  </div>
                </div>
              ) : shipmentDetail ? (
                <div className="p-4">
                  <div className="space-y-1.5 text-sm">
                    {shipmentDetail.shipDate && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-400">Ship date</span>
                        <span className="text-xs text-gray-700">{formatDate(shipmentDetail.shipDate)}</span>
                      </div>
                    )}
                    {shipmentDetail.carrier && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-400">Carrier</span>
                        <span className="text-xs text-gray-700">{shipmentDetail.carrier}</span>
                      </div>
                    )}
                    {shipmentDetail.carrierReference && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-400">Reference</span>
                        <span className="text-xs text-gray-700">{shipmentDetail.carrierReference}</span>
                      </div>
                    )}
                    {shipmentDetail.poNumber && (
                      <div className="flex justify-between">
                        <span className="text-xs text-gray-400">Purchase Order</span>
                        <span className="text-xs text-gray-700 font-medium">{shipmentDetail.poNumber}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-400">Status</span>
                      <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-gold-100 text-gold-700">{shipmentDetail.status}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-400 text-sm">No shipment selected</p>
                  <p className="text-gray-300 text-xs mt-1">Click &ldquo;Select&rdquo; above</p>
                </div>
              )}
            </div>
          )}

          {/* ── Receipt card ── */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="bg-sage-600 px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-white uppercase tracking-wider">Receipt</span>
              <div className="flex items-center gap-2">
                {activeReceipt && (
                  <a href={`/receipts/${activeReceipt.id}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[11px] text-sage-200 hover:text-white">
                    {activeReceipt.receiptNumber} <ExternalLinkIcon />
                  </a>
                )}
                {matchType === "po" && !isApproved && !isDiscrepancy && receiptOptions.length > 1 && (
                  <select value={selectedReceiptId || ""} onChange={(e) => handleReceiptChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs bg-sage-700 text-white border border-sage-500 rounded px-1.5 py-0.5 focus:outline-none">
                    {receiptOptions.map(r => <option key={r.receiptId} value={r.receiptId}>{r.receiptNumber}</option>)}
                  </select>
                )}
              </div>
            </div>

            {activeReceipt ? (
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-xs text-gray-500">{formatDate(activeReceipt.receivedDate)}</p>
                    <p className="text-sm font-medium text-gray-800 mt-0.5">{activeReceipt.warehouse || "\u2014"}</p>
                  </div>
                </div>
                {activeReceipt.lines.length > 0 && (
                  <div className="border-t border-gray-100 pt-3">
                    <div className="max-h-44 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-100">
                            <th className="text-left pb-1.5 font-medium">SKU</th>
                            <th className="text-right pb-1.5 font-medium">Qty Received</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {activeReceipt.lines.map(line => (
                            <tr key={line.id}>
                              <td className="py-1.5 text-gray-700 font-medium">{line.sku || "\u2014"}</td>
                              <td className="py-1.5 text-right text-gray-600">{line.qtyReceived.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center">
                <p className="text-gray-400 text-sm">No receipt found</p>
                <p className="text-gray-300 text-xs mt-1">
                  {matchType === "po"
                    ? !poDetail ? "Select a PO first" : receiptOptions.length === 0 ? "No receipts linked to this PO" : "No receipt matched yet"
                    : matchType === "wo"
                    ? !woDetail ? "Select a Work Order first" : "No receipts linked to this WO"
                    : !shipmentDetail ? "Select a shipment first" : "No receipts linked to this shipment"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ─── Comparison section ─── */}

        {/* PO comparison */}
        {matchType === "po" && poRows.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th rowSpan={2} className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider align-bottom pb-3">SKU</th>
                  <th colSpan={2} className="text-center px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider bg-gray-50 border-l border-gray-200 text-gray-500">Invoice</th>
                  <th colSpan={2} className="text-center px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider bg-gold-50 border-l border-gray-200 text-gold-700">Purchase Order</th>
                  <th colSpan={1} className="text-center px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider bg-sage-50 border-l border-gray-200 text-sage-700">Receipt</th>
                  <th colSpan={2} className="text-center px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider border-l border-gray-200 text-gray-400">Checks</th>
                </tr>
                <tr className="border-b border-gray-200 text-xs text-gray-400">
                  <th className="text-right px-3 pb-2 font-medium bg-gray-50 border-l border-gray-200">Qty</th>
                  <th className="text-right px-3 pb-2 font-medium bg-gray-50">Unit Cost</th>
                  <th className="text-right px-3 pb-2 font-medium bg-gold-50 border-l border-gray-200">Qty</th>
                  <th className="text-right px-3 pb-2 font-medium bg-gold-50">Unit Cost</th>
                  <th className="text-right px-3 pb-2 font-medium bg-sage-50 border-l border-gray-200">Qty</th>
                  <th className="text-center px-3 pb-2 font-medium border-l border-gray-200 w-14">Qty</th>
                  <th className="text-center px-3 pb-2 font-medium w-14">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {poRows.map(row => (
                  <tr key={row.skuName} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-xs font-medium text-gray-900">{row.skuName}</td>
                    <td className={`px-3 py-2.5 text-right bg-gray-50/50 border-l border-gray-100 ${row.hasInvoice ? "text-gray-900" : "text-gray-300"}`}>
                      {row.hasInvoice ? row.invoiceQty.toLocaleString() : "\u2014"}
                    </td>
                    <td className={`px-3 py-2.5 text-right text-xs bg-gray-50/50 ${row.hasInvoice ? "text-gray-700" : "text-gray-300"}`}>
                      {row.hasInvoice ? formatCurrency(row.invoiceUnitCost) : "\u2014"}
                    </td>
                    <td className={`px-3 py-2.5 text-right bg-gold-50/40 border-l border-gray-100 ${row.hasPO ? "text-gray-700" : "text-gray-300"}`}>
                      {row.hasPO ? row.poQty.toLocaleString() : "\u2014"}
                    </td>
                    <td className={`px-3 py-2.5 text-right text-xs bg-gold-50/40 ${row.hasPO ? "text-gray-700" : "text-gray-300"}`}>
                      {row.hasPO ? formatCurrency(row.poUnitCost) : "\u2014"}
                    </td>
                    <td className={`px-3 py-2.5 text-right bg-sage-50/40 border-l border-gray-100 ${row.hasReceipt ? "text-gray-700" : "text-gray-300"}`}>
                      {row.hasReceipt ? row.receiptQty.toLocaleString() : "\u2014"}
                    </td>
                    <td className="px-3 py-2.5 text-center border-l border-gray-100">
                      {!row.hasInvoice || !row.hasReceipt ? (
                        <span className="text-gray-200">&mdash;</span>
                      ) : row.qtyMatch ? (
                        <span className="text-sage-600 font-bold text-base">&#10003;</span>
                      ) : (
                        <span className="text-warm-600 text-xs font-semibold">
                          {row.invoiceQty - row.receiptQty > 0 ? "+" : ""}{(row.invoiceQty - row.receiptQty).toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {!row.hasInvoice || !row.hasPO || row.poUnitCost === 0 ? (
                        <span className="text-gray-200">&mdash;</span>
                      ) : row.priceMatch ? (
                        <span className="text-sage-600 font-bold text-base">&#10003;</span>
                      ) : (
                        <span className="text-warm-600 text-xs font-semibold">
                          {row.invoiceUnitCost > row.poUnitCost ? "+" : "-"}${Math.abs(row.invoiceUnitCost - row.poUnitCost).toFixed(2)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={`px-4 py-3 border-t ${poAllPass ? "bg-sage-50 border-sage-100" : "bg-warm-50 border-warm-100"}`}>
              <p className={`text-sm font-medium ${poAllPass ? "text-sage-700" : "text-warm-700"}`}>
                {poAllPass ? "All checks pass \u2014 ready to approve" : `${poDiscrepancyCount} discrepanc${poDiscrepancyCount === 1 ? "y" : "ies"} found \u2014 review before approving`}
              </p>
            </div>
          </div>
        )}

        {matchType === "po" && poRows.length === 0 && !loading && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm mb-6">
            {!poDetail && !receiptDetail ? "Select a PO and receipt to compare." : !poDetail ? "Select a PO to compare." : "Select a receipt to compare."}
          </div>
        )}

        {/* WO comparison */}
        {matchType === "wo" && woRows.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th rowSpan={2} className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider align-bottom pb-3">SKU</th>
                  <th colSpan={2} className="text-center px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider bg-gray-50 border-l border-gray-200 text-gray-500">Invoice</th>
                  <th colSpan={1} className="text-center px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider bg-gold-50 border-l border-gray-200 text-gold-700">Work Order</th>
                  <th colSpan={1} className="text-center px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider bg-sage-50 border-l border-gray-200 text-sage-700">Receipt</th>
                  <th colSpan={1} className="text-center px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider border-l border-gray-200 text-gray-400">Check</th>
                </tr>
                <tr className="border-b border-gray-200 text-xs text-gray-400">
                  <th className="text-right px-3 pb-2 font-medium bg-gray-50 border-l border-gray-200">Qty</th>
                  <th className="text-right px-3 pb-2 font-medium bg-gray-50">Unit Cost</th>
                  <th className="text-right px-3 pb-2 font-medium bg-gold-50 border-l border-gray-200">Expected Qty</th>
                  <th className="text-right px-3 pb-2 font-medium bg-sage-50 border-l border-gray-200">Qty Received</th>
                  <th className="text-center px-3 pb-2 font-medium border-l border-gray-200 w-14">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {woRows.map(row => (
                  <tr key={row.skuName} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-xs font-medium text-gray-900">{row.skuName}</td>
                    <td className={`px-3 py-2.5 text-right bg-gray-50/50 border-l border-gray-100 ${row.hasInvoice ? "text-gray-900" : "text-gray-300"}`}>
                      {row.hasInvoice ? row.invoiceQty.toLocaleString() : "\u2014"}
                    </td>
                    <td className={`px-3 py-2.5 text-right text-xs bg-gray-50/50 ${row.hasInvoice ? "text-gray-700" : "text-gray-300"}`}>
                      {row.hasInvoice ? formatCurrency(row.invoiceUnitCost) : "\u2014"}
                    </td>
                    <td className={`px-3 py-2.5 text-right bg-gold-50/40 border-l border-gray-100 ${row.hasWO ? "text-gray-700" : "text-gray-300"}`}>
                      {row.hasWO ? row.woExpectedQty.toLocaleString() : "\u2014"}
                    </td>
                    <td className={`px-3 py-2.5 text-right bg-sage-50/40 border-l border-gray-100 ${row.hasReceipt ? "text-gray-700" : "text-gray-300"}`}>
                      {row.hasReceipt ? row.receiptQty.toLocaleString() : "\u2014"}
                    </td>
                    <td className="px-3 py-2.5 text-center border-l border-gray-100">
                      {!row.hasInvoice || !row.hasReceipt ? (
                        <span className="text-gray-200">&mdash;</span>
                      ) : row.qtyMatch ? (
                        <span className="text-sage-600 font-bold text-base">&#10003;</span>
                      ) : (
                        <span className="text-warm-600 text-xs font-semibold">
                          {row.invoiceQty - row.receiptQty > 0 ? "+" : ""}{(row.invoiceQty - row.receiptQty).toLocaleString()}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={`px-4 py-3 border-t ${!woReceiptDetail ? "bg-gray-50 border-gray-100" : woAllPass ? "bg-sage-50 border-sage-100" : "bg-warm-50 border-warm-100"}`}>
              <p className={`text-sm font-medium ${!woReceiptDetail ? "text-gray-400" : woAllPass ? "text-sage-700" : "text-warm-700"}`}>
                {!woReceiptDetail
                  ? "No receipt yet \u2014 qty comparison incomplete"
                  : woAllPass
                  ? "Qty checks pass \u2014 invoice matches received goods"
                  : `${woDiscrepancyCount} qty discrepanc${woDiscrepancyCount === 1 ? "y" : "ies"} found`}
              </p>
            </div>
          </div>
        )}

        {matchType === "wo" && woRows.length === 0 && woDetail && !loading && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm mb-6">
            No invoice lines matched WO output SKUs.
          </div>
        )}

        {/* Shipment confirmation block */}
        {matchType === "shipment" && shipmentDetail && (
          <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
            <p className="text-sm text-gray-600">
              This invoice covers{" "}
              <span className="font-medium text-gray-900">{invoice.invoiceType === "Freight" ? "freight" : "customs"} charges</span>{" "}
              for shipment{" "}
              <span className="font-medium text-gray-900">{shipmentDetail.shipmentNumber}</span>
              {shipmentDetail.poNumber && (
                <> associated with PO <span className="font-medium text-gray-900">{shipmentDetail.poNumber}</span></>
              )}.
              {activeReceipt ? (
                <> Receipt <span className="font-medium text-gray-900">{activeReceipt.receiptNumber}</span> confirms delivery.</>
              ) : (
                <span className="text-gray-400"> No receipt yet.</span>
              )}
            </p>
          </div>
        )}

        {/* ─── Actions ─── */}
        <div className="flex items-center justify-between">
          <div>
            {isProcessed && (
              <button onClick={handleUnmatch} disabled={unmatching}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
                {unmatching ? "Unmatching..." : "Unmatch"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isDiscrepancy && (
              <button onClick={handleApprove} disabled={confirming}
                className="bg-sage-600 text-white px-6 py-2 text-sm font-semibold rounded-md hover:bg-sage-700 disabled:opacity-50">
                {confirming ? "Approving..." : "Approve Anyway"}
              </button>
            )}

            {matchType === "wo" && !isApproved && !isDiscrepancy && woDetail && (
              <button onClick={handleConfirmWO} disabled={confirmingWO}
                className="bg-sage-600 text-white px-6 py-2 text-sm font-semibold rounded-md hover:bg-sage-700 disabled:opacity-50">
                {confirmingWO ? "Approving..." : "Approve"}
              </button>
            )}

            {matchType === "shipment" && !isApproved && !isDiscrepancy && shipmentDetail && (
              <button onClick={handleConfirmShipment} disabled={confirmingShipment}
                className="bg-sage-600 text-white px-6 py-2 text-sm font-semibold rounded-md hover:bg-sage-700 disabled:opacity-50">
                {confirmingShipment ? "Approving..." : "Approve"}
              </button>
            )}

            {matchType === "po" && !isApproved && !isDiscrepancy && poDetail && receiptDetail && (
              <button onClick={handleConfirmPO} disabled={confirming}
                className={`text-white px-6 py-2 text-sm font-semibold rounded-md transition-colors disabled:opacity-50 ${
                  poAllPass ? "bg-sage-600 hover:bg-sage-700" : "bg-warm-500 hover:bg-warm-600"
                }`}>
                {confirming ? "Saving..." : poAllPass ? "Approve" : "Match with Discrepancy"}
              </button>
            )}

            {matchType === "po" && !isApproved && !isDiscrepancy && !isPendingReceipt && poDetail && !receiptDetail && (
              <button onClick={handlePendingPO} disabled={confirming}
                className="bg-gray-700 text-white px-6 py-2 text-sm font-semibold rounded-md hover:bg-gray-800 disabled:opacity-50">
                {confirming ? "Saving..." : "Confirm PO \u2014 Awaiting Receipt"}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// --- Page wrapper (handles search params) ---

function MatchPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
    searchParams.get("invoiceId")
  );

  function handleSelect(id: string) {
    setSelectedInvoiceId(id);
    router.replace(`/match?invoiceId=${id}`);
  }

  if (!selectedInvoiceId) {
    return <InvoicePicker onSelect={handleSelect} />;
  }

  return <MatchTool invoiceId={selectedInvoiceId} />;
}

export default function MatchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    }>
      <MatchPageInner />
    </Suspense>
  );
}
