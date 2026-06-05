import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { setReceiptLineFlag } from "@/lib/receipt-status";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  try {
    const { id } = await params;
    const { error } = await setReceiptLineFlag(id, "excluded");
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to exclude: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
