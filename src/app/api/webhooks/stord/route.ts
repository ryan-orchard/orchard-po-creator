import { NextRequest, NextResponse } from "next/server";

// Stord webhook — DISABLED 2026-05-18.
//
// The webhook captured wrong quantities and missed ~64% of receipts (compared
// against the Stord Inventory Adjustments report). Receipts now flow in via
// the daily inventory adjustments report emailed to magna@orchardinventory.com.
// See sql/020-stord-2026-backfill.sql for the historical reload.
//
// This route returns 200 so Stord's webhook config doesn't error or retry.
// Don't delete the route — Stord still has this URL configured.

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest) {
  return NextResponse.json({ status: "disabled", note: "Webhook deprecated; receipts now ingested from daily report email." });
}
