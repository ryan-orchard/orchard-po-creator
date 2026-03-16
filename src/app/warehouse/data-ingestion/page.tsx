"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface ReceiptLine {
  stordSku: string;
  productName: string;
  qtyReceived: number;
  qtyExpected: number | null;
  lotNumber: string | null;
  standardSku: string | null;
  airtableSkuId: string | null;
  uom: string | null;
  skuMapped: boolean;
}

interface ParsedReceipt {
  orderNumber: string;
  receivedDate: string;
  facility: string;
  lines: ReceiptLine[];
  matchedPO: { id: string; poNumber: string } | null;
  poMatchAttempted: boolean;
}

interface ClassificationSummary {
  receiptConfirmation: number;
  inboundInventory: number;
  customerReturns: number;
  workOrders: number;
  outboundShipments: number;
  outboundAllocations: number;
  other: number;
  total: number;
}

interface IngestResult {
  fileName: string;
  totalRows: number;
  dateRange: { from: string | null; to: string | null };
  classification: ClassificationSummary;
  receipts: ParsedReceipt[];
  availablePOs: {
    id: string;
    poNumber: string;
    lineItems: { skuId: string; qtySticks: number; qtyCartons: number | null }[];
  }[];
}

export default function DataIngestionPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Local state for PO overrides (receipt index -> PO id)
  const [poOverrides, setPOOverrides] = useState<Record<number, string>>({});

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    setResult(null);
    setSubmitted(false);
    setPOOverrides({});

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/warehouse/ingest", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Upload failed");
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const handleSubmit = async () => {
    if (!result || result.receipts.length === 0) return;
    setSubmitting(true);

    try {
      let created = 0;
      for (let i = 0; i < result.receipts.length; i++) {
        const receipt = result.receipts[i];
        const poId = poOverrides[i] || receipt.matchedPO?.id || null;

        const body = {
          receivedDate: receipt.receivedDate,
          purchaseOrderId: poId,
          facilityCode: receipt.facility === "RNOs003" ? "STORD" : receipt.facility,
          externalReceiptId: receipt.orderNumber,
          lineItems: receipt.lines.map((line) => ({
            skuId: line.airtableSkuId || undefined,
            qtyReceived: line.qtyReceived,
            qtyExpected: line.qtyExpected || undefined,
            threePlSku: line.stordSku,
            lotNumber: line.lotNumber || undefined,
          })),
        };

        const response = await fetch("/api/receipts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (response.ok) created++;
      }

      setSubmitted(true);
      alert(`Created ${created} receipt(s) in Airtable.`);
    } catch {
      alert("Error creating receipts. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const getReceiptStatus = (receipt: ParsedReceipt, index: number) => {
    const hasUnmapped = receipt.lines.some((l) => !l.skuMapped);
    const hasPO = poOverrides[index] || receipt.matchedPO;
    if (hasUnmapped) return "unmapped";
    if (!hasPO) return "needs-po";
    // Check if all mapped SKUs exist on the selected PO
    const poId = (poOverrides[index] || receipt.matchedPO?.id) as string;
    if (poId && result) {
      const po = result.availablePOs.find((p) => p.id === poId);
      if (po) {
        const hasMismatch = receipt.lines.some(
          (l) => l.airtableSkuId && !po.lineItems.some((li) => li.skuId === l.airtableSkuId)
        );
        if (hasMismatch) return "sku-mismatch";
      }
    }
    return "ready";
  };

  const statusConfig = {
    ready: { label: "Ready", color: "bg-green-100 text-green-800" },
    "sku-mismatch": { label: "SKU Mismatch", color: "bg-orange-100 text-orange-800" },
    "needs-po": { label: "No PO Match", color: "bg-yellow-100 text-yellow-800" },
    unmapped: { label: "Unmapped SKU", color: "bg-red-100 text-red-800" },
  };

  // Look up PO expected qty for a receipt line's SKU
  const getPOLineMatch = (receiptIdx: number, line: ReceiptLine) => {
    if (!result || !line.airtableSkuId) return null;
    const poId = poOverrides[receiptIdx] || result.receipts[receiptIdx].matchedPO?.id;
    if (!poId) return null;
    const po = result.availablePOs.find((p) => p.id === poId);
    if (!po) return null;
    const poLine = po.lineItems.find((li) => li.skuId === line.airtableSkuId);
    return poLine || null;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Data Ingestion</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload Stord Inventory Adjustments report to import receipt data
          </p>
        </div>

        {/* Upload Section */}
        {!result && (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="bg-white rounded-lg border-2 border-dashed border-gray-300 p-12 text-center hover:border-gray-400 transition-colors"
          >
            {uploading ? (
              <div>
                <p className="text-gray-600 mb-2">Parsing file...</p>
                <p className="text-sm text-gray-400">This may take a moment for large files</p>
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
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
                <p className="text-gray-600 mb-2">
                  Drag and drop your Stord XLSX file here, or
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
                  accept=".xlsx,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
                <p className="text-xs text-gray-400 mt-3">Accepts .xlsx and .csv files</p>
              </>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* File Summary */}
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">File Summary</h2>
                <button
                  onClick={() => {
                    setResult(null);
                    setError(null);
                    setSubmitted(false);
                    setPOOverrides({});
                  }}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Upload different file
                </button>
              </div>
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">File</p>
                  <p className="font-medium text-gray-900">{result.fileName}</p>
                </div>
                <div>
                  <p className="text-gray-500">Total Rows</p>
                  <p className="font-medium text-gray-900">{result.totalRows.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-500">Date Range</p>
                  <p className="font-medium text-gray-900">
                    {result.dateRange.from && result.dateRange.to
                      ? `${new Date(result.dateRange.from + "T00:00:00").toLocaleDateString("en-US")} — ${new Date(result.dateRange.to + "T00:00:00").toLocaleDateString("en-US")}`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Receipts Found</p>
                  <p className="font-medium text-gray-900">{result.receipts.length}</p>
                </div>
              </div>
            </div>

            {/* Classification Breakdown */}
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Data Classification</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <ClassificationCard
                  label="Receipts"
                  count={result.classification.receiptConfirmation}
                  active
                />
                <ClassificationCard
                  label="Inbound (ASN)"
                  count={result.classification.inboundInventory}
                  active
                />
                <ClassificationCard
                  label="Outbound Shipments"
                  count={result.classification.outboundShipments}
                />
                <ClassificationCard
                  label="Outbound Allocations"
                  count={result.classification.outboundAllocations}
                />
                <ClassificationCard
                  label="Work Orders"
                  count={result.classification.workOrders}
                />
                <ClassificationCard
                  label="Customer Returns"
                  count={result.classification.customerReturns}
                />
                <ClassificationCard
                  label="Other"
                  count={result.classification.other}
                />
              </div>
            </div>

            {/* Parsed Receipts */}
            {result.receipts.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Parsed Receipts ({result.receipts.length})
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Order #
                        </th>
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Date
                        </th>
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          3PL SKU
                        </th>
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Mapped SKU
                        </th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Qty Received
                        </th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          PO Qty
                        </th>
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[160px]">
                          Purchase Order
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.receipts.map((receipt, idx) => {
                        const status = getReceiptStatus(receipt, idx);
                        const config = statusConfig[status];
                        const selectedPOId = poOverrides[idx] || receipt.matchedPO?.id || "";

                        return receipt.lines.map((line, lineIdx) => (
                          <tr
                            key={`${idx}-${lineIdx}`}
                            className={`border-b border-gray-100 ${
                              lineIdx === 0 && idx > 0 ? "border-t-2 border-t-gray-200" : ""
                            }`}
                          >
                            {/* Status — only on first line */}
                            <td className="px-3 py-2.5">
                              {lineIdx === 0 && (
                                <span className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${config.color}`}>
                                  {config.label}
                                </span>
                              )}
                            </td>
                            {/* Order # — only on first line */}
                            <td className="px-3 py-2.5 font-mono text-gray-600 text-xs">
                              {lineIdx === 0 ? receipt.orderNumber : ""}
                            </td>
                            {/* Date — only on first line */}
                            <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                              {lineIdx === 0 && receipt.receivedDate
                                ? new Date(receipt.receivedDate + "T00:00:00").toLocaleDateString("en-US")
                                : ""}
                            </td>
                            {/* 3PL SKU */}
                            <td className="px-3 py-2.5 font-mono text-gray-600 text-xs">
                              {line.stordSku}
                            </td>
                            {/* Mapped SKU */}
                            <td className="px-3 py-2.5">
                              {line.standardSku ? (
                                <span className="font-mono text-gray-900 text-xs">{line.standardSku}</span>
                              ) : line.skuMapped ? (
                                <span className="text-gray-400 italic text-xs">Non-inventory</span>
                              ) : (
                                <span className="text-red-500 font-medium text-xs">Unmapped</span>
                              )}
                            </td>
                            {/* Qty Received */}
                            <td className="px-3 py-2.5 text-right font-mono text-gray-900">
                              {line.qtyReceived.toLocaleString()}
                            </td>
                            {/* PO Qty — expected from PO line item */}
                            <td className="px-3 py-2.5 text-right">
                              {(() => {
                                const poLine = getPOLineMatch(idx, line);
                                const hasPO = poOverrides[idx] || receipt.matchedPO;
                                if (!hasPO || !line.airtableSkuId) return <span className="text-gray-300">—</span>;
                                if (!poLine) {
                                  return (
                                    <span className="text-yellow-600 text-xs font-medium" title="This SKU is not on the selected PO">
                                      Not on PO
                                    </span>
                                  );
                                }
                                const poQty = line.uom === "Carton" ? (poLine.qtyCartons || 0) : poLine.qtySticks;
                                const match = poQty === line.qtyReceived;
                                return (
                                  <span className={`font-mono ${match ? "text-green-600" : "text-orange-500"}`}>
                                    {poQty.toLocaleString()}
                                  </span>
                                );
                              })()}
                            </td>
                            {/* PO Dropdown — only on first line */}
                            <td className="px-3 py-2.5">
                              {lineIdx === 0 && (
                                <div className="flex items-center gap-1">
                                  <select
                                    value={selectedPOId}
                                    onChange={(e) => {
                                      setPOOverrides((prev) => ({
                                        ...prev,
                                        [idx]: e.target.value,
                                      }));
                                    }}
                                    className="text-xs border border-gray-300 rounded px-1.5 py-1 w-full"
                                  >
                                    <option value="">— Select PO —</option>
                                    {result.availablePOs.map((po) => (
                                      <option key={po.id} value={po.id}>
                                        {po.poNumber}
                                      </option>
                                    ))}
                                  </select>
                                  {receipt.matchedPO && !poOverrides[idx] && (
                                    <span className="text-[10px] text-green-600 whitespace-nowrap">Auto</span>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Submit Button */}
                <div className="mt-6 flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    {result.receipts.length} receipt(s) will be created in Airtable
                  </p>
                  {submitted ? (
                    <div className="flex items-center gap-3">
                      <span className="text-green-600 text-sm font-medium">
                        Receipts created successfully
                      </span>
                      <button
                        onClick={() => router.push("/receipts")}
                        className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
                      >
                        View Receipts
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="bg-gray-900 text-white px-6 py-2 text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
                    >
                      {submitting
                        ? "Creating..."
                        : `Create ${result.receipts.length} Receipt(s) in Airtable`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* No receipts found */}
            {result.receipts.length === 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                <p className="text-gray-500">
                  No receipt data found in this file. The file contains{" "}
                  {result.totalRows.toLocaleString()} rows but none are Receipt Confirmation events.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ClassificationCard({
  label,
  count,
  active = false,
}: {
  label: string;
  count: number;
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        active
          ? "border-green-200 bg-green-50"
          : "border-gray-200 bg-gray-50"
      }`}
    >
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p
        className={`text-lg font-semibold ${
          active ? "text-green-700" : "text-gray-400"
        }`}
      >
        {count.toLocaleString()}
      </p>
      {active && <p className="text-[10px] text-green-600 uppercase font-medium">Processing</p>}
      {!active && count > 0 && (
        <p className="text-[10px] text-gray-400 uppercase">Coming soon</p>
      )}
    </div>
  );
}
