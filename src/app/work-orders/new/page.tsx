"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface BOM {
  finishedGoodId: string;
  finishedGoodSku: string;
  finishedGoodName: string;
  uom: string;
  isActive: boolean;
  components: {
    componentId: string;
    componentSku: string;
    componentName: string;
    uom: string;
    qtyPerOutput: number;
  }[];
}

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

interface OutputLine {
  key: string;
  bomId: string | null;      // null = no BOM (manual)
  finishedGoodId: string;
  finishedGoodSku: string;
  finishedGoodName: string;
  uom: string;
  runQty: number;
}

interface InputLine {
  componentId: string;
  componentSku: string;
  componentName: string;
  uom: string;
  calculatedQty: number;
  overrideQty: number | null; // null = use calculated
}

let keyCounter = 0;
function nextKey() { return `out-${++keyCounter}`; }

// Merge input quantities across all output lines that have a BOM
function calculateInputs(outputs: OutputLine[], boms: BOM[]): InputLine[] {
  const bomMap = new Map(boms.map((b) => [b.finishedGoodId, b]));
  const acc = new Map<string, { componentSku: string; componentName: string; uom: string; qty: number }>();

  for (const out of outputs) {
    if (!out.finishedGoodId || out.runQty <= 0) continue;
    const bom = bomMap.get(out.finishedGoodId);
    if (!bom) continue;
    for (const comp of bom.components) {
      const total = comp.qtyPerOutput * out.runQty;
      if (acc.has(comp.componentId)) {
        acc.get(comp.componentId)!.qty += total;
      } else {
        acc.set(comp.componentId, {
          componentSku: comp.componentSku,
          componentName: comp.componentName,
          uom: comp.uom,
          qty: total,
        });
      }
    }
  }

  return [...acc.entries()].map(([componentId, v]) => ({
    componentId,
    componentSku: v.componentSku,
    componentName: v.componentName,
    uom: v.uom,
    calculatedQty: v.qty,
    overrideQty: null,
  }));
}

export default function NewWorkOrderPage() {
  const router = useRouter();
  const [boms, setBoms] = useState<BOM[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Header
  const [warehouseId, setWarehouseId] = useState("");
  const [issuedDate, setIssuedDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");

  // Outputs
  const [outputs, setOutputs] = useState<OutputLine[]>([
    { key: nextKey(), bomId: null, finishedGoodId: "", finishedGoodSku: "", finishedGoodName: "", uom: "", runQty: 0 },
  ]);

  // Inputs — auto-derived from outputs, editable override
  const [inputs, setInputs] = useState<InputLine[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/boms").then((r) => r.json()),
      fetch("/api/ship-to").then((r) => r.json()),
    ]).then(([bomsData, whData]) => {
      setBoms(bomsData);
      setWarehouses(whData);
      setLoading(false);
    });
  }, []);

  // Recalculate inputs whenever outputs change
  useEffect(() => {
    const calculated = calculateInputs(outputs, boms);
    setInputs((prev) => {
      // Preserve existing overrides by componentId
      const overrideMap = new Map(prev.map((p) => [p.componentId, p.overrideQty]));
      return calculated.map((c) => ({
        ...c,
        overrideQty: overrideMap.get(c.componentId) ?? null,
      }));
    });
  }, [outputs, boms]);

  const selectBom = useCallback((key: string, finishedGoodId: string) => {
    const bom = boms.find((b) => b.finishedGoodId === finishedGoodId);
    setOutputs((prev) => prev.map((o) =>
      o.key !== key ? o : {
        ...o,
        bomId: bom?.finishedGoodId ?? null,
        finishedGoodId: finishedGoodId,
        finishedGoodSku: bom?.finishedGoodSku ?? "",
        finishedGoodName: bom?.finishedGoodName ?? "",
        uom: bom?.uom ?? "",
        runQty: o.runQty,
      }
    ));
  }, [boms]);

  const updateRunQty = useCallback((key: string, qty: number) => {
    setOutputs((prev) => prev.map((o) => o.key !== key ? o : { ...o, runQty: qty }));
  }, []);

  const addOutput = useCallback(() => {
    setOutputs((prev) => [...prev, {
      key: nextKey(), bomId: null, finishedGoodId: "", finishedGoodSku: "",
      finishedGoodName: "", uom: "", runQty: 0,
    }]);
  }, []);

  const removeOutput = useCallback((key: string) => {
    setOutputs((prev) => prev.filter((o) => o.key !== key));
  }, []);

  const setOverride = useCallback((componentId: string, val: string) => {
    setInputs((prev) => prev.map((inp) =>
      inp.componentId !== componentId ? inp : {
        ...inp,
        overrideQty: val === "" ? null : parseFloat(val) || null,
      }
    ));
  }, []);

  const handleSubmit = async () => {
    if (!warehouseId) { alert("Select a warehouse."); return; }
    const validOutputs = outputs.filter((o) => o.finishedGoodId && o.runQty > 0);
    if (!validOutputs.length) { alert("Add at least one output."); return; }

    setSubmitting(true);
    try {
      const lineItems = [
        ...validOutputs.map((o) => ({
          skuId: o.finishedGoodId,
          lineType: "Output" as const,
          qty: o.runQty,
          bomId: o.bomId ?? null,
        })),
        ...inputs.map((inp) => ({
          skuId: inp.componentId,
          lineType: "Input" as const,
          qty: inp.overrideQty ?? inp.calculatedQty,
          bomId: null,
        })),
      ];

      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseId, issuedDate, description: notes, lineItems }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to create Work Order");
      }

      const { id } = await res.json();
      router.push(`/work-orders/${id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error creating Work Order");
    } finally {
      setSubmitting(false);
    }
  };

  // BOMs that aren't already selected in another output line
  const availableBoms = (currentKey: string) =>
    boms.filter(
      (b) => b.isActive && !outputs.some((o) => o.key !== currentKey && o.finishedGoodId === b.finishedGoodId)
    );

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-sm text-gray-400">Loading…</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">New Work Order</h1>
            <p className="text-sm text-gray-500 mt-1">Select a BOM for each output. Inputs are calculated automatically.</p>
          </div>
          <button onClick={() => router.push("/work-orders")} className="text-sm text-gray-500 hover:text-gray-700">
            ← Cancel
          </button>
        </div>

        <div className="space-y-6">
          {/* Header */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Warehouse</label>
                <select
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-500"
                >
                  <option value="">Select warehouse…</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Issued Date</label>
                <input
                  type="date"
                  value={issuedDate}
                  onChange={(e) => setIssuedDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-500"
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">Special Instructions / Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Any special instructions for the warehouse…"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-500 resize-none"
              />
            </div>
          </div>

          {/* Outputs */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Outputs — Finished Goods to Produce</h2>
                <p className="text-xs text-gray-400 mt-0.5">Each output pulls inputs from its BOM.</p>
              </div>
              <button onClick={addOutput} className="text-xs text-sage-700 hover:underline font-medium">
                + Add Output
              </button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase tracking-wider">BOM / Finished Good</th>
                  <th className="text-right pb-2 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider w-36">Run Qty</th>
                  <th className="text-left pb-2 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider w-20">UOM</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {outputs.map((out) => (
                  <tr key={out.key}>
                    <td className="py-2 pr-2">
                      <select
                        value={out.finishedGoodId}
                        onChange={(e) => selectBom(out.key, e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sage-500"
                      >
                        <option value="">Select BOM…</option>
                        {availableBoms(out.key).map((b) => (
                          <option key={b.finishedGoodId} value={b.finishedGoodId}>
                            {b.finishedGoodSku} — {b.finishedGoodName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-4">
                      <input
                        type="number"
                        min={0}
                        value={out.runQty || ""}
                        onChange={(e) => updateRunQty(out.key, parseInt(e.target.value) || 0)}
                        placeholder="0"
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sage-500 tabular-nums"
                      />
                    </td>
                    <td className="py-2 px-4 text-xs text-gray-500">{out.uom || "—"}</td>
                    <td className="py-2">
                      {outputs.length > 1 && (
                        <button
                          onClick={() => removeOutput(out.key)}
                          className="text-gray-300 hover:text-red-500 text-xl leading-none"
                          title="Remove"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Inputs — auto-calculated */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Inputs — Raw Materials to Consume</h2>
              <p className="text-xs text-gray-400 mt-0.5">Calculated from BOMs. Override any quantity if needed.</p>
            </div>

            {inputs.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">
                Select a BOM and enter a run quantity above to see inputs.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Component</th>
                    <th className="text-right pb-2 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider w-36">Calculated</th>
                    <th className="text-right pb-2 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider w-36">Override</th>
                    <th className="text-left pb-2 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider w-20">UOM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {inputs.map((inp) => (
                    <tr key={inp.componentId}>
                      <td className="py-2 pr-4">
                        <p className="text-xs font-semibold text-gray-900">{inp.componentSku}</p>
                        {inp.componentName && (
                          <p className="text-xs text-gray-400">{inp.componentName}</p>
                        )}
                      </td>
                      <td className="py-2 px-4 text-right text-xs tabular-nums text-gray-700 font-medium">
                        {inp.calculatedQty.toLocaleString()}
                      </td>
                      <td className="py-2 px-4">
                        <input
                          type="number"
                          min={0}
                          value={inp.overrideQty ?? ""}
                          onChange={(e) => setOverride(inp.componentId, e.target.value)}
                          placeholder="—"
                          className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sage-500 tabular-nums"
                        />
                      </td>
                      <td className="py-2 px-4 text-xs text-gray-500">{inp.uom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => router.push("/work-orders")} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-5 py-2 bg-sage-800 text-white text-sm font-medium rounded-md hover:bg-sage-700 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create Work Order"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
