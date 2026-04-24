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
  lines?: { itemNumber?: string | null; description: string; quantity: number; unit?: string; unitPrice: number; amount: number }[];
  suggestedType?: string;
  error?: string;
}

interface IngestedDocument {
  id: string;
  filename: string;
  content_type: string;
  storage_path: string | null;
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

interface SupplierOption {
  id: string;
  name: string;
}

interface POOption {
  id: string;
  poNumber: string;
}

interface ItemOption {
  id: string;
  sku: string;
  name: string | null;
  supplierItemName: string | null;
}

interface EditLine {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  itemId: string;
}

// Editable fields for a pending document
interface EditState {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms: string;
  deliveryTerms: string;
  poReference: string;
  salesOrder: string;
  trackingNumber: string;
  shipTo: string;
  suggestedType: string;
  supplierId: string;
  poId: string;
  subtotal: string;
  freight: string;
  tax: string;
  invoiceAmount: string;
  lines: EditLine[];
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

const INVOICE_TYPES = ["Supplier", "Freight", "Customs", "Packaging", "Work Order"];

function buildEditState(doc: IngestedDocument, itemsList: ItemOption[]): EditState {
  const p = doc.parsed_data;

  // Build lookup: supplier item name → item ID
  const supplierItemMap = new Map<string, string>();
  for (const item of itemsList) {
    if (item.supplierItemName) {
      supplierItemMap.set(item.supplierItemName.toLowerCase(), item.id);
    }
  }

  return {
    invoiceNumber: p?.invoiceNumber || "",
    invoiceDate: p?.invoiceDate || "",
    dueDate: p?.dueDate || "",
    paymentTerms: p?.paymentTerms || "",
    deliveryTerms: p?.deliveryTerms || "",
    poReference: p?.poReference || "",
    salesOrder: p?.salesOrder || "",
    trackingNumber: p?.trackingNumber || "",
    shipTo: p?.shipTo || "",
    suggestedType: p?.suggestedType || "Supplier",
    supplierId: doc.supplier_id || "",
    poId: doc.po_id || "",
    subtotal: p?.subtotal != null ? String(p.subtotal) : "",
    freight: p?.freight != null ? String(p.freight) : "",
    tax: p?.tax != null ? String(p.tax) : "",
    invoiceAmount: p?.invoiceAmount != null ? String(p.invoiceAmount) : "",
    lines: (p?.lines || []).map((l) => {
      // Auto-match: try supplier item number first, then description
      let matchedItemId = "";
      if (l.itemNumber) {
        matchedItemId = supplierItemMap.get(l.itemNumber.toLowerCase()) || "";
      }
      if (!matchedItemId && l.description) {
        // Try matching description against supplier item names
        const descLower = l.description.toLowerCase();
        for (const item of itemsList) {
          if (item.supplierItemName && descLower.includes(item.supplierItemName.toLowerCase())) {
            matchedItemId = item.id;
            break;
          }
          if (item.name && descLower.includes(item.name.toLowerCase())) {
            matchedItemId = item.id;
            break;
          }
        }
      }
      return {
        description: l.description,
        quantity: String(l.quantity),
        unitPrice: String(l.unitPrice),
        amount: String(l.amount),
        itemId: matchedItemId,
      };
    }),
  };
}

// --- Component ---

export default function InboxPage() {
  const [documents, setDocuments] = useState<IngestedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editStates, setEditStates] = useState<Record<string, EditState>>({});
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [pos, setPOs] = useState<POOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);

  // Load reference data
  useEffect(() => {
    Promise.all([
      fetch("/api/suppliers").then((r) => r.json()),
      fetch("/api/purchase-orders").then((r) => r.json()),
      fetch("/api/skus").then((r) => r.json()),
    ]).then(([suppData, poData, itemData]) => {
      setSuppliers(
        (suppData || []).map((s: { id: string; name: string }) => ({
          id: s.id,
          name: s.name,
        }))
      );
      setPOs(
        (poData || []).map((p: { id: string; poNumber: string }) => ({
          id: p.id,
          poNumber: p.poNumber,
        }))
      );
      setItems(
        (itemData || []).map((i: { id: string; standardSku: string; name: string | null; supplierItemName: string | null }) => ({
          id: i.id,
          sku: i.standardSku,
          name: i.name,
          supplierItemName: i.supplierItemName,
        }))
      );
    });
  }, []);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    const qs = tab === "all" ? "" : `?status=${tab}`;
    const res = await fetch(`/api/ingest/documents${qs}`);
    const data = await res.json();
    const docs: IngestedDocument[] = data.documents || [];
    setDocuments(docs);
    // Build edit states for pending docs
    const states: Record<string, EditState> = {};
    for (const doc of docs) {
      if (doc.status === "pending") {
        states[doc.id] = editStates[doc.id] || buildEditState(doc, items);
      }
    }
    setEditStates((prev) => ({ ...prev, ...states }));
    setLoading(false);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const updateField = (docId: string, field: keyof EditState, value: string) => {
    setEditStates((prev) => ({
      ...prev,
      [docId]: { ...prev[docId], [field]: value },
    }));
  };

  const updateLine = (docId: string, lineIdx: number, field: keyof EditLine, value: string) => {
    setEditStates((prev) => {
      const state = prev[docId];
      if (!state) return prev;
      const lines = [...state.lines];
      lines[lineIdx] = { ...lines[lineIdx], [field]: value };
      return { ...prev, [docId]: { ...state, lines } };
    });
  };

  const handleApprove = async (id: string) => {
    const edit = editStates[id];
    if (!edit) return;

    if (!edit.supplierId) {
      alert("Please select a supplier before approving.");
      return;
    }

    setActionLoading(id);
    const res = await fetch(`/api/ingest/documents/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId: edit.supplierId || undefined,
        poId: edit.poId || undefined,
        overrides: {
          invoiceNumber: edit.invoiceNumber,
          invoiceDate: edit.invoiceDate,
          dueDate: edit.dueDate || null,
          paymentTerms: edit.paymentTerms || null,
          deliveryTerms: edit.deliveryTerms || null,
          poReference: edit.poReference || null,
          salesOrder: edit.salesOrder || null,
          trackingNumber: edit.trackingNumber || null,
          shipTo: edit.shipTo || null,
          suggestedType: edit.suggestedType || "Supplier",
          subtotal: edit.subtotal ? parseFloat(edit.subtotal) : null,
          freight: edit.freight ? parseFloat(edit.freight) : null,
          tax: edit.tax ? parseFloat(edit.tax) : null,
          invoiceAmount: edit.invoiceAmount ? parseFloat(edit.invoiceAmount) : null,
          lines: edit.lines.map((l) => ({
            description: l.description,
            quantity: parseFloat(l.quantity) || 0,
            unitPrice: parseFloat(l.unitPrice) || 0,
            amount: parseFloat(l.amount) || 0,
            itemId: l.itemId || null,
          })),
        },
      }),
    });
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

  const handleViewPdf = async (id: string) => {
    setPdfLoading(id);
    try {
      const res = await fetch(`/api/ingest/documents/${id}/attachment`);
      if (res.ok) {
        const { url } = await res.json();
        window.open(url, "_blank");
      } else {
        alert("Could not load PDF.");
      }
    } finally {
      setPdfLoading(null);
    }
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
          Documents received via email — review, edit, and approve to create records.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
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
            const isPending = doc.status === "pending";
            const edit = editStates[doc.id];

            return (
              <div
                key={doc.id}
                className={`bg-white border rounded-lg transition-all ${
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

                {/* Expanded detail — Invoice, editable if pending */}
                {isExpanded && isInvoice && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    {/* View PDF */}
                    {doc.storage_path && (
                      <div className="mt-3 mb-1">
                        <button
                          onClick={() => handleViewPdf(doc.id)}
                          disabled={pdfLoading === doc.id}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                          {pdfLoading === doc.id ? "Opening..." : "View Original PDF"}
                        </button>
                      </div>
                    )}

                    {isPending && edit ? (
                      /* ── Editable form (pending) ── */
                      <div className="space-y-4 mt-3">
                        {/* Invoice Details card */}
                        <div>
                          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Invoice Details</h3>
                          <div className="grid grid-cols-2 gap-4">
                            <Field label="Invoice #" value={edit.invoiceNumber} onChange={(v) => updateField(doc.id, "invoiceNumber", v)} />
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
                              <select
                                value={edit.supplierId}
                                onChange={(e) => updateField(doc.id, "supplierId", e.target.value)}
                                className={`w-full border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black ${
                                  edit.supplierId ? "border-gray-300" : "border-amber-400 bg-amber-50"
                                }`}
                              >
                                <option value="">Select supplier...</option>
                                {suppliers.map((s) => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
                            </div>
                            <Field label="Invoice Date" value={edit.invoiceDate} onChange={(v) => updateField(doc.id, "invoiceDate", v)} type="date" />
                            <Field label="Due Date" value={edit.dueDate} onChange={(v) => updateField(doc.id, "dueDate", v)} type="date" />
                            <Field label="Payment Terms" value={edit.paymentTerms} onChange={(v) => updateField(doc.id, "paymentTerms", v)} />
                            <Field label="Delivery Terms" value={edit.deliveryTerms} onChange={(v) => updateField(doc.id, "deliveryTerms", v)} />
                          </div>
                        </div>

                        {/* Reference & Shipping card */}
                        <div>
                          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">References</h3>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">PO Reference</label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={edit.poReference}
                                  onChange={(e) => updateField(doc.id, "poReference", e.target.value)}
                                  className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Linked PO</label>
                              <select
                                value={edit.poId}
                                onChange={(e) => updateField(doc.id, "poId", e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                              >
                                <option value="">None</option>
                                {pos.map((p) => (
                                  <option key={p.id} value={p.id}>{p.poNumber}</option>
                                ))}
                              </select>
                            </div>
                            <Field label="Sales Order" value={edit.salesOrder} onChange={(v) => updateField(doc.id, "salesOrder", v)} />
                            <Field label="Tracking #" value={edit.trackingNumber} onChange={(v) => updateField(doc.id, "trackingNumber", v)} />
                            <Field label="Ship To" value={edit.shipTo} onChange={(v) => updateField(doc.id, "shipTo", v)} />
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Invoice Type</label>
                              <select
                                value={edit.suggestedType}
                                onChange={(e) => updateField(doc.id, "suggestedType", e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                              >
                                {INVOICE_TYPES.map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>

                        {/* Line items (editable) */}
                        {edit.lines.length > 0 && (
                          <div>
                            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Line Items</h3>
                            <div className="space-y-3">
                              {edit.lines.map((line, i) => (
                                <div key={i} className="border border-gray-200 rounded-lg p-3">
                                  {/* Row 1: Description (full width) */}
                                  <div className="mb-2">
                                    <label className="block text-xs font-medium text-gray-400 mb-1">Description (from invoice)</label>
                                    <p className="text-sm text-gray-700">{line.description}</p>
                                  </div>
                                  {/* Row 2: Item dropdown + Qty + Unit Price + Amount */}
                                  <div className="grid grid-cols-4 gap-3">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-500 mb-1">Item</label>
                                      <select
                                        value={line.itemId}
                                        onChange={(e) => updateLine(doc.id, i, "itemId", e.target.value)}
                                        className={`w-full border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black ${
                                          line.itemId ? "border-gray-300" : "border-amber-400 bg-amber-50"
                                        }`}
                                      >
                                        <option value="">Select item...</option>
                                        {items.map((item) => (
                                          <option key={item.id} value={item.id}>
                                            {item.sku}{item.name ? ` — ${item.name}` : ""}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-500 mb-1">Qty</label>
                                      <input
                                        type="number"
                                        value={line.quantity}
                                        onChange={(e) => updateLine(doc.id, i, "quantity", e.target.value)}
                                        step="0.01"
                                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-black"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-500 mb-1">Unit Price</label>
                                      <input
                                        type="number"
                                        value={line.unitPrice}
                                        onChange={(e) => updateLine(doc.id, i, "unitPrice", e.target.value)}
                                        step="0.01"
                                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-black"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
                                      <input
                                        type="number"
                                        value={line.amount}
                                        onChange={(e) => updateLine(doc.id, i, "amount", e.target.value)}
                                        step="0.01"
                                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-black"
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Totals (editable) */}
                        <div>
                          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Totals</h3>
                          <div className="grid grid-cols-4 gap-4">
                            <Field label="Subtotal" value={edit.subtotal} onChange={(v) => updateField(doc.id, "subtotal", v)} type="number" />
                            <Field label="Freight" value={edit.freight} onChange={(v) => updateField(doc.id, "freight", v)} type="number" />
                            <Field label="Tax" value={edit.tax} onChange={(v) => updateField(doc.id, "tax", v)} type="number" />
                            <Field label="Grand Total" value={edit.invoiceAmount} onChange={(v) => updateField(doc.id, "invoiceAmount", v)} type="number" />
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 pt-2 border-t border-gray-100">
                          <button
                            onClick={() => handleApprove(doc.id)}
                            disabled={actionLoading === doc.id}
                            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors"
                          >
                            {actionLoading === doc.id ? "Approving..." : "Approve & Create Invoice"}
                          </button>
                          <button
                            onClick={() => handleReject(doc.id)}
                            disabled={actionLoading === doc.id}
                            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ── Read-only view (approved/rejected) ── */
                      <div className="mt-3">
                        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                          <ReadOnlyField label="Invoice #" value={parsed.invoiceNumber} />
                          <ReadOnlyField label="Vendor" value={parsed.vendor} />
                          <ReadOnlyField label="Invoice Date" value={formatDate(parsed.invoiceDate)} />
                          <ReadOnlyField label="Due Date" value={formatDate(parsed.dueDate)} />
                          <ReadOnlyField label="Payment Terms" value={parsed.paymentTerms} />
                          <ReadOnlyField label="Delivery Terms" value={parsed.deliveryTerms} />
                          <ReadOnlyField label="PO Reference" value={parsed.poReference} highlight={!!doc.po_id} />
                          <ReadOnlyField label="Sales Order" value={parsed.salesOrder} />
                          <ReadOnlyField label="Tracking #" value={parsed.trackingNumber} />
                          <ReadOnlyField label="Ship To" value={parsed.shipTo} />
                          <ReadOnlyField label="Type" value={parsed.suggestedType} />
                          <ReadOnlyField label="Supplier" value={doc.supplier_id ? "Resolved" : "Not resolved"} highlight={!!doc.supplier_id} warn={!doc.supplier_id} />
                        </div>

                        {/* Line items */}
                        {parsed.lines && parsed.lines.length > 0 && (
                          <div className="mt-4">
                            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Line Items</h3>
                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="bg-gray-50 border-b border-gray-200">
                                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Description</th>
                                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Qty</th>
                                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Unit Price</th>
                                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {parsed.lines.map((line, i) => (
                                    <tr key={i} className="border-b border-gray-100">
                                      <td className="px-3 py-2 text-gray-700">{line.description}</td>
                                      <td className="px-3 py-2 text-right text-gray-600 tabular-nums">
                                        {line.quantity.toLocaleString()}
                                      </td>
                                      <td className="px-3 py-2 text-right text-gray-600 tabular-nums">
                                        {formatCurrency(line.unitPrice)}
                                      </td>
                                      <td className="px-3 py-2 text-right text-gray-700 font-medium tabular-nums">
                                        {formatCurrency(line.amount)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

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

                        {doc.status === "approved" && (
                          <div className="mt-4 text-xs text-green-600">
                            Approved {doc.reviewed_at ? formatDateTime(doc.reviewed_at) : ""}
                          </div>
                        )}
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
                        className="mt-3 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
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

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "date" | "number";
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={type === "number" ? "0.01" : undefined}
        className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
      />
    </div>
  );
}

function ReadOnlyField({
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
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p
        className={`text-sm font-medium text-gray-900 ${
          highlight ? "text-green-700" : ""
        } ${warn ? "text-amber-600" : ""}`}
      >
        {value || "\u2014"}
      </p>
    </div>
  );
}
