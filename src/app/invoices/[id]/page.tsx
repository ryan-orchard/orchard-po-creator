"use client";

import { useEffect, useState, Fragment } from "react";
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
  supplier: string;
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
  linkedShipment: { id: string; shipmentNumber: string } | null;
  linkedWorkOrder: { id: string; woNumber: string } | null;
  lines: InvoiceLine[];
  purchaseOrder: { id: string; poNumber: string; status: string } | null;
  receipts: { id: string; receiptNumber: string; receivedDate: string; lines: { sku: string; qtyReceived: number }[] }[];
  shipments: { id: string; shipmentNumber: string; shipDate: string; status: string }[];
}

// --- Constants ---

const INVOICE_TYPE_COLORS: Record<string, string> = {
  Supplier: "bg-gray-100 text-gray-700",
  Packaging: "bg-warm-100 text-warm-800",
  Freight: "bg-blue-100 text-blue-800",
  Customs: "bg-orange-100 text-orange-800",
  "Work Order": "bg-gold-100 text-gold-800",
};

const PAYMENT_STATUSES = ["Unpaid", "Paid", "Disputed"];
const CLASSIFICATION_VALUES = ["Capitalized", "Expensed"];

const paymentStatusColors: Record<string, string> = {
  Unpaid: "bg-gray-100 text-gray-700",
  Paid: "bg-gold-100 text-gold-800",
  Disputed: "bg-burgundy-100 text-burgundy-800",
};

const classificationColors: Record<string, string> = {
  Capitalized: "bg-sage-100 text-sage-800",
  Expensed: "bg-gray-100 text-gray-700",
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

// --- Validation State ---

interface CheckRow {
  ok: boolean;
  flag: boolean;
  label: string;
}

interface ValidationState {
  priceCheck: CheckRow;
  linkedCheck: CheckRow;
  cta: { label: string; href: string } | null;
  showMarkReviewed: boolean;
}

function getValidationState(invoice: InvoiceDetail): ValidationState {
  const matchHref = `/match?invoiceId=${invoice.id}`;
  const { invoiceType, matchStatus, purchaseOrder, receipts, linkedShipment, linkedWorkOrder } = invoice;

  if (invoiceType === "Supplier" || invoiceType === "Packaging") {
    const hasPO = !!purchaseOrder;
    const priceOk = hasPO && matchStatus === "Matched";
    const priceFlag = hasPO && matchStatus === "Discrepancy";
    const linkedOk = receipts.length > 0;
    let cta: { label: string; href: string } | null = null;
    if (!hasPO) cta = { label: "Link to PO →", href: matchHref };
    else if (priceFlag) cta = { label: "Resolve Discrepancy →", href: matchHref };
    else if (!linkedOk) cta = { label: "Link to Receipt →", href: matchHref };
    return {
      priceCheck: {
        ok: priceOk,
        flag: priceFlag,
        label: priceOk
          ? `Matches ${purchaseOrder!.poNumber}`
          : priceFlag
          ? "Price discrepancy found"
          : hasPO
          ? "Pending validation"
          : "No PO linked",
      },
      linkedCheck: {
        ok: linkedOk,
        flag: false,
        label: linkedOk
          ? `${receipts.length} receipt${receipts.length > 1 ? "s" : ""} linked`
          : "No receipt linked",
      },
      cta,
      showMarkReviewed: false,
    };
  }

  if (invoiceType === "Freight" || invoiceType === "Customs") {
    const hasShipment = !!linkedShipment;
    const isReviewed = matchStatus === "Matched";
    return {
      priceCheck: { ok: isReviewed, flag: false, label: isReviewed ? "Reviewed & approved" : "Awaiting user review" },
      linkedCheck: { ok: hasShipment, flag: false, label: hasShipment ? linkedShipment!.shipmentNumber : "No shipment linked" },
      cta: !hasShipment
        ? { label: "Link to Shipment →", href: matchHref }
        : !isReviewed
        ? { label: "Review & Approve →", href: matchHref }
        : null,
      showMarkReviewed: hasShipment && !isReviewed,
    };
  }

  if (invoiceType === "Work Order") {
    const hasWO = !!linkedWorkOrder;
    const isReviewed = matchStatus === "Matched";
    return {
      priceCheck: { ok: isReviewed, flag: false, label: isReviewed ? "Reviewed & approved" : "Awaiting user review" },
      linkedCheck: { ok: hasWO, flag: false, label: hasWO ? linkedWorkOrder!.woNumber : "No work order linked" },
      cta: !hasWO
        ? { label: "Link to Work Order →", href: matchHref }
        : !isReviewed
        ? { label: "Review & Approve →", href: matchHref }
        : null,
      showMarkReviewed: hasWO && !isReviewed,
    };
  }

  return {
    priceCheck: { ok: false, flag: false, label: "N/A" },
    linkedCheck: { ok: false, flag: false, label: "N/A" },
    cta: null,
    showMarkReviewed: false,
  };
}

// --- Check Icon ---

function CheckIcon({ ok, flag }: { ok: boolean; flag?: boolean }) {
  if (flag) {
    return (
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-warm-100 shrink-0">
        <svg className="w-3.5 h-3.5 text-warm-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    );
  }
  if (ok) {
    return (
      <span className="flex items-center justify-center w-7 h-7 rounded-full bg-sage-100 shrink-0">
        <svg className="w-3.5 h-3.5 text-sage-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 shrink-0">
      <span className="w-2.5 h-0.5 bg-gray-300 rounded-full block" />
    </span>
  );
}

// --- Comparison Rows ---

interface ComparisonRow {
  label: string;
  invoiceVal: string;
  refVal: string;
  ok: boolean;
  flag: boolean;
  varLabel?: string;
}

function getComparisonRows(invoice: InvoiceDetail): ComparisonRow[] {
  const { invoiceType, matchStatus, purchaseOrder, receipts, linkedShipment, linkedWorkOrder, lines, invoiceAmount } = invoice;
  const totalInvoiceQty = lines.reduce((s, l) => s + l.qtyBilled, 0);
  const receipt = receipts[0] ?? null;
  const totalReceiptQty = receipt ? receipt.lines.reduce((s, l) => s + l.qtyReceived, 0) : null;
  const qtyDelta = totalReceiptQty !== null ? totalInvoiceQty - totalReceiptQty : null;

  if (invoiceType === "Supplier" || invoiceType === "Packaging") {
    const hasPO = !!purchaseOrder;
    const priceOk = hasPO && matchStatus === "Matched";
    const priceFlag = hasPO && matchStatus === "Discrepancy";
    const qtyOk = totalReceiptQty !== null && totalInvoiceQty === totalReceiptQty;
    const qtyFlag = totalReceiptQty !== null && totalInvoiceQty !== totalReceiptQty;
    return [
      {
        label: "Price",
        invoiceVal: formatCurrency(invoiceAmount),
        refVal: hasPO ? purchaseOrder!.poNumber : "No PO linked",
        ok: priceOk,
        flag: priceFlag,
        varLabel: priceFlag ? "Discrepancy" : undefined,
      },
      {
        label: "QTY",
        invoiceVal: `${totalInvoiceQty.toLocaleString()} units`,
        refVal: totalReceiptQty !== null ? `${totalReceiptQty.toLocaleString()} received` : "No receipt",
        ok: qtyOk,
        flag: qtyFlag,
        varLabel: qtyDelta !== null && qtyDelta !== 0
          ? (qtyDelta > 0 ? `+${qtyDelta.toLocaleString()}` : `${qtyDelta.toLocaleString()}`)
          : undefined,
      },
    ];
  }

  if (invoiceType === "Freight" || invoiceType === "Customs") {
    const hasShipment = !!linkedShipment;
    const isReviewed = matchStatus === "Matched";
    return [
      {
        label: "Price",
        invoiceVal: formatCurrency(invoiceAmount),
        refVal: isReviewed ? "Reviewed" : "Awaiting review",
        ok: isReviewed,
        flag: false,
      },
      {
        label: "Linked",
        invoiceVal: invoiceType,
        refVal: hasShipment ? linkedShipment!.shipmentNumber : "Not linked",
        ok: hasShipment,
        flag: false,
      },
    ];
  }

  if (invoiceType === "Work Order") {
    const hasWO = !!linkedWorkOrder;
    const isReviewed = matchStatus === "Matched";
    return [
      {
        label: "Price",
        invoiceVal: formatCurrency(invoiceAmount),
        refVal: isReviewed ? "Reviewed" : "Awaiting review",
        ok: isReviewed,
        flag: false,
      },
      {
        label: "Linked",
        invoiceVal: "Work Order",
        refVal: hasWO ? linkedWorkOrder!.woNumber : "Not linked",
        ok: hasWO,
        flag: false,
      },
    ];
  }

  return [];
}

// --- Timeline Node ---

type NodeIcon = "invoice" | "po" | "shipment" | "receipt" | "wo";

interface TimelineNodeProps {
  icon: NodeIcon;
  label: string;
  sub: string;
  href: string | null;
  empty: boolean;
}

const NODE_ICON_COLORS: Record<NodeIcon, string> = {
  invoice: "bg-gray-800 text-white",
  po: "bg-gold-100 text-gold-700",
  shipment: "bg-blue-100 text-blue-700",
  receipt: "bg-sage-100 text-sage-700",
  wo: "bg-gold-100 text-gold-700",
};

function NodeSvg({ icon }: { icon: NodeIcon }) {
  if (icon === "invoice") {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    );
  }
  if (icon === "po") {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
      </svg>
    );
  }
  if (icon === "shipment") {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
      </svg>
    );
  }
  if (icon === "receipt") {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185z" />
      </svg>
    );
  }
  // wo
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
    </svg>
  );
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

  if (href && !empty) {
    return <Link href={href}>{inner}</Link>;
  }
  return <>{inner}</>;
}

// --- Main Page ---

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInvoice = async () => {
      try {
        const res = await fetch(`/api/invoices/${params.id}`);
        if (!res.ok) throw new Error("Not found");
        setInvoice(await res.json());
      } catch {
        router.push("/invoices");
      } finally {
        setLoading(false);
      }
    };
    fetchInvoice();
  }, [params.id, router]);

  const patchStatus = async (body: Record<string, string>, optimistic: Partial<InvoiceDetail>) => {
    if (!invoice) return;
    const prev = { ...invoice };
    setInvoice({ ...invoice, ...optimistic });
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
    } catch {
      setInvoice(prev);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading invoice...</p>
      </div>
    );
  }

  if (!invoice) return null;

  const validation = getValidationState(invoice);
  const comparisonRows = getComparisonRows(invoice);

  // Build timeline — always starts with Invoice Received
  const timelineNodes: TimelineNodeProps[] = [
    {
      icon: "invoice",
      label: "Invoice Received",
      sub: formatDate(invoice.invoiceDate),
      href: null,
      empty: false,
    },
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
    const totalReceiptCartons = invoice.receipts.reduce(
      (sum, r) => sum + r.lines.reduce((s, l) => s + l.qtyReceived, 0), 0
    );
    timelineNodes.push({
      icon: "receipt",
      label: receiptCount > 0
        ? `${receiptCount} receipt${receiptCount > 1 ? "s" : ""}`
        : "Receipt Match",
      sub: receiptCount > 0
        ? `${totalReceiptCartons.toLocaleString()} cartons received`
        : "Not linked",
      href: receiptCount > 0 ? `/match?invoiceId=${invoice.id}` : null,
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

  const details = [
    { key: "Invoice Amount", val: formatCurrency(invoice.invoiceAmount) },
    { key: "Invoice Date", val: formatDate(invoice.invoiceDate) },
    { key: "PO Reference", val: invoice.poReference || "—" },
    { key: "Payment Terms", val: invoice.paymentTerms || "—" },
    { key: "Ship To", val: invoice.shipTo || "—" },
    { key: "Delivery Terms", val: invoice.deliveryTerms || "—" },
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
            {invoice.invoiceType && (
              <span className={`inline-block mt-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${INVOICE_TYPE_COLORS[invoice.invoiceType] || "bg-gray-100 text-gray-700"}`}>
                {invoice.invoiceType}
              </span>
            )}
          </div>
          <div className="text-right">
            <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-0.5">Invoice #</p>
            <h1 className="text-xl font-bold text-gray-900">{invoice.invoiceNumber}</h1>
            {invoice.paymentStatus && (
              <span className={`inline-block mt-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${paymentStatusColors[invoice.paymentStatus] || "bg-gray-100 text-gray-700"}`}>
                {invoice.paymentStatus}
              </span>
            )}
          </div>
        </div>

        {/* Validation + Details */}
        <div className="grid grid-cols-5 gap-4 mb-4">

          {/* Validation */}
          <div className="col-span-3 bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-4">Validation</p>
            <table className="w-full mb-4">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-16">Check</th>
                  <th className="text-right pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Invoice</th>
                  <th className="text-right pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Reference</th>
                  <th className="w-24 pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {comparisonRows.map(row => (
                  <tr key={row.label}>
                    <td className="py-3 text-xs font-semibold text-gray-700">{row.label}</td>
                    <td className="py-3 text-right text-xs text-gray-600">{row.invoiceVal}</td>
                    <td className={`py-3 text-right text-xs font-medium ${row.ok ? "text-sage-600" : row.flag ? "text-warm-600" : "text-gray-400"}`}>
                      {row.refVal}
                    </td>
                    <td className="py-3 pl-3">
                      <div className="flex items-center justify-end gap-2">
                        {(row.flag || (!row.ok && row.varLabel)) && row.varLabel && (
                          <span className={`text-xs font-semibold ${row.flag ? "text-warm-600" : "text-gray-400"}`}>{row.varLabel}</span>
                        )}
                        <CheckIcon ok={row.ok} flag={row.flag} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {(validation.cta || validation.showMarkReviewed) && (
              <div className="border-t border-gray-100 pt-4 space-y-3">
                {validation.cta && (
                  <div>
                    <Link
                      href={validation.cta.href}
                      className="inline-flex items-center gap-1.5 bg-gold-500 hover:bg-gold-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                    >
                      {validation.cta.label}
                    </Link>
                  </div>
                )}
                {validation.showMarkReviewed && (
                  <button
                    onClick={() => patchStatus({ matchStatus: "Matched" }, { matchStatus: "Matched" })}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Mark as reviewed
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="col-span-2 bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-4">Details</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              {details.map(({ key, val }) => (
                <div key={key}>
                  <p className="text-[11px] text-gray-400 mb-0.5">{key}</p>
                  <p className="text-sm font-medium text-gray-800">{val}</p>
                </div>
              ))}
            </div>
          </div>
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
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">ANS Item #</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Description</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider">SKU</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Qty</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Unit Cost</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line) => (
                    <tr key={line.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-xs text-gray-500 font-mono">{line.ansItemNumber || "—"}</td>
                      <td className="px-4 py-3 text-gray-800">{line.description}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{line.skuName || "—"}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{line.qtyBilled.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-800">{formatCurrency(line.unitCost)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {invoice.subtotal > 0 && (
                    <tr className="border-t border-gray-100">
                      <td colSpan={5} className="px-4 py-2 text-right text-xs text-gray-400">Subtotal</td>
                      <td className="px-4 py-2 text-right text-sm text-gray-600">{formatCurrency(invoice.subtotal)}</td>
                    </tr>
                  )}
                  {invoice.freight > 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-2 text-right text-xs text-gray-400">Freight</td>
                      <td className="px-4 py-2 text-right text-sm text-gray-600">{formatCurrency(invoice.freight)}</td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={5} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{formatCurrency(invoice.invoiceAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="px-5 py-6 text-sm text-gray-400">No line items.</p>
          )}
        </div>

        {/* Accounting */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mt-4">
          <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-4">Accounting</p>
          <div className="flex gap-10">
            <div>
              <p className="text-[11px] text-gray-400 mb-1">Payment Status</p>
              <select
                value={invoice.paymentStatus}
                onChange={(e) => patchStatus({ paymentStatus: e.target.value }, { paymentStatus: e.target.value })}
                className="text-sm font-semibold text-gray-800 bg-transparent border-0 cursor-pointer p-0 pr-6 focus:outline-none focus:ring-0 appearance-none"
              >
                {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[11px] text-gray-400 mb-1">Classification</p>
              <select
                value={invoice.classification}
                onChange={(e) => patchStatus({ classification: e.target.value }, { classification: e.target.value })}
                className="text-sm font-semibold text-gray-800 bg-transparent border-0 cursor-pointer p-0 pr-6 focus:outline-none focus:ring-0 appearance-none"
              >
                <option value="">—</option>
                {CLASSIFICATION_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
