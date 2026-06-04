"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";

interface LineItem {
  sku: string;
  name: string;
  qty: number;
  uom: string;
}

interface WODocProps {
  woNumber: string;
  issuedDate: string;
  warehouse: string;
  status: string;
  notes: string | null;
  outputs: LineItem[];
  inputs: LineItem[];
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  header: { marginBottom: 24 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  metaRow: { flexDirection: "row", gap: 32, marginBottom: 2 },
  metaLabel: { fontFamily: "Helvetica-Bold", width: 80 },
  metaValue: { flex: 1 },
  section: { marginBottom: 20 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  tableHeader: { flexDirection: "row", backgroundColor: "#2d4a3e", color: "#fff", paddingVertical: 5, paddingHorizontal: 8 },
  tableHeaderText: { fontFamily: "Helvetica-Bold", fontSize: 8, textTransform: "uppercase", letterSpacing: 0.4, color: "#fff" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e5e7eb", paddingVertical: 5, paddingHorizontal: 8 },
  tableRowAlt: { backgroundColor: "#f9fafb" },
  colSku: { width: "35%" },
  colName: { flex: 1 },
  colQty: { width: 70, textAlign: "right" },
  colUom: { width: 50, textAlign: "left", paddingLeft: 8 },
  notesBox: { backgroundColor: "#f9fafb", borderWidth: 1, borderColor: "#e5e7eb", padding: 10, borderRadius: 4 },
  notesLabel: { fontFamily: "Helvetica-Bold", marginBottom: 4 },
  divider: { borderBottomWidth: 1, borderBottomColor: "#e5e7eb", marginBottom: 20 },
});

function WODocument({ woNumber, issuedDate, warehouse, status, notes, outputs, inputs }: WODocProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Work Order</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>WO Number</Text>
            <Text style={styles.metaValue}>{woNumber}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Issued Date</Text>
            <Text style={styles.metaValue}>{issuedDate}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Warehouse</Text>
            <Text style={styles.metaValue}>{warehouse}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={styles.metaValue}>{status}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Outputs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Outputs — Finished Goods to Produce</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, styles.colSku]}>SKU</Text>
            <Text style={[styles.tableHeaderText, styles.colName]}>Description</Text>
            <Text style={[styles.tableHeaderText, styles.colQty]}>Qty</Text>
            <Text style={[styles.tableHeaderText, styles.colUom]}>UOM</Text>
          </View>
          {outputs.map((item, i) => (
            <View key={item.sku + i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={styles.colSku}>{item.sku}</Text>
              <Text style={styles.colName}>{item.name}</Text>
              <Text style={styles.colQty}>{item.qty.toLocaleString()}</Text>
              <Text style={styles.colUom}>{item.uom}</Text>
            </View>
          ))}
        </View>

        {/* Inputs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Inputs — Raw Materials to Consume</Text>
          <View style={[styles.tableHeader, { backgroundColor: "#6b3a2a" }]}>
            <Text style={[styles.tableHeaderText, styles.colSku]}>SKU</Text>
            <Text style={[styles.tableHeaderText, styles.colName]}>Description</Text>
            <Text style={[styles.tableHeaderText, styles.colQty]}>Qty</Text>
            <Text style={[styles.tableHeaderText, styles.colUom]}>UOM</Text>
          </View>
          {inputs.map((item, i) => (
            <View key={item.sku + i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={styles.colSku}>{item.sku}</Text>
              <Text style={styles.colName}>{item.name}</Text>
              <Text style={styles.colQty}>{item.qty.toLocaleString()}</Text>
              <Text style={styles.colUom}>{item.uom}</Text>
            </View>
          ))}
        </View>

        {/* Notes */}
        {notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Special Instructions</Text>
            <View style={styles.notesBox}>
              <Text>{notes}</Text>
            </View>
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function downloadWOPdf(props: WODocProps) {
  const blob = await pdf(<WODocument {...props} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${props.woNumber}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
