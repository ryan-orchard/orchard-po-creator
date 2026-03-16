import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

export async function GET() {
  const records = await getRecords(TABLES.SKUS, {
    sort: [{ field: "Standard SKU", direction: "asc" }],
  });

  const skus = records.map((r) => ({
    id: r.id,
    standardSku: r.fields["Standard SKU"] as string,
    category: r.fields["Category"] as string,
    flavor: r.fields["Flavor"] as string,
    count: r.fields["Sticks per Carton"] as string,
    uom: r.fields["UOM"] as string,
    description: r.fields["Description"] as string,
    status: r.fields["Status"] as string,
    supplierItemName: r.fields["Supplier Item Name"] as string,
  }));

  return NextResponse.json(skus);
}
