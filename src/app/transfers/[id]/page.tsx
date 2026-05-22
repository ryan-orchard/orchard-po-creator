"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";

interface MatchRow {
  id: string;
  receiptLineId: string;
  matchedQty: number;
  matchMethod: string;
  confirmed: boolean;
  receipt: {
    source: string;
    receivedDate: string | null;
    warehouseCode: string | null;
    qtyReceived: number;
    sourceDocNo: string | null;
  } | null;
}

interface DetailLine {
  id: string;
  itemId: string;
  itemSku: string;
  itemName: string;
  shippedQty: number;
  receivedQty: number;
  uom: string | null;
  lotNumber: string | null;
  poLineId: string | null;
  hasVariance: boolean;
  matches: MatchRow[];
}

interface TransferDetail {
  id: string;
  transferNumber: string;
  poId: string | null;
  poNumber: string;
  fromCode: string;
  fromName: string;
  toCode: string;
  toName: string;
  carrier: string | null;
  shipDate: string;
  expectedArrivalDate: string | null;
  status: string;
  notes: string | null;
  freightTotal: number;
  lines: DetailLine[];
}

interface Candidate {
  receiptLineId: string;
  source: string;
  receivedDate: string | null;
  warehouseCode: string | null;
  qtyReceived: number;
  sourceDocNo: string | null;
  lotNumber: string | null;
}
interface Suggestion {
  transferLineId: string;
  itemId: string;
  shippedQty: number;
  receivedQty: number;
  fullyReceived: boolean;
  candidates: Candidate[];
}

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const yy = String(dt.getFullYear()).slice(2);
  return `${mm}/${dd}/${yy}`;
};

const statusColors: Record<string, string> = {
  in_transit: "bg-blue-100 text-blue-800",
  received: "bg-sage-100 text-sage-800",
  cancelled: "bg-gray-100 text-gray-600",
};
const statusLabels: Record<string, string> = {
  in_transit: "In Transit",
  received: "Received",
  cancelled: "Cancelled",
};

export default function TransferDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [transfer, setTransfer] = useState<TransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Record<string, { checked: boolean; qty: number }>>({});
  const [matching, setMatching] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [freightInput, setFreightInput] = useState("0");
  const [savingFreight, setSavingFreight] = useState(false);

  const loadTransfer = useCallback(async (): Promise<TransferDetail | null> => {
    const res = await fetch(`/api/transfers/${id}`);
    const data = await res.json();
    if (res.ok) {
      setTransfer(data);
      setFreightInput(String(data.freightTotal ?? 0));
      return data as TransferDetail;
    }
    return null;
  }, [id]);

  const loadSuggestions = useCallback(async () => {
    const res = await fetch(`/api/transfers/${id}/match-suggestions`);
    const data = await res.json();
    if (res.ok) setSuggestions(data.suggestions ?? []);
  }, [id]);

  useEffect(() => {
    (async () => {
      const t = await loadTransfer();
      if (t && t.status === "in_transit") await loadSuggestions();
      setLoading(false);
    })();
  }, [loadTransfer, loadSuggestions]);

  const keyOf = (tlId: string, rlId: string) => `${tlId}|${rlId}`;

  const toggleCandidate = (tlId: string, c: Candidate, remaining: number) => {
    const k = keyOf(tlId, c.receiptLineId);
    setSelected((prev) => {
      const cur = prev[k];
      if (cur?.checked) return { ...prev, [k]: { checked: false, qty: cur.qty } };
      const defaultQty = remaining > 0 ? Math.min(c.qtyReceived, remaining) : c.qtyReceived;
      return { ...prev, [k]: { checked: true, qty: defaultQty } };
    });
  };

  const setCandidateQty = (tlId: string, rlId: string, qty: number) => {
    const k = keyOf(tlId, rlId);
    setSelected((prev) => ({ ...prev, [k]: { checked: prev[k]?.checked ?? true, qty } }));
  };

  const handleConfirmMatches = async () => {
    const matches = Object.entries(selected)
      .filter(([, v]) => v.checked && v.qty > 0)
      .map(([k, v]) => {
        const [transferLineId, receiptLineId] = k.split("|");
        return { transferLineId, receiptLineId, matchedQty: v.qty };
      });
    if (matches.length === 0) {
      alert("Select at least one receipt to match.");
      return;
    }
    setMatching(true);
    try {
      const res = await fetch(`/api/transfers/${id}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matches }),
      });
      const result = await res.json();
      if (!res.ok) {
        alert(result.error || "Failed to record match.");
        return;
      }
      setSelected({});
      const t = await loadTransfer();
      if (t && t.status === "in_transit") await loadSuggestions();
      else setSuggestions([]);
    } catch {
      alert("Error recording match.");
    } finally {
      setMatching(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm("Cancel this transfer? Its movements will be reversed.")) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/transfers/${id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const e = await res.json();
        alert(e.error || "Failed to cancel.");
        return;
      }
      await loadTransfer();
      setSuggestions([]);
    } catch {
      alert("Error cancelling.");
    } finally {
      setCancelling(false);
    }
  };

  const handleSaveFreight = async () => {
    setSavingFreight(true);
    try {
      const res = await fetch(`/api/transfers/${id}/freight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parseFloat(freightInput) || 0 }),
      });
      if (!res.ok) {
        const e = await res.json();
        alert(e.error || "Failed to save freight.");
        return;
      }
      await loadTransfer();
    } catch {
      alert("Error saving freight.");
    } finally {
      setSavingFreight(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }
  if (!transfer) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Transfer not found.</p>
      </div>
    );
  }

  const openSuggestions = suggestions.filter((s) => !s.fullyReceived && s.candidates.length > 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{transfer.transferNumber}</h1>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full ${
                statusColors[transfer.status] || "bg-gray-100 text-gray-600"
              }`}
            >
              {statusLabels[transfer.status] || transfer.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {transfer.status !== "cancelled" && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="text-sm text-burgundy-600 border border-burgundy-200 px-3 py-1.5 rounded-md hover:bg-burgundy-50 disabled:opacity-50"
              >
                {cancelling ? "Cancelling..." : "Cancel Transfer"}
              </button>
            )}
            <button
              onClick={() => router.push("/transfers")}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back
            </button>
          </div>
        </div>

        {/* Details */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-3 gap-x-6 gap-y-4 text-sm">
            <Field label="Route">
              <span className="font-medium text-gray-900">
                {transfer.fromCode} → {transfer.toCode}
              </span>
            </Field>
            <Field label="Carrier">{transfer.carrier || "—"}</Field>
            <Field label="Purchase Order">
              {transfer.poId ? (
                <button
                  onClick={() => router.push(`/pos/${transfer.poId}`)}
                  className="text-blue-600 hover:underline"
                >
                  {transfer.poNumber || "View PO"}
                </button>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Ship Date">{fmtDate(transfer.shipDate)}</Field>
            <Field label="Expected Arrival">{fmtDate(transfer.expectedArrivalDate)}</Field>
            <Field label="Notes">{transfer.notes || "—"}</Field>
          </div>
        </div>

        {/* Lines */}
        <div className="bg-white rounded-lg border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Lines</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/40 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                <th className="text-left px-6 py-2.5">SKU</th>
                <th className="text-left px-4 py-2.5">Description</th>
                <th className="text-right px-4 py-2.5">Shipped</th>
                <th className="text-right px-4 py-2.5">Received</th>
              </tr>
            </thead>
            <tbody>
              {transfer.lines.map((line) => (
                <tr key={line.id} className="border-b border-gray-100 last:border-0 align-top">
                  <td className="px-6 py-3 font-medium text-gray-900">{line.itemSku || "—"}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {line.itemName || "—"}
                    {line.matches.filter((m) => m.confirmed).length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {line.matches
                          .filter((m) => m.confirmed)
                          .map((m) => (
                            <div key={m.id} className="text-xs text-sage-700">
                              ✓ Matched {m.matchedQty.toLocaleString()} —{" "}
                              {m.receipt
                                ? `${m.receipt.source.toUpperCase()} ${
                                    m.receipt.sourceDocNo ?? ""
                                  } ${fmtDate(m.receipt.receivedDate)}`
                                : "receipt"}
                            </div>
                          ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-800">
                    {line.shippedQty.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span
                      className={line.hasVariance ? "text-burgundy-600 font-medium" : "text-gray-800"}
                    >
                      {line.receivedQty.toLocaleString()}
                    </span>
                    {line.hasVariance && (
                      <span
                        className="ml-1 text-burgundy-500"
                        title={`Variance: shipped ${line.shippedQty}, received ${line.receivedQty}`}
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Costs */}
        {transfer.status !== "cancelled" && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Costs
            </h2>
            <div className="flex items-end gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Freight cost (total)</label>
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={freightInput}
                    onChange={(e) => setFreightInput(e.target.value)}
                    className="w-40 border border-gray-300 rounded px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
              </div>
              <button
                onClick={handleSaveFreight}
                disabled={savingFreight}
                className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
              >
                {savingFreight ? "Saving..." : "Save Freight"}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Allocated pro-rata across the transfer&apos;s lines — adds to inventory cost on receipt.
            </p>
          </div>
        )}

        {/* Match to receipts */}
        {transfer.status === "in_transit" && (
          <div className="bg-white rounded-lg border border-gray-200 mb-6">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                  Match to Receipts
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Confirm which warehouse receipts cover this transfer to close it out.
                </p>
              </div>
              <button
                onClick={handleConfirmMatches}
                disabled={matching}
                className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
              >
                {matching ? "Saving..." : "Confirm Matches"}
              </button>
            </div>
            <div className="p-6 space-y-6">
              {openSuggestions.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No candidate receipts found at {transfer.toCode} for these SKUs yet. Receipts
                  appear here once the destination warehouse logs them.
                </p>
              ) : (
                openSuggestions.map((s) => {
                  const line = transfer.lines.find((l) => l.id === s.transferLineId);
                  const remaining = s.shippedQty - s.receivedQty;
                  return (
                    <div key={s.transferLineId}>
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm font-medium text-gray-900">
                          {line?.itemSku || "SKU"}
                        </span>
                        <span className="text-xs text-gray-500 tabular-nums">
                          shipped {s.shippedQty.toLocaleString()} · received{" "}
                          {s.receivedQty.toLocaleString()} · {remaining.toLocaleString()} open
                        </span>
                      </div>
                      <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
                        {s.candidates.map((c) => {
                          const k = keyOf(s.transferLineId, c.receiptLineId);
                          const sel = selected[k];
                          return (
                            <div key={c.receiptLineId} className="flex items-center gap-3 px-3 py-2">
                              <input
                                type="checkbox"
                                checked={sel?.checked ?? false}
                                onChange={() => toggleCandidate(s.transferLineId, c, remaining)}
                                className="rounded border-gray-300"
                              />
                              <div className="flex-1 text-sm">
                                <span className="font-medium text-gray-900">
                                  {c.source.toUpperCase()} {c.sourceDocNo ?? ""}
                                </span>
                                <span className="text-gray-500">
                                  {" "}
                                  · {fmtDate(c.receivedDate)} · {c.warehouseCode}
                                  {c.lotNumber ? ` · lot ${c.lotNumber}` : ""}
                                </span>
                              </div>
                              <span className="text-xs text-gray-500 tabular-nums">
                                receipt qty {c.qtyReceived.toLocaleString()}
                              </span>
                              <input
                                type="number"
                                value={sel?.checked ? sel.qty : ""}
                                disabled={!sel?.checked}
                                onChange={(e) =>
                                  setCandidateQty(
                                    s.transferLineId,
                                    c.receiptLineId,
                                    parseInt(e.target.value) || 0
                                  )
                                }
                                placeholder="qty"
                                className="w-24 border border-gray-300 rounded px-2 py-1 text-xs text-right disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-black"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <div className="text-sm text-gray-900">{children}</div>
    </div>
  );
}
