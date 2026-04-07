import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { getRecords, createRecord, TABLES } from "@/lib/airtable";

export async function POST(req: Request) {
  const authError = await requireOperator();
  if (authError) return authError;

  const body = await req.json();
  const fields: Record<string, unknown> = {
    "Standard SKU": body.standardSku,
    "Category": body.category,
    "Flavor": body.flavor,
    "UOM": body.uom,
    "Description": body.description,
    "Status": body.status,
  };
  if (body.uom === "Carton" && body.count != null) {
    fields["Sticks per Carton"] = Number(body.count);
  }
  const record = await createRecord(TABLES.SKUS, fields);
  return NextResponse.json({
    id: record.id,
    standardSku: record.fields["Standard SKU"],
    category: record.fields["Category"],
    flavor: record.fields["Flavor"],
    uom: record.fields["UOM"],
    count: record.fields["Sticks per Carton"],
    description: record.fields["Description"],
    status: record.fields["Status"],
  });
}

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
