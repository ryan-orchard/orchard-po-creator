import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

export async function GET() {
  const records = await getRecords(TABLES.SHIP_TO, {
    sort: [{ field: "Name", direction: "asc" }],
  });

  const locations = records.map((r) => ({
    id: r.id,
    name: r.fields["Name"] as string,
    address: r.fields["Address"] as string,
    city: r.fields["City"] as string,
    state: r.fields["State"] as string,
    zip: r.fields["Zip"] as string,
    isDefault: r.fields["Is Default"] as boolean,
  }));

  return NextResponse.json(locations);
}
