"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

// --- ANS-specific types ---

interface ParsedLine {
  ansItemNumber: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  batchNumber: string | null;
  standardSku: string | null;
  airtableSkuId: string | null;
  skuMapped: boolean;
}

interface ParsedInvoice {
  invoiceNumber: string;
  invoiceDate: string;
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
  lines: ParsedLine[];
}

interface ParseResult {
  fileName: string;
  invoice: ParsedInvoice;
  unmappedItems: string[];
  isDuplicate: boolean;
}

// --- Universal (AI-extracted) types ---

interface ExtractedLine {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
}

interface ExtractedInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  vendor: string;
  poReference: string;
  subtotal: number;
  freight: number;
  tax: number;
  invoiceAmount: number;
  lines: ExtractedLine[];
}

interface ExtractResult {
  fileName: string;
  invoice: ExtractedInvoice;
  suggestedType: string;
  isDuplicate: boolean;
}

const INVOICE_TYPES = ["Supplier", "Freight", "Customs", "Packaging", "Work Order"];

function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function computeDueDate(invoiceDate: string, paymentTerms: string): string | null {
  if (!invoiceDate || !paymentTerms) return null;
  const netMatch = paymentTerms.match(/net\s*(\d+)/i);
  if (!netMatch) return null;
  const days = parseInt(netMatch[1], 10);
  const base = new Date(invoiceDate + "T00:00:00");
  base.setDate(base.getDate() + days);
  return base.toISOString().split("T")[0];
}

export default function InvoiceImportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"ans" | "universal">("ans");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // ANS mode state
  const [result, setResult] = useState<ParseResult | null>(null);

  // Universal mode state
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
  const [invoiceType, setInvoiceType] = useState<string>("Supplier");

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const resetAll = () => {
    setResult(null);
    setExtractResult(null);
    setError(null);
    setSubmitted(false);
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    setResult(null);
    setExtractResult(null);
    setSubmitted(false);

    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(URL.createObjectURL(file));

    try {
      const formData = new FormData();
      formData.append("file", file);

      const endpoint = mode === "ans" ? "/api/invoices/parse" : "/api/invoices/extract";
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Upload failed");
      }

      const data = await response.json();
      if (mode === "ans") {
        setResult(data);
      } else {
        setExtractResult(data);
        setInvoiceType(data.suggestedType || "Supplier");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Parsing timed out. This file may not be a supported invoice format.");
      } else {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  // ANS submit
  const handleSubmit = async () => {
    if (!result) return;
    setSubmitting(true);
    try {
      const dueDate = computeDueDate(result.invoice.invoiceDate, result.invoice.paymentTerms);
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...result.invoice, dueDate }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to create invoice");
      }
      setSubmitted(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error creating invoice");
    } finally {
      setSubmitting(false);
    }
  };

  // Universal submit
  const handleUniversalSubmit = async () => {
    if (!extractResult) return;
    setSubmitting(true);
    const inv = extractResult.invoice;
    try {
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          dueDate: inv.dueDate,
          vendor: inv.vendor,
          poReference: inv.poReference,
          subtotal: inv.subtotal,
          freight: inv.freight,
          tax: inv.tax,
          invoiceAmount: inv.invoiceAmount,
          invoiceType,
          lines: inv.lines.map((l, idx) => ({
            ansItemNumber: "",
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            amount: l.amount,
            batchNumber: null,
            airtableSkuId: null,
          })),
        }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to create invoice");
      }
      setSubmitted(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error creating invoice");
    } finally {
      setSubmitting(false);
    }
  };

  const inv = result?.invoice;
  const hasResult = result !== null || extractResult !== null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className={`mx-auto px-6 py-8 ${hasResult ? "max-w-[1800px]" : "max-w-6xl"}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Import Invoice</h1>
            <p className="text-sm text-gray-500 mt-1">
              {mode === "ans"
                ? "Upload an ANS invoice PDF to parse and save to Airtable"
                : "Upload any vendor invoice PDF — AI will extract the data"}
            </p>
          </div>
          {/* Mode toggle */}
          {!hasResult && (
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => { setMode("ans"); resetAll(); }}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === "ans" ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                ANS Supplier
              </button>
              <button
                onClick={() => { setMode("universal"); resetAll(); }}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === "universal" ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              >
                Other Invoice
              </button>
            </div>
          )}
        </div>

        {/* Upload Section */}
        {!hasResult && (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="bg-white rounded-lg border-2 border-dashed border-gray-300 p-12 text-center hover:border-gray-400 transition-colors"
          >
            {uploading ? (
              <div>
                <p className="text-gray-600 mb-2">
                  {mode === "ans" ? "Parsing invoice..." : "Extracting invoice with AI..."}
                </p>
                <p className="text-sm text-gray-400 mb-4">
                  {mode === "ans" ? "Extracting text from PDF" : "This may take a few seconds"}
                </p>
                <button
                  onClick={() => {
                    setUploading(false);
                    setError(null);
                    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }
                  }}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <svg
                  className="mx-auto h-12 w-12 text-gray-400 mb-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
                <p className="text-gray-600 mb-2">
                  {mode === "ans"
                    ? "Drag and drop your ANS invoice PDF here, or"
                    : "Drag and drop any vendor invoice PDF here, or"}
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
                >
                  Choose File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
                <p className="text-xs text-gray-400 mt-3">Accepts .pdf files</p>
              </>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-burgundy-50 border border-burgundy-200 rounded-lg p-4 mb-6">
            <p className="text-burgundy-800 text-sm">{error}</p>
          </div>
        )}

        {/* Universal Results — split view */}
        {extractResult && (
          <div className="flex gap-6">
            <div className="flex-1 min-w-0 space-y-6">
              {extractResult.isDuplicate && (
                <div className="bg-warm-50 border border-warm-200 rounded-lg p-4">
                  <p className="text-warm-800 text-sm font-medium">
                    Invoice {extractResult.invoice.invoiceNumber} already exists in Airtable.
                  </p>
                </div>
              )}

              {/* Invoice Summary */}
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Invoice Summary</h2>
                  <button onClick={resetAll} className="text-sm text-gray-500 hover:text-gray-700">
                    Upload different file
                  </button>
                </div>

                {/* Type selector */}
                <div className="mb-4 pb-4 border-b border-gray-100">
                  <label className="text-xs text-gray-500 block mb-1.5">Invoice Type</label>
                  <div className="flex gap-2 flex-wrap">
                    {INVOICE_TYPES.map((t) => (
                      <button
                        key={t}
                        onClick={() => setInvoiceType(t)}
                        className={`px-3 py-1 text-sm rounded-md border transition-colors ${
                          invoiceType === t
                            ? "bg-gray-900 text-white border-gray-900"
                            : "border-gray-300 text-gray-600 hover:border-gray-400"
                        }`}
                      >
                        {t}
                        {t === extractResult.suggestedType && invoiceType !== t && (
                          <span className="ml-1 text-[10px] text-gray-400">AI</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Vendor</p>
                    <p className="font-medium text-gray-900">{extractResult.invoice.vendor || "—"}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Invoice Number</p>
                    <p className="font-medium text-gray-900">{extractResult.invoice.invoiceNumber || "—"}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Invoice Date</p>
                    <p className="font-medium text-gray-900">{formatDate(extractResult.invoice.invoiceDate)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Due Date</p>
                    <p className="font-medium text-gray-900">
                      {extractResult.invoice.dueDate ? formatDate(extractResult.invoice.dueDate) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">PO Reference</p>
                    <p className="font-medium text-gray-900">{extractResult.invoice.poReference || "—"}</p>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Subtotal</p>
                    <p className="font-medium text-gray-900">{formatCurrency(extractResult.invoice.subtotal)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Freight</p>
                    <p className="font-medium text-gray-900">{formatCurrency(extractResult.invoice.freight)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Tax</p>
                    <p className="font-medium text-gray-900">{formatCurrency(extractResult.invoice.tax)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Invoice Total</p>
                    <p className="font-semibold text-gray-900 text-base">{formatCurrency(extractResult.invoice.invoiceAmount)}</p>
                  </div>
                </div>
              </div>

              {/* Line Items */}
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Line Items ({extractResult.invoice.lines.length})
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Qty</th>
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Unit</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Unit Price</th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extractResult.invoice.lines.map((line, idx) => (
                        <tr key={idx} className="border-b border-gray-100">
                          <td className="px-3 py-2.5 text-gray-900">{line.description}</td>
                          <td className="px-3 py-2.5 text-right text-gray-900">{line.quantity.toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">{line.unit}</td>
                          <td className="px-3 py-2.5 text-right text-gray-900">{formatCurrency(line.unitPrice)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-900">{formatCurrency(line.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td colSpan={4} className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Total</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{formatCurrency(extractResult.invoice.invoiceAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="mt-6 flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    Invoice + {extractResult.invoice.lines.length} line item(s) will be created in Airtable
                  </p>
                  {submitted ? (
                    <div className="flex items-center gap-3">
                      <span className="text-sage-600 text-sm font-medium">Invoice created successfully</span>
                      <button
                        onClick={() => router.push("/invoices")}
                        className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
                      >
                        View Invoices
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={resetAll}
                        className="border border-gray-300 text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50"
                      >
                        Discard
                      </button>
                      <button
                        onClick={handleUniversalSubmit}
                        disabled={submitting || extractResult.isDuplicate}
                        className="bg-gray-900 text-white px-6 py-2 text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
                      >
                        {submitting ? "Creating..." : "Create Invoice in Airtable"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* PDF Preview */}
            {pdfUrl && (
              <div className="w-[500px] flex-shrink-0 sticky top-6 self-start">
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" style={{ height: "calc(100vh - 120px)" }}>
                  <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Original PDF</p>
                  </div>
                  <iframe src={pdfUrl} className="w-full" style={{ height: "calc(100% - 41px)" }} title="Invoice PDF preview" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ANS Results — split view */}
        {result && inv && (
          <div className="flex gap-6">
            {/* Left: Parsed Data */}
            <div className="flex-1 min-w-0 space-y-6">
            {/* Duplicate Warning */}
            {result.isDuplicate && (
              <div className="bg-warm-50 border border-warm-200 rounded-lg p-4">
                <p className="text-warm-800 text-sm font-medium">
                  Invoice {inv.invoiceNumber} already exists in Airtable. Submitting will create a duplicate.
                </p>
              </div>
            )}

            {/* Invoice Summary */}
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Invoice Summary</h2>
                <button
                  onClick={resetAll}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Upload different file
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Invoice Number</p>
                  <p className="font-medium text-gray-900">{inv.invoiceNumber || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Invoice Date</p>
                  <p className="font-medium text-gray-900">{formatDate(inv.invoiceDate)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Due Date</p>
                  <p className="font-medium text-gray-900">
                    {(() => {
                      const due = computeDueDate(inv.invoiceDate, inv.paymentTerms);
                      return due ? formatDate(due) : "—";
                    })()}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Sales Order</p>
                  <p className="font-medium text-gray-900">{inv.salesOrder || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">PO Reference</p>
                  <p className="font-medium text-gray-900">{inv.poReference || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Payment Terms</p>
                  <p className="font-medium text-gray-900">{inv.paymentTerms || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Tracking Number</p>
                  <p className="font-medium text-gray-900 text-xs">{inv.trackingNumber || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Delivery Terms</p>
                  <p className="font-medium text-gray-900">{inv.deliveryTerms || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Ship To</p>
                  <p className="font-medium text-gray-900">{inv.shipTo || "—"}</p>
                </div>
              </div>

              {/* Totals */}
              <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Subtotal</p>
                  <p className="font-medium text-gray-900">{formatCurrency(inv.subtotal)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Freight</p>
                  <p className="font-medium text-gray-900">{formatCurrency(inv.freight)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Tax</p>
                  <p className="font-medium text-gray-900">{formatCurrency(inv.tax)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Invoice Total</p>
                  <p className="font-semibold text-gray-900 text-base">{formatCurrency(inv.invoiceAmount)}</p>
                </div>
              </div>
            </div>

            {/* Unmapped Items Warning */}
            {result.unmappedItems.length > 0 && (
              <div className="bg-warm-50 border border-warm-200 rounded-lg p-4">
                <p className="text-warm-800 text-sm">
                  <span className="font-medium">{result.unmappedItems.length} unmapped ANS item number(s):</span>{" "}
                  {result.unmappedItems.join(", ")}. These lines will be created without a SKU link.
                  Add them to <code className="bg-warm-100 px-1 rounded text-xs">ans-sku-mapping.json</code> to
                  link them.
                </p>
              </div>
            )}

            {/* Line Items Table */}
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Line Items ({inv.lines.length})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        ANS Item #
                      </th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Description
                      </th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Mapped SKU
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
                    {inv.lines.map((line, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="px-3 py-2.5">
                          {line.skuMapped ? (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-sage-100 text-sage-800">
                              Ready
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-burgundy-100 text-burgundy-800">
                              Unmapped
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-gray-900 text-xs">
                          {line.ansItemNumber}
                        </td>
                        <td className="px-3 py-2.5 text-gray-900">
                          {line.description}
                        </td>
                        <td className="px-3 py-2.5">
                          {line.standardSku ? (
                            <span className="text-gray-900 text-xs">{line.standardSku}</span>
                          ) : (
                            <span className="text-burgundy-500 font-medium text-xs">Unmapped</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-900">
                          {line.quantity.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-900">
                          {formatCurrency(line.unitPrice)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-900">
                          {formatCurrency(line.amount)}
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs">
                          {line.batchNumber || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td colSpan={6} className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">
                        Total
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-gray-900">
                        {formatCurrency(inv.invoiceAmount)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  Invoice + {inv.lines.length} line item(s) will be created in Airtable
                </p>
                {submitted ? (
                  <div className="flex items-center gap-3">
                    <span className="text-sage-600 text-sm font-medium">
                      Invoice created successfully
                    </span>
                    <button
                      onClick={() => router.push("/invoices")}
                      className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
                    >
                      View Invoices
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={resetAll}
                      className="border border-gray-300 text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50"
                    >
                      Discard
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || result.isDuplicate}
                      className="bg-gray-900 text-white px-6 py-2 text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
                      title={result.isDuplicate ? "Invoice already exists in Airtable" : ""}
                    >
                      {submitting ? "Creating..." : "Create Invoice in Airtable"}
                    </button>
                  </div>
                )}
              </div>
            </div>
            </div>

            {/* Right: PDF Preview */}
            {pdfUrl && (
              <div className="w-[500px] flex-shrink-0 sticky top-6 self-start">
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden" style={{ height: "calc(100vh - 120px)" }}>
                  <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Original PDF</p>
                  </div>
                  <iframe
                    src={pdfUrl}
                    className="w-full"
                    style={{ height: "calc(100% - 41px)" }}
                    title="Invoice PDF preview"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
