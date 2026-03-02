"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Supplier {
  id: string;
  name: string;
  type: string;
  address: string;
  city: string;
  state: string;
  zip: string;
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
  isDefault: boolean;
}

interface LineItem {
  key: string;
  skuId: string;
  sku?: SKU;
  section: string;
  qtySticks: number;
  qtyCartons: number | null;
  unitCost: number;
  costBasis: "Per Carton" | "Per Stick";
  totalPrice: number;
  shipToOverrideId?: string;
}

export default function NewPOPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [skus, setSkus] = useState<SKU[]>([]);
  const [shipTos, setShipTos] = useState<ShipTo[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // PO Header
  const [supplierId, setSupplierId] = useState("");
  const [shipToId, setShipToId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [shippingTerms, setShippingTerms] = useState("");
  const [notes, setNotes] = useState("");

  // Line Items
  const [lineItems, setLineItems] = useState<LineItem[]>([
    createEmptyLineItem(),
  ]);

  // SKU search
  const [skuSearch, setSkuSearch] = useState<Record<string, string>>({});
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // Custom Ship To
  const [showCustomShipTo, setShowCustomShipTo] = useState(false);
  const [customShipTo, setCustomShipTo] = useState({
    name: "",
    address: "",
    city: "",
    state: "",
    zip: "",
  });
  const [savingShipTo, setSavingShipTo] = useState(false);

  function createEmptyLineItem(): LineItem {
    return {
      key: crypto.randomUUID(),
      skuId: "",
      section: "28CT Packout",
      qtySticks: 0,
      qtyCartons: null,
      unitCost: 0,
      costBasis: "Per Carton",
      totalPrice: 0,
    };
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/suppliers").then((r) => r.json()),
      fetch("/api/skus").then((r) => r.json()),
      fetch("/api/ship-to").then((r) => r.json()),
    ]).then(([s, sk, st]) => {
      setSuppliers(s);
      setSkus(sk);
      setShipTos(st);
      const defaultShipTo = st.find((l: ShipTo) => l.isDefault);
      if (defaultShipTo) setShipToId(defaultShipTo.id);
      setLoading(false);
    });
  }, []);

  // Auto-fill payment terms from supplier (always overwrite when supplier changes)
  useEffect(() => {
    if (supplierId) {
      const supplier = suppliers.find((s) => s.id === supplierId);
      setPaymentTerms(supplier?.paymentTerms || "");
    }
  }, [supplierId, suppliers]);

  const updateLineItem = useCallback(
    (key: string, updates: Partial<LineItem>) => {
      setLineItems((prev) =>
        prev.map((item) => {
          if (item.key !== key) return item;
          const updated = { ...item, ...updates };

          // Auto-fill from SKU
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

          // Recalculate totals
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

            // Auto-calc cartons from sticks
            if (updated.sku && updated.qtySticks > 0) {
              const count = parseInt(updated.sku.count);
              if (!isNaN(count) && count > 0) {
                updated.qtyCartons = Math.ceil(updated.qtySticks / count);
              }
            }

            // Recalculate total after carton update
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
    setLineItems((prev) => [...prev, createEmptyLineItem()]);
  };

  const removeLineItem = (key: string) => {
    setLineItems((prev) => prev.filter((item) => item.key !== key));
  };

  const grandTotal = lineItems.reduce((sum, item) => sum + item.totalPrice, 0);

  const handleSaveCustomShipTo = async () => {
    if (!customShipTo.name) return;
    setSavingShipTo(true);
    try {
      const res = await fetch("/api/ship-to", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customShipTo),
      });
      const newLocation = await res.json();
      setShipTos((prev) => [...prev, newLocation]);
      setShipToId(newLocation.id);
      setShowCustomShipTo(false);
      setCustomShipTo({ name: "", address: "", city: "", state: "", zip: "" });
    } catch (err) {
      console.error(err);
      alert("Error saving location. Please try again.");
    } finally {
      setSavingShipTo(false);
    }
  };

  const handleSubmit = async () => {
    if (!supplierId || !shipToId || lineItems.every((li) => !li.skuId)) {
      alert("Please select a supplier, ship-to location, and at least one SKU.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          supplierId,
          shipToId,
          deliveryDate: deliveryDate || null,
          shippingTerms,
          paymentTerms,
          notes,
          grandTotal,
          lineItems: lineItems
            .filter((li) => li.skuId)
            .map((li) => ({
              skuId: li.skuId,
              section: li.section,
              qtySticks: li.qtySticks,
              qtyCartons: li.qtyCartons,
              unitCost: li.unitCost,
              costBasis: li.costBasis,
              totalPrice: li.totalPrice,
              shipToOverrideId: li.shipToOverrideId,
            })),
        }),
      });

      const result = await res.json();
      router.push(`/pos/${result.id}?created=1`);
    } catch (err) {
      console.error(err);
      alert("Error creating PO. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredSkus = (key: string) => {
    const search = (skuSearch[key] || "").toLowerCase();
    // Filter by supplier's categories
    const supplier = suppliers.find((s) => s.id === supplierId);
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Create Purchase Order
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              PO number will be auto-generated on save
            </p>
          </div>
          <button
            onClick={() => router.push("/pos")}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to POs
          </button>
        </div>

        {/* PO Header */}
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
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
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
                value={shipToId}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setShowCustomShipTo(true);
                    setShipToId("");
                  } else {
                    setShipToId(e.target.value);
                    setShowCustomShipTo(false);
                  }
                }}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              >
                <option value="">Select location...</option>
                {shipTos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.address ? ` — ${s.address}, ${s.city}, ${s.state}` : ""}
                  </option>
                ))}
                <option value="__custom__">+ Add custom location...</option>
              </select>
              {showCustomShipTo && (
                <div className="mt-2 p-3 border border-gray-200 rounded-md bg-gray-50 space-y-2">
                  <input
                    type="text"
                    placeholder="Location name *"
                    value={customShipTo.name}
                    onChange={(e) =>
                      setCustomShipTo((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />
                  <input
                    type="text"
                    placeholder="Address"
                    value={customShipTo.address}
                    onChange={(e) =>
                      setCustomShipTo((prev) => ({ ...prev, address: e.target.value }))
                    }
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      placeholder="City"
                      value={customShipTo.city}
                      onChange={(e) =>
                        setCustomShipTo((prev) => ({ ...prev, city: e.target.value }))
                      }
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                    <input
                      type="text"
                      placeholder="State"
                      value={customShipTo.state}
                      onChange={(e) =>
                        setCustomShipTo((prev) => ({ ...prev, state: e.target.value }))
                      }
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                    <input
                      type="text"
                      placeholder="Zip"
                      value={customShipTo.zip}
                      onChange={(e) =>
                        setCustomShipTo((prev) => ({ ...prev, zip: e.target.value }))
                      }
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveCustomShipTo}
                      disabled={savingShipTo || !customShipTo.name}
                      className="px-3 py-1.5 text-xs bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
                    >
                      {savingShipTo ? "Saving..." : "Save Location"}
                    </button>
                    <button
                      onClick={() => {
                        setShowCustomShipTo(false);
                        setCustomShipTo({ name: "", address: "", city: "", state: "", zip: "" });
                      }}
                      className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                PO Date *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Delivery Date
              </label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Terms
              </label>
              <input
                type="text"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="e.g., Net 30"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Shipping Terms
              </label>
              <input
                type="text"
                value={shippingTerms}
                onChange={(e) => setShippingTerms(e.target.value)}
                placeholder="e.g., FOB Destination"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Special instructions..."
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
        </div>

        {/* Line Items */}
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
                {lineItems.map((item) => (
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
                        placeholder="Search SKU or flavor..."
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
                                updateLineItem(item.key, { skuId: sku.id });
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
                                {sku.flavor} · {sku.count} · {sku.category}
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
                          updateLineItem(item.key, { section: e.target.value })
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
                        placeholder="0"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={item.qtyCartons ?? ""}
                        readOnly
                        className="w-full border border-gray-200 bg-gray-50 rounded px-2 py-1 text-xs text-right text-gray-500"
                        placeholder="—"
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
                        placeholder="$0.00"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="text-xs text-gray-500">
                        {item.costBasis}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="text-xs font-semibold tabular-nums">
                        ${item.totalPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {lineItems.length > 1 && (
                        <button
                          onClick={() => removeLineItem(item.key)}
                          className="text-gray-400 hover:text-red-500 text-xs"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Grand Total */}
          <div className="flex justify-end mt-4 pt-4 border-t border-gray-200">
            <div className="text-right">
              <p className="text-xs text-gray-500 uppercase tracking-wider">
                Grand Total
              </p>
              <p className="text-2xl font-bold text-gray-900 tabular-nums">
                ${grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={() => router.push("/pos")}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create PO"}
          </button>
        </div>
      </div>
    </div>
  );
}
