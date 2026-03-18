import { NextResponse } from "next/server";
import { updateRecord, TABLES } from "@/lib/airtable";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const fields: Record<string, unknown> = {
    "Standard SKU": body.standardSku,
    "Category": body.category,
    "Flavor": body.flavor,
    "UOM": body.uom,
    "Description": body.description,
    "Status": body.status,
    "Sticks per Carton": body.uom === "Carton" && body.count != null ? Number(body.count) : null,
  };
  const record = await updateRecord(TABLES.SKUS, id, fields);
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
