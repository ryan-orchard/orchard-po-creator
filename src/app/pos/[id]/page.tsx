"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { MAGNA } from "@/config/magna";

// ─── Types ───

interface LinkedReceipt {
  id: string;
  receiptNumber: string;
  receivedDate: string | null;
  warehouse: string | null;
}

interface LinkedInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  matchStatus: string | null;
  paymentStatus: string | null;
  totalAmount: number | null;
}

interface Milestones {
  issuedAt: string | null;
  acceptedAt: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
}

interface PODetail {
  id: string;
  poNumber: string;
  date: string;
  status: string;
  soNumber: string | null;
  deliveryDate: string;
  shippingTerms: string;
  paymentTerms: string;
  notes: string;
  grandTotal: number;
  milestones: Milestones;
  supplierId: string | null;
  shipToId: string | null;
  supplier: {
    id: string;
    name: string;
    code: string | null;
    address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  shipTo: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  lineItems: {
    id: string;
    skuId: string | null;
    sku: {
      id: string;
      standardSku: string;
      flavor: string;
      count: number | null;
      uom: string;
      category: string;
      description: string;
      ansItemNumber: string;
    } | null;
    section: string;
    qtySticks: number;
    qtyCartons: number;
    unitCost: number;
    costBasis: string;
    totalPrice: number;
  }[];
  receipts: LinkedReceipt[];
  invoices: LinkedInvoice[];
}

interface ActivityEntry {
  id: string;
  action: string;
  description: string;
  actor: string;
  relatedRecordType: string | null;
  relatedRecordId: string | null;
  createdTime: string;
}

interface Supplier {
  id: string;
  name: string;
  type: string;
  paymentTerms: string;
  categories: string[];
}

interface SKU {
  id: string;
  standardSku: string;
  category: string;
  flavor: string;
  uom: string;
  count: number | null;
  description: string;
  ansItemNumber: string;
}

interface ShipTo {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface EditLineItem {
  key: string;
  skuId: string;
  sku?: SKU;
  qtySticks: number;
  qtyCartons: number | null;
  unitCost: number;
  totalPrice: number;
}

// ─── Constants ───

const ANS_SUPPLIER_CODE = "ANS";
const STATUSES = ["Draft", "Issued", "Accepted", "Shipped", "Partially Received", "Received", "Closed"] as const;
type Tab = "details" | "receipts" | "invoices";

const statusColors: Record<string, string> = {
  Draft: "bg-warm-100 text-warm-800",
  Issued: "bg-gold-100 text-gold-800",
  Accepted: "bg-blue-100 text-blue-800",
  Shipped: "bg-blue-100 text-blue-800",
  "Partially Received": "bg-gold-100 text-gold-800",
  Received: "bg-sage-100 text-sage-800",
  Closed: "bg-gray-100 text-gray-600",
};

// ─── Helpers ───

const fmtDate = (d: string | null) => {
  if (!d) return null;
  return new Date(d.includes("T") ? d : d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const fmtDateShort = (d: string | null) => {
  if (!d) return null;
  const date = new Date(d.includes("T") ? d : d + "T00:00:00");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
};

const fmtCurrency = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatActivityTime = (dateStr: string) => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${mm}/${dd}/${yy} ${time}`;
};

// ─── Component ───

export default function PODetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const [po, setPO] = useState<PODetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const justCreated = searchParams.get("created") === "1";

  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [activities, setActivities] = useState<ActivityEntry[]>([]);

  // Receipt status
  const [receiptStatus, setReceiptStatus] = useState<{
    totalOrdered: number;
    totalReceived: number;
    uomLabel: string;
    receiptDates: string[];
    lineItems: { id: string; skuId: string | null; sku: { standardSku: string; flavor: string; uom: string } | null; qtyOrdered: number; qtyReceived: number; qtyRemaining: number }[];
  } | null>(null);

  // Status controls
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showSoModal, setShowSoModal] = useState(false);
  const [soInput, setSoInput] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  // Inline line item editing
  const [editingLines, setEditingLines] = useState(false);
  const [savingLines, setSavingLines] = useState(false);
  const [editLineItems, setEditLineItems] = useState<EditLineItem[]>([]);
  const [skuSearch, setSkuSearch] = useState<Record<string, string>>({});
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // Ref data for editing
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [skus, setSkus] = useState<SKU[]>([]);
  const [shipTos, setShipTos] = useState<ShipTo[]>([]);
  const [refDataLoaded, setRefDataLoaded] = useState(false);

  // Header edit mode (for supplier, ship-to, dates, terms)
  const [editingHeader, setEditingHeader] = useState(false);
  const [savingHeader, setSavingHeader] = useState(false);
  const [editSupplierId, setEditSupplierId] = useState("");
  const [editShipToId, setEditShipToId] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDeliveryDate, setEditDeliveryDate] = useState("");
  const [editPaymentTerms, setEditPaymentTerms] = useState("");
  const [editShippingTerms, setEditShippingTerms] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // ─── Data fetching ───

  useEffect(() => {
    fetch(`/api/purchase-orders/${params.id}`)
      .then((r) => { if (!r.ok) throw new Error("Not found"); return r.json(); })
      .then((data) => { setPO(data); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [params.id]);

  useEffect(() => {
    fetch(`/api/purchase-orders/${params.id}/activity`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setActivities(data))
      .catch(() => setActivities([]));
  }, [params.id]);

  useEffect(() => {
    fetch(`/api/purchase-orders/${params.id}/receipt-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.lineItems) {
          const totalOrdered = data.lineItems.reduce((s: number, li: { qtyOrdered: number }) => s + (li.qtyOrdered || 0), 0);
          const totalReceived = data.lineItems.reduce((s: number, li: { qtyReceived: number }) => s + (li.qtyReceived || 0), 0);
          setReceiptStatus({ totalOrdered, totalReceived, uomLabel: data.uomLabel || "units", receiptDates: data.receiptDates || [], lineItems: data.lineItems });
        }
      })
      .catch(() => {});
  }, [params.id]);

  // ─── Ref data loading ───

  const loadRefData = () => {
    if (refDataLoaded) return Promise.resolve();
    return Promise.all([
      fetch("/api/suppliers").then((r) => r.json()),
      fetch("/api/skus").then((r) => r.json()),
      fetch("/api/ship-to").then((r) => r.json()),
    ]).then(([s, sk, st]) => {
      setSuppliers(s);
      setSkus(sk);
      setShipTos(st);
      setRefDataLoaded(true);
    });
  };

  // ─── Status handlers ───

  const updateStatus = async (newStatus: string) => {
    if (!po) return;
    setShowStatusMenu(false);
    if (newStatus === "Accepted" && (po.supplier?.code === ANS_SUPPLIER_CODE || po.supplier?.name === ANS_SUPPLIER_CODE)) {
      setSoInput("");
      setShowSoModal(true);
      return;
    }
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/purchase-orders/${params.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed");
      // Refresh PO to get updated milestones
      const poRes = await fetch(`/api/purchase-orders/${params.id}`);
      if (poRes.ok) setPO(await poRes.json());
      else setPO({ ...po, status: newStatus });
    } catch {
      alert("Error updating status.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const confirmAccepted = async () => {
    if (!po) return;
    setShowSoModal(false);
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/purchase-orders/${params.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Accepted", soNumber: soInput || null }),
      });
      if (!res.ok) throw new Error("Failed");
      const poRes = await fetch(`/api/purchase-orders/${params.id}`);
      if (poRes.ok) setPO(await poRes.json());
      else setPO({ ...po, status: "Accepted", soNumber: soInput || null });
      setSoInput("");
    } catch {
      alert("Error updating status.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  // ─── Header edit handlers ───

  const startEditingHeader = async () => {
    if (!po) return;
    await loadRefData();
    setEditSupplierId(po.supplierId || "");
    setEditShipToId(po.shipToId || "");
    setEditDate(po.date || "");
    setEditDeliveryDate(po.deliveryDate || "");
    setEditPaymentTerms(po.paymentTerms || "");
    setEditShippingTerms(po.shippingTerms || "");
    setEditNotes(po.notes || "");
    setEditingHeader(true);
  };

  const saveHeader = async () => {
    if (!po) return;
    setSavingHeader(true);
    try {
      await fetch(`/api/purchase-orders/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: editDate,
          supplierId: editSupplierId,
          shipToId: editShipToId,
          deliveryDate: editDeliveryDate || null,
          shippingTerms: editShippingTerms,
          paymentTerms: editPaymentTerms,
          notes: editNotes,
          status: po.status,
          lineItems: po.lineItems.map((li) => ({
            skuId: li.skuId,
            uom: li.sku?.uom ?? "",
            count: li.sku?.count ?? null,
            qtySticks: li.qtySticks,
            qtyCartons: li.qtyCartons,
            unitCost: li.unitCost,
            totalPrice: li.totalPrice,
          })),
        }),
      });
      const res = await fetch(`/api/purchase-orders/${params.id}`);
      const data = await res.json();
      setPO(data);
      setEditingHeader(false);
    } catch {
      alert("Error saving changes.");
    } finally {
      setSavingHeader(false);
    }
  };

  // ─── Line item edit handlers ───

  const startEditingLines = async () => {
    if (!po) return;
    await loadRefData();
    setEditLineItems(
      po.lineItems.map((li) => ({
        key: crypto.randomUUID(),
        skuId: li.skuId || "",
        sku: li.sku ? {
          id: li.skuId || "",
          standardSku: li.sku.standardSku,
          category: li.sku.category,
          flavor: li.sku.flavor,
          uom: li.sku.uom,
          count: li.sku.count,
          description: li.sku.description || "",
          ansItemNumber: li.sku.ansItemNumber || "",
        } : undefined,
        qtySticks: li.qtySticks,
        qtyCartons: li.qtyCartons,
        unitCost: li.unitCost,
        totalPrice: li.totalPrice,
      }))
    );
    setSkuSearch({});
    setEditingLines(true);
  };

  const updateLineItem = useCallback(
    (key: string, updates: Partial<EditLineItem>) => {
      setEditLineItems((prev) =>
        prev.map((item) => {
          if (item.key !== key) return item;
          const updated = { ...item, ...updates };
          if (updates.skuId) {
            const sku = skus.find((s) => s.id === updates.skuId);
            if (sku) {
              updated.sku = sku;
              updated.qtySticks = 0;
              updated.qtyCartons = sku.uom === "Carton" ? 0 : null;
            }
          }
          const uom = updated.sku?.uom;
          const count = updated.sku?.count ?? NaN;
          if (uom === "Carton" && !isNaN(count) && count > 0) {
            updated.qtySticks = (updated.qtyCartons || 0) * count;
            updated.totalPrice = (updated.qtyCartons || 0) * updated.unitCost;
          } else {
            updated.qtyCartons = null;
            updated.totalPrice = updated.qtySticks * updated.unitCost;
          }
          return updated;
        })
      );
    },
    [skus]
  );

  const addLineItem = () => {
    setEditLineItems((prev) => [
      ...prev,
      { key: crypto.randomUUID(), skuId: "", qtySticks: 0, qtyCartons: null, unitCost: 0, totalPrice: 0 },
    ]);
  };

  const removeLineItem = (key: string) => {
    setEditLineItems((prev) => prev.filter((item) => item.key !== key));
  };

  const editGrandTotal = editLineItems.reduce((sum, item) => sum + item.totalPrice, 0);

  const filteredSkus = (key: string) => {
    const search = (skuSearch[key] || "").toLowerCase();
    const supplier = suppliers.find((s) => s.id === (po?.supplierId || ""));
    const supplierFiltered = supplier?.categories?.length
      ? skus.filter((s) => supplier.categories.includes(s.category))
      : skus;
    if (!search) return supplierFiltered.slice(0, 20);
    return supplierFiltered.filter(
      (s) =>
        (s.standardSku || "").toLowerCase().includes(search) ||
        (s.flavor || "").toLowerCase().includes(search) ||
        (s.category || "").toLowerCase().includes(search) ||
        (s.description || "").toLowerCase().includes(search)
    );
  };

  const saveLines = async () => {
    if (!po) return;
    if (editLineItems.every((li) => !li.skuId)) {
      alert("Add at least one line item.");
      return;
    }
    setSavingLines(true);
    try {
      await fetch(`/api/purchase-orders/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: po.date,
          supplierId: po.supplierId,
          shipToId: po.shipToId,
          deliveryDate: po.deliveryDate || null,
          shippingTerms: po.shippingTerms,
          paymentTerms: po.paymentTerms,
          notes: po.notes,
          status: po.status,
          grandTotal: editGrandTotal,
          lineItems: editLineItems
            .filter((li) => li.skuId)
            .map((li) => ({
              skuId: li.skuId,
              uom: li.sku?.uom ?? "",
              count: li.sku?.count ?? null,
              qtySticks: li.qtySticks,
              qtyCartons: li.qtyCartons,
              unitCost: li.unitCost,
              totalPrice: li.totalPrice,
            })),
        }),
      });
      const res = await fetch(`/api/purchase-orders/${params.id}`);
      const data = await res.json();
      setPO(data);
      setEditingLines(false);
    } catch {
      alert("Error saving line items.");
    } finally {
      setSavingLines(false);
    }
  };

  // ─── Render helpers ───

  const receivedByLineId: Record<string, number> = {};
  if (receiptStatus?.lineItems) {
    for (const rli of receiptStatus.lineItems) {
      receivedByLineId[rli.id] = rli.qtyReceived || 0;
    }
  }

  // ─── Loading / Error states ───

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (error || !po) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Purchase order not found.</p>
          <button onClick={() => router.push("/pos")} className="text-xs text-gray-700 underline hover:text-gray-900">
            &larr; Back to POs
          </button>
        </div>
      </div>
    );
  }

  const isSimpleMode = po.lineItems.length > 0 && !po.lineItems.some((li) => li.sku?.uom === "Carton");
  const showReceived = receiptStatus && receiptStatus.totalReceived > 0;

  // ─── Milestone timeline data ───
  const milestoneSteps = [
    { label: "Created", date: po.date, reached: true },
    { label: "Issued", date: po.milestones?.issuedAt, reached: !!po.milestones?.issuedAt || ["Issued", "Accepted", "Shipped", "Partially Received", "Received", "Closed"].includes(po.status) },
    { label: "Accepted", date: po.milestones?.acceptedAt, reached: !!po.milestones?.acceptedAt || ["Accepted", "Shipped", "Partially Received", "Received", "Closed"].includes(po.status) },
    { label: "Shipped", date: po.milestones?.shippedAt, reached: !!po.milestones?.shippedAt || ["Shipped", "Partially Received", "Received", "Closed"].includes(po.status) },
    { label: "Received", date: po.milestones?.receivedAt, reached: !!po.milestones?.receivedAt || ["Received", "Closed"].includes(po.status) },
  ];

  // Activity event styling
  const isLifecycleEvent = (action: string) =>
    action === "status_changed" || action === "po_created" || action === "receipt_linked" || action === "invoice_linked";

  return (
    <>
      <div className="min-h-screen bg-gray-50" onClick={() => setShowStatusMenu(false)}>
        <div className="max-w-6xl mx-auto px-6 py-8">
          {/* Banners */}
          {justCreated && (
            <div className="print:hidden mb-6 bg-sage-50 border border-sage-200 rounded-lg px-4 py-3 text-sm text-sage-800">
              PO <span className="font-semibold">{po.poNumber}</span> created successfully.
            </div>
          )}
          {po.status === "Draft" && (
            <div className="print:hidden mb-6 bg-yellow-50 border border-yellow-300 rounded-lg px-4 py-3 flex items-center gap-3">
              <span className="inline-block bg-yellow-200 text-yellow-900 text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded">Draft</span>
              <span className="text-sm text-yellow-800">This PO has not been issued. Change status to <strong>Issued</strong> when ready to send.</span>
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900">{po.poNumber}</h1>
                <div className="relative print:hidden" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setShowStatusMenu(!showStatusMenu)}
                    disabled={updatingStatus}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full cursor-pointer border transition-all ${
                      showStatusMenu ? "ring-2 ring-gray-300" : "hover:ring-1 hover:ring-gray-200"
                    } ${statusColors[po.status] || "bg-gray-100 text-gray-600"} border-current/20`}
                  >
                    {updatingStatus ? "..." : po.status}
                    <svg className={`w-3 h-3 opacity-60 transition-transform ${showStatusMenu ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  {showStatusMenu && (
                    <div className="absolute z-50 mt-1 left-0 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[120px]">
                      {STATUSES.map((s) => (
                        <button
                          key={s}
                          onClick={() => updateStatus(s)}
                          className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${po.status === s ? "font-semibold" : ""}`}
                        >
                          <span className={`inline-block w-2 h-2 rounded-full mr-2 ${statusColors[s]?.split(" ")[0] || "bg-gray-200"}`} />
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {po.supplier?.name || "No supplier"} &middot; {fmtDate(po.date) || "No date"}
              </p>
              {/* Receipt progress bar */}
              {receiptStatus && receiptStatus.totalOrdered > 0 && ["Issued", "Accepted", "Shipped", "Partially Received", "Received"].includes(po.status) && (
                <div className="flex items-center gap-3 mt-2 print:hidden">
                  <div className="w-36 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        receiptStatus.totalReceived >= receiptStatus.totalOrdered ? "bg-sage-500" : receiptStatus.totalReceived > 0 ? "bg-gold-400" : ""
                      }`}
                      style={{ width: `${Math.min(100, (receiptStatus.totalReceived / receiptStatus.totalOrdered) * 100)}%` }}
                    />
                  </div>
                  <span className={`text-xs font-medium ${
                    receiptStatus.totalReceived >= receiptStatus.totalOrdered ? "text-sage-700" : receiptStatus.totalReceived > 0 ? "text-gold-700" : "text-gray-400"
                  }`}>
                    {receiptStatus.totalReceived.toLocaleString()} / {receiptStatus.totalOrdered.toLocaleString()} {receiptStatus.uomLabel} received
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 print:hidden">
              <button
                onClick={() => window.open(`/pos/${params.id}/print`, "_blank")}
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Save as PDF
              </button>
              <button
                onClick={() => router.push("/pos")}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                &larr; Back
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 border-b border-gray-200 mb-6 print:hidden">
            {([
              { key: "details" as Tab, label: "Details" },
              { key: "receipts" as Tab, label: "Receipts", count: po.receipts?.length || 0 },
              { key: "invoices" as Tab, label: "Invoices", count: po.invoices?.length || 0 },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
                {"count" in tab && (tab.count ?? 0) > 0 && (
                  <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* ─── DETAILS TAB ─── */}
          {activeTab === "details" && (
            <>
              {/* Two-column: Order Details + Lifecycle */}
              <div className="grid grid-cols-5 gap-6 mb-6">
                {/* Order Details — left, wider */}
                <div className="col-span-3 bg-white rounded-lg border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-semibold text-gray-900">Order Details</h2>
                    {!editingHeader && (
                      <button
                        onClick={startEditingHeader}
                        className="text-xs font-medium text-gray-600 border border-gray-300 rounded px-2.5 py-1 hover:bg-gray-50 hover:text-gray-800 transition-colors"
                      >
                        Edit
                      </button>
                    )}
                  </div>

                  {editingHeader ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
                          <select value={editSupplierId} onChange={(e) => setEditSupplierId(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black">
                            <option value="">Select...</option>
                            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Ship To</label>
                          <select value={editShipToId} onChange={(e) => setEditShipToId(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black">
                            <option value="">Select...</option>
                            {shipTos.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">PO Date</label>
                          <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Expected Delivery</label>
                          <input type="date" value={editDeliveryDate} onChange={(e) => setEditDeliveryDate(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Payment Terms</label>
                          <input type="text" value={editPaymentTerms} onChange={(e) => setEditPaymentTerms(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Shipping Terms</label>
                          <input type="text" value={editShippingTerms} onChange={(e) => setEditShippingTerms(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                        <input type="text" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button onClick={saveHeader} disabled={savingHeader} className="px-4 py-1.5 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50">
                          {savingHeader ? "Saving..." : "Save"}
                        </button>
                        <button onClick={() => setEditingHeader(false)} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Supplier</p>
                        <p className="text-sm font-medium text-gray-900">{po.supplier?.name || "\u2014"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Ship To</p>
                        <p className="text-sm font-medium text-gray-900">{po.shipTo?.name || "\u2014"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">PO Date</p>
                        <p className="text-sm text-gray-900">{fmtDate(po.date) || "\u2014"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Expected Delivery</p>
                        <p className="text-sm text-gray-900">{fmtDate(po.deliveryDate) || "\u2014"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Payment Terms</p>
                        <p className="text-sm text-gray-900">{po.paymentTerms || "\u2014"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Shipping Terms</p>
                        <p className="text-sm text-gray-900">{po.shippingTerms || "\u2014"}</p>
                      </div>
                      {po.notes && (
                        <div className="col-span-2">
                          <p className="text-xs text-gray-400 mb-0.5">Notes</p>
                          <p className="text-sm text-gray-900">{po.notes}</p>
                        </div>
                      )}
                      {po.soNumber && (
                        <div className="col-span-2 border-t border-gray-100 pt-3 mt-1">
                          <p className="text-xs text-blue-500 mb-0.5">ANS SO #</p>
                          <p className="text-sm font-medium text-gray-900">{po.soNumber}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Order Lifecycle — right, narrower */}
                <div className="col-span-2 bg-white rounded-lg border border-gray-200 p-6">
                  <h2 className="text-base font-semibold text-gray-900 mb-5">Lifecycle</h2>
                  <div className="space-y-0">
                    {milestoneSteps.map((step, idx) => {
                      const isLast = idx === milestoneSteps.length - 1;
                      const nextReached = !isLast && milestoneSteps[idx + 1].reached;
                      return (
                        <div key={step.label} className="flex items-start gap-3">
                          {/* Dot + line */}
                          <div className="flex flex-col items-center">
                            <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                              step.reached
                                ? "bg-sage-500 border-sage-500"
                                : "bg-white border-gray-300"
                            }`} />
                            {!isLast && (
                              <div className={`w-0.5 h-8 ${
                                nextReached ? "bg-sage-300" : "bg-gray-200"
                              }`} />
                            )}
                          </div>
                          {/* Label + date */}
                          <div className="-mt-0.5">
                            <p className={`text-sm font-medium ${step.reached ? "text-gray-900" : "text-gray-400"}`}>
                              {step.label}
                            </p>
                            {step.date && (
                              <p className="text-xs text-gray-400">{fmtDateShort(step.date)}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Line Items */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h2 className="text-base font-semibold text-gray-900">Line Items</h2>
                  <div className="flex items-center gap-2 print:hidden">
                    {editingLines ? (
                      <>
                        <button onClick={addLineItem} className="text-xs text-gray-600 hover:text-gray-800 border border-gray-300 rounded px-2.5 py-1 hover:bg-gray-50">
                          + Add Line
                        </button>
                        <button onClick={() => setEditingLines(false)} className="text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1">
                          Cancel
                        </button>
                        <button onClick={saveLines} disabled={savingLines} className="text-xs bg-gray-900 text-white rounded px-3 py-1 hover:bg-gray-800 disabled:opacity-50">
                          {savingLines ? "Saving..." : "Save"}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={startEditingLines}
                        className="text-xs font-medium text-gray-600 border border-gray-300 rounded px-2.5 py-1 hover:bg-gray-50 hover:text-gray-800 transition-colors"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>

                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Product</th>
                      {!isSimpleMode && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Pack</th>}
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">{isSimpleMode ? "Qty" : "Qty (Sticks)"}</th>
                      {!isSimpleMode && <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Qty (Ctns)</th>}
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Unit Cost</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Total</th>
                      {showReceived && !editingLines && <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Received</th>}
                      {editingLines && <th className="px-4 py-3 w-8"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {editingLines ? (
                      /* ─── EDIT MODE ROWS ─── */
                      editLineItems.map((item) => (
                        <tr key={item.key} className="border-b border-gray-100">
                          <td className="px-4 py-2 relative">
                            <input
                              type="text"
                              value={item.sku ? `${item.sku.standardSku} — ${item.sku.flavor || item.sku.ansItemNumber || ""}` : skuSearch[item.key] || ""}
                              onChange={(e) => {
                                setSkuSearch((prev) => ({ ...prev, [item.key]: e.target.value }));
                                setActiveDropdown(item.key);
                                if (item.skuId) updateLineItem(item.key, { skuId: "", sku: undefined });
                              }}
                              onFocus={() => setActiveDropdown(item.key)}
                              onBlur={() => setTimeout(() => setActiveDropdown(null), 200)}
                              placeholder="Search SKU..."
                              className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-black"
                            />
                            {activeDropdown === item.key && (
                              <div className="absolute z-50 mt-1 w-96 max-h-60 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-xl">
                                {filteredSkus(item.key).map((sku) => (
                                  <button
                                    key={sku.id}
                                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs border-b border-gray-50"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      updateLineItem(item.key, { skuId: sku.id });
                                      setSkuSearch((prev) => ({ ...prev, [item.key]: "" }));
                                      setActiveDropdown(null);
                                    }}
                                  >
                                    <span className="font-semibold">{sku.standardSku}</span>
                                    <span className="text-gray-500 ml-2">{sku.flavor} &middot; {sku.count} &middot; {sku.category}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                          {!isSimpleMode && (
                            <td className="px-4 py-2 text-xs text-gray-500">
                              {item.sku?.uom === "Carton" ? `${item.sku.count} CT` : item.sku?.uom === "Stick" ? "Bulk" : "\u2014"}
                            </td>
                          )}
                          <td className="px-4 py-2">
                            {item.sku?.uom !== "Carton" ? (
                              <input type="number" value={item.qtySticks || ""} onChange={(e) => updateLineItem(item.key, { qtySticks: parseInt(e.target.value) || 0 })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-black" />
                            ) : (
                              <input type="number" value={item.qtySticks || ""} readOnly className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1 text-xs text-right text-gray-500" />
                            )}
                          </td>
                          {!isSimpleMode && (
                            <td className="px-4 py-2">
                              {item.sku?.uom === "Carton" ? (
                                <input type="number" value={item.qtyCartons ?? ""} onChange={(e) => updateLineItem(item.key, { qtyCartons: parseInt(e.target.value) || 0 })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-black" />
                              ) : (
                                <input type="number" value={item.qtyCartons ?? ""} readOnly className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1 text-xs text-right text-gray-500" />
                              )}
                            </td>
                          )}
                          <td className="px-4 py-2">
                            <input type="number" step="0.01" value={item.unitCost || ""} onChange={(e) => updateLineItem(item.key, { unitCost: parseFloat(e.target.value) || 0 })} className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-black" />
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span className="text-xs font-semibold tabular-nums">{fmtCurrency(item.totalPrice)}</span>
                          </td>
                          <td className="px-4 py-2 text-center">
                            {editLineItems.length > 1 && (
                              <button onClick={() => removeLineItem(item.key)} className="text-gray-400 hover:text-red-500 text-xs">&times;</button>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      /* ─── VIEW MODE ROWS ─── */
                      po.lineItems.map((item) => (
                        <tr key={item.id} className="border-b border-gray-100">
                          <td className="px-4 py-3 text-xs font-medium text-gray-900 whitespace-nowrap">
                            {item.sku?.ansItemNumber || item.sku?.flavor || item.sku?.standardSku || "\u2014"}
                          </td>
                          {!isSimpleMode && (
                            <td className="px-4 py-3 text-xs text-gray-700">
                              {item.sku?.uom === "Carton" ? `${item.sku.count} CT` : item.sku?.uom === "Stick" ? "Bulk" : "\u2014"}
                            </td>
                          )}
                          <td className="px-4 py-3 text-xs text-right text-gray-700 tabular-nums">{item.qtySticks?.toLocaleString() || "\u2014"}</td>
                          {!isSimpleMode && (
                            <td className="px-4 py-3 text-xs text-right text-gray-500 tabular-nums">{item.qtyCartons?.toLocaleString() || "\u2014"}</td>
                          )}
                          <td className="px-4 py-3 text-xs text-right text-gray-700 tabular-nums">{fmtCurrency(item.unitCost || 0)}</td>
                          <td className="px-4 py-3 text-xs text-right font-semibold text-gray-900 tabular-nums">{fmtCurrency(item.totalPrice || 0)}</td>
                          {showReceived && (() => {
                            const uom = item.sku?.uom || "Each";
                            const ordered = uom === "Carton" ? item.qtyCartons : item.qtySticks;
                            const received = receivedByLineId[item.id] || 0;
                            const variance = received - ordered;
                            return (
                              <td className="px-4 py-2.5 text-right tabular-nums">
                                <span className="font-medium">{received.toLocaleString()}</span>
                                {variance !== 0 && ordered > 0 && (
                                  <span className={`ml-1 text-xs ${variance < 0 ? "text-red-500" : "text-sage-600"}`}>
                                    ({variance > 0 ? "+" : ""}{variance.toLocaleString()})
                                  </span>
                                )}
                              </td>
                            );
                          })()}
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td className="px-4 py-3 text-xs font-bold text-gray-900">TOTAL</td>
                      {!isSimpleMode && <td />}
                      <td className="px-4 py-3 text-xs text-right font-bold text-gray-900 tabular-nums">
                        {(editingLines ? editLineItems.reduce((s, i) => s + (i.qtySticks || 0), 0) : po.lineItems.reduce((s, i) => s + (i.qtySticks || 0), 0)).toLocaleString()}
                      </td>
                      {!isSimpleMode && (
                        <td className="px-4 py-3 text-xs text-right font-bold text-gray-500 tabular-nums">
                          {(editingLines ? editLineItems.reduce((s, i) => s + (i.qtyCartons || 0), 0) : po.lineItems.reduce((s, i) => s + (i.qtyCartons || 0), 0)).toLocaleString()}
                        </td>
                      )}
                      <td />
                      <td className="px-4 py-3 text-xs text-right font-bold text-gray-900 tabular-nums">
                        {fmtCurrency(editingLines ? editGrandTotal : po.grandTotal || 0)}
                      </td>
                      {showReceived && !editingLines && (
                        <td className="px-4 py-3 text-right font-bold tabular-nums">{receiptStatus.totalReceived.toLocaleString()}</td>
                      )}
                      {editingLines && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Activity Timeline */}
              {activities.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-6 print:hidden">
                  <h2 className="text-base font-semibold text-gray-900 mb-5">Activity</h2>

                  <div className="relative pl-7">
                    <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-gray-100 rounded-full" />
                    {activities.map((entry, idx) => {
                      const isMajor = isLifecycleEvent(entry.action);
                      return (
                        <div key={entry.id} className={`relative ${idx < activities.length - 1 ? "pb-4" : ""}`}>
                          <div className={`absolute -left-7 top-0.5 rounded-full ${
                            isMajor
                              ? "w-3.5 h-3.5 ring-2 ring-offset-1 bg-sage-500 ring-sage-100"
                              : "w-2.5 h-2.5 mt-0.5 bg-gray-300"
                          }`} />
                          <div className="flex items-start justify-between gap-3">
                            <p className={`leading-relaxed ${
                              isMajor ? "text-sm text-gray-900" : "text-xs text-gray-400"
                            }`}>
                              {entry.description}
                            </p>
                            <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0 pt-0.5">
                              {formatActivityTime(entry.createdTime)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ─── RECEIPTS TAB ─── */}
          {activeTab === "receipts" && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              {po.receipts && po.receipts.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Receipt #</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Received Date</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Warehouse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.receipts.map((r) => (
                      <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <a href="/receipts" className="text-sm font-medium text-sage-700 hover:text-sage-900 hover:underline">
                            {r.receiptNumber}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{fmtDate(r.receivedDate) || "\u2014"}</td>
                        <td className="px-4 py-3">
                          {r.warehouse && (
                            <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded">{r.warehouse}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="py-12 text-center">
                  <p className="text-sm text-gray-400">No receipts linked to this PO yet.</p>
                </div>
              )}
            </div>
          )}

          {/* ─── INVOICES TAB ─── */}
          {activeTab === "invoices" && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              {po.invoices && po.invoices.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Invoice #</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Payment Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <a href={`/invoices/${inv.id}`} className="text-sm font-medium text-sage-700 hover:text-sage-900 hover:underline">
                            {inv.invoiceNumber}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{fmtDate(inv.invoiceDate) || "\u2014"}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {inv.totalAmount != null ? fmtCurrency(inv.totalAmount) : "\u2014"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                            inv.paymentStatus === "Paid" ? "bg-sage-100 text-sage-700" :
                            inv.paymentStatus === "Disputed" ? "bg-red-100 text-red-700" :
                            "bg-gray-100 text-gray-500"
                          }`}>
                            {inv.paymentStatus || "Unpaid"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="py-12 text-center">
                  <p className="text-sm text-gray-400">No invoices linked to this PO yet.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SO Number modal */}
      {showSoModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowSoModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900 mb-1">ANS Sales Order Number</h2>
            <p className="text-sm text-gray-500 mb-4">Enter the SO number from ANS&apos;s acceptance. You can skip this and add it later.</p>
            <input
              type="text"
              value={soInput}
              onChange={(e) => setSoInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmAccepted()}
              placeholder="e.g. SO570645"
              autoFocus
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setSoInput(""); confirmAccepted(); }} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">
                Skip
              </button>
              <button onClick={confirmAccepted} className="px-4 py-1.5 text-sm font-medium bg-gray-900 text-white rounded-md hover:bg-gray-800">
                Confirm Accepted
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
