import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

export async function GET() {
  const records = await getRecords(TABLES.SUPPLIERS, {
    sort: [{ field: "Supplier Name", direction: "asc" }],
  });

  const suppliers = records.map((r) => ({
    id: r.id,
    name: r.fields["Supplier Name"] as string,
    type: r.fields["Type"] as string,
    address: r.fields["Address"] as string,
    city: r.fields["City"] as string,
    state: r.fields["State"] as string,
    zip: r.fields["Zip"] as string,
    contactName: r.fields["Contact Name"] as string,
    contactEmail: r.fields["Contact Email"] as string,
    paymentTerms: r.fields["Payment Terms"] as string,
  }));

  return NextResponse.json(suppliers);
}
