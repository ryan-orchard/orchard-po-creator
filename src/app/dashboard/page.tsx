"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface DashboardData {
  unmatchedReceiptLines: number;
  invoicesWithoutReceipt: number;
  readyToPay: number;
  posInProgress: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Magna &middot; {today}</p>
        </div>

        {loading ? (
          <p className="text-gray-400 text-sm">Loading&hellip;</p>
        ) : !data ? (
          <p className="text-gray-400 text-sm">Failed to load dashboard.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {/* New receipts at the warehouse */}
            <ActionCard
              label="New Receipts at Warehouse"
              description="Receipt lines not yet matched to a PO"
              count={data.unmatchedReceiptLines}
              countLabel="unmatched lines"
              href="/receipts"
              color="warm"
              urgent={data.unmatchedReceiptLines > 0}
            />

            {/* Invoices without a receipt */}
            <ActionCard
              label="Invoices Without Receipt"
              description="Invoices not yet linked to a receipt"
              count={data.invoicesWithoutReceipt}
              countLabel="invoices"
              href="/invoices"
              color="warm"
              urgent={data.invoicesWithoutReceipt > 0}
            />

            {/* POs in progress */}
            <ActionCard
              label="POs In Progress"
              description="Draft, Issued, or Accepted"
              count={data.posInProgress}
              countLabel="purchase orders"
              href="/pos"
              color="gray"
              urgent={false}
            />

            {/* Ready to pay */}
            <ActionCard
              label="Ready to Pay"
              description="Invoices matched and approved"
              count={data.readyToPay}
              countLabel="invoices"
              href="/invoices?filter=ready-to-pay"
              color="sage"
              urgent={data.readyToPay > 0}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ActionCard({
  label,
  description,
  count,
  countLabel,
  href,
  color,
  urgent,
}: {
  label: string;
  description: string;
  count: number;
  countLabel: string;
  href: string;
  color: "warm" | "sage" | "gray";
  urgent: boolean;
}) {
  const router = useRouter();

  const colorStyles: Record<string, { card: string; count: string; label: string; desc: string }> = {
    warm: {
      card: urgent
        ? "bg-warm-50 border-warm-200 hover:bg-warm-100"
        : "bg-white border-gray-200 hover:bg-gray-50",
      count: urgent ? "text-warm-800" : "text-gray-400",
      label: urgent ? "text-warm-900" : "text-gray-500",
      desc: urgent ? "text-warm-600" : "text-gray-400",
    },
    sage: {
      card: urgent
        ? "bg-sage-50 border-sage-200 hover:bg-sage-100"
        : "bg-white border-gray-200 hover:bg-gray-50",
      count: urgent ? "text-sage-800" : "text-gray-400",
      label: urgent ? "text-sage-900" : "text-gray-500",
      desc: urgent ? "text-sage-600" : "text-gray-400",
    },
    gray: {
      card: "bg-white border-gray-200 hover:bg-gray-50",
      count: count > 0 ? "text-gray-700" : "text-gray-400",
      label: "text-gray-700",
      desc: "text-gray-400",
    },
  };

  const s = colorStyles[color];

  return (
    <button
      onClick={() => router.push(href)}
      className={`rounded-lg border px-6 py-5 text-left transition-colors ${s.card}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${s.label}`}>
            {label}
          </p>
          <p className={`text-4xl font-bold tabular-nums ${s.count}`}>
            {count}
          </p>
          <p className={`text-xs mt-1 ${s.desc}`}>{countLabel}</p>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-4 h-4 mt-1 ${urgent ? s.label : "text-gray-300"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </div>
      <p className={`text-sm mt-3 ${s.desc}`}>{description}</p>
    </button>
  );
}
