import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ANS_ID = "70d8c507-37f3-48a7-86a2-4373fecaaecb";

const { data, error } = await db
  .schema("orchard")
  .from("invoices")
  .select("invoice_number, invoice_date, invoice_type, total_amount")
  .eq("supplier_id", ANS_ID)
  .order("invoice_date", { ascending: false });

if (error) throw error;
console.log(`ANS invoices: ${data.length}`);
for (const i of data) {
  console.log(`${(i.invoice_number ?? "").padEnd(20)} ${i.invoice_date ?? ""}  ${i.invoice_type ?? ""}  $${i.total_amount}`);
}
