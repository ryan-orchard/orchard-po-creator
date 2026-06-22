"use client";

import { useEffect, useState } from "react";

// Inline per-line PO status control. Used on the /pos list and the PO detail
// Line Items section. draft/ordered/confirmed go through PATCH
// /api/po-lines/[id]/status; complete goes through POST /api/po-lines/[id]/complete
// (which posts the Acquisition movement).
const STATUS_OPTIONS = ["draft", "ordered", "confirmed", "complete"] as const;

const labels: Record<string, string> = {
  draft: "Draft",
  ordered: "Ordered",
  confirmed: "Confirmed",
  complete: "Complete",
  cancelled: "Cancelled",
};

const colors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  ordered: "bg-warm-100 text-warm-800",
  confirmed: "bg-gold-100 text-gold-800",
  complete: "bg-sage-100 text-sage-800",
  cancelled: "bg-gray-100 text-gray-600",
};

export default function LineStatusSelect({
  poLineId,
  status,
  onChanged,
}: {
  poLineId: string;
  status: string;
  /** Called with the new status after a successful update. */
  onChanged?: (next: string) => void;
}) {
  const [value, setValue] = useState(status);
  const [saving, setSaving] = useState(false);

  // Stay in sync if the parent refreshes with a new value (e.g. PO rollup).
  useEffect(() => setValue(status), [status]);

  const apply = async (next: string) => {
    if (next === value || saving) return;

    if (next === "complete") {
      if (!confirm("Mark this line complete? This posts an Acquisition movement for the line.")) return;
    } else if (value === "complete") {
      if (
        !confirm(
          "This line is complete and has an inventory movement posted. Changing its status will NOT remove that movement. Continue?"
        )
      )
        return;
    }

    const prev = value;
    setValue(next); // optimistic
    setSaving(true);
    try {
      const res =
        next === "complete"
          ? await fetch(`/api/po-lines/${poLineId}/complete`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            })
          : await fetch(`/api/po-lines/${poLineId}/status`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: next }),
            });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Failed");
      }
      onChanged?.(next);
    } catch (err) {
      setValue(prev); // revert on failure
      alert("Error updating status" + (err instanceof Error ? `: ${err.message}` : ""));
    } finally {
      setSaving(false);
    }
  };

  // Always include the current value as an option, even if it's not in the
  // standard set (e.g. an existing 'cancelled' line).
  const options = [...new Set<string>([...STATUS_OPTIONS, value])];

  return (
    <select
      value={value}
      disabled={saving}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        apply(e.target.value);
      }}
      className={`text-xs font-medium rounded-full pl-2 pr-6 py-1 border-0 cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-300 disabled:opacity-50 ${
        colors[value] || "bg-gray-100 text-gray-600"
      }`}
    >
      {options.map((s) => (
        <option key={s} value={s} className="bg-white text-gray-800">
          {labels[s] || s}
        </option>
      ))}
    </select>
  );
}
