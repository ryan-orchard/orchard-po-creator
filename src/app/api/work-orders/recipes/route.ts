import { NextResponse } from "next/server";

// WO recipe system retired — work order lines are entered manually via the WO form
export async function GET() {
  return NextResponse.json({ error: "WO recipes endpoint retired" }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: "WO recipes endpoint retired" }, { status: 410 });
}
