"use client";

import { useEffect, useState, Fragment, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// --- Types ---

interface InvoiceLine {
  id: string;
  lineId: string;
  ansItemNumber: string;
  description: string;
  skuName: string | null;
  qtyBilled: number;
  unitCost: number;
  unit: string;
  amount: number;
  batchNumber: string;
}

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  supplier: string;
  supplierId: string | null;
  salesOrder: string;
  poReference: string;
  paymentTerms: string;
  trackingNumber: string;
  deliveryTerms: string;
  shipTo: string;
  subtotal: number;
  freight: number;
  tax: number;
  invoiceAmount: number;
  matchStatus: string;
  paymentStatus: string;
  classification: string;
  notes: string;
  invoiceType: string;
  sourceDocumentId: string | null;
  linkedShipment: { id: string; shipmentNumber: string } | null;
  linkedWorkOrder: { id: string; woNumber: string } | null;
  lines: InvoiceLine[];
  purchaseOrder: { id: string; poNumber: string; status: string } | null;
  receipts: { id: string; receiptNumber: string; receivedDate: string; lines: { sku: string; qtyReceived: number }[] }[];
  shipments: { id: string; shipmentNumber: string; shipDate: string; status: string }[];
}

interface Supplier {
  id: string;
  name: string;
}

interface SkuItem {
  id: string;
  standardSku: string;
}

interface LineDraft {
  id: string;
  itemId: string | null;
  description: string;
  qtyBilled: number;
  unitCost: number;
  amount: number;
}

// --- Constants ---

const INVOICE_TYPE_COLORS: Record<string, string> = {
  Supplier: "bg-gray-100 text-gray-700",
  Packaging: "bg-warm-100 text-warm-800",
  Freight: "bg-blue-100 text-blue-800",
  Customs: "bg-orange-100 text-orange-800",
  "Work Order": "bg-gold-100 text-gold-800",
};

const INVOICE_TYPES = ["Supplier", "Packaging", "Freight", "Customs", "Work Order"];
const PAYMENT_STATUSES = ["Unpaid", "Paid", "Disputed"];
const CLASSIFICATION_VALUES = ["", "Capitalized", "Expensed"];

const paymentStatusColors: Record<string, string> = {
  Unpaid: "bg-gray-100 text-gray-700",
  Paid: "bg-gold-100 text-gold-800",
  Disputed: "bg-burgundy-100 text-burgundy-800",
};

// --- Helpers ---

function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// --- Timeline ---

type NodeIcon = "invoice" | "po" | "shipment" | "receipt" | "wo";

const NODE_ICON_COLORS: Record<NodeIcon, string> = {
  invoice: "bg-gray-800 text-white",
  po: "bg-gold-100 text-gold-700",
  shipment: "bg-blue-100 text-blue-700",
  receipt: "bg-sage-100 text-sage-700",
  wo: "bg-gold-100 text-gold-700",
};

function NodeSvg({ icon }: { icon: NodeIcon }) {
  const paths: Record<NodeIcon, string> = {
    invoice: "M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75",
    po: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z",
    shipment: "M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12",
    receipt: "M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185z",
    wo: "M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z",
  };
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={paths[icon]} />
    </svg>
  );
}

interface TimelineNodeProps {
  icon: NodeIcon;
  label: string;
  sub: string;
  href: string | null;
  empty: boolean;
}

function TimelineNode({ icon, label, sub, href, empty }: TimelineNodeProps) {
  const inner = (
    <div className={`flex flex-col items-center px-4 py-2 rounded-lg transition-colors ${!empty ? "hover:bg-gray-50 cursor-pointer" : ""}`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-2 ${empty ? "bg-gray-100 text-gray-300 border-2 border-dashed border-gray-200" : NODE_ICON_COLORS[icon]}`}>
        {empty ? (
          <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        ) : (
          <NodeSvg icon={icon} />
        )}
      </div>
      <p className={`text-xs font-semibold text-center whitespace-nowrap ${empty ? "text-gray-400 italic font-normal" : "text-gray-800"}`}>{label}</p>
      <p className="text-[11px] text-gray-400 text-center mt-0.5 whitespace-nowrap">{sub}</p>
    </div>
  );
  if (href && !empty) return <Link href={href}>{inner}</Link>;
  return <>{inner}</>;
}

// --- Edit Form Fields type ---

interface EditDraft {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  poReference: string;
  paymentTerms: string;
  salesOrder: string;
  trackingNumber: string;
  deliveryTerms: string;
  shipTo: string;
  notes: string;
  invoiceType: string;
  supplierId: string;
  classification: string;
}

function draftFromInvoice(inv: InvoiceDetail): EditDraft {
  return {
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    poReference: inv.poReference,
    paymentTerms: inv.paymentTerms,
    salesOrder: inv.salesOrder,
    trackingNumber: inv.trackingNumber,
    deliveryTerms: inv.deliveryTerms,
    shipTo: inv.shipTo,
    notes: inv.notes,
    invoiceType: inv.invoiceType,
    supplierId: inv.supplierId || "",
    classification: inv.classification,
  };
}

// --- Main Page ---

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [skuItems, setSkuItems] = useState<SkuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);

  const fetchInvoice = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices/${params.id}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setInvoice(data);
      setDraft(draftFromInvoice(data));
      setLineDrafts(data.lines.map((l: InvoiceLine) => ({
        id: l.id,
        itemId: null, // will be resolved from skuName if needed
        description: l.description,
        qtyBilled: l.qtyBilled,
        unitCost: l.unitCost,
        amount: l.amount,
      })));
    } catch {
      router.push("/invoices");
    } finally {
      setLoading(false);
    }
  }, [params.id, router]);

  useEffect(() => {
    fetchInvoice();
    fetch("/api/suppliers").then((r) => r.json()).then((data) => {
      setSuppliers(Array.isArray(data) ? data : data.suppliers || []);
    }).catch(() => {});
    fetch("/api/skus").then((r) => r.json()).then((data) => {
      setSkuItems(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, [fetchInvoice]);

  const saveEdits = useCallback(async () => {
    if (!invoice || !draft) return;
    setSaving(true);
    try {
      // Save header fields
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: draft.invoiceNumber,
          invoiceDate: draft.invoiceDate,
          dueDate: draft.dueDate || null,
          poReference: draft.poReference || null,
          paymentTerms: draft.paymentTerms || null,
          salesOrder: draft.salesOrder || null,
          trackingNumber: draft.trackingNumber || null,
          deliveryTerms: draft.deliveryTerms || null,
          shipTo: draft.shipTo || null,
          notes: draft.notes || null,
          invoiceType: draft.invoiceType,
          supplierId: draft.supplierId || null,
        }),
      });
      if (!res.ok) throw new Error();

      // Save classification via status endpoint
      await fetch(`/api/invoices/${invoice.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classification: draft.classification }),
      });

      // Save line item changes
      if (lineDrafts.length > 0) {
        await fetch(`/api/invoices/${invoice.id}/lines`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines: lineDrafts.map((l) => ({
              id: l.id,
              itemId: l.itemId,
              description: l.description,
              qty: l.qtyBilled,
              unitPrice: l.unitCost,
              total: l.amount,
            })),
          }),
        });
      }

      await fetchInvoice();
      setEditing(false);
    } catch {
      // could add error toast
    } finally {
      setSaving(false);
    }
  }, [invoice, draft, lineDrafts, fetchInvoice]);

  const patchStatus = useCallback(async (body: Record<string, string>) => {
    if (!invoice) return;
    try {
      await fetch(`/api/invoices/${invoice.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await fetchInvoice();
    } catch {
      // ignore
    }
  }, [invoice, fetchInvoice]);

  const viewOriginal = useCallback(async () => {
    if (!invoice?.sourceDocumentId) return;
    try {
      const res = await fetch(`/api/ingest/documents/${invoice.sourceDocumentId}/attachment`);
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      window.open(url, "_blank");
    } catch {
      alert("Could not load the original document.");
    }
  }, [invoice]);

  const cancelEdit = useCallback(() => {
    if (invoice) {
      setDraft(draftFromInvoice(invoice));
      setLineDrafts(invoice.lines.map((l) => ({
        id: l.id,
        itemId: null,
        description: l.description,
        qtyBilled: l.qtyBilled,
        unitCost: l.unitCost,
        amount: l.amount,
      })));
    }
    setEditing(false);
  }, [invoice]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading invoice...</p>
      </div>
    );
  }

  if (!invoice || !draft) return null;

  const supplierName = suppliers.find((s) => s.id === draft.supplierId)?.name ?? invoice.supplier;

  // Build timeline nodes
  const timelineNodes: TimelineNodeProps[] = [
    { icon: "invoice", label: "Invoice Received", sub: formatDate(invoice.invoiceDate), href: null, empty: false },
  ];
  if (invoice.invoiceType === "Supplier" || invoice.invoiceType === "Packaging") {
    timelineNodes.push({
      icon: "po",
      label: invoice.purchaseOrder?.poNumber ?? "PO Match",
      sub: invoice.purchaseOrder ? invoice.purchaseOrder.status : "Not linked",
      href: invoice.purchaseOrder ? `/pos/${invoice.purchaseOrder.id}` : null,
      empty: !invoice.purchaseOrder,
    });
    const receiptCount = invoice.receipts.length;
    timelineNodes.push({
      icon: "receipt",
      label: receiptCount > 0 ? `${receiptCount} receipt${receiptCount > 1 ? "s" : ""}` : "Receipts",
      sub: receiptCount > 0
        ? `${invoice.receipts.reduce((s, r) => s + r.lines.reduce((s2, l) => s2 + l.qtyReceived, 0), 0).toLocaleString()} units received`
        : "Linked via PO",
      href: receiptCount > 0 && invoice.purchaseOrder ? `/pos/${invoice.purchaseOrder.id}` : null,
      empty: receiptCount === 0,
    });
  } else if (invoice.invoiceType === "Freight" || invoice.invoiceType === "Customs") {
    timelineNodes.push({
      icon: "shipment",
      label: invoice.linkedShipment?.shipmentNumber ?? "Shipment Match",
      sub: invoice.linkedShipment ? "Linked" : "Not linked",
      href: invoice.linkedShipment ? `/shipments/${invoice.linkedShipment.id}` : null,
      empty: !invoice.linkedShipment,
    });
  } else if (invoice.invoiceType === "Work Order") {
    timelineNodes.push({
      icon: "wo",
      label: invoice.linkedWorkOrder?.woNumber ?? "WO Match",
      sub: invoice.linkedWorkOrder ? "Linked" : "Not linked",
      href: invoice.linkedWorkOrder ? `/work-orders/${invoice.linkedWorkOrder.id}` : null,
      empty: !invoice.linkedWorkOrder,
    });
  }

  // Detail fields for read mode
  const detailFields = [
    { label: "Invoice Number", value: invoice.invoiceNumber },
    { label: "Invoice Date", value: formatDate(invoice.invoiceDate) },
    { label: "Due Date", value: formatDate(invoice.dueDate) },
    { label: "PO Reference", value: invoice.poReference || "—" },
    { label: "Payment Terms", value: invoice.paymentTerms || "—" },
    { label: "Sales Order", value: invoice.salesOrder || "—" },
    { label: "Vendor", value: invoice.supplier || "—" },
    { label: "Invoice Type", value: invoice.invoiceType },
    { label: "Tracking Number", value: invoice.trackingNumber || "—" },
    { label: "Ship To", value: invoice.shipTo || "—" },
    { label: "Delivery Terms", value: invoice.deliveryTerms || "—" },
    { label: "Classification", value: invoice.classification || "—" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* Back */}
        <Link href="/invoices" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Invoices
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-xl font-bold text-gray-900">{invoice.supplier || "—"}</p>
            <span className={`inline-block mt-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${INVOICE_TYPE_COLORS[invoice.invoiceType] || "bg-gray-100 text-gray-700"}`}>
              {invoice.invoiceType}
            </span>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-0.5">Invoice #</p>
            <h1 className="text-xl font-bold text-gray-900">{invoice.invoiceNumber}</h1>
            <div className="flex items-center justify-end gap-2 mt-2">
              {/* Match Status pill */}
              <div className="relative">
                <select
                  value={invoice.matchStatus}
                  onChange={(e) => patchStatus({ matchStatus: e.target.value })}
                  className={`appearance-none cursor-pointer text-xs font-semibold pl-2.5 pr-6 py-1 rounded-full border-0 focus:ring-0 focus:outline-none ${
                    invoice.matchStatus === "Matched" ? "bg-sage-100 text-sage-700" :
                    invoice.matchStatus === "Discrepancy" ? "bg-warm-100 text-warm-700" :
                    "bg-gray-100 text-gray-600"
                  }`}
                >
                  <option value="Open">Open</option>
                  <option value="Matched">Matched</option>
                  <option value="Discrepancy">Discrepancy</option>
                </select>
                <svg className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-current opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {/* Payment Status pill */}
              <div className="relative">
                <select
                  value={invoice.paymentStatus}
                  onChange={(e) => patchStatus({ paymentStatus: e.target.value })}
                  className={`appearance-none cursor-pointer text-xs font-semibold pl-2.5 pr-6 py-1 rounded-full border-0 focus:ring-0 focus:outline-none ${paymentStatusColors[invoice.paymentStatus] || "bg-gray-100 text-gray-600"}`}
                >
                  {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <svg className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-current opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Details Card */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Details</p>
            <div className="flex items-center gap-2">
              {invoice.sourceDocumentId && (
                <button
                  onClick={viewOriginal}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  View Original
                </button>
              )}
              {!editing ? (
                <button
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  Edit
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={cancelEdit}
                    className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveEdits}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-gray-900 hover:bg-gray-800 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {!editing ? (
            /* Read mode */
            <div className="grid grid-cols-3 gap-x-6 gap-y-4">
              {detailFields.map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
                  <p className="text-sm font-medium text-gray-800">{value}</p>
                </div>
              ))}
              {invoice.notes && (
                <div className="col-span-3 pt-3 border-t border-gray-100">
                  <p className="text-[11px] text-gray-400 mb-0.5">Notes</p>
                  <p className="text-sm text-gray-800">{invoice.notes}</p>
                </div>
              )}
            </div>
          ) : (
            /* Edit mode */
            <div className="grid grid-cols-3 gap-x-6 gap-y-4">
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Invoice Number</label>
                <input type="text" value={draft.invoiceNumber} onChange={(e) => setDraft({ ...draft, invoiceNumber: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400" />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Invoice Date</label>
                <input type="date" value={draft.invoiceDate} onChange={(e) => setDraft({ ...draft, invoiceDate: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400" />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Due Date</label>
                <input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400" />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">PO Reference</label>
                <input type="text" value={draft.poReference} onChange={(e) => setDraft({ ...draft, poReference: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400" />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Payment Terms</label>
                <input type="text" value={draft.paymentTerms} onChange={(e) => setDraft({ ...draft, paymentTerms: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400" />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Sales Order</label>
                <input type="text" value={draft.salesOrder} onChange={(e) => setDraft({ ...draft, salesOrder: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400" />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Vendor</label>
                <select value={draft.supplierId} onChange={(e) => setDraft({ ...draft, supplierId: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400">
                  <option value="">—</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Invoice Type</label>
                <select value={draft.invoiceType} onChange={(e) => setDraft({ ...draft, invoiceType: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400">
                  {INVOICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Tracking Number</label>
                <input type="text" value={draft.trackingNumber} onChange={(e) => setDraft({ ...draft, trackingNumber: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400" />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Ship To</label>
                <input type="text" value={draft.shipTo} onChange={(e) => setDraft({ ...draft, shipTo: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400" />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Delivery Terms</label>
                <input type="text" value={draft.deliveryTerms} onChange={(e) => setDraft({ ...draft, deliveryTerms: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400" />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">Classification</label>
                <select value={draft.classification} onChange={(e) => setDraft({ ...draft, classification: e.target.value })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400">
                  {CLASSIFICATION_VALUES.map((v) => <option key={v} value={v}>{v || "—"}</option>)}
                </select>
              </div>
              <div className="col-span-3 pt-3 border-t border-gray-100">
                <label className="text-[11px] text-gray-400 block mb-1">Notes</label>
                <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400" />
              </div>
            </div>
          )}
        </div>

        {/* Linked Records Timeline */}
        {timelineNodes.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-4">Linked Records</p>
            <div className="flex items-center">
              {timelineNodes.map((node, i) => (
                <Fragment key={i}>
                  <TimelineNode {...node} />
                  {i < timelineNodes.length - 1 && (
                    <div className="flex-1 flex items-center gap-1 mx-1">
                      <div className="flex-1 h-px bg-gray-200" />
                      <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {/* Line Items */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">
              Line Items ({invoice.lines.length})
            </p>
          </div>
          {invoice.lines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Description</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">SKU</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Qty</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Unit Cost</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line, idx) => {
                    const ld = lineDrafts[idx];
                    const updateLine = (patch: Partial<LineDraft>) => {
                      const next = [...lineDrafts];
                      next[idx] = { ...next[idx], ...patch };
                      setLineDrafts(next);
                    };

                    return editing && ld ? (
                      <tr key={line.id} className="border-b border-gray-50 bg-gold-50/30">
                        <td className="px-4 py-2">
                          <input type="text" value={ld.description} onChange={(e) => updateLine({ description: e.target.value })}
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gold-400" />
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={ld.itemId || ""}
                            onChange={(e) => updateLine({ itemId: e.target.value || null })}
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gold-400"
                          >
                            <option value="">{line.skuName || "— Select SKU —"}</option>
                            {skuItems.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.standardSku}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <input type="number" value={ld.qtyBilled} onChange={(e) => updateLine({ qtyBilled: Number(e.target.value) })}
                            className="w-20 text-sm text-right border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gold-400" />
                        </td>
                        <td className="px-4 py-2">
                          <input type="number" step="0.01" value={ld.unitCost} onChange={(e) => updateLine({ unitCost: Number(e.target.value) })}
                            className="w-24 text-sm text-right border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gold-400" />
                        </td>
                        <td className="px-4 py-2">
                          <input type="number" step="0.01" value={ld.amount} onChange={(e) => updateLine({ amount: Number(e.target.value) })}
                            className="w-24 text-sm text-right border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gold-400" />
                        </td>
                      </tr>
                    ) : (
                      <tr key={line.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-gray-800">{line.description}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{line.skuName || "—"}</td>
                        <td className="px-4 py-3 text-right text-gray-800">{line.qtyBilled.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-gray-800">{formatCurrency(line.unitCost)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(line.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {invoice.subtotal > 0 && (
                    <tr className="border-t border-gray-100">
                      <td colSpan={4} className="px-4 py-2 text-right text-xs text-gray-400">Subtotal</td>
                      <td className="px-4 py-2 text-right text-sm text-gray-600">{formatCurrency(invoice.subtotal)}</td>
                    </tr>
                  )}
                  {invoice.freight > 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-2 text-right text-xs text-gray-400">Freight</td>
                      <td className="px-4 py-2 text-right text-sm text-gray-600">{formatCurrency(invoice.freight)}</td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={4} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{formatCurrency(invoice.invoiceAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="px-5 py-6 text-sm text-gray-400">No line items.</p>
          )}
        </div>

      </div>
    </div>
  );
}
