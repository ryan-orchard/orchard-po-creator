"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { MAGNA } from "@/config/magna";

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
  totalAmount: number | null;
}

const ANS_SUPPLIER_ID = "recQ9MHAO091WGTOO";

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
  supplierId: string | null;
  shipToId: string | null;
  supplier: {
    id: string;
    name: string;
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
      supplierItemName: string;
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
  supplierItemName: string;
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

const STATUSES = ["Draft", "Issued", "Accepted", "Partially Received", "Received", "Closed"] as const;

const statusColors: Record<string, string> = {
  Draft: "bg-warm-100 text-warm-800",
  Issued: "bg-gold-100 text-gold-800",
  Accepted: "bg-blue-100 text-blue-800",
  "Partially Received": "bg-gold-100 text-gold-800",
  Received: "bg-sage-100 text-sage-800",
  Closed: "bg-gray-100 text-gray-600",
};

export default function PODetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const [po, setPO] = useState<PODetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const justCreated = searchParams.get("created") === "1";

  // Activity log
  const [activities, setActivities] = useState<ActivityEntry[]>([]);

  // Receipt status (received vs ordered)
  const [receiptStatus, setReceiptStatus] = useState<{
    totalOrdered: number;
    totalReceived: number;
    uomLabel: string;
    receiptDates: string[];
    lineItems: { id: string; skuId: string | null; sku: { standardSku: string; flavor: string; uom: string } | null; qtyOrdered: number; qtyReceived: number; qtyRemaining: number }[];
  } | null>(null);

  // Status update
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showSoModal, setShowSoModal] = useState(false);
  const [soInput, setSoInput] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [skus, setSkus] = useState<SKU[]>([]);
  const [shipTos, setShipTos] = useState<ShipTo[]>([]);
  const [refDataLoaded, setRefDataLoaded] = useState(false);

  // Edit form fields
  const [editSupplierId, setEditSupplierId] = useState("");
  const [editShipToId, setEditShipToId] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDeliveryDate, setEditDeliveryDate] = useState("");
  const [editPaymentTerms, setEditPaymentTerms] = useState("");
  const [editShippingTerms, setEditShippingTerms] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editLineItems, setEditLineItems] = useState<EditLineItem[]>([]);
  const [skuSearch, setSkuSearch] = useState<Record<string, string>>({});
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/purchase-orders/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setPO(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [params.id]);

  // Fetch activity log
  useEffect(() => {
    fetch(`/api/purchase-orders/${params.id}/activity`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setActivities(data))
      .catch(() => setActivities([]));
  }, [params.id]);

  // Fetch receipt status (received vs ordered quantities)
  useEffect(() => {
    fetch(`/api/purchase-orders/${params.id}/receipt-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.lineItems) {
          const totalOrdered = data.lineItems.reduce((s: number, li: { qtyOrdered: number }) => s + (li.qtyOrdered || 0), 0);
          const totalReceived = data.lineItems.reduce((s: number, li: { qtyReceived: number }) => s + (li.qtyReceived || 0), 0);
          setReceiptStatus({
            totalOrdered,
            totalReceived,
            uomLabel: data.uomLabel || "units",
            receiptDates: data.receiptDates || [],
            lineItems: data.lineItems,
          });
        }
      })
      .catch(() => {});
  }, [params.id]);

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

  const updateStatus = async (newStatus: string) => {
    if (!po) return;
    setShowStatusMenu(false);
    // Intercept Accepted for ANS POs — prompt for SO number first
    if (newStatus === "Accepted" && po.supplierId === ANS_SUPPLIER_ID) {
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
      setPO({ ...po, status: newStatus });
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
      setPO({ ...po, status: "Accepted", soNumber: soInput || null });
      setSoInput("");
    } catch {
      alert("Error updating status. Check that 'Accepted' is an option in the Airtable Status field.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const startEditing = async () => {
    if (!po) return;
    await loadRefData();
    setEditSupplierId(po.supplierId || "");
    setEditShipToId(po.shipToId || "");
    setEditDate(po.date || "");
    setEditDeliveryDate(po.deliveryDate || "");
    setEditPaymentTerms(po.paymentTerms || "");
    setEditShippingTerms(po.shippingTerms || "");
    setEditNotes(po.notes || "");
    setEditStatus(po.status || "Draft");
    setEditLineItems(
      po.lineItems.map((li) => ({
        key: crypto.randomUUID(),
        skuId: li.skuId || "",
        sku: li.sku
          ? {
              id: li.skuId || "",
              standardSku: li.sku.standardSku,
              category: li.sku.category,
              flavor: li.sku.flavor,
              uom: li.sku.uom,
              count: li.sku.count,
              description: li.sku.description || "",
              supplierItemName: li.sku.supplierItemName || "",
            }
          : undefined,
        qtySticks: li.qtySticks,
        qtyCartons: li.qtyCartons,
        unitCost: li.unitCost,
        totalPrice: li.totalPrice,
      }))
    );
    setSkuSearch({});
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
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
              // Reset qtys when SKU changes
              updated.qtySticks = 0;
              updated.qtyCartons = sku.uom === "Carton" ? 0 : null;
            }
          }

          // Recalculate totals based on item UOM
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
      {
        key: crypto.randomUUID(),
        skuId: "",
        qtySticks: 0,
        qtyCartons: null,
        unitCost: 0,
        totalPrice: 0,
      },
    ]);
  };

  const removeLineItem = (key: string) => {
    setEditLineItems((prev) => prev.filter((item) => item.key !== key));
  };

  const editGrandTotal = editLineItems.reduce(
    (sum, item) => sum + item.totalPrice,
    0
  );

  const filteredSkus = (key: string) => {
    const search = (skuSearch[key] || "").toLowerCase();
    const supplier = suppliers.find((s) => s.id === editSupplierId);
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

  const handleSave = async () => {
    if (
      !editSupplierId ||
      !editShipToId ||
      editLineItems.every((li) => !li.skuId)
    ) {
      alert(
        "Please select a supplier, ship-to location, and at least one SKU."
      );
      return;
    }

    setSaving(true);
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
          grandTotal: editGrandTotal,
          status: editStatus,
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

      // Reload PO data
      const res = await fetch(`/api/purchase-orders/${params.id}`);
      const data = await res.json();
      setPO(data);
      setEditing(false);
    } catch {
      alert("Error saving changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const formatRelativeTime = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay === 1) return "Yesterday";
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  const getActionDotColor = (action: string) => {
    if (action.includes("matched")) return "bg-gold-500";
    if (action.includes("status")) return "bg-gray-400";
    if (action.includes("edited")) return "bg-gray-400";
    return "bg-sage-500"; // creates (po, shipment, receipt, invoice)
  };

  const getActionDotRing = (action: string) => {
    if (action.includes("matched")) return "ring-gold-100";
    if (action.includes("status")) return "ring-gray-200";
    if (action.includes("edited")) return "ring-gray-200";
    return "ring-sage-100";
  };

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
          <button
            onClick={() => router.push("/pos")}
            className="text-sm text-gray-700 underline hover:text-gray-900"
          >
            &larr; Back to POs
          </button>
        </div>
      </div>
    );
  }

  // ─── EDIT MODE ───
  if (editing) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {po.poNumber}
              </h1>
              <p className="text-sm text-gray-500 mt-1">Editing</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={cancelEditing}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>

          {/* Edit Header */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
              PO Details
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Supplier *
                </label>
                <select
                  value={editSupplierId}
                  onChange={(e) => setEditSupplierId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                >
                  <option value="">Select supplier...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.type})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ship To *
                </label>
                <select
                  value={editShipToId}
                  onChange={(e) => setEditShipToId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                >
                  <option value="">Select location...</option>
                  {shipTos.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.address ? ` — ${s.address}, ${s.city}, ${s.state}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  PO Date *
                </label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Delivery Date
                </label>
                <input
                  type="date"
                  value={editDeliveryDate}
                  onChange={(e) => setEditDeliveryDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Payment Terms
                </label>
                <input
                  type="text"
                  value={editPaymentTerms}
                  onChange={(e) => setEditPaymentTerms(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Shipping Terms
                </label>
                <input
                  type="text"
                  value={editShippingTerms}
                  onChange={(e) => setEditShippingTerms(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
            </div>
          </div>

          {/* Edit Line Items */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Line Items
              </h2>
              <button
                onClick={addLineItem}
                className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded-md hover:bg-gray-800"
              >
                + Add Line Item
              </button>
            </div>

            <div className="overflow-visible">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-900 text-white">
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                      SKU
                    </th>
                    <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                      Qty (Sticks)
                    </th>
                    <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                      Qty (Ctns)
                    </th>
                    <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                      Unit Cost
                    </th>
                    <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                      Total
                    </th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {editLineItems.map((item) => (
                    <tr key={item.key} className="border-b border-gray-100">
                      <td className="px-3 py-2 relative">
                        <input
                          type="text"
                          value={
                            item.sku
                              ? `${item.sku.standardSku} — ${item.sku.flavor}`
                              : skuSearch[item.key] || ""
                          }
                          onChange={(e) => {
                            setSkuSearch((prev) => ({
                              ...prev,
                              [item.key]: e.target.value,
                            }));
                            setActiveDropdown(item.key);
                            if (item.skuId) {
                              updateLineItem(item.key, {
                                skuId: "",
                                sku: undefined,
                              });
                            }
                          }}
                          onFocus={() => setActiveDropdown(item.key)}
                          onBlur={() =>
                            setTimeout(() => setActiveDropdown(null), 200)
                          }
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
                                  updateLineItem(item.key, {
                                    skuId: sku.id,
                                  });
                                  setSkuSearch((prev) => ({
                                    ...prev,
                                    [item.key]: "",
                                  }));
                                  setActiveDropdown(null);
                                }}
                              >
                                <span className="font-semibold">
                                  {sku.standardSku}
                                </span>
                                <span className="text-gray-500 ml-2">
                                  {sku.flavor} &middot; {sku.count} &middot;{" "}
                                  {sku.category}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {item.sku?.uom !== "Carton" ? (
                          <input
                            type="number"
                            value={item.qtySticks || ""}
                            onChange={(e) =>
                              updateLineItem(item.key, {
                                qtySticks: parseInt(e.target.value) || 0,
                              })
                            }
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-black"
                          />
                        ) : (
                          <input
                            type="number"
                            value={item.qtySticks || ""}
                            readOnly
                            className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1 text-xs text-right text-gray-500"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {item.sku?.uom === "Carton" ? (
                          <input
                            type="number"
                            value={item.qtyCartons ?? ""}
                            onChange={(e) =>
                              updateLineItem(item.key, {
                                qtyCartons: parseInt(e.target.value) || 0,
                              })
                            }
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-black"
                          />
                        ) : (
                          <input
                            type="number"
                            value={item.qtyCartons ?? ""}
                            readOnly
                            className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1 text-xs text-right text-gray-500"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          value={item.unitCost || ""}
                          onChange={(e) =>
                            updateLineItem(item.key, {
                              unitCost: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-black"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-xs font-semibold tabular-nums">
                          $
                          {item.totalPrice.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {editLineItems.length > 1 && (
                          <button
                            onClick={() => removeLineItem(item.key)}
                            className="text-gray-400 hover:text-red-500 text-xs"
                          >
                            &times;
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end mt-4 pt-4 border-t border-gray-200">
              <div className="text-right">
                <p className="text-xs text-gray-500 uppercase tracking-wider">
                  Grand Total
                </p>
                <p className="text-2xl font-bold text-gray-900 tabular-nums">
                  $
                  {editGrandTotal.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={cancelEditing}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── VIEW MODE ───
  const isSimpleMode = po.lineItems.length > 0 && !po.lineItems.some(
    (li) => li.sku?.uom === "Carton"
  );

  // Build received qty lookup per PO line item
  const receivedByLineId: Record<string, number> = {};
  if (receiptStatus?.lineItems) {
    for (const rli of receiptStatus.lineItems) {
      receivedByLineId[rli.id] = rli.qtyReceived || 0;
    }
  }
  const showReceived = receiptStatus && receiptStatus.totalReceived > 0;
  const colSpan = (isSimpleMode ? 3 : 6) + (showReceived ? 1 : 0);
  return (
    <><div className="min-h-screen bg-gray-50" onClick={() => setShowStatusMenu(false)}>
      <div className="max-w-6xl mx-auto px-6 py-8">
        {justCreated && (
          <div className="print:hidden mb-6 bg-sage-50 border border-sage-200 rounded-lg px-4 py-3 text-sm text-sage-800">
            PO <span className="font-semibold">{po.poNumber}</span> created
            successfully.
          </div>
        )}

        {po.status === "Draft" && (
          <div className="print:hidden mb-6 bg-yellow-50 border border-yellow-300 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className="inline-block bg-yellow-200 text-yellow-900 text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded">Draft</span>
            <span className="text-sm text-yellow-800">This PO has not been issued. Edit and change status to <strong>Issued</strong> when ready to send.</span>
          </div>
        )}
        {po.status === "Accepted" && !unlocked && (
          <div className="print:hidden mb-6 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className="inline-block bg-blue-200 text-blue-900 text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded">Accepted</span>
            <span className="text-sm text-blue-800">Vendor has accepted this PO. Editing is locked — use <strong>Unlock to Edit</strong> to make changes.</span>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {po.poNumber}
              </h1>
              <div className="relative print:hidden" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setShowStatusMenu(!showStatusMenu)}
                  disabled={updatingStatus}
                  className={`inline-block px-2.5 py-0.5 text-xs font-medium rounded-full cursor-pointer hover:opacity-80 ${statusColors[po.status] || "bg-gray-100 text-gray-600"}`}
                >
                  {updatingStatus ? "..." : po.status}
                </button>
                {showStatusMenu && (
                  <div className="absolute z-50 mt-1 left-0 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[120px]">
                    {STATUSES.map((s) => (
                      <button
                        key={s}
                        onClick={() => updateStatus(s)}
                        className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${po.status === s ? "font-semibold" : ""}`}
                      >
                        <span
                          className={`inline-block w-2 h-2 rounded-full mr-2 ${statusColors[s]?.split(" ")[0] || "bg-gray-200"}`}
                        />
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {po.date
                ? new Date(po.date + "T00:00:00").toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : "No date"}
            </p>
            {receiptStatus && receiptStatus.totalOrdered > 0 && (po.status === "Issued" || po.status === "Partially Received" || po.status === "Received") && (
              <div className="flex items-center gap-3 mt-2 print:hidden">
                <div className="w-36 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      receiptStatus.totalReceived >= receiptStatus.totalOrdered
                        ? "bg-sage-500"
                        : receiptStatus.totalReceived > 0
                        ? "bg-gold-400"
                        : ""
                    }`}
                    style={{ width: `${Math.min(100, (receiptStatus.totalReceived / receiptStatus.totalOrdered) * 100)}%` }}
                  />
                </div>
                <span className={`text-xs font-medium ${
                  receiptStatus.totalReceived >= receiptStatus.totalOrdered
                    ? "text-sage-700"
                    : receiptStatus.totalReceived > 0
                    ? "text-gold-700"
                    : "text-gray-400"
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
            {po.status === "Accepted" && !unlocked ? (
              <button
                onClick={() => {
                  if (confirm("This PO has been accepted by the vendor. Editing may create discrepancies with their records. Continue?")) {
                    setUnlocked(true);
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 flex items-center gap-1.5"
              >
                <span>🔒</span> Unlock to Edit
              </button>
            ) : (
              <button
                onClick={startEditing}
                className="px-4 py-2 text-sm font-medium bg-sage-50 text-sage-700 border border-sage-200 rounded-md hover:bg-sage-100"
              >
                Edit
              </button>
            )}
            <button
              onClick={() => router.push("/pos")}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              &larr; Back to POs
            </button>
          </div>
        </div>

        {/* PO Details */}
        <div className="grid grid-cols-3 gap-6 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              From
            </h2>
            <p className="font-semibold text-gray-900">{MAGNA.companyName}</p>
            <p className="text-sm text-gray-600 mt-1">
              {MAGNA.address}
              <br />
              {MAGNA.city}, {MAGNA.state} {MAGNA.zip}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Supplier
            </h2>
            {po.supplier ? (
              <div>
                <p className="font-semibold text-gray-900">
                  {po.supplier.name}
                </p>
                {po.supplier.address && (
                  <p className="text-sm text-gray-600 mt-1">
                    {po.supplier.address}
                    <br />
                    {po.supplier.city}, {po.supplier.state} {po.supplier.zip}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No supplier</p>
            )}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Ship To
            </h2>
            {po.shipTo ? (
              <div>
                <p className="font-semibold text-gray-900">{po.shipTo.name}</p>
                {po.shipTo.address && (
                  <p className="text-sm text-gray-600 mt-1">
                    {po.shipTo.address}
                    <br />
                    {po.shipTo.city}, {po.shipTo.state} {po.shipTo.zip}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No ship-to location</p>
            )}
          </div>
        </div>

        {/* Terms & Dates */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex gap-10 flex-wrap">
            {/* Smart date: show expected delivery until received, then show actual receipt dates */}
            {(() => {
              const isReceived = po.status === "Received" || po.status === "Partially Received";
              const receiptDates = receiptStatus?.receiptDates || [];
              const hasReceiptDates = receiptDates.length > 0;

              return (
                <>
                  {/* Always show expected delivery if set */}
                  {po.deliveryDate && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        {isReceived && hasReceiptDates ? "Expected Delivery" : "Delivery Date"}
                      </p>
                      <p className={`text-sm ${isReceived && hasReceiptDates ? "text-gray-400 line-through" : "text-gray-900"}`}>
                        {new Date(po.deliveryDate + "T00:00:00").toLocaleDateString("en-US")}
                      </p>
                    </div>
                  )}
                  {/* Show actual receipt dates when available */}
                  {hasReceiptDates && (
                    <div>
                      <p className="text-xs font-semibold text-sage-600 uppercase tracking-wider mb-1">
                        Received
                      </p>
                      <p className="text-sm text-gray-900 font-medium">
                        {receiptDates.map((d: string) =>
                          new Date(d + "T00:00:00").toLocaleDateString("en-US")
                        ).join(", ")}
                      </p>
                    </div>
                  )}
                  {/* Show dash if no dates at all */}
                  {!po.deliveryDate && !hasReceiptDates && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        Delivery Date
                      </p>
                      <p className="text-sm text-gray-900">{"\u2014"}</p>
                    </div>
                  )}
                </>
              );
            })()}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Payment Terms
              </p>
              <p className="text-sm text-gray-900">
                {po.paymentTerms || "\u2014"}
              </p>
            </div>
            <div className={!po.shippingTerms ? "print:hidden" : ""}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Shipping Terms
              </p>
              <p className="text-sm text-gray-900">
                {po.shippingTerms || "\u2014"}
              </p>
            </div>
            <div className={!po.notes ? "print:hidden" : ""}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Notes
              </p>
              <p className="text-sm text-gray-900">{po.notes || "\u2014"}</p>
            </div>
            {po.soNumber && (
              <div className="print:hidden border-l-2 border-blue-200 pl-3">
                <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-1">
                  ANS SO #
                </p>
                <p className="text-sm text-gray-900 font-medium">{po.soNumber}</p>
              </div>
            )}
          </div>
        </div>

        {/* Linked Records — Receipts & Invoices */}
        {((po.receipts && po.receipts.length > 0) || (po.invoices && po.invoices.length > 0)) && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6 print:hidden">
            <div className="flex gap-12 flex-wrap">
              {po.receipts && po.receipts.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Receipts
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {po.receipts.map((r: LinkedReceipt) => (
                      <a
                        key={r.id}
                        href={`/receipts`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium text-sage-700 bg-sage-50 border border-sage-200 rounded-md hover:bg-sage-100 transition-colors"
                      >
                        {r.receiptNumber}
                        {r.receivedDate && (
                          <span className="text-xs text-sage-500">
                            {new Date(r.receivedDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {po.invoices && po.invoices.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Invoices
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {po.invoices.map((inv: LinkedInvoice) => (
                      <a
                        key={inv.id}
                        href={`/match?from=invoice&id=${inv.id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium text-warm-700 bg-warm-50 border border-warm-200 rounded-md hover:bg-warm-100 transition-colors"
                      >
                        #{inv.invoiceNumber}
                        {inv.matchStatus && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            inv.matchStatus === "Matched" ? "bg-sage-100 text-sage-700" :
                            inv.matchStatus === "Discrepancy" ? "bg-gold-100 text-gold-700" :
                            "bg-gray-100 text-gray-600"
                          }`}>
                            {inv.matchStatus}
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Line Items — grouped by section */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
                  Product
                </th>
                {!isSimpleMode && (
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
                    Carton Count
                  </th>
                )}
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
                  {isSimpleMode ? "Qty" : "Qty (Sticks)"}
                </th>
                {!isSimpleMode && (
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
                    Qty (Cartons)
                  </th>
                )}
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
                  Unit Cost
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
                  Total Price
                </th>
                {showReceived && (
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap">
                    Received
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Group line items by section
                const sections: Record<string, typeof po.lineItems> = {};
                for (const item of po.lineItems) {
                  const key = item.section || "Other";
                  if (!sections[key]) sections[key] = [];
                  sections[key].push(item);
                }
                const sectionKeys = Object.keys(sections);

                return sectionKeys.map((sectionName) => {
                  const items = sections[sectionName];
                  const sectionSticks = items.reduce((sum, i) => sum + (i.qtySticks || 0), 0);
                  const sectionCartons = items.reduce((sum, i) => sum + (i.qtyCartons || 0), 0);
                  const sectionTotal = items.reduce((sum, i) => sum + (i.totalPrice || 0), 0);

                  return (
                    <React.Fragment key={sectionName}>
                      {/* Line items */}
                      {items.map((item) => (
                        <tr key={item.id} className="border-b border-gray-100">
                          <td className="px-4 py-2.5 text-gray-900 whitespace-nowrap">
                            {item.sku?.supplierItemName || item.sku?.flavor || item.sku?.standardSku || "\u2014"}
                          </td>
                          {!isSimpleMode && (
                            <td className="px-4 py-2.5 text-gray-600">
                              {item.sku?.uom === "Carton" ? `${item.sku.count} CT` : item.sku?.uom === "Stick" ? "Bulk" : "\u2014"}
                            </td>
                          )}
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {item.qtySticks?.toLocaleString() || "\u2014"}
                          </td>
                          {!isSimpleMode && (
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                              {item.qtyCartons?.toLocaleString() || "\u2014"}
                            </td>
                          )}
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            ${item.unitCost?.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }) || "0.00"}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                            ${item.totalPrice?.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }) || "0.00"}
                          </td>
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
                      ))}
                    </React.Fragment>
                  );
                });
              })()}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50">
                <td className="px-4 py-3 font-bold text-gray-900 uppercase text-sm">Grand Total</td>
                {!isSimpleMode && <td />}
                <td className="px-4 py-3 text-right font-bold tabular-nums">
                  {po.lineItems.reduce((s, i) => s + (i.qtySticks || 0), 0).toLocaleString()}
                </td>
                {!isSimpleMode && (
                  <td className="px-4 py-3 text-right font-bold text-gray-500 tabular-nums">
                    {po.lineItems.reduce((s, i) => s + (i.qtyCartons || 0), 0).toLocaleString()}
                  </td>
                )}
                <td />
                <td className="px-4 py-3 text-right font-bold text-lg tabular-nums">
                  ${po.grandTotal?.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }) || "0.00"}
                </td>
                {showReceived && (
                  <td className="px-4 py-3 text-right font-bold tabular-nums">
                    {receiptStatus.totalReceived.toLocaleString()}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Activity Timeline — not shown in print */}
        {activities.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6 print:hidden">
            <div className="flex items-center gap-2 mb-5">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-gray-500">
                <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8z" fill="currentColor" fillOpacity="0.4"/>
                <path d="M8 4a.75.75 0 01.75.75v3.5h2.5a.75.75 0 010 1.5h-3.25a.75.75 0 01-.75-.75v-4.25A.75.75 0 018 4z" fill="currentColor" fillOpacity="0.6"/>
              </svg>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Activity
              </span>
              <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
                {activities.length}
              </span>
            </div>

            <div className="relative pl-7">
              {/* Vertical line */}
              <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-gray-200 rounded-full" />

              {activities.map((entry, idx) => (
                <div key={entry.id} className={`relative ${idx < activities.length - 1 ? "pb-5" : ""}`}>
                  {/* Dot */}
                  <div
                    className={`absolute -left-7 top-0.5 w-4 h-4 rounded-full ring-2 ring-offset-1 ${getActionDotColor(entry.action)} ${getActionDotRing(entry.action)}`}
                  />

                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-gray-900 leading-relaxed">
                        {entry.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                            entry.actor === "Orchard AI"
                              ? "bg-plum-50 text-plum-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              entry.actor === "Orchard AI" ? "bg-plum-500" : "bg-gray-400"
                            }`}
                          />
                          {entry.actor}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0 pt-0.5">
                      {formatRelativeTime(entry.createdTime)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>

    {/* SO Number modal — shown when moving ANS PO to Accepted */}

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
            <button
              onClick={() => { setSoInput(""); confirmAccepted(); }}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
            >
              Skip
            </button>
            <button
              onClick={confirmAccepted}
              className="px-4 py-1.5 text-sm font-medium bg-gray-900 text-white rounded-md hover:bg-gray-800"
            >
              Confirm Accepted
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
