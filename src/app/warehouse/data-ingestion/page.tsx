"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

type IngestionTab = "receipts" | "snapshots";

interface ReceiptLine {
  stordSku: string;
  productName: string;
  qtyReceived: number;
  lotNumber: string | null;
  standardSku: string | null;
  itemId: string | null;
  skuMapped: boolean;
}

interface ParsedReceipt {
  orderNumber: string;
  receivedDate: string;
  facility: string;
  lines: ReceiptLine[];
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

interface AvailableItem {
  id: string;
  standardSku: string;
  category: string;
}

interface IngestResult {
  fileName: string;
  totalRows: number;
  dateRange: { from: string | null; to: string | null };
  classification: ClassificationSummary;
  receipts: ParsedReceipt[];
  availableItems: AvailableItem[];
}

// Snapshot types
interface SnapshotLine {
  standardSku: string;
  skuRecordId: string;
  qty: number;
}

interface SnapshotPreview {
  lines: SnapshotLine[];
  unmappedSkus: string[];
}

export default function DataIngestionPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<IngestionTab>("receipts");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // SKU overrides: key = "receiptIdx-lineIdx", value = airtable item ID
  const [skuOverrides, setSkuOverrides] = useState<Record<string, string>>({});
  // Deleted lines: set of "receiptIdx-lineIdx" keys
  const [deletedLines, setDeletedLines] = useState<Set<string>>(new Set());

  // Snapshot upload state
  const snapshotFileRef = useRef<HTMLInputElement>(null);
  const [snapshotWarehouse, setSnapshotWarehouse] = useState("BMC");
  const [snapshotDate, setSnapshotDate] = useState(new Date().toISOString().split("T")[0]);
  const [snapshotPreview, setSnapshotPreview] = useState<SnapshotPreview | null>(null);
  const [snapshotUploading, setSnapshotUploading] = useState(false);
  const [snapshotSubmitting, setSnapshotSubmitting] = useState(false);
  const [snapshotSubmitted, setSnapshotSubmitted] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    setResult(null);
    setSubmitted(false);
    setSkuOverrides({});
    setDeletedLines(new Set());

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

        // Filter out deleted lines
        const activeLines = receipt.lines
          .map((line, lineIdx) => ({ line, lineIdx }))
          .filter(({ lineIdx }) => !deletedLines.has(`${i}-${lineIdx}`));

        // Skip receipt if all lines were deleted
        if (activeLines.length === 0) continue;

        const body = {
          receivedDate: receipt.receivedDate,
          facilityCode: receipt.facility === "RNOs003" ? "STORD" : receipt.facility,
          externalReceiptId: receipt.orderNumber,
          lineItems: activeLines.map(({ line, lineIdx }) => {
            const overrideKey = `${i}-${lineIdx}`;
            const skuId = skuOverrides[overrideKey] || line.itemId || undefined;
            return {
              skuId,
              qtyReceived: line.qtyReceived,
              threePlSku: line.stordSku,
              lotNumber: line.lotNumber || undefined,
            };
          }),
        };

        const response = await fetch("/api/receipts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (response.ok) created++;
      }

      setSubmitted(true);
      alert(`Created ${created} receipt(s). Go to Receipt Matching to link them to POs.`);
    } catch {
      alert("Error creating receipts. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const getLineStatus = (line: ReceiptLine, receiptIdx: number, lineIdx: number) => {
    const overrideKey = `${receiptIdx}-${lineIdx}`;
    if (skuOverrides[overrideKey]) return "resolved";
    if (!line.skuMapped) return "unmapped";
    return "ready";
  };

  const statusConfig = {
    ready: { label: "Ready", color: "bg-sage-100 text-sage-800" },
    unmapped: { label: "Unmapped SKU", color: "bg-burgundy-100 text-burgundy-800" },
    resolved: { label: "Mapped", color: "bg-gold-100 text-gold-800" },
  };

  // --- Snapshot handlers ---

  const handleSnapshotFile = async (file: File) => {
    setSnapshotUploading(true);
    setSnapshotError(null);
    setSnapshotPreview(null);
    setSnapshotSubmitted(false);

    try {
      // Read CSV file
      const text = await file.text();
      const rows = text.split("\n").map((r) => r.trim()).filter(Boolean);
      if (rows.length < 2) throw new Error("File is empty or has no data rows");

      // Parse header to find SKU and Qty columns
      const header = rows[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
      const skuCol = header.findIndex((h) =>
        ["sku", "standard sku", "standard_sku", "item", "product"].includes(h)
      );
      const qtyCol = header.findIndex((h) =>
        ["qty", "quantity", "qty on hand", "qty_on_hand", "on hand", "on_hand", "available", "total"].includes(h)
      );

      if (skuCol === -1) throw new Error("Could not find SKU column. Expected: sku, standard sku, item, or product");
      if (qtyCol === -1) throw new Error("Could not find quantity column. Expected: qty, quantity, on hand, or available");

      // Fetch items from Airtable to map SKUs
      const itemsRes = await fetch("/api/skus");
      const itemsData = await itemsRes.json();
      const skuToRecord = new Map<string, { id: string; standardSku: string }>();
      for (const item of itemsData) {
        const sku = (item.fields?.["Standard SKU"] || item.standardSku || "") as string;
        if (sku) skuToRecord.set(sku.toUpperCase(), { id: item.id, standardSku: sku });
      }

      // Parse data rows
      const lines: SnapshotLine[] = [];
      const unmappedSkus: string[] = [];

      for (let i = 1; i < rows.length; i++) {
        const cols = rows[i].split(",").map((c) => c.trim().replace(/"/g, ""));
        const sku = cols[skuCol];
        const qty = parseInt(cols[qtyCol]) || 0;
        if (!sku || qty === 0) continue;

        const match = skuToRecord.get(sku.toUpperCase());
        if (match) {
          lines.push({ standardSku: match.standardSku, skuRecordId: match.id, qty });
        } else {
          unmappedSkus.push(sku);
        }
      }

      setSnapshotPreview({ lines, unmappedSkus });
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : "Failed to parse file");
    } finally {
      setSnapshotUploading(false);
    }
  };

  const handleSnapshotSubmit = async () => {
    if (!snapshotPreview || snapshotPreview.lines.length === 0) return;
    setSnapshotSubmitting(true);

    try {
      const res = await fetch("/api/warehouse/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseCode: snapshotWarehouse,
          date: snapshotDate,
          lines: snapshotPreview.lines.map((l) => ({
            sku: l.standardSku,
            itemId: l.skuRecordId,
            qty: l.qty,
          })),
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Upload failed");
      }

      setSnapshotSubmitted(true);
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSnapshotSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Data Ingestion</h1>
          <p className="text-sm text-gray-500 mt-1">
            Import receipt data and inventory snapshots
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab("receipts")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === "receipts"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Stord Receipts
          </button>
          <button
            onClick={() => setActiveTab("snapshots")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === "snapshots"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Inventory Snapshots
          </button>
        </div>

        {/* === RECEIPTS TAB === */}
        {activeTab === "receipts" && <>

        {/* Import Options */}
        {!result && (
          <div className="max-w-md">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-800">
                Stord receipts arrive automatically via webhook. Use this upload as a backup for manual corrections.
              </p>
            </div>
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="bg-white rounded-lg border border-dashed border-gray-300 p-6 text-center hover:border-gray-400 transition-colors"
            >
              <h2 className="text-base font-semibold text-gray-900 mb-1">Upload File</h2>
              <p className="text-sm text-gray-500 mb-4">Upload a Stord Inventory Adjustments XLSX or CSV export.</p>
              {uploading ? (
                <p className="text-sm text-gray-500">Parsing file...</p>
              ) : (
                <>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-white border border-gray-300 text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50"
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
                  <p className="text-xs text-gray-400 mt-3">Drag & drop or choose .xlsx / .csv</p>
                </>
              )}
            </div>
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
                    setSkuOverrides({});
                    setDeletedLines(new Set());
                  }}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  ← Start over
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
                        <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[200px]">
                          Mapped SKU
                        </th>
                        <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Qty Received
                        </th>
                        <th className="px-3 py-2.5 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.receipts.map((receipt, idx) =>
                        receipt.lines.map((line, lineIdx) => {
                          const lineKey = `${idx}-${lineIdx}`;
                          if (deletedLines.has(lineKey)) return null;

                          const lineStatus = getLineStatus(line, idx, lineIdx);
                          const config = statusConfig[lineStatus];
                          const overrideKey = lineKey;
                          const hasOverride = !!skuOverrides[overrideKey];
                          const overrideItem = hasOverride
                            ? result.availableItems.find((item) => item.id === skuOverrides[overrideKey])
                            : null;

                          return (
                            <tr
                              key={lineKey}
                              className={`border-b border-gray-100 ${
                                lineIdx === 0 && idx > 0 ? "border-t-2 border-t-gray-200" : ""
                              }`}
                            >
                              {/* Status — shown on every line */}
                              <td className="px-3 py-2.5">
                                <span className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${config.color}`}>
                                  {config.label}
                                </span>
                              </td>
                              {/* Order # — shown on every line */}
                              <td className="px-3 py-2.5 text-gray-600 text-xs">
                                {receipt.orderNumber}
                              </td>
                              {/* Date — shown on every line */}
                              <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                                {receipt.receivedDate
                                  ? new Date(receipt.receivedDate + "T00:00:00").toLocaleDateString("en-US")
                                  : "—"}
                              </td>
                              {/* 3PL SKU */}
                              <td className="px-3 py-2.5 text-gray-600 text-xs">
                                {line.stordSku}
                              </td>
                              {/* Mapped SKU — editable for unmapped */}
                              <td className="px-3 py-2.5">
                                {line.standardSku ? (
                                  <span className="text-gray-900 text-xs">{line.standardSku}</span>
                                ) : line.skuMapped ? (
                                  <span className="text-gray-400 italic text-xs">Non-inventory</span>
                                ) : hasOverride ? (
                                  <div className="flex items-center gap-1">
                                    <span className="text-gold-700 text-xs">{overrideItem?.standardSku}</span>
                                    <button
                                      onClick={() => {
                                        setSkuOverrides((prev) => {
                                          const next = { ...prev };
                                          delete next[overrideKey];
                                          return next;
                                        });
                                      }}
                                      className="text-gray-400 hover:text-gray-600 text-xs"
                                      title="Clear mapping"
                                    >
                                      x
                                    </button>
                                  </div>
                                ) : (
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        setSkuOverrides((prev) => ({
                                          ...prev,
                                          [overrideKey]: e.target.value,
                                        }));
                                      }
                                    }}
                                    className="text-xs border border-burgundy-300 rounded px-1.5 py-1 w-full bg-red-50 text-red-700"
                                  >
                                    <option value="">Select SKU...</option>
                                    {result.availableItems.map((item) => (
                                      <option key={item.id} value={item.id}>
                                        {item.standardSku}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </td>
                              {/* Qty Received */}
                              <td className="px-3 py-2.5 text-right text-gray-900">
                                {line.qtyReceived.toLocaleString()}
                              </td>
                              {/* Delete */}
                              <td className="px-3 py-2.5 text-center">
                                <button
                                  onClick={() => {
                                    setDeletedLines((prev) => {
                                      const next = new Set(prev);
                                      next.add(lineKey);
                                      return next;
                                    });
                                  }}
                                  className="text-gray-300 hover:text-red-500 transition-colors"
                                  title="Remove this line"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Info banner */}
                <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-800">
                    Receipts will be created as <strong>Unmatched</strong>. Use{" "}
                    <button
                      onClick={() => router.push("/receipts/matching")}
                      className="underline font-medium hover:text-blue-900"
                    >
                      Receipt Matching
                    </button>{" "}
                    to link them to Purchase Orders after import.
                  </p>
                </div>

                {/* Submit Button */}
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    {(() => {
                      const activeReceipts = result.receipts.filter((_, idx) =>
                        result.receipts[idx].lines.some((_, lineIdx) => !deletedLines.has(`${idx}-${lineIdx}`))
                      ).length;
                      const totalDeleted = deletedLines.size;
                      return (
                        <>
                          {activeReceipts} receipt(s) will be created in Airtable
                          {totalDeleted > 0 && (
                            <span className="text-gray-400 ml-1">({totalDeleted} line(s) removed)</span>
                          )}
                        </>
                      );
                    })()}
                  </p>
                  {submitted ? (
                    <div className="flex items-center gap-3">
                      <span className="text-green-600 text-sm font-medium">
                        Receipts created successfully
                      </span>
                      <button
                        onClick={() => router.push("/receipts/matching")}
                        className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
                      >
                        Go to Receipt Matching
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
                        : `Create ${result.receipts.filter((_, idx) =>
                            result.receipts[idx].lines.some((_, lineIdx) => !deletedLines.has(`${idx}-${lineIdx}`))
                          ).length} Receipt(s)`}
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

        </>}

        {/* === INVENTORY SNAPSHOTS TAB === */}
        {activeTab === "snapshots" && (
          <div className="space-y-6">
            {/* Upload Section */}
            {!snapshotPreview && !snapshotSubmitted && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-base font-semibold text-gray-900 mb-1">
                  Upload Inventory Snapshot
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                  Upload a CSV with current on-hand quantities for a warehouse. This replaces any existing snapshot.
                </p>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Warehouse</label>
                    <select
                      value={snapshotWarehouse}
                      onChange={(e) => setSnapshotWarehouse(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                    >
                      <option value="BMC">BMC</option>
                      <option value="ANS">ANS</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">As of Date</label>
                    <input
                      type="date"
                      value={snapshotDate}
                      onChange={(e) => setSnapshotDate(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                    />
                  </div>
                </div>
                <div
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) handleSnapshotFile(file);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  className="border border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors"
                >
                  {snapshotUploading ? (
                    <p className="text-sm text-gray-500">Parsing file...</p>
                  ) : (
                    <>
                      <button
                        onClick={() => snapshotFileRef.current?.click()}
                        className="bg-white border border-gray-300 text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50"
                      >
                        Choose CSV
                      </button>
                      <input
                        ref={snapshotFileRef}
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleSnapshotFile(file);
                        }}
                      />
                      <p className="text-xs text-gray-400 mt-3">
                        CSV with columns: SKU (or Standard SKU), Qty (or Quantity, On Hand)
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Snapshot Error */}
            {snapshotError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-800 text-sm">{snapshotError}</p>
              </div>
            )}

            {/* Snapshot Preview */}
            {snapshotPreview && !snapshotSubmitted && (
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Preview — {snapshotWarehouse} Snapshot ({snapshotDate})
                  </h2>
                  <button
                    onClick={() => {
                      setSnapshotPreview(null);
                      setSnapshotError(null);
                    }}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    &larr; Start over
                  </button>
                </div>

                {snapshotPreview.unmappedSkus.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                    <p className="text-sm text-amber-800">
                      <strong>{snapshotPreview.unmappedSkus.length} SKU(s) not found</strong> in Items master data and will be skipped:{" "}
                      {snapshotPreview.unmappedSkus.join(", ")}
                    </p>
                  </div>
                )}

                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        SKU
                      </th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Qty On Hand
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshotPreview.lines.map((line) => (
                      <tr key={line.skuRecordId} className="border-b border-gray-100">
                        <td className="px-3 py-2.5 text-xs font-semibold text-gray-900">
                          {line.standardSku}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-900">
                          {line.qty.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t-2 border-gray-300">
                      <td className="px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Total
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-gray-900">
                        {snapshotPreview.lines.reduce((s, l) => s + l.qty, 0).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>

                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    {snapshotPreview.lines.length} SKU(s) will replace existing {snapshotWarehouse} snapshot
                  </p>
                  <button
                    onClick={handleSnapshotSubmit}
                    disabled={snapshotSubmitting}
                    className="bg-gray-900 text-white px-6 py-2 text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
                  >
                    {snapshotSubmitting ? "Uploading..." : `Upload ${snapshotWarehouse} Snapshot`}
                  </button>
                </div>
              </div>
            )}

            {/* Snapshot Success */}
            {snapshotSubmitted && (
              <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                <p className="text-green-600 font-medium mb-2">
                  Snapshot uploaded successfully
                </p>
                <p className="text-sm text-gray-500 mb-4">
                  {snapshotWarehouse} inventory has been updated as of {snapshotDate}.
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => {
                      setSnapshotPreview(null);
                      setSnapshotSubmitted(false);
                      setSnapshotError(null);
                    }}
                    className="border border-gray-300 text-gray-700 px-4 py-2 text-sm rounded-md hover:bg-gray-50"
                  >
                    Upload Another
                  </button>
                  <button
                    onClick={() => router.push("/warehouse/on-hand")}
                    className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
                  >
                    View On-Hand Inventory
                  </button>
                </div>
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
