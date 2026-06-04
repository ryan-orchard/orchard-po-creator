"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Item {
  id: string;
  standardSku: string;
  name: string | null;
  uom: string;
  category: string | null;
}

interface ComponentLine {
  key: string;
  componentId: string;
  qtyPerOutput: number;
}

interface BomFormProps {
  initialFinishedGoodId?: string;
  initialComponents?: { componentId: string; qtyPerOutput: number }[];
  lockFinishedGood?: boolean;
}

let keyCounter = 0;
function nextKey() { return `line-${++keyCounter}`; }

export default function BomForm({ initialFinishedGoodId, initialComponents, lockFinishedGood }: BomFormProps) {
  const router = useRouter();
  const [fgItems, setFgItems] = useState<Item[]>([]);
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [finishedGoodId, setFinishedGoodId] = useState(initialFinishedGoodId ?? "");
  const [lines, setLines] = useState<ComponentLine[]>(
    initialComponents?.map((c) => ({ key: nextKey(), componentId: c.componentId, qtyPerOutput: c.qtyPerOutput })) ??
    [{ key: nextKey(), componentId: "", qtyPerOutput: 1 }]
  );

  useEffect(() => {
    Promise.all([
      fetch("/api/skus?accountingCategory=FG").then((r) => r.json()),
      fetch("/api/skus").then((r) => r.json()),
    ]).then(([fgData, allData]) => {
      const toItem = (s: Record<string, unknown>): Item => ({
        id: s.id as string,
        standardSku: s.standardSku as string,
        name: (s.name ?? null) as string | null,
        uom: s.uom as string,
        category: (s.category ?? null) as string | null,
      });
      setFgItems((fgData as Record<string, unknown>[]).map(toItem).sort((a, b) => a.standardSku.localeCompare(b.standardSku)));
      setAllItems((allData as Record<string, unknown>[]).map(toItem).sort((a, b) => a.standardSku.localeCompare(b.standardSku)));
      setLoading(false);
    });
  }, []);

  const addLine = useCallback(() => {
    setLines((prev) => [...prev, { key: nextKey(), componentId: "", qtyPerOutput: 1 }]);
  }, []);

  const removeLine = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const updateLine = useCallback((key: string, field: keyof Omit<ComponentLine, "key">, value: string | number) => {
    setLines((prev) => prev.map((l) => l.key === key ? { ...l, [field]: value } : l));
  }, []);

  const handleSave = async () => {
    if (!finishedGoodId) { alert("Select a finished good."); return; }
    const validLines = lines.filter((l) => l.componentId && l.qtyPerOutput > 0);
    if (!validLines.length) { alert("Add at least one component."); return; }

    setSaving(true);
    try {
      const isEdit = !!initialFinishedGoodId;
      const res = await fetch(
        isEdit ? `/api/boms/${finishedGoodId}` : "/api/boms",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            finishedGoodId,
            components: validLines.map((l) => ({ componentId: l.componentId, qtyPerOutput: l.qtyPerOutput })),
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Save failed");
      }
      router.push("/boms");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const selectedFG = fgItems.find((f) => f.id === finishedGoodId);

  if (loading) return <div className="py-12 text-center text-sm text-gray-400">Loading…</div>;

  return (
    <div className="space-y-6">
      {/* Finished Good */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Finished Good</h2>
        {lockFinishedGood && selectedFG ? (
          <div>
            <p className="text-sm font-semibold text-gray-900">{selectedFG.standardSku}</p>
            <p className="text-sm text-gray-500">{selectedFG.name} · {selectedFG.uom}</p>
          </div>
        ) : (
          <select
            value={finishedGoodId}
            onChange={(e) => setFinishedGoodId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-500"
          >
            <option value="">Select finished good…</option>
            {fgItems.map((fg) => (
              <option key={fg.id} value={fg.id}>
                {fg.standardSku}{fg.name ? ` — ${fg.name}` : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Components */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Components</h2>
            <p className="text-xs text-gray-400 mt-0.5">Quantity consumed per 1 output unit</p>
          </div>
          <button onClick={addLine} className="text-xs text-sage-700 hover:underline font-medium">
            + Add Component
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">No components yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left pb-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Component</th>
                <th className="text-right pb-2 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider w-36">Qty / Output</th>
                <th className="text-left pb-2 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider w-20">UOM</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lines.map((line) => {
                const comp = allItems.find((i) => i.id === line.componentId);
                return (
                  <tr key={line.key}>
                    <td className="py-2 pr-2">
                      <select
                        value={line.componentId}
                        onChange={(e) => updateLine(line.key, "componentId", e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sage-500"
                      >
                        <option value="">Select component…</option>
                        {allItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.standardSku}{item.name ? ` — ${item.name}` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-4">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={line.qtyPerOutput}
                        onChange={(e) => updateLine(line.key, "qtyPerOutput", parseFloat(e.target.value) || 0)}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-sage-500 tabular-nums"
                      />
                    </td>
                    <td className="py-2 px-4 text-xs text-gray-500">{comp?.uom ?? "—"}</td>
                    <td className="py-2">
                      <button
                        onClick={() => removeLine(line.key)}
                        className="text-gray-300 hover:text-red-500 text-xl leading-none"
                        title="Remove"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.push("/boms")} className="text-sm text-gray-500 hover:text-gray-700">
          ← Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-sage-800 text-white text-sm font-medium rounded-md hover:bg-sage-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save BOM"}
        </button>
      </div>
    </div>
  );
}
