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
  status: string;
  notes: string;
  lines: InvoiceLine[];
}

const STATUSES = ["Pending Review", "Matched", "Discrepancy", "Paid"];
const statusColors: Record<string, string> = {
  "Pending Review": "bg-yellow-100 text-yellow-800",
  Matched: "bg-blue-100 text-blue-800",
  Discrepancy: "bg-red-100 text-red-800",
  Paid: "bg-green-100 text-green-800",
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

  const handleStatusChange = async (newStatus: string) => {
    if (!invoice) return;
    const prev = invoice.status;
    setInvoice({ ...invoice, status: newStatus });

    try {
      const res = await fetch(`/api/invoices/${invoice.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setInvoice({ ...invoice, status: prev });
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
            <select
              value={invoice.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className={`text-sm font-medium rounded-md px-3 py-1.5 border-0 ${
                statusColors[invoice.status] || "bg-gray-100 text-gray-800"
              }`}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

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
