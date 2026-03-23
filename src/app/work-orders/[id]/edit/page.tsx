"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";

interface SKU {
  id: string;
  standardSku: string;
  category: string;
  flavor: string;
  count: number | null;
  uom: string;
  description: string;
}

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

interface InputLine {
  key: string;
  skuId: string;
  sku?: SKU;
  qtyPerUnit: number;
}

export default function EditWorkOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [skus, setSkus] = useState<SKU[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [woNumber, setWoNumber] = useState("");

  // WO Header
  const [warehouseId, setWarehouseId] = useState("");
  const [description, setDescription] = useState("");
  const [issuedDate, setIssuedDate] = useState("");

  // Inputs
  const [inputLines, setInputLines] = useState<InputLine[]>([]);

  // Output
  const [outputSkuId, setOutputSkuId] = useState("");
  const [outputSku, setOutputSku] = useState<SKU | null>(null);
  const [outputQty, setOutputQty] = useState<number>(0);

  // SKU search state
  const [inputSearch, setInputSearch] = useState<Record<string, string>>({});
  const [outputSearch, setOutputSearch] = useState("");
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  function createEmptyInput(): InputLine {
    return { key: crypto.randomUUID(), skuId: "", qtyPerUnit: 0 };
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/skus").then((r) => r.json()),
      fetch("/api/ship-to").then((r) => r.json()),
      fetch(`/api/work-orders/${id}`).then((r) => r.json()),
    ]).then(([skuData, whData, woData]) => {
      setSkus(skuData);
      setWarehouses(whData);

      // Pre-fill from existing WO
      setWoNumber(woData.woNumber || "");
      setWarehouseId(woData.warehouseId || "");
      setDescription(woData.description || "");
      setIssuedDate(woData.issuedDate || "");

      // Pre-fill output (first output line)
      const outputLine = woData.outputs?.[0];
      if (outputLine) {
        setOutputSkuId(outputLine.skuId);
        const oSku = skuData.find((s: SKU) => s.id === outputLine.skuId);
        setOutputSku(oSku || null);
        setOutputQty(outputLine.qty);
      }

      // Pre-fill inputs — reverse-calculate qtyPerUnit from totalQty / outputQty
      const oQty = outputLine?.qty || 1;
      const inputs = (woData.inputs || []).map(
        (inp: { skuId: string; qty: number }) => ({
          key: crypto.randomUUID(),
          skuId: inp.skuId,
          sku: skuData.find((s: SKU) => s.id === inp.skuId),
          qtyPerUnit: oQty > 0 ? Math.round(inp.qty / oQty) : inp.qty,
        })
      );
      setInputLines(inputs.length > 0 ? inputs : [createEmptyInput()]);

      setLoading(false);
    });
  }, [id]);

  // --- Input management ---
  const updateInputLine = useCallback(
    (key: string, updates: Partial<InputLine>) => {
      setInputLines((prev) =>
        prev.map((item) => {
          if (item.key !== key) return item;
          const updated = { ...item, ...updates };
          if (updates.skuId) {
            updated.sku = skus.find((s) => s.id === updates.skuId);
          }
          return updated;
        })
      );
    },
    [skus]
  );

  const addInputLine = () =>
    setInputLines((prev) => [...prev, createEmptyInput()]);
  const removeInputLine = (key: string) =>
    setInputLines((prev) => prev.filter((i) => i.key !== key));

  // --- Output management ---
  const selectOutputSku = (skuId: string) => {
    const sku = skus.find((s) => s.id === skuId);
    setOutputSkuId(skuId);
    setOutputSku(sku || null);
    setOutputSearch("");
    setActiveDropdown(null);
  };

  // --- Calculated totals ---
  const calculatedInputs = inputLines
    .filter((il) => il.skuId && il.qtyPerUnit > 0)
    .map((il) => ({
      ...il,
      totalQty: il.qtyPerUnit * outputQty,
    }));

  // --- Submit WO edit ---
  const handleSubmit = async () => {
    const validInputs = inputLines.filter(
      (il) => il.skuId && il.qtyPerUnit > 0
    );
    if (
      !warehouseId ||
      validInputs.length === 0 ||
      !outputSkuId ||
      outputQty <= 0
    ) {
      alert(
        "Please select a warehouse, define inputs, select an output, and enter a quantity."
      );
      return;
    }

    setSubmitting(true);
    try {
      const lineItems = [
        { skuId: outputSkuId, lineType: "Output" as const, qty: outputQty },
        ...validInputs.map((il) => ({
          skuId: il.skuId,
          lineType: "Input" as const,
          qty: il.qtyPerUnit * outputQty,
        })),
      ];

      const res = await fetch(`/api/work-orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId,
          description: description || `WO — ${outputSku?.standardSku || ""}`,
          issuedDate,
          lineItems,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
        return;
      }

      router.push(`/work-orders/${id}`);
    } catch (err) {
      console.error(err);
      alert("Error updating Work Order.");
    } finally {
      setSubmitting(false);
    }
  };

  // --- SKU search helpers ---
  const filteredInputSkus = (key: string) => {
    const search = (inputSearch[key] || "").toLowerCase();
    if (!search) return skus.slice(0, 20);
    return skus.filter(
      (s) =>
        s.standardSku?.toLowerCase().includes(search) ||
        s.flavor?.toLowerCase().includes(search) ||
        s.category?.toLowerCase().includes(search)
    );
  };

  const filteredOutputSkus = () => {
    const search = outputSearch.toLowerCase();
    if (!search) return skus.slice(0, 20);
    return skus.filter(
      (s) =>
        s.standardSku?.toLowerCase().includes(search) ||
        s.flavor?.toLowerCase().includes(search) ||
        s.category?.toLowerCase().includes(search)
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
              Edit {woNumber}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Modify work order details and line items
            </p>
          </div>
          <button
            onClick={() => router.push(`/work-orders/${id}`)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to {woNumber}
          </button>
        </div>

        {/* WO Header */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Work Order Details
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Warehouse *
              </label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              >
                <option value="">Select warehouse...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Issued Date
              </label>
              <input
                type="date"
                value={issuedDate}
                onChange={(e) => setIssuedDate(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Kit 28ct Cartons - Lemon Lime"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
          </div>
        </div>

        {/* Step 1: Inputs */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Step 1: Define Inputs (per 1 output unit)
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                What raw materials go into making 1 unit of the finished good?
              </p>
            </div>
            <button
              onClick={addInputLine}
              className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded-md hover:bg-gray-800"
            >
              + Add Input
            </button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="bg-warm-800 text-white">
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                  Input SKU
                </th>
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                  UOM
                </th>
                <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                  Qty per 1 Output
                </th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {inputLines.map((item) => (
                <tr key={item.key} className="border-b border-gray-100">
                  <td className="px-3 py-2 relative min-w-[300px]">
                    <input
                      type="text"
                      value={
                        item.sku
                          ? `${item.sku.standardSku} — ${item.sku.flavor}`
                          : inputSearch[item.key] || ""
                      }
                      onChange={(e) => {
                        setInputSearch((prev) => ({
                          ...prev,
                          [item.key]: e.target.value,
                        }));
                        setActiveDropdown(`input-${item.key}`);
                        if (item.skuId) {
                          updateInputLine(item.key, {
                            skuId: "",
                            sku: undefined,
                          });
                        }
                      }}
                      onFocus={() => setActiveDropdown(`input-${item.key}`)}
                      onBlur={() =>
                        setTimeout(() => setActiveDropdown(null), 200)
                      }
                      placeholder="Search SKU..."
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-black"
                    />
                    {activeDropdown === `input-${item.key}` && (
                      <div className="absolute z-50 mt-1 w-96 max-h-60 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-xl">
                        {filteredInputSkus(item.key).map((sku) => (
                          <button
                            key={sku.id}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs border-b border-gray-50"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              updateInputLine(item.key, { skuId: sku.id });
                              setInputSearch((prev) => ({
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
                              {sku.flavor} · {sku.uom} · {sku.category}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {item.sku?.uom || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={item.qtyPerUnit || ""}
                      onChange={(e) =>
                        updateInputLine(item.key, {
                          qtyPerUnit: parseInt(e.target.value) || 0,
                        })
                      }
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-black"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {inputLines.length > 1 && (
                      <button
                        onClick={() => removeInputLine(item.key)}
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

        {/* Step 2: Output */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
            Step 2: Define Output
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            The finished good this work order produces.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Output SKU *
              </label>
              {outputSku ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 border border-sage-300 bg-sage-50 rounded-md px-3 py-2 text-sm">
                    <span className="font-semibold">
                      {outputSku.standardSku}
                    </span>
                    <span className="text-gray-500 ml-2">
                      {outputSku.flavor}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setOutputSkuId("");
                      setOutputSku(null);
                    }}
                    className="text-gray-400 hover:text-red-500 text-sm px-2"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={outputSearch}
                    onChange={(e) => {
                      setOutputSearch(e.target.value);
                      setActiveDropdown("output");
                    }}
                    onFocus={() => setActiveDropdown("output")}
                    onBlur={() =>
                      setTimeout(() => setActiveDropdown(null), 200)
                    }
                    placeholder="Search existing SKU..."
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />
                  {activeDropdown === "output" && (
                    <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-xl">
                      {filteredOutputSkus().map((sku) => (
                        <button
                          key={sku.id}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs border-b border-gray-50"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectOutputSku(sku.id);
                          }}
                        >
                          <span className="font-semibold">
                            {sku.standardSku}
                          </span>
                          <span className="text-gray-500 ml-2">
                            {sku.flavor} · {sku.uom} · {sku.category}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quantity to Produce *
              </label>
              <input
                type="number"
                value={outputQty || ""}
                onChange={(e) => setOutputQty(parseInt(e.target.value) || 0)}
                placeholder="0"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
          </div>
        </div>

        {/* Calculated Summary */}
        {outputQty > 0 && calculatedInputs.length > 0 && (
          <div className="bg-gray-900 text-white rounded-lg p-6 mb-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider opacity-70 mb-3">
              Calculated Requirements
            </h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs uppercase tracking-wider opacity-50 mb-2">
                  Inputs Required
                </p>
                {calculatedInputs.map((il) => (
                  <div
                    key={il.key}
                    className="flex justify-between items-center py-1 border-b border-white/10"
                  >
                    <span className="text-sm">
                      {il.sku?.standardSku}{" "}
                      <span className="opacity-50">{il.sku?.flavor}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {il.totalQty.toLocaleString()}{" "}
                      <span className="opacity-50 text-xs">
                        ({il.qtyPerUnit} × {outputQty.toLocaleString()})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider opacity-50 mb-2">
                  Output
                </p>
                <div className="flex justify-between items-center py-1">
                  <span className="text-sm">
                    {outputSku?.standardSku}{" "}
                    <span className="opacity-50">{outputSku?.flavor}</span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {outputQty.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={() => router.push(`/work-orders/${id}`)}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
