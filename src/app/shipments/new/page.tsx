"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface POOption {
  id: string;
  poNumber: string;
  supplier: string[];
  shipTo: string[];
  status: string;
}

interface WOOption {
  id: string;
  woNumber: string;
  description: string;
  warehouse: string[];
  status: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface Location {
  id: string;
  name: string;
}

interface PODetail {
  id: string;
  poNumber: string;
  shipToId: string | null;
  supplier: { id: string; name: string } | null;
  shipTo: { id: string; name: string } | null;
  lineItems: POLineItem[];
}

interface POLineItem {
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
}

interface WOLineItem {
  id: string;
  skuId: string | null;
  sku: {
    standardSku: string;
    flavor: string;
    count: number | null;
    category: string;
    uom: string;
  } | null;
  lineType: string;
  qty: number;
}

interface ShipmentLine {
  sourceLineId: string;
  skuId: string;
  skuName: string;
  section: string;
  qtyOrdered: number;
  qtyAlreadyShipped: number;
  qtyRemaining: number;
  qtyShipped: number;
  included: boolean;
}

interface ExistingShipment {
  id: string;
  purchaseOrder: string[];
  workOrder: string[];
  shipmentLines: string[];
}

type SourceType = "po" | "wo";

export default function CreateShipmentPage() {
  const router = useRouter();

  // Source type toggle
  const [sourceType, setSourceType] = useState<SourceType>("po");

  // Reference data
  const [pos, setPOs] = useState<POOption[]>([]);
  const [wos, setWOs] = useState<WOOption[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [warehouses, setWarehouses] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [sourceDetail, setSourceDetail] = useState<PODetail | { id: string; woNumber: string; description: string; outputs: WOLineItem[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [shipmentLines, setShipmentLines] = useState<ShipmentLine[]>([]);

  const [shipDate, setShipDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [carrier, setCarrier] = useState("");
  const [carrierReference, setCarrierReference] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shipToId, setShipToId] = useState("");

  const [submitting, setSubmitting] = useState(false);

  // Load reference data
  useEffect(() => {
    Promise.all([
      fetch("/api/purchase-orders").then((r) => r.json()),
      fetch("/api/work-orders").then((r) => r.json()),
      fetch("/api/suppliers").then((r) => r.json()),
      fetch("/api/ship-to").then((r) => r.json()),
    ]).then(([poData, woData, supplierData, locationData]) => {
      setPOs(poData.filter((p: POOption) => p.status === "Issued"));
      setWOs(woData.filter((w: WOOption) => w.status === "Issued" || w.status === "In Progress" || w.status === "Completed"));
      const sMap: Record<string, string> = {};
      supplierData.forEach((s: Supplier) => {
        sMap[s.id] = s.name;
      });
      setSuppliers(sMap);
      const wMap: Record<string, string> = {};
      locationData.forEach((l: Location) => {
        wMap[l.id] = l.name;
      });
      setWarehouses(wMap);
      setLocations(locationData);
      setLoading(false);
    });
  }, []);

  // Load source detail when selection changes
  const loadSourceDetail = useCallback(async (sourceId: string, type: SourceType) => {
    if (!sourceId) {
      setSourceDetail(null);
      setShipmentLines([]);
      return;
    }

    setLoadingDetail(true);
    try {
      const allShipments = await fetch("/api/shipments").then((r) => r.json());

      if (type === "po") {
        const poData = await fetch(`/api/purchase-orders/${sourceId}`).then((r) => r.json());
        setSourceDetail(poData);

        if (poData.shipToId) setShipToId(poData.shipToId);

        // Calculate already shipped per line item
        const shippedByLineItem: Record<string, number> = {};
        const poShipments = allShipments.filter(
          (s: ExistingShipment) => s.purchaseOrder?.[0] === sourceId
        );
        for (const shipment of poShipments) {
          if (shipment.shipmentLines?.length) {
            const detail = await fetch(`/api/shipments/${shipment.id}`).then((r) => r.json());
            for (const line of detail.lineItems || []) {
              if (line.poLineItemId) {
                shippedByLineItem[line.poLineItemId] =
                  (shippedByLineItem[line.poLineItemId] || 0) + (line.qtyShipped || 0);
              }
            }
          }
        }

        const lines: ShipmentLine[] = (poData.lineItems || []).map((li: POLineItem) => {
          const qtyOrdered = li.qtySticks || 0;
          const qtyAlreadyShipped = shippedByLineItem[li.id] || 0;
          const qtyRemaining = Math.max(0, qtyOrdered - qtyAlreadyShipped);
          return {
            sourceLineId: li.id,
            skuId: li.skuId || "",
            skuName: li.sku ? li.sku.flavor || li.sku.standardSku : "Unknown SKU",
            section: li.section || "",
            qtyOrdered,
            qtyAlreadyShipped,
            qtyRemaining,
            qtyShipped: qtyRemaining,
            included: qtyRemaining > 0,
          };
        });
        setShipmentLines(lines);
      } else {
        // Work Order — ship output lines
        const woData = await fetch(`/api/work-orders/${sourceId}`).then((r) => r.json());
        setSourceDetail(woData);

        // Calculate already shipped per WO output SKU
        const shippedBySku: Record<string, number> = {};
        const woShipments = allShipments.filter(
          (s: ExistingShipment) => s.workOrder?.[0] === sourceId
        );
        for (const shipment of woShipments) {
          if (shipment.shipmentLines?.length) {
            const detail = await fetch(`/api/shipments/${shipment.id}`).then((r) => r.json());
            for (const line of detail.lineItems || []) {
              if (line.skuId) {
                shippedBySku[line.skuId] =
                  (shippedBySku[line.skuId] || 0) + (line.qtyShipped || 0);
              }
            }
          }
        }

        const lines: ShipmentLine[] = (woData.outputs || []).map((li: WOLineItem) => {
          const qtyOrdered = li.qty || 0;
          const qtyAlreadyShipped = shippedBySku[li.skuId || ""] || 0;
          const qtyRemaining = Math.max(0, qtyOrdered - qtyAlreadyShipped);
          return {
            sourceLineId: li.id,
            skuId: li.skuId || "",
            skuName: li.sku ? `${li.sku.standardSku} — ${li.sku.flavor}` : "Unknown SKU",
            section: "",
            qtyOrdered,
            qtyAlreadyShipped,
            qtyRemaining,
            qtyShipped: qtyRemaining,
            included: qtyRemaining > 0,
          };
        });
        setShipmentLines(lines);
      }
    } catch (err) {
      console.error("Failed to load source detail:", err);
      alert("Failed to load details. Please try again.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const handleSourceChange = (sourceId: string) => {
    setSelectedSourceId(sourceId);
    loadSourceDetail(sourceId, sourceType);
  };

  const handleSourceTypeChange = (type: SourceType) => {
    setSourceType(type);
    setSelectedSourceId("");
    setSourceDetail(null);
    setShipmentLines([]);
    setShipToId("");
  };

  const handleLineToggle = (index: number) => {
    setShipmentLines((prev) =>
      prev.map((line, i) =>
        i === index
          ? { ...line, included: !line.included, qtyShipped: !line.included ? line.qtyRemaining : 0 }
          : line
      )
    );
  };

  const handleQtyChange = (index: number, qty: number) => {
    setShipmentLines((prev) =>
      prev.map((line, i) =>
        i === index
          ? { ...line, qtyShipped: Math.min(Math.max(0, qty), line.qtyRemaining) }
          : line
      )
    );
  };

  const handleSubmit = async () => {
    if (!selectedSourceId) {
      alert(`Please select a ${sourceType === "po" ? "Purchase Order" : "Work Order"}.`);
      return;
    }
    if (!shipDate) {
      alert("Please enter a ship date.");
      return;
    }
    if (!shipToId) {
      alert("Please select a Ship To location.");
      return;
    }
    const includedLines = shipmentLines.filter(
      (line) => line.included && line.qtyShipped > 0
    );
    if (includedLines.length === 0) {
      alert("Please include at least one line item with quantity shipped.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(sourceType === "po"
            ? { purchaseOrderId: selectedSourceId }
            : { workOrderId: selectedSourceId }),
          shipDate,
          expectedDeliveryDate: expectedDeliveryDate || null,
          carrier,
          carrierReference,
          trackingNumber,
          shipToId: shipToId || null,
          lineItems: includedLines.map((line) => ({
            skuId: line.skuId,
            qtyShipped: line.qtyShipped,
          })),
        }),
      });

      const data = await res.json();
      router.push(`/shipments/${data.id}`);
    } catch {
      alert("Failed to create shipment. Please try again.");
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
            <h1 className="text-2xl font-bold text-gray-900">Create Shipment</h1>
            <p className="text-sm text-gray-500 mt-1">
              Record a shipment against a purchase order or work order
            </p>
          </div>
          <button
            onClick={() => router.push("/shipments")}
            className="border border-gray-300 text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
          {/* Source Type Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Source Document
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => handleSourceTypeChange("po")}
                className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
                  sourceType === "po"
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                Purchase Order
              </button>
              <button
                onClick={() => handleSourceTypeChange("wo")}
                className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
                  sourceType === "wo"
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                Work Order
              </button>
            </div>
          </div>

          {/* Source Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {sourceType === "po" ? "Purchase Order" : "Work Order"} <span className="text-red-500">*</span>
            </label>
            {sourceType === "po" ? (
              <select
                value={selectedSourceId}
                onChange={(e) => handleSourceChange(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
              >
                <option value="">Select a PO...</option>
                {pos.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.poNumber} — {po.supplier?.[0] ? suppliers[po.supplier[0]] || "" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={selectedSourceId}
                onChange={(e) => handleSourceChange(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
              >
                <option value="">Select a Work Order...</option>
                {wos.map((wo) => (
                  <option key={wo.id} value={wo.id}>
                    {wo.woNumber} — {wo.description || (wo.warehouse?.[0] ? warehouses[wo.warehouse[0]] || "" : "")}
                  </option>
                ))}
              </select>
            )}
            {sourceType === "po" && pos.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">
                No issued POs available. POs must be in &quot;Issued&quot; status to create shipments.
              </p>
            )}
            {sourceType === "wo" && wos.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">
                No work orders available.
              </p>
            )}
          </div>

          {/* Line Items */}
          {loadingDetail && (
            <p className="text-sm text-gray-500">Loading details...</p>
          )}

          {sourceDetail && !loadingDetail && (
            <>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 mb-3">
                  Line Items
                </h2>
                <p className="text-xs text-gray-500 mb-3">
                  Select the items included in this shipment and enter qty shipped.
                </p>
                <div className="border border-gray-200 rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="w-10 px-3 py-2"></th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                          SKU
                        </th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                          {sourceType === "po" ? "Ordered" : "Produced"}
                        </th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                          Already Shipped
                        </th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                          Remaining
                        </th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">
                          Qty Shipped
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shipmentLines.map((line, index) => (
                        <tr
                          key={line.sourceLineId}
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
                            {line.qtyAlreadyShipped.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                            {line.qtyRemaining.toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              value={line.qtyShipped || ""}
                              onChange={(e) =>
                                handleQtyChange(index, parseInt(e.target.value) || 0)
                              }
                              disabled={!line.included || line.qtyRemaining === 0}
                              min={0}
                              max={line.qtyRemaining}
                              className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Shipment Details */}
              <div className="border-t border-gray-200 pt-6">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">
                  Shipment Details
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Ship Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={shipDate}
                      onChange={(e) => setShipDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Expected Delivery Date
                    </label>
                    <input
                      type="date"
                      value={expectedDeliveryDate}
                      onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Ship To <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={shipToId}
                      onChange={(e) => setShipToId(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                    >
                      <option value="">Select location...</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Carrier
                    </label>
                    <input
                      type="text"
                      value={carrier}
                      onChange={(e) => setCarrier(e.target.value)}
                      placeholder="e.g. GlobalTranz, FedEx"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Carrier Reference
                    </label>
                    <input
                      type="text"
                      value={carrierReference}
                      onChange={(e) => setCarrierReference(e.target.value)}
                      placeholder="BOL / PRO number"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tracking Number
                    </label>
                    <input
                      type="text"
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      placeholder="Carrier tracking number"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {/* Submit */}
              <div className="border-t border-gray-200 pt-6 flex justify-end">
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="bg-gray-900 text-white px-6 py-2 text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
                >
                  {submitting ? "Creating..." : "Create Shipment"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
