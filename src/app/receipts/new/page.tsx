"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface POOption {
  id: string;
  poNumber: string;
  supplier: string[];
  status: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

interface ReceiptStatusLine {
  id: string;
  skuId: string | null;
  sku: {
    standardSku: string;
    flavor: string;
    uom: string;
    count: number | null;
    category: string;
  } | null;
  section: string;
  qtyOrdered: number;
  qtyCartons: number;
  qtyReceived: number;
  qtyRemaining: number;
}

interface ReceiptLine {
  poLineItemId: string;
  skuId: string;
  skuName: string;
  section: string;
  uom: string;
  qtyOrdered: number;
  qtyAlreadyReceived: number;
  qtyRemaining: number;
  qtyReceived: number;
  included: boolean;
}

export default function CreateReceiptPage() {
  const router = useRouter();

  // Reference data
  const [pos, setPOs] = useState<POOption[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [selectedPOId, setSelectedPOId] = useState("");
  const [loadingPO, setLoadingPO] = useState(false);
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([]);
  const [poNumber, setPONumber] = useState("");

  const [receivedDate, setReceivedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);

  // Load reference data
  useEffect(() => {
    Promise.all([
      fetch("/api/purchase-orders").then((r) => r.json()),
      fetch("/api/suppliers").then((r) => r.json()),
      fetch("/api/ship-to").then((r) => r.json()),
    ]).then(([poData, supplierData, warehouseData]) => {
      // Show Issued and Partially Received POs
      setPOs(
        poData.filter(
          (p: POOption) =>
            p.status === "Issued" || p.status === "Partially Received"
        )
      );
      const sMap: Record<string, string> = {};
      supplierData.forEach((s: Supplier) => {
        sMap[s.id] = s.name;
      });
      setSuppliers(sMap);
      setWarehouses(
        warehouseData.map((w: { id: string; name: string; code?: string }) => ({
          id: w.id,
          name: w.name,
          code: w.code || "",
        }))
      );
      setLoading(false);
    });
  }, []);

  // Load PO receipt status when PO is selected
  const loadPOReceiptStatus = useCallback(async (poId: string) => {
    if (!poId) {
      setReceiptLines([]);
      setPONumber("");
      return;
    }

    setLoadingPO(true);
    try {
      const data = await fetch(
        `/api/purchase-orders/${poId}/receipt-status`
      ).then((r) => r.json());

      setPONumber(data.poNumber || "");

      const lines: ReceiptLine[] = (data.lineItems || []).map(
        (li: ReceiptStatusLine) => {
          const skuName = li.sku
            ? li.sku.flavor || li.sku.standardSku
            : "Unknown SKU";

          return {
            poLineItemId: li.id,
            skuId: li.skuId || "",
            skuName,
            section: li.section || "",
            uom: li.sku?.uom || "Stick",
            qtyOrdered: li.qtyOrdered,
            qtyAlreadyReceived: li.qtyReceived,
            qtyRemaining: li.qtyRemaining,
            qtyReceived: li.qtyRemaining, // Default to receiving remaining
            included: li.qtyRemaining > 0,
          };
        }
      );

      setReceiptLines(lines);
    } catch (err) {
      console.error("Failed to load PO receipt status:", err);
      alert("Failed to load PO details. Please try again.");
    } finally {
      setLoadingPO(false);
    }
  }, []);

  const handlePOChange = (poId: string) => {
    setSelectedPOId(poId);
    loadPOReceiptStatus(poId);
  };

  const selectableCount = receiptLines.filter((l) => l.qtyRemaining > 0).length;
  const selectedCount = receiptLines.filter((l) => l.included && l.qtyRemaining > 0).length;
  const allSelected = selectableCount > 0 && selectedCount === selectableCount;

  const handleToggleAll = () => {
    setReceiptLines((prev) =>
      prev.map((line) =>
        line.qtyRemaining > 0
          ? {
              ...line,
              included: !allSelected,
              qtyReceived: !allSelected ? line.qtyRemaining : 0,
            }
          : line
      )
    );
  };

  const handleLineToggle = (index: number) => {
    setReceiptLines((prev) =>
      prev.map((line, i) =>
        i === index
          ? {
              ...line,
              included: !line.included,
              qtyReceived: !line.included ? line.qtyRemaining : 0,
            }
          : line
      )
    );
  };

  const handleQtyChange = (index: number, qty: number) => {
    setReceiptLines((prev) =>
      prev.map((line, i) =>
        i === index ? { ...line, qtyReceived: Math.max(0, qty) } : line
      )
    );
  };

  const handleSubmit = async () => {
    if (!selectedPOId) {
      alert("Please select a Purchase Order.");
      return;
    }
    if (!warehouseId) {
      alert("Please select a warehouse.");
      return;
    }
    if (!receivedDate) {
      alert("Please enter a received date.");
      return;
    }
    const includedLines = receiptLines.filter(
      (line) => line.included && line.qtyReceived > 0
    );
    if (includedLines.length === 0) {
      alert("Please include at least one line item with quantity received.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receivedDate,
          purchaseOrderId: selectedPOId,
          warehouseId,
          notes: notes || undefined,
          lineItems: includedLines.map((line) => ({
            skuId: line.skuId,
            qtyReceived: line.qtyReceived,
            qtyExpected: line.qtyRemaining,
            poLineItemId: line.poLineItemId,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create receipt");
      }

      const data = await res.json();
      router.push(`/receipts`);
      // Could navigate to detail page if we had one: `/receipts/${data.id}`
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Failed to create receipt. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
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
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Create Receipt
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Record inventory received against a purchase order
            </p>
          </div>
          <button
            onClick={() => router.push("/receipts")}
            className="border border-gray-300 text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
          {/* Step 1: Select PO */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Purchase Order <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedPOId}
              onChange={(e) => handlePOChange(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
            >
              <option value="">Select a PO...</option>
              {pos.map((po) => (
                <option key={po.id} value={po.id}>
                  {po.poNumber} —{" "}
                  {po.supplier?.[0] ? suppliers[po.supplier[0]] || "" : ""}
                  {po.status === "Partially Received" ? " (Partial)" : ""}
                </option>
              ))}
            </select>
            {pos.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">
                No eligible POs available. POs must be in &quot;Issued&quot; or
                &quot;Partially Received&quot; status.
              </p>
            )}
          </div>

          {/* Step 2: Line Items (shown when PO is selected) */}
          {loadingPO && (
            <p className="text-sm text-gray-500">Loading PO details...</p>
          )}

          {receiptLines.length > 0 && !loadingPO && (
            <>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 mb-3">
                  Line Items
                  {poNumber && (
                    <span className="text-gray-400 font-normal ml-2">
                      {poNumber}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-gray-500 mb-3">
                  Select items being received and enter quantities.
                </p>
                <div className="border border-gray-200 rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="w-10 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={handleToggleAll}
                            disabled={selectableCount === 0}
                            className="rounded border-gray-300"
                            title={allSelected ? "Deselect all" : "Select all"}
                          />
                        </th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                          SKU
                        </th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                          Ordered
                        </th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                          Already Received
                        </th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                          Remaining
                        </th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                          Qty Received
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {receiptLines.map((line, index) => (
                        <tr
                          key={line.poLineItemId}
                          className={`border-b border-gray-100 ${
                            line.qtyRemaining === 0 ? "opacity-40" : ""
                          }`}
                        >
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={line.included}
                              onChange={() => handleLineToggle(index)}
                              disabled={line.qtyRemaining === 0}
                              className="rounded border-gray-300"
                            />
                          </td>
                          <td className="px-3 py-2 text-gray-900">
                            {line.skuName}
                            {line.section && (
                              <span className="text-xs text-gray-400 ml-2">
                                {line.section}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                            {line.qtyOrdered.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                            {line.qtyAlreadyReceived.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                            {line.qtyRemaining.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              value={line.qtyReceived || ""}
                              onChange={(e) =>
                                handleQtyChange(
                                  index,
                                  parseInt(e.target.value) || 0
                                )
                              }
                              disabled={
                                !line.included || line.qtyRemaining === 0
                              }
                              min={0}
                              className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Step 3: Receipt Details */}
              <div className="border-t border-gray-200 pt-6">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">
                  Receipt Details
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Warehouse <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={warehouseId}
                      onChange={(e) => setWarehouseId(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                    >
                      <option value="">Select warehouse...</option>
                      {warehouses.map((wh) => (
                        <option key={wh.id} value={wh.id}>
                          {wh.name}
                          {wh.code ? ` (${wh.code})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Received Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={receivedDate}
                      onChange={(e) => setReceivedDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Notes
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      placeholder="Optional notes about this receipt..."
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Submit */}
              <div className="border-t border-gray-200 pt-6 flex justify-end gap-3">
                <button
                  onClick={() => router.push("/receipts")}
                  className="border border-gray-300 text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="bg-gray-900 text-white px-6 py-2 text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
                >
                  {submitting ? "Creating..." : "Create Receipt"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
