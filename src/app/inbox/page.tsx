"use client";

import { useState, useEffect, useCallback } from "react";

// --- Types ---

interface ParsedInvoice {
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  paymentTerms?: string;
  vendor?: string;
  poReference?: string;
  salesOrder?: string;
  trackingNumber?: string;
  shipTo?: string;
  deliveryTerms?: string;
  subtotal?: number;
  freight?: number;
  tax?: number;
  invoiceAmount?: number;
  lines?: { description: string; quantity: number; unit: string; unitPrice: number; amount: number }[];
  suggestedType?: string;
  error?: string;
}

interface IngestedDocument {
  id: string;
  filename: string;
  content_type: string;
  document_type: string;
  confidence: number;
  parsed_data: ParsedInvoice | null;
  supplier_name: string | null;
  supplier_id: string | null;
  po_reference: string | null;
  po_id: string | null;
  invoice_number: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  ingested_emails: {
    from_address: string;
    from_name: string;
    subject: string;
    received_at: string;
  } | null;
}

type Tab = "pending" | "approved" | "all";

// --- Helpers ---

function formatDate(d: string | undefined | null) {
  if (!d) return "\u2014";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

function formatCurrency(n: number | undefined | null) {
  if (n == null) return "\u2014";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function confidenceBadge(c: number) {
  if (c >= 0.9) return { label: `${Math.round(c * 100)}%`, cls: "bg-green-100 text-green-700" };
  if (c >= 0.7) return { label: `${Math.round(c * 100)}%`, cls: "bg-yellow-100 text-yellow-700" };
  return { label: `${Math.round(c * 100)}%`, cls: "bg-red-100 text-red-700" };
}

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  duplicate: "bg-gray-100 text-gray-600",
};

const typeColors: Record<string, string> = {
  invoice: "bg-blue-100 text-blue-700",
  receipt: "bg-purple-100 text-purple-700",
  transaction_export: "bg-teal-100 text-teal-700",
  shipping_doc: "bg-orange-100 text-orange-700",
  unknown: "bg-gray-100 text-gray-500",
};

// --- Component ---

export default function InboxPage() {
  const [documents, setDocuments] = useState<IngestedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    const qs = tab === "all" ? "" : `?status=${tab}`;
    const res = await fetch(`/api/ingest/documents${qs}`);
    const data = await res.json();
    setDocuments(data.documents || []);
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    const res = await fetch(`/api/ingest/documents/${id}/approve`, { method: "POST" });
    if (res.ok) {
      await fetchDocs();
      setExpanded(null);
    } else {
      const err = await res.json();
      alert(`Approval failed: ${err.error}`);
    }
    setActionLoading(null);
  };

  const handleReject = async (id: string) => {
    setActionLoading(id);
    await fetch(`/api/ingest/documents/${id}/reject`, { method: "POST" });
    await fetchDocs();
    setExpanded(null);
    setActionLoading(null);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
        <p className="text-sm text-gray-500 mt-1">
          Documents received via email — review and approve to create records.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            {t.key === "pending" && documents.length > 0 && tab === "pending" && (
              <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                {documents.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Document list */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">No documents</p>
          <p className="text-gray-300 text-xs mt-1">
            Forward emails to magna@orchardinventory.com
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => {
            const isExpanded = expanded === doc.id;
            const parsed = doc.parsed_data;
            const conf = confidenceBadge(doc.confidence);
            const isInvoice = doc.document_type === "invoice" && parsed && !parsed.error;

            return (
              <div
                key={doc.id}
                className={`border rounded-lg transition-all ${
                  isExpanded ? "border-gray-300 shadow-sm" : "border-gray-200"
                }`}
              >
                {/* Summary row */}
                <button
                  onClick={() => setExpanded(isExpanded ? null : doc.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 rounded-lg"
                >
                  {/* Type badge */}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase ${typeColors[doc.document_type] || typeColors.unknown}`}>
                    {doc.document_type}
                  </span>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {isInvoice ? `Invoice ${parsed.invoiceNumber}` : doc.filename}
                      </span>
                      {isInvoice && parsed.vendor && (
                        <span className="text-xs text-gray-500 truncate">
                          from {parsed.vendor}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {doc.ingested_emails?.subject || doc.filename}
                      {" \u00b7 "}
                      {formatDateTime(doc.created_at)}
                    </div>
                  </div>

                  {/* Amount */}
                  {isInvoice && parsed.invoiceAmount != null && (
                    <span className="text-sm font-semibold text-gray-900 tabular-nums">
                      {formatCurrency(parsed.invoiceAmount)}
                    </span>
                  )}

                  {/* Confidence */}
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${conf.cls}`}>
                    {conf.label}
                  </span>

                  {/* Status */}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${statusColors[doc.status] || "bg-gray-100 text-gray-500"}`}>
                    {doc.status}
                  </span>

                  {/* Chevron */}
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded detail */}
                {isExpanded && isInvoice && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    {/* Two-column detail grid */}
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 mt-3 text-sm">
                      <DetailRow label="Invoice #" value={parsed.invoiceNumber} />
                      <DetailRow label="Vendor" value={parsed.vendor} />
                      <DetailRow label="Invoice Date" value={formatDate(parsed.invoiceDate)} />
                      <DetailRow label="Due Date" value={formatDate(parsed.dueDate)} />
                      <DetailRow label="Payment Terms" value={parsed.paymentTerms} />
                      <DetailRow label="Delivery Terms" value={parsed.deliveryTerms} />
                      <DetailRow label="PO Reference" value={parsed.poReference} highlight={!!doc.po_id} />
                      <DetailRow label="Sales Order" value={parsed.salesOrder} />
                      <DetailRow label="Tracking #" value={parsed.trackingNumber} />
                      <DetailRow label="Ship To" value={parsed.shipTo} />
                      <DetailRow label="Type" value={parsed.suggestedType} />
                      <DetailRow label="Existing Supplier" value={doc.supplier_id ? "Yes" : "No"} highlight={!!doc.supplier_id} warn={!doc.supplier_id} />
                    </div>

                    {/* Line items */}
                    {parsed.lines && parsed.lines.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Line Items
                        </p>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                              <th className="pb-1.5 font-medium">Description</th>
                              <th className="pb-1.5 font-medium text-right">Qty</th>
                              <th className="pb-1.5 font-medium text-right">Unit Price</th>
                              <th className="pb-1.5 font-medium text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {parsed.lines.map((line, i) => (
                              <tr key={i} className="border-b border-gray-50">
                                <td className="py-1.5 text-gray-700">{line.description}</td>
                                <td className="py-1.5 text-right text-gray-600 tabular-nums">
                                  {line.quantity.toLocaleString()} {line.unit}
                                </td>
                                <td className="py-1.5 text-right text-gray-600 tabular-nums">
                                  {formatCurrency(line.unitPrice)}
                                </td>
                                <td className="py-1.5 text-right text-gray-700 font-medium tabular-nums">
                                  {formatCurrency(line.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {/* Totals */}
                        <div className="mt-2 flex flex-col items-end gap-0.5 text-sm">
                          {parsed.subtotal != null && parsed.subtotal !== parsed.invoiceAmount && (
                            <div className="flex gap-6">
                              <span className="text-gray-400">Subtotal</span>
                              <span className="text-gray-600 tabular-nums">{formatCurrency(parsed.subtotal)}</span>
                            </div>
                          )}
                          {parsed.freight != null && parsed.freight > 0 && (
                            <div className="flex gap-6">
                              <span className="text-gray-400">Freight</span>
                              <span className="text-gray-600 tabular-nums">{formatCurrency(parsed.freight)}</span>
                            </div>
                          )}
                          {parsed.tax != null && parsed.tax > 0 && (
                            <div className="flex gap-6">
                              <span className="text-gray-400">Tax</span>
                              <span className="text-gray-600 tabular-nums">{formatCurrency(parsed.tax)}</span>
                            </div>
                          )}
                          <div className="flex gap-6 font-semibold border-t border-gray-200 pt-1 mt-1">
                            <span className="text-gray-600">Total</span>
                            <span className="text-gray-900 tabular-nums">{formatCurrency(parsed.invoiceAmount)}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    {doc.status === "pending" && (
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => handleApprove(doc.id)}
                          disabled={actionLoading === doc.id}
                          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors"
                        >
                          {actionLoading === doc.id ? "Approving..." : "Approve"}
                        </button>
                        <button
                          onClick={() => handleReject(doc.id)}
                          disabled={actionLoading === doc.id}
                          className="px-4 py-2 bg-white text-gray-600 text-sm font-medium rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    )}

                    {doc.status === "approved" && (
                      <div className="mt-4 text-xs text-green-600">
                        Approved {doc.reviewed_at ? formatDateTime(doc.reviewed_at) : ""}
                      </div>
                    )}
                  </div>
                )}

                {/* Expanded detail for errors/non-invoices */}
                {isExpanded && !isInvoice && (
                  <div className="px-4 pb-4 border-t border-gray-100 mt-2">
                    {parsed?.error ? (
                      <p className="text-sm text-red-500 font-mono">{parsed.error}</p>
                    ) : (
                      <p className="text-sm text-gray-400">
                        Parsing not available for {doc.document_type} documents yet.
                      </p>
                    )}
                    {doc.status === "pending" && (
                      <button
                        onClick={() => handleReject(doc.id)}
                        disabled={actionLoading === doc.id}
                        className="mt-3 px-4 py-2 bg-white text-gray-600 text-sm font-medium rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      >
                        Reject
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function DetailRow({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: string | null | undefined;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-gray-400 text-xs w-28 flex-shrink-0">{label}</span>
      <span
        className={`text-gray-700 truncate ${
          highlight ? "text-green-700 font-medium" : ""
        } ${warn ? "text-amber-600" : ""}`}
      >
        {value || "\u2014"}
      </span>
    </div>
  );
}
