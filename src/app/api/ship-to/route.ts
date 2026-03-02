import { NextRequest, NextResponse } from "next/server";
import { getRecords, createRecord, TABLES } from "@/lib/airtable";

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

export async function POST(request: NextRequest) {
  const body = await request.json();

  const record = await createRecord(TABLES.SHIP_TO, {
    Name: body.name,
    Address: body.address || "",
    City: body.city || "",
    State: body.state || "",
    Zip: body.zip || "",
    "Is Default": false,
  });

  return NextResponse.json({
    id: record.id,
    name: record.fields["Name"] as string,
    address: record.fields["Address"] as string,
    city: record.fields["City"] as string,
    state: record.fields["State"] as string,
    zip: record.fields["Zip"] as string,
    isDefault: false,
  });
}
