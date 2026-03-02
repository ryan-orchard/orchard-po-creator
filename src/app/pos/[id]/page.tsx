"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";

interface PODetail {
  id: string;
  poNumber: string;
  date: string;
  status: string;
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
      standardSku: string;
      flavor: string;
      count: string;
      category: string;
    } | null;
    section: string;
    qtySticks: number;
    qtyCartons: number;
    unitCost: number;
    costBasis: string;
    totalPrice: number;
  }[];
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
  count: string;
  description: string;
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
  section: string;
  qtySticks: number;
  qtyCartons: number | null;
  unitCost: number;
  costBasis: "Per Carton" | "Per Stick";
  totalPrice: number;
}

const STATUSES = ["Draft", "Issued", "Confirmed", "Shipped", "Received"] as const;

const statusColors: Record<string, string> = {
  Draft: "bg-yellow-100 text-yellow-800",
  Issued: "bg-blue-100 text-blue-800",
  Confirmed: "bg-purple-100 text-purple-800",
  Shipped: "bg-orange-100 text-orange-800",
  Received: "bg-green-100 text-green-800",
};

export default function PODetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const [po, setPO] = useState<PODetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const justCreated = searchParams.get("created") === "1";

  // Status update
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);

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
    setUpdatingStatus(true);
    setShowStatusMenu(false);
    try {
      await fetch(`/api/purchase-orders/${params.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      setPO({ ...po, status: newStatus });
    } catch {
      alert("Error updating status.");
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
              count: li.sku.count,
              description: "",
            }
          : undefined,
        section: li.section,
        qtySticks: li.qtySticks,
        qtyCartons: li.qtyCartons,
        unitCost: li.unitCost,
        costBasis: li.costBasis as "Per Carton" | "Per Stick",
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
              const count = parseInt(sku.count);
              if (sku.count === "Stick") {
                updated.costBasis = "Per Stick";
                updated.section = "Bulk Sticks";
              } else if (!isNaN(count)) {
                updated.costBasis = "Per Carton";
                if (count === 28) updated.section = "28CT Packout";
                else if (count === 10) updated.section = "10CT Retail";
                else if (count === 14) updated.section = "14CT Amazon";
                else if (count === 7) updated.section = "7CT Amazon";
                else updated.section = `${count}CT`;
              }
            }
          }

          if (
            updates.qtySticks !== undefined ||
            updates.qtyCartons !== undefined ||
            updates.unitCost !== undefined ||
            updates.costBasis !== undefined ||
            updates.skuId !== undefined
          ) {
            if (updated.costBasis === "Per Carton" && updated.qtyCartons) {
              updated.totalPrice = updated.qtyCartons * updated.unitCost;
            } else if (updated.costBasis === "Per Stick") {
              updated.totalPrice = updated.qtySticks * updated.unitCost;
            }

            if (updated.sku && updated.qtySticks > 0) {
              const count = parseInt(updated.sku.count);
              if (!isNaN(count) && count > 0) {
                updated.qtyCartons = Math.ceil(updated.qtySticks / count);
              }
            }

            if (updated.costBasis === "Per Carton" && updated.qtyCartons) {
              updated.totalPrice = updated.qtyCartons * updated.unitCost;
            }
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
        section: "28CT Packout",
        qtySticks: 0,
        qtyCartons: null,
        unitCost: 0,
        costBasis: "Per Carton",
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
              section: li.section,
              qtySticks: li.qtySticks,
              qtyCartons: li.qtyCartons,
              unitCost: li.unitCost,
              costBasis: li.costBasis,
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
              <h1 className="text-2xl font-bold text-gray-900 font-mono">
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
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                      Section
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
                    <th className="text-center px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                      Cost Basis
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
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-black"
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
                                <span className="font-mono font-semibold">
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
                        <input
                          type="text"
                          value={item.section}
                          onChange={(e) =>
                            updateLineItem(item.key, {
                              section: e.target.value,
                            })
                          }
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-black"
                        />
                      </td>
                      <td className="px-3 py-2">
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
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={item.qtyCartons ?? ""}
                          readOnly
                          className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1 text-xs text-right text-gray-500"
                        />
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
                      <td className="px-3 py-2 text-center">
                        <span className="text-xs text-gray-500">
                          {item.costBasis}
                        </span>
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
  return (
    <div className="min-h-screen bg-gray-50" onClick={() => setShowStatusMenu(false)}>
      <div className="max-w-6xl mx-auto px-6 py-8">
        {justCreated && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
            PO <span className="font-semibold">{po.poNumber}</span> created
            successfully.
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 font-mono">
                {po.poNumber}
              </h1>
              <div className="relative" onClick={(e) => e.stopPropagation()}>
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
          </div>
          <div className="flex items-center gap-3 print:hidden">
            <button
              onClick={() => window.print()}
              className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Save as PDF
            </button>
            <button
              onClick={startEditing}
              className="px-4 py-2 text-sm font-medium bg-green-50 text-green-700 border border-green-200 rounded-md hover:bg-green-100"
            >
              Edit
            </button>
            <button
              onClick={() => router.push("/pos")}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              &larr; Back to POs
            </button>
          </div>
        </div>

        {/* PO Details */}
        <div className="grid grid-cols-2 gap-6 mb-6">
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

        {/* Terms */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-4 gap-6">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Delivery Date
              </p>
              <p className="text-sm text-gray-900">
                {po.deliveryDate
                  ? new Date(
                      po.deliveryDate + "T00:00:00"
                    ).toLocaleDateString("en-US")
                  : "\u2014"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Payment Terms
              </p>
              <p className="text-sm text-gray-900">
                {po.paymentTerms || "\u2014"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Shipping Terms
              </p>
              <p className="text-sm text-gray-900">
                {po.shippingTerms || "\u2014"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Notes
              </p>
              <p className="text-sm text-gray-900">{po.notes || "\u2014"}</p>
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  SKU
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  Section
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  Qty (Sticks)
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  Qty (Ctns)
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  Unit Cost
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  Cost Basis
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {po.lineItems.map((item) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="px-4 py-3">
                    <span className="font-mono font-semibold text-gray-900">
                      {item.sku?.standardSku || "\u2014"}
                    </span>
                    {item.sku?.flavor && (
                      <span className="text-gray-500 ml-2 text-xs">
                        {item.sku.flavor}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.section}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {item.qtySticks?.toLocaleString() || "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                    {item.qtyCartons?.toLocaleString() || "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    $
                    {item.unitCost?.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }) || "0.00"}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500">
                    {item.costBasis}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    $
                    {item.totalPrice?.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }) || "0.00"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end px-4 py-4 border-t border-gray-200 bg-gray-50">
            <div className="text-right">
              <p className="text-xs text-gray-500 uppercase tracking-wider">
                Grand Total
              </p>
              <p className="text-2xl font-bold text-gray-900 tabular-nums">
                $
                {po.grandTotal?.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }) || "0.00"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
