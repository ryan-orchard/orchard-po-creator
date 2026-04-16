"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// The old Match App has been retired.
// Links that used /match?from=invoice&id=X now go to /invoices/X directly.
export default function MatchPageRedirect() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const from = params.get("from");
    const id = params.get("id");

    if (from === "invoice" && id) {
      router.replace(`/invoices/${id}`);
    } else if (from === "receipt" && id) {
      router.replace(`/receipts/${id}`);
    } else if (from === "po" && id) {
      router.replace(`/pos/${id}`);
    } else {
      router.replace("/invoices");
    }
  }, [router, params]);

  return null;
}
