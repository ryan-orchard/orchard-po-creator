import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

// POST — Upload a new inventory snapshot (replaces existing for that warehouse+date)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { warehouseCode, date, lines } = body as {
      warehouseCode: string;
      date: string;
      lines: { sku: string; itemId?: string; qty: number; qtyOnHold?: number; baseUom?: string; palletCount?: number }[];
    };

    if (!warehouseCode || !date || !lines?.length) {
      return NextResponse.json(
        { error: "Missing required fields: warehouseCode, date, lines" },
        { status: 400 }
      );
    }

    // Delete existing snapshot for this warehouse+date, then insert fresh
    await db
      .schema("orchard")
      .from("inventory_snapshots")
      .delete()
      .eq("warehouse_code", warehouseCode)
      .eq("snapshot_date", date);

    const rows = lines.map((line) => ({
      client_id: "magna",
      warehouse_code: warehouseCode,
      snapshot_date: date,
      item_id: line.itemId || null,
      sku: line.sku,
      qty_on_hand: line.qty,
      qty_on_hold: line.qtyOnHold ?? 0,
      qty_available: line.qty - (line.qtyOnHold ?? 0),
      base_uom: line.baseUom || null,
      pallet_count: line.palletCount || null,
    }));

    const { data: created, error } = await db
      .schema("orchard")
      .from("inventory_snapshots")
      .insert(rows)
      .select("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      skusImported: created?.length || 0,
      totalUnits: lines.reduce((sum, l) => sum + l.qty, 0),
      warehouseCode,
      snapshotDate: date,
    });
  } catch (error) {
    console.error("Snapshot upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload snapshot" },
      { status: 500 }
    );
  }
}

// GET — List snapshot history
export async function GET() {
  try {
    const { data: snapshots, error } = await db
      .schema("orchard")
      .from("inventory_snapshots")
      .select("warehouse_code, snapshot_date, qty_on_hand")
      .order("snapshot_date", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Group by warehouse + date
    const groups = new Map<string, { warehouse: string; date: string; count: number; totalUnits: number }>();

    for (const s of snapshots || []) {
      const key = `${s.warehouse_code}-${s.snapshot_date}`;
      const qty = Number(s.qty_on_hand) || 0;
      const existing = groups.get(key);
      if (existing) {
        existing.count++;
        existing.totalUnits += qty;
      } else {
        groups.set(key, {
          warehouse: s.warehouse_code as string,
          date: s.snapshot_date as string,
          count: 1,
          totalUnits: qty,
        });
      }
    }

    const history = Array.from(groups.values()).sort((a, b) => b.date.localeCompare(a.date));
    return NextResponse.json({ snapshots: history });
  } catch (error) {
    console.error("Snapshot list error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list snapshots" },
      { status: 500 }
    );
  }
}
