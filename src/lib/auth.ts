import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export type UserRole = "operator" | "viewer";

export async function getUserRole(): Promise<UserRole> {
  const { sessionClaims } = await auth();
  const role = (sessionClaims?.publicMetadata as { role?: string })?.role;
  return role === "viewer" ? "viewer" : "operator";
}

// Returns a 403 response if the user is not an operator, null if OK.
// Usage in API routes: const authError = await requireOperator(); if (authError) return authError;
export async function requireOperator(): Promise<NextResponse | null> {
  const role = await getUserRole();
  if (role !== "operator") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
