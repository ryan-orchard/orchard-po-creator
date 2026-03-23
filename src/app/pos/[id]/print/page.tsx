"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { MAGNA } from "@/config/magna";

interface POPrint {
  id: string;
  poNumber: string;
  date: string;
  deliveryDate: string;
  paymentTerms: string;
  shippingTerms: string;
  notes: string;
  grandTotal: number;
  supplier: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  shipTo: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  lineItems: {
    id: string;
    sku: {
      standardSku: string;
      flavor: string;
      count: number | null;
      uom: string;
      supplierItemName: string;
    } | null;
    section: string;
    qtySticks: number;
    qtyCartons: number;
    unitCost: number;
    totalPrice: number;
  }[];
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string, long = false) =>
  new Date(d + "T00:00:00").toLocaleDateString(
    "en-US",
    long ? { year: "numeric", month: "long", day: "numeric" } : undefined
  );

const packSize = (uom?: string, count?: number | null) => {
  if (uom === "Carton") return `${count} CT`;
  if (uom === "Stick") return "Bulk";
  return "—";
};

export default function POPrintPage() {
  const params = useParams();
  const id = params.id as string;
  const [po, setPO] = useState<POPrint | null>(null);

  useEffect(() => {
    fetch(`/api/purchase-orders/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setPO(data);
        document.title = data.poNumber;
      });
  }, [id]);

  useEffect(() => {
    if (!po) return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [po]);

  if (!po) {
    return (
      <div className="flex items-center justify-center min-h-screen text-sm text-gray-400">
        Preparing document…
      </div>
    );
  }

  const sections: Record<string, typeof po.lineItems> = {};
  for (const item of po.lineItems) {
    const key = item.section || "Other";
    if (!sections[key]) sections[key] = [];
    sections[key].push(item);
  }

  const isSimpleMode = po.lineItems.length > 0 && po.lineItems.every(
    (li) => li.sku?.uom === "Each"
  );

  const meta: { label: string; value: string }[] = [
    { label: "PO Number", value: po.poNumber },
    { label: "Date", value: po.date ? fmtDate(po.date, true) : "—" },
    ...(po.deliveryDate ? [{ label: "Delivery", value: fmtDate(po.deliveryDate) }] : []),
    ...(po.paymentTerms ? [{ label: "Payment", value: po.paymentTerms }] : []),
    ...(po.shippingTerms ? [{ label: "Shipping", value: po.shippingTerms }] : []),
  ];

  return (
    <div className="min-h-screen bg-white">

      {/* ── Screen-only toolbar ── */}
      <div className="print:hidden border-b border-gray-200 px-10 py-3 flex items-center gap-4 bg-white">
        <a href={`/pos/${id}`} className="text-sm text-gray-500 hover:text-gray-900">
          ← Back to PO
        </a>
        <button
          onClick={() => window.print()}
          className="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-700"
        >
          Save as PDF
        </button>
      </div>

      {/* ── Document ── */}
      <div className="max-w-3xl mx-auto px-12 py-12 print:p-0 print:max-w-none">

        {/* ── Header ── */}
        <div className="flex justify-between items-start mb-14">
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#111", letterSpacing: "-0.01em" }}>
              {MAGNA.companyName}
            </p>
            <p style={{ fontSize: 13, color: "#888", marginTop: 4, lineHeight: 1.6 }}>
              {MAGNA.address}<br />
              {MAGNA.city}, {MAGNA.state} {MAGNA.zip}
            </p>
          </div>

          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 26, fontWeight: 800, color: "#111", letterSpacing: "-0.02em", textTransform: "uppercase" }}>
              Purchase Order
            </p>
            <div style={{ marginTop: 10 }}>
              {meta.map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "flex-end", gap: 24, marginTop: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#aaa", width: 68, textAlign: "right" }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 13, color: "#333", width: 130, textAlign: "right" }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Vendor + Ship To ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, marginBottom: 40 }}>
          {[
            { label: "Vendor", name: po.supplier?.name, address: po.supplier },
            { label: "Ship To", name: po.shipTo?.name, address: po.shipTo },
          ].map(({ label, name, address }) => (
            <div key={label}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#aaa", marginBottom: 6 }}>
                {label}
              </p>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{name || "—"}</p>
              {address?.address && (
                <p style={{ fontSize: 13, color: "#888", marginTop: 3, lineHeight: 1.6 }}>
                  {address.address}<br />
                  {address.city}, {address.state} {address.zip}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* ── Line Items ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1.5px solid #111" }}>
              {(isSimpleMode
                ? [
                    ["Product", "left"],
                    ["Qty", "right"],
                    ["Unit Cost", "right"],
                    ["Total", "right"],
                  ]
                : [
                    ["Product", "left"],
                    ["Pack Size", "left"],
                    ["Qty (Sticks)", "right"],
                    ["Qty (Cartons)", "right"],
                    ["Unit Cost", "right"],
                    ["Total", "right"],
                  ]
              ).map(([col, align]) => (
                <th
                  key={col}
                  style={{
                    textAlign: align as "left" | "right",
                    paddingBottom: 8,
                    paddingLeft: align === "left" ? 0 : 12,
                    paddingRight: align === "right" ? 0 : 12,
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    color: "#888",
                    whiteSpace: "nowrap",
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(sections).map(([sectionName, items]) => {
              const sectionSticks = items.reduce((s, i) => s + (i.qtySticks || 0), 0);
              const sectionCartons = items.reduce((s, i) => s + (i.qtyCartons || 0), 0);
              const sectionTotal = items.reduce((s, i) => s + (i.totalPrice || 0), 0);
              const printColSpan = isSimpleMode ? 4 : 6;

              return (
                <React.Fragment key={sectionName}>
                  {!isSimpleMode && (
                    <tr>
                      <td
                        colSpan={printColSpan}
                        style={{
                          paddingTop: 20,
                          paddingBottom: 6,
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          color: "#aaa",
                        }}
                      >
                        {sectionName}
                      </td>
                    </tr>
                  )}

                  {items.map((item) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "9px 12px 9px 0", color: "#111", whiteSpace: "nowrap" }}>
                        {item.sku?.supplierItemName || item.sku?.flavor || item.sku?.standardSku || "—"}
                      </td>
                      {!isSimpleMode && (
                        <td style={{ padding: "9px 12px", color: "#888", whiteSpace: "nowrap" }}>
                          {packSize(item.sku?.uom, item.sku?.count)}
                        </td>
                      )}
                      <td style={{ padding: "9px 0 9px 12px", textAlign: "right", color: "#111", fontVariantNumeric: "tabular-nums" }}>
                        {item.qtySticks?.toLocaleString() || "—"}
                      </td>
                      {!isSimpleMode && (
                        <td style={{ padding: "9px 0 9px 12px", textAlign: "right", color: "#888", fontVariantNumeric: "tabular-nums" }}>
                          {item.qtyCartons?.toLocaleString() || "—"}
                        </td>
                      )}
                      <td style={{ padding: "9px 0 9px 12px", textAlign: "right", color: "#111", fontVariantNumeric: "tabular-nums" }}>
                        ${fmt(item.unitCost)}
                      </td>
                      <td style={{ padding: "9px 0 9px 12px", textAlign: "right", color: "#111", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        ${fmt(item.totalPrice)}
                      </td>
                    </tr>
                  ))}

                  {!isSimpleMode && (
                    <tr style={{ borderBottom: "1px solid #e8e8e8" }}>
                      <td style={{ padding: "7px 12px 7px 0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#aaa" }}>
                        {sectionName} Total
                      </td>
                      <td />
                      <td style={{ padding: "7px 0 7px 12px", textAlign: "right", fontWeight: 700, color: "#555", fontVariantNumeric: "tabular-nums" }}>
                        {sectionSticks.toLocaleString()}
                      </td>
                      <td style={{ padding: "7px 0 7px 12px", textAlign: "right", fontWeight: 700, color: "#aaa", fontVariantNumeric: "tabular-nums" }}>
                        {sectionCartons.toLocaleString()}
                      </td>
                      <td />
                      <td style={{ padding: "7px 0 7px 12px", textAlign: "right", fontWeight: 700, color: "#111", fontVariantNumeric: "tabular-nums" }}>
                        ${fmt(sectionTotal)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {/* ── Grand Total ── */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24, paddingTop: 20, borderTop: "1.5px solid #111" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 32 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888" }}>
              Grand Total
            </span>
            <span style={{ fontSize: 22, fontWeight: 800, color: "#111", letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" }}>
              ${fmt(po.grandTotal)}
            </span>
          </div>
        </div>

        {/* ── Notes ── */}
        {po.notes && (
          <div style={{ marginTop: 36 }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#aaa", marginBottom: 4 }}>
              Notes
            </p>
            <p style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>{po.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
