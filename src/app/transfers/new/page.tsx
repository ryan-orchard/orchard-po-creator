"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Location {
  id: string;
  name: string;
  code: string;
}
interface Item {
  id: string;
  standardSku: string;
  name: string | null;
  uom: string;
}
interface PO {
  id: string;
  poNumber: string;
}
interface POLine {
  poLineId: string;
  poId: string;
  itemSku: string;
  qty: number;
}

interface TransferLineInput {
  key: string;
  itemId: string;
  shippedQty: number;
  poLineId: string | null;
}

const CARRIERS = ["GlobalTranz", "Supplier Freight", "Stord Parcel", "Other"];

export default function NewTransferPage() {
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [poLines, setPoLines] = useState<POLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [carrier, setCarrier] = useState("");
  const [shipDate, setShipDate] = useState(new Date().toISOString().split("T")[0]);
  const [expectedArrivalDate, setExpectedArrivalDate] = useState("");
  const [poId, setPoId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<TransferLineInput[]>([emptyLine()]);

  function emptyLine(): TransferLineInput {
    return { key: crypto.randomUUID(), itemId: "", shippedQty: 0, poLineId: null };
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/ship-to").then((r) => r.json()),
      fetch("/api/skus").then((r) => r.json()),
      fetch("/api/purchase-orders").then((r) => r.json()),
      fetch("/api/po-lines").then((r) => r.json()),
    ])
      .then(([locs, sk, p, pl]) => {
        setLocations(Array.isArray(locs) ? locs : []);
        setItems(Array.isArray(sk) ? sk : []);
        setPos(Array.isArray(p) ? p : []);
        setPoLines(Array.isArray(pl) ? pl : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Selecting a PO prefills the lines from that PO's lines.
  const handlePoChange = (newPoId: string) => {
    setPoId(newPoId);
    if (!newPoId) return;
    const matching = poLines.filter((pl) => pl.poId === newPoId);
    if (matching.length === 0) return;
    const prefilled = matching.map((pl) => {
      const item = items.find((i) => i.standardSku === pl.itemSku);
      return {
        key: crypto.randomUUID(),
        itemId: item?.id ?? "",
        shippedQty: pl.qty,
        poLineId: pl.poLineId,
      };
    });
    setLines(prefilled);
  };

  const updateLine = (key: string, updates: Partial<TransferLineInput>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...updates } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const handleSubmit = async () => {
    if (!fromLocationId || !toLocationId || !shipDate) {
      alert("From location, to location and ship date are required.");
      return;
    }
    if (fromLocationId === toLocationId) {
      alert("From and to locations must be different.");
      return;
    }
    const validLines = lines.filter((l) => l.itemId && l.shippedQty > 0);
    if (validLines.length === 0) {
      alert("Add at least one line with a SKU and a quantity.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poId: poId || null,
          fromLocationId,
          toLocationId,
          carrier: carrier || null,
          shipDate,
          expectedArrivalDate: expectedArrivalDate || null,
          notes: notes || null,
          lines: validLines.map((l) => {
            const item = items.find((i) => i.id === l.itemId);
            return {
              itemId: l.itemId,
              poLineId: l.poLineId,
              shippedQty: l.shippedQty,
              uom: item?.uom ?? null,
            };
          }),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        alert(result.error || "Failed to create transfer.");
        setSubmitting(false);
        return;
      }
      router.push(`/transfers/${result.id}`);
    } catch {
      alert("Error creating transfer. Please try again.");
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

  const inputCls =
    "w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Create Transfer</h1>
            <p className="text-sm text-gray-500 mt-1">
              Transfer number will be auto-generated on save
            </p>
          </div>
          <button
            onClick={() => router.push("/transfers")}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to Transfers
          </button>
        </div>

        {/* Transfer details */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Transfer Details
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From *</label>
              <select
                value={fromLocationId}
                onChange={(e) => setFromLocationId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select origin...</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To *</label>
              <select
                value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select destination...</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Carrier</label>
              <select
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                className={inputCls}
              >
                <option value="">None / unknown</option>
                {CARRIERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ship Date *</label>
              <input
                type="date"
                value={shipDate}
                onChange={(e) => setShipDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Expected Arrival
              </label>
              <input
                type="date"
                value={expectedArrivalDate}
                onChange={(e) => setExpectedArrivalDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Purchase Order
              </label>
              <select value={poId} onChange={(e) => handlePoChange(e.target.value)} className={inputCls}>
                <option value="">None — selecting one prefills lines</option>
                {pos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.poNumber}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </div>
        </div>

        {/* Lines */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Lines</h2>
            <button
              onClick={addLine}
              className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded-md hover:bg-gray-800"
            >
              + Add Line
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-white text-xs font-semibold uppercase tracking-wider">
                <th className="text-left px-3 py-2">SKU</th>
                <th className="text-right px-3 py-2 w-32">Shipped Qty</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key} className="border-b border-gray-100">
                  <td className="px-3 py-2">
                    <select
                      value={line.itemId}
                      onChange={(e) => updateLine(line.key, { itemId: e.target.value })}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-black"
                    >
                      <option value="">Select SKU...</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.standardSku}
                          {i.name ? ` — ${i.name}` : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={line.shippedQty || ""}
                      onChange={(e) =>
                        updateLine(line.key, { shippedQty: parseInt(e.target.value) || 0 })
                      }
                      placeholder="0"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {lines.length > 1 && (
                      <button
                        onClick={() => removeLine(line.key)}
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

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={() => router.push("/transfers")}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Transfer"}
          </button>
        </div>
      </div>
    </div>
  );
}
