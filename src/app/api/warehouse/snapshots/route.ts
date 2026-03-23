import { NextResponse } from "next/server";
import {
  getRecords,
  createRecords,
  deleteRecords,
  TABLES,
} from "@/lib/airtable";

// POST — Upload a new inventory snapshot (replaces existing for that warehouse)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { warehouseCode, date, lines } = body as {
      warehouseCode: string;
      date: string;
      lines: { skuRecordId: string; qty: number }[];
    };

    if (!warehouseCode || !date || !lines?.length) {
      return NextResponse.json(
        { error: "Missing required fields: warehouseCode, date, lines" },
        { status: 400 }
      );
    }

    // Find warehouse record ID by code
    const warehouses = await getRecords(TABLES.WAREHOUSES, {
      filterByFormula: `{Code} = "${warehouseCode}"`,
    });
    if (warehouses.length === 0) {
      return NextResponse.json(
        { error: `Warehouse "${warehouseCode}" not found` },
        { status: 404 }
      );
    }
    const warehouseId = warehouses[0].id;

    // Delete existing snapshot records for this warehouse
    const existing = await getRecords(TABLES.INVENTORY_SNAPSHOTS);
    const toDelete = existing
      .filter((r) => {
        const whLinks = r.fields["Warehouse"] as string[] | undefined;
        return whLinks?.includes(warehouseId);
      })
      .map((r) => r.id);

    if (toDelete.length > 0) {
      await deleteRecords(TABLES.INVENTORY_SNAPSHOTS, toDelete);
    }

    // Create new snapshot records
    const source = warehouseCode === "BMC" ? "BMC Report" : "Manual";
    const records = lines.map((line, idx) => ({
      fields: {
        "Snapshot ID": `${warehouseCode}-${date}-${String(idx + 1).padStart(3, "0")}`,
        Warehouse: [warehouseId],
        SKU: [line.skuRecordId],
        "Qty On Hand": line.qty,
        "Snapshot Date": date,
        Source: source,
      },
    }));

    const created = await createRecords(TABLES.INVENTORY_SNAPSHOTS, records);

    return NextResponse.json({
      success: true,
      skusImported: created.length,
      totalUnits: lines.reduce((sum, l) => sum + l.qty, 0),
      warehouseCode,
      snapshotDate: date,
    });
  } catch (error) {
    console.error("Snapshot upload error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to upload snapshot",
      },
      { status: 500 }
    );
  }
}

// GET — List snapshot history
export async function GET() {
  try {
    const [snapshots, warehouses] = await Promise.all([
      getRecords(TABLES.INVENTORY_SNAPSHOTS),
      getRecords(TABLES.WAREHOUSES),
    ]);

    // Build warehouse lookup
    const warehouseMap = new Map<string, string>();
    for (const wh of warehouses) {
      warehouseMap.set(wh.id, (wh.fields["Code"] as string) || (wh.fields["Name"] as string) || wh.id);
    }

    // Group by warehouse + date
    const groups = new Map<string, { warehouse: string; date: string; count: number; totalUnits: number }>();

    for (const s of snapshots) {
      const whLinks = s.fields["Warehouse"] as string[] | undefined;
      const whCode = whLinks?.[0] ? warehouseMap.get(whLinks[0]) || "Unknown" : "Unknown";
      const date = (s.fields["Snapshot Date"] as string) || "Unknown";
      const key = `${whCode}-${date}`;
      const qty = (s.fields["Qty On Hand"] as number) || 0;

      const existing = groups.get(key);
      if (existing) {
        existing.count++;
        existing.totalUnits += qty;
      } else {
        groups.set(key, { warehouse: whCode, date, count: 1, totalUnits: qty });
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
