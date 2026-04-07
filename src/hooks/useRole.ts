"use client";

import { useUser } from "@clerk/nextjs";

export type UserRole = "operator" | "viewer";

export function useRole() {
  const { user, isLoaded } = useUser();
  const role = ((user?.publicMetadata?.role as string) ?? "operator") as UserRole;
  return {
    role,
    isOperator: role === "operator",
    isViewer: role === "viewer",
    isLoaded,
  };
}
