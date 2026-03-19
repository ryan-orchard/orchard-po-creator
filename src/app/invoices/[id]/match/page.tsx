"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";

// --- Types ---

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplier: string;
  poReference: string;
  invoiceAmount: number;
  lines: {
    id: string;
    skuName: string | null;
    ansItemNumber: string;
    description: string;
    qtyBilled: number;
    unitCost: number;
    amount: number;
  }[];
  purchaseOrder: { id: string; poNumber: string; status: string } | null;
}

interface PODetail {
  id: string;
  poNumber: string;
  date: string;
  status: string;
  grandTotal: number;
  supplier: { name: string } | null;
  lineItems: {
    id: string;
    skuId: string | null;
    sku: {
      standardSku: string;
      uom: string;
    } | null;
    qtySticks: number;
    qtyCartons: number;
    unitCost: number;
  }[];
}

interface ReceiptDetail {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  warehouse: string | null;
  lines: {
    id: string;
    skuId: string | null;
    sku: string | null;
    qtyReceived: number;
  }[];
}

interface MatchInfo {
  matchStatus: "open" | "matched" | "discrepancy";
  po: { poId: string; poNumber: string; status: string } | null;
  suggestedReceipt: {
    receiptId: string;
    receiptNumber: string;
    receivedDate: string;
  } | null;
  matchedReceipt: {
    receiptId: string;
    receiptNumber: string;
  } | null;
  receiptOptions: {
    receiptId: string;
    receiptNumber: string;
    receivedDate: string;
    overlapScore: number;
  }[];
  flags: string[];
}

interface ComparisonRow {
  skuName: string;
  invoiceQty: number;
  invoiceUnitCost: number;
  poQty: number;
  poUnitCost: number;
  receiptQty: number;
  qtyMatch: boolean;
  priceMatch: boolean;
  invoiceLineId: string;
  receiptLineId: string;
  poLineItemId: string;
  hasInvoice: boolean;
  hasPO: boolean;
  hasReceipt: boolean;
}

// --- Helpers ---

function formatDate(d: string) {
  if (!d) return "\u2014";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(n: number) {
  if (!n && n !== 0) return "\u2014";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function getPoQty(line: PODetail["lineItems"][0]): number {
  if (!line.sku) return line.qtyCartons || line.qtySticks || 0;
  return line.sku.uom === "Carton"
    ? line.qtyCartons || 0
    : line.qtySticks || line.qtyCartons || 0;
}

function buildComparison(
  invoice: InvoiceDetail | null,
  po: PODetail | null,
  receipt: ReceiptDetail | null
): ComparisonRow[] {
  if (!invoice) return [];

  // Build lookup maps by SKU name
  const invoiceBySkuName: Record<
    string,
    InvoiceDetail["lines"][0]
  > = {};
  for (const l of invoice.lines) {
    if (l.skuName) invoiceBySkuName[l.skuName] = l;
  }

  const poBySkuName: Record<
    string,
    PODetail["lineItems"][0]
  > = {};
  if (po) {
    for (const l of po.lineItems) {
      if (l.sku?.standardSku) poBySkuName[l.sku.standardSku] = l;
    }
  }

  const receiptBySkuName: Record<
    string,
    ReceiptDetail["lines"][0]
  > = {};
  if (receipt) {
    for (const l of receipt.lines) {
      if (l.sku) receiptBySkuName[l.sku] = l;
    }
  }

  // Only show SKUs from the invoice — it's the anchor document
  const invoiceSkus = Object.keys(invoiceBySkuName);

  // Build comparison rows
  return invoiceSkus.map((skuName) => {
    const inv = invoiceBySkuName[skuName];
    const poLine = poBySkuName[skuName];
    const rec = receiptBySkuName[skuName];

    const invoiceQty = inv?.qtyBilled || 0;
    const invoiceUnitCost = inv?.unitCost || 0;
    const receiptQty = rec?.qtyReceived || 0;
    const poQty = poLine ? getPoQty(poLine) : 0;
    const poUnitCost = poLine?.unitCost || 0;

    return {
      skuName,
      invoiceQty,
      invoiceUnitCost,
      poQty,
      poUnitCost,
      receiptQty,
      qtyMatch: !!inv && !!rec && invoiceQty === receiptQty,
      priceMatch:
        !!inv && !!poLine && poUnitCost > 0 && invoiceUnitCost === poUnitCost,
      invoiceLineId: inv?.id || "",
      receiptLineId: rec?.id || "",
      poLineItemId: poLine?.id || "",
      hasInvoice: !!inv,
      hasPO: !!poLine,
      hasReceipt: !!rec,
    };
  });
}

// --- Main Page ---

export default function InvoiceMatchPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);
  const [poDetail, setPODetail] = useState<PODetail | null>(null);
  const [receiptDetail, setReceiptDetail] = useState<ReceiptDetail | null>(
    null
  );
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [unmatching, setUnmatching] = useState(false);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadData() {
    try {
      // Step 1: Fetch invoice detail + matching data in parallel
      const [invoiceRes, matchingRes] = await Promise.all([
        fetch(`/api/invoices/${id}`),
        fetch(`/api/invoices/matching`),
      ]);
      const invoiceData = await invoiceRes.json();
      const matchingData = await matchingRes.json();

      setInvoice(invoiceData);

      // Find this invoice in matching data
      const match = matchingData.invoices?.find(
        (i: { id: string }) => i.id === id
      );
      setMatchInfo(match || null);

      // Step 2: Fetch PO and receipt details
      const poId = match?.po?.poId;
      const receiptId =
        match?.matchedReceipt?.receiptId ||
        match?.suggestedReceipt?.receiptId;

      const fetches: [Promise<Response> | null, Promise<Response> | null] = [
        poId ? fetch(`/api/purchase-orders/${poId}`) : null,
        receiptId ? fetch(`/api/receipts/${receiptId}`) : null,
      ];

      const [poRes, receiptRes] = await Promise.all(
        fetches.map((f) => f || Promise.resolve(null))
      );

      if (poRes) setPODetail(await poRes.json());
      if (receiptRes) {
        setReceiptDetail(await receiptRes.json());
        setSelectedReceiptId(receiptId || null);
      }
    } catch (err) {
      console.error("Failed to load match data:", err);
    } finally {
      setLoading(false);
    }
  }

  // Comparison rows
  const rows = useMemo(
    () => buildComparison(invoice, poDetail, receiptDetail),
    [invoice, poDetail, receiptDetail]
  );

  const discrepancyCount = rows.filter(
    (r) => r.hasInvoice && (!r.qtyMatch || !r.priceMatch)
  ).length;
  const allPass = discrepancyCount === 0 && rows.length > 0;
  const isMatched =
    matchInfo?.matchStatus === "matched" ||
    matchInfo?.matchStatus === "discrepancy";

  // Handle receipt change
  async function handleReceiptChange(receiptId: string) {
    setSelectedReceiptId(receiptId);
    try {
      const res = await fetch(`/api/receipts/${receiptId}`);
      setReceiptDetail(await res.json());
    } catch {
      console.error("Failed to load receipt");
    }
  }

  // Handle confirm match
  async function handleConfirm() {
    if (!selectedReceiptId) return;
    setConfirming(true);
    try {
      const lineMatches = rows
        .filter((r) => r.invoiceLineId && r.receiptLineId && r.poLineItemId)
        .map((r) => ({
          invoiceLineId: r.invoiceLineId,
          receiptLineId: r.receiptLineId,
          poLineItemId: r.poLineItemId,
        }));

      const res = await fetch(`/api/invoices/${id}/match`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptId: selectedReceiptId,
          lineMatches,
          hasDiscrepancy: !allPass,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
        return;
      }

      router.push("/invoices");
    } catch {
      alert("Failed to confirm match.");
    } finally {
      setConfirming(false);
    }
  }

  // Handle unmatch
  async function handleUnmatch() {
    setUnmatching(true);
    try {
      const res = await fetch(`/api/invoices/${id}/unmatch`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
        return;
      }
      router.push("/invoices");
    } catch {
      alert("Failed to unmatch.");
    } finally {
      setUnmatching(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Invoice not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push("/invoices")}
            className="text-sm text-gray-500 hover:text-gray-700 mb-2 flex items-center gap-1"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to Invoices
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            Match Invoice {invoice.invoiceNumber}
          </h1>
          {matchInfo?.flags && matchInfo.flags.length > 0 && (
            <div className="mt-2">
              {matchInfo.flags.map((flag, i) => (
                <p key={i} className="text-sm text-warm-600 font-medium">
                  {flag}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Three Document Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {/* Invoice Card */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="bg-gray-900 px-4 py-2">
              <span className="text-xs font-semibold text-white uppercase tracking-wider">
                Invoice
              </span>
            </div>
            <div className="p-4">
              <p className="text-lg font-bold text-gray-900">
                {invoice.invoiceNumber}
              </p>
              <div className="mt-2 space-y-1 text-sm text-gray-600">
                <p>{formatDate(invoice.invoiceDate)}</p>
                <p>{invoice.supplier || "\u2014"}</p>
                {invoice.poReference && (
                  <p className="text-xs text-gray-400">
                    PO Ref: {invoice.poReference}
                  </p>
                )}
              </div>
              <p className="mt-3 text-lg font-semibold text-gray-900">
                {formatCurrency(invoice.invoiceAmount)}
              </p>
            </div>
          </div>

          {/* PO Card */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="bg-gold-600 px-4 py-2">
              <span className="text-xs font-semibold text-white uppercase tracking-wider">
                Purchase Order
              </span>
            </div>
            {poDetail ? (
              <div className="p-4">
                <div className="flex items-center gap-2">
                  <p className="text-lg font-bold text-gray-900">
                    {poDetail.poNumber}
                  </p>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                      poDetail.status === "Received"
                        ? "bg-sage-100 text-sage-700"
                        : poDetail.status === "Issued"
                        ? "bg-gold-100 text-gold-700"
                        : "bg-warm-100 text-warm-700"
                    }`}
                  >
                    {poDetail.status}
                  </span>
                </div>
                <div className="mt-2 space-y-1 text-sm text-gray-600">
                  <p>{formatDate(poDetail.date)}</p>
                  <p>{poDetail.supplier?.name || "\u2014"}</p>
                </div>
                <p className="mt-3 text-lg font-semibold text-gray-900">
                  {formatCurrency(poDetail.grandTotal)}
                </p>
              </div>
            ) : (
              <div className="p-4 text-center py-8">
                <p className="text-gray-400 text-sm">No PO found</p>
                <p className="text-gray-300 text-xs mt-1">
                  {invoice.poReference
                    ? `No match for "${invoice.poReference}"`
                    : "No PO reference on invoice"}
                </p>
              </div>
            )}
          </div>

          {/* Receipt Card */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="bg-sage-600 px-4 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-white uppercase tracking-wider">
                Receipt
              </span>
              {!isMatched &&
                matchInfo?.receiptOptions &&
                matchInfo.receiptOptions.length > 1 && (
                  <select
                    value={selectedReceiptId || ""}
                    onChange={(e) => handleReceiptChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs bg-sage-700 text-white border border-sage-500 rounded px-1.5 py-0.5 focus:outline-none"
                  >
                    {matchInfo.receiptOptions.map((r) => (
                      <option key={r.receiptId} value={r.receiptId}>
                        {r.receiptNumber}
                      </option>
                    ))}
                  </select>
                )}
            </div>
            {receiptDetail ? (
              <div className="p-4">
                <p className="text-lg font-bold text-gray-900">
                  {receiptDetail.receiptNumber}
                </p>
                <div className="mt-2 space-y-1 text-sm text-gray-600">
                  <p>{formatDate(receiptDetail.receivedDate)}</p>
                  <p>{receiptDetail.warehouse || "\u2014"}</p>
                </div>
              </div>
            ) : (
              <div className="p-4 text-center py-8">
                <p className="text-gray-400 text-sm">No receipt found</p>
                <p className="text-gray-300 text-xs mt-1">
                  {poDetail
                    ? "No receipts matched to this PO yet"
                    : "Find a PO first"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Comparison Table */}
        {rows.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    SKU
                  </th>
                  {/* Invoice group */}
                  <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider border-l border-gray-200">
                    Inv Qty
                  </th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Inv Cost
                  </th>
                  {/* PO group */}
                  <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider border-l border-gray-200">
                    PO Qty
                  </th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    PO Cost
                  </th>
                  {/* Receipt group */}
                  <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider border-l border-gray-200">
                    Rcpt Qty
                  </th>
                  {/* Status */}
                  <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider border-l border-gray-200 w-16">
                    Qty
                  </th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-16">
                    Price
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.skuName}>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-medium text-gray-900">
                        {row.skuName}
                      </span>
                    </td>
                    {/* Invoice */}
                    <td
                      className={`px-3 py-2.5 text-right border-l border-gray-100 ${
                        row.hasInvoice ? "text-gray-900" : "text-gray-300"
                      }`}
                    >
                      {row.hasInvoice
                        ? row.invoiceQty.toLocaleString()
                        : "\u2014"}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right text-xs ${
                        row.hasInvoice ? "text-gray-900" : "text-gray-300"
                      }`}
                    >
                      {row.hasInvoice
                        ? formatCurrency(row.invoiceUnitCost)
                        : "\u2014"}
                    </td>
                    {/* PO */}
                    <td
                      className={`px-3 py-2.5 text-right border-l border-gray-100 ${
                        row.hasPO ? "text-gray-600" : "text-gray-300"
                      }`}
                    >
                      {row.hasPO ? row.poQty.toLocaleString() : "\u2014"}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right text-xs ${
                        row.hasPO ? "text-gray-600" : "text-gray-300"
                      }`}
                    >
                      {row.hasPO ? formatCurrency(row.poUnitCost) : "\u2014"}
                    </td>
                    {/* Receipt */}
                    <td
                      className={`px-3 py-2.5 text-right border-l border-gray-100 ${
                        row.hasReceipt ? "text-gray-600" : "text-gray-300"
                      }`}
                    >
                      {row.hasReceipt
                        ? row.receiptQty.toLocaleString()
                        : "\u2014"}
                    </td>
                    {/* Qty check */}
                    <td className="px-3 py-2.5 text-center border-l border-gray-100">
                      {!row.hasInvoice || !row.hasReceipt ? (
                        <span className="text-gray-300">\u2014</span>
                      ) : row.qtyMatch ? (
                        <span className="text-sage-600 font-medium">
                          &#10003;
                        </span>
                      ) : (
                        <span className="text-warm-600 text-xs font-medium">
                          {row.invoiceQty - row.receiptQty > 0 ? "+" : ""}
                          {(
                            row.invoiceQty - row.receiptQty
                          ).toLocaleString()}
                        </span>
                      )}
                    </td>
                    {/* Price check */}
                    <td className="px-3 py-2.5 text-center">
                      {!row.hasInvoice || !row.hasPO || row.poUnitCost === 0 ? (
                        <span className="text-gray-300">\u2014</span>
                      ) : row.priceMatch ? (
                        <span className="text-sage-600 font-medium">
                          &#10003;
                        </span>
                      ) : (
                        <span className="text-warm-600 text-xs font-medium">
                          $
                          {Math.abs(
                            row.invoiceUnitCost - row.poUnitCost
                          ).toFixed(2)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Verdict banner */}
            {poDetail && receiptDetail && (
              <div
                className={`px-4 py-3 border-t ${
                  allPass
                    ? "bg-sage-50 border-sage-100"
                    : "bg-warm-50 border-warm-100"
                }`}
              >
                <p
                  className={`text-sm font-medium ${
                    allPass ? "text-sage-700" : "text-warm-700"
                  }`}
                >
                  {allPass
                    ? "All checks pass \u2014 approved to pay"
                    : `${discrepancyCount} discrepanc${discrepancyCount === 1 ? "y" : "ies"} found`}
                </p>
              </div>
            )}
          </div>
        )}

        {/* No comparison possible */}
        {rows.length === 0 && !loading && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm mb-6">
            {!poDetail && !receiptDetail
              ? "Cannot compare \u2014 no PO or receipt found."
              : !poDetail
              ? "Cannot compare \u2014 no PO found."
              : "Cannot compare \u2014 no receipt found."}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div>
            {isMatched && (
              <button
                onClick={handleUnmatch}
                disabled={unmatching}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                {unmatching ? "Unmatching..." : "Unmatch"}
              </button>
            )}
          </div>

          <div>
            {!isMatched && poDetail && receiptDetail && (
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className={`text-white px-6 py-2 text-sm font-semibold rounded-md transition-colors disabled:opacity-50 ${
                  allPass
                    ? "bg-sage-600 hover:bg-sage-700"
                    : "bg-gold-500 hover:bg-gold-600"
                }`}
              >
                {confirming
                  ? "Matching..."
                  : allPass
                  ? "Confirm Match"
                  : "Match with Discrepancy"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
