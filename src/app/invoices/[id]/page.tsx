"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

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

interface ReceiptLine {
  sku: string;
  qtyReceived: number;
}

interface Receipt {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  lines: ReceiptLine[];
}

interface Shipment {
  id: string;
  shipmentNumber: string;
  shipDate: string;
  status: string;
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
  reviewStatus: string;
  paymentStatus: string;
  notes: string;
  lines: InvoiceLine[];
  purchaseOrder: { id: string; poNumber: string; status: string } | null;
  receipts: Receipt[];
  shipments: Shipment[];
}

const REVIEW_STATUSES = ["Pending", "Matched", "Discrepancy"];
const PAYMENT_STATUSES = ["Unpaid", "Paid", "Disputed"];

const reviewStatusColors: Record<string, string> = {
  Pending: "bg-warm-100 text-warm-800",
  Matched: "bg-sage-100 text-sage-800",
  Discrepancy: "bg-burgundy-100 text-burgundy-800",
};

const paymentStatusColors: Record<string, string> = {
  Unpaid: "bg-gray-100 text-gray-700",
  Paid: "bg-gold-100 text-gold-800",
  Disputed: "bg-burgundy-100 text-burgundy-800",
};

function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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
        const data = await res.json();
        setInvoice(data);
      } catch {
        router.push("/invoices");
      } finally {
        setLoading(false);
      }
    };
    fetchInvoice();
  }, [params.id, router]);

  const handleReviewStatusChange = async (newStatus: string) => {
    if (!invoice) return;
    const prev = invoice.reviewStatus;
    setInvoice({ ...invoice, reviewStatus: newStatus });

    try {
      const res = await fetch(`/api/invoices/${invoice.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus: newStatus }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setInvoice({ ...invoice, reviewStatus: prev });
    }
  };

  const handlePaymentStatusChange = async (newStatus: string) => {
    if (!invoice) return;
    const prev = invoice.paymentStatus;
    setInvoice({ ...invoice, paymentStatus: newStatus });

    try {
      const res = await fetch(`/api/invoices/${invoice.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentStatus: newStatus }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setInvoice({ ...invoice, paymentStatus: prev });
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

  const isMatched = !!invoice.purchaseOrder;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link
              href="/invoices"
              className="text-gray-400 hover:text-gray-600"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5L8.25 12l7.5-7.5"
                />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Invoice {invoice.invoiceNumber}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {invoice.supplier} &middot; {formatDate(invoice.invoiceDate)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Review status dropdown */}
            <select
              value={invoice.reviewStatus}
              onChange={(e) => handleReviewStatusChange(e.target.value)}
              className={`text-sm font-medium rounded-md px-3 py-1.5 border-0 ${
                reviewStatusColors[invoice.reviewStatus] || "bg-gray-100 text-gray-800"
              }`}
            >
              {REVIEW_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {/* Payment status dropdown */}
            <select
              value={invoice.paymentStatus}
              onChange={(e) => handlePaymentStatusChange(e.target.value)}
              className={`text-sm font-medium rounded-md px-3 py-1.5 border-0 ${
                paymentStatusColors[invoice.paymentStatus] || "bg-gray-100 text-gray-800"
              }`}
            >
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {/* Match button for unmatched invoices */}
            {!isMatched && (
              <Link
                href={`/invoices/matching?invoice=${invoice.id}`}
                className="bg-gold-500 text-white px-4 py-1.5 text-sm rounded-md hover:bg-gold-600 font-medium"
              >
                Match to PO
              </Link>
            )}
          </div>
        </div>

        {/* Matched PO Banner */}
        {isMatched && invoice.purchaseOrder && (
          <div className="bg-sage-50 border border-sage-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-sage-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-sage-800">
                  Matched to{" "}
                  <Link href={`/pos/${invoice.purchaseOrder.id}`} className="underline hover:text-sage-800">
                    {invoice.purchaseOrder.poNumber}
                  </Link>
                </p>
                <p className="text-xs text-sage-600 mt-0.5">
                  PO Status: {invoice.purchaseOrder.status}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Receipt & Shipment Info (when matched) */}
        {isMatched && (invoice.receipts.length > 0 || invoice.shipments.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Receipts */}
            {invoice.receipts.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Receipts
                </h3>
                <div className="space-y-3">
                  {invoice.receipts.map((receipt) => (
                    <div key={receipt.id}>
                      <div className="flex items-center justify-between mb-1">
                        <Link
                          href={`/receipts/${receipt.id}`}
                          className="text-sm font-medium text-gray-900 hover:underline"
                        >
                          {receipt.receiptNumber || "Receipt"}
                        </Link>
                        <span className="text-xs text-gray-500">
                          {formatDate(receipt.receivedDate)}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {receipt.lines.map((line, i) => (
                          <div key={i} className="flex items-center justify-between text-xs text-gray-600">
                            <span className="font-mono">{line.sku}</span>
                            <span className="font-mono">{line.qtyReceived.toLocaleString()} received</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Shipments */}
            {invoice.shipments.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Shipments
                </h3>
                <div className="space-y-2">
                  {invoice.shipments.map((shipment) => (
                    <div key={shipment.id} className="flex items-center justify-between">
                      <Link
                        href={`/shipments/${shipment.id}`}
                        className="text-sm font-medium text-gray-900 hover:underline"
                      >
                        {shipment.shipmentNumber || "Shipment"}
                      </Link>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">
                          {formatDate(shipment.shipDate)}
                        </span>
                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-600">
                          {shipment.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Info Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">PO Reference</p>
            <p className="text-sm font-medium text-gray-900 font-mono">
              {invoice.poReference || "—"}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Sales Order</p>
            <p className="text-sm font-medium text-gray-900 font-mono">
              {invoice.salesOrder || "—"}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Payment Terms</p>
            <p className="text-sm font-medium text-gray-900">
              {invoice.paymentTerms || "—"}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Ship To</p>
            <p className="text-sm font-medium text-gray-900">
              {invoice.shipTo || "—"}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Tracking Number</p>
            <p className="text-sm font-medium text-gray-900 font-mono text-xs">
              {invoice.trackingNumber || "—"}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Delivery Terms</p>
            <p className="text-sm font-medium text-gray-900">
              {invoice.deliveryTerms || "—"}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Subtotal</p>
            <p className="text-sm font-medium text-gray-900">
              {formatCurrency(invoice.subtotal)}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Freight</p>
            <p className="text-sm font-medium text-gray-900">
              {formatCurrency(invoice.freight)}
            </p>
          </div>
        </div>

        {/* Invoice Total */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Invoice Total</span>
            <span className="text-xl font-semibold text-gray-900">
              {formatCurrency(invoice.invoiceAmount)}
            </span>
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Line Items ({invoice.lines.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    ANS Item #
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Qty
                  </th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Unit Price
                  </th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Batch #
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line) => (
                  <tr key={line.id} className="border-b border-gray-100">
                    <td className="px-3 py-2.5 font-mono text-gray-900 text-xs">
                      {line.ansItemNumber}
                    </td>
                    <td className="px-3 py-2.5 text-gray-900">
                      {line.description}
                    </td>
                    <td className="px-3 py-2.5">
                      {line.skuName ? (
                        <span className="font-mono text-gray-900 text-xs">
                          {line.skuName}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-900">
                      {line.qtyBilled.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-900">
                      {formatCurrency(line.unitCost)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-900">
                      {formatCurrency(line.amount)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-gray-500 text-xs">
                      {line.batchNumber || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td
                    colSpan={5}
                    className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase"
                  >
                    Total
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-gray-900">
                    {formatCurrency(invoice.invoiceAmount)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
