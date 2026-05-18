import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { setReceiptLineStatus } from "@/lib/receipt-status";

/**
 * POST /api/receipt-lines/[id]/restore
 *
 * Restores a receipt line status to Unmatched.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  try {
    const { id } = await params;

    const { error } = await setReceiptLineStatus(id, "Unmatched");
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to restore: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
