/**
 * Apply payment status updates for ANS invoices based on user's payments report.
 * Usage: node --env-file=.env.local scripts/ans-payment-status-update.mjs
 */
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ANS_ID = "70d8c507-37f3-48a7-86a2-4373fecaaecb";

const USER_LIST = {
  "538279": "Unpaid", "538264": "Unpaid", "538263": "Unpaid", "538262": "Unpaid",
  "538265": "Unpaid", "538266": "Unpaid", "538267": "Unpaid", "538168": "Unpaid",
  "538167": "Unpaid", "538076": "Unpaid", "538073": "Unpaid", "537983": "Unpaid",
  "537979": "Unpaid", "537977": "Unpaid", "537987": "Unpaid", "537981": "Unpaid",
  "537980": "Unpaid", "537978": "Unpaid", "537986": "Unpaid", "537982": "Unpaid",
  "537988": "Unpaid",
  "537870": "Unpaid",
  "537843": "Paid", "537844": "Paid", "537742": "Paid", "537730": "Paid",
  "537646": "Paid", "537645": "Paid", "537647": "Paid", "537640": "Paid",
  "537633": "Paid", "537634": "Paid", "537629": "Paid", "537480": "Paid",
  "537494": "Paid", "537488": "Paid", "537416": "Paid", "537417": "Paid",
  "537406": "Paid", "537372": "Paid", "537371": "Paid",
  "CFC-001964": "Unpaid",
  "537305": "Paid", "537297": "Paid", "537219": "Paid", "536917": "Paid",
  "536915": "Paid", "536916": "Paid", "536918": "Paid", "536919": "Paid",
  "536920": "Paid", "536922": "Paid", "536921": "Paid", "536841": "Paid",
  "536746": "Paid", "536748": "Paid", "536747": "Paid", "536745": "Paid",
  "536741": "Paid", "536613": "Paid", "536522": "Paid", "536501": "Paid",
  "536514": "Paid", "536506": "Paid", "536503": "Paid", "536505": "Paid",
  "536502": "Paid", "536510": "Paid", "536447": "Paid", "536419": "Paid",
  "536329": "Paid", "536328": "Paid", "536330": "Paid", "535446": "Paid",
  "535448": "Paid", "535445": "Paid", "535447": "Paid", "535362": "Paid",
  "535364": "Paid", "535360": "Paid", "535361": "Paid", "535226": "Paid",
  "535193": "Paid", "535121": "Paid", "534718": "Paid", "534161": "Paid",
  "534023": "Paid", "533921": "Paid", "533856": "Paid",
  "010-2": "Paid", "10": "Paid", "6": "Paid", "006-2": "Paid",
};

const { data: invoices, error: invErr } = await db
  .schema("orchard")
  .from("invoices")
  .select("id, invoice_number")
  .eq("supplier_id", ANS_ID);
if (invErr) throw invErr;

const norm = (s) => String(s ?? "").trim();
const stripZeros = (s) => norm(s).replace(/^0+/, "");
const invByNumber = new Map();
for (const i of invoices) {
  const raw = norm(i.invoice_number);
  invByNumber.set(raw, i);
  const stripped = stripZeros(raw);
  if (stripped && stripped !== raw && !invByNumber.has(stripped)) {
    invByNumber.set(stripped, i);
  }
}

const ids = invoices.map((i) => i.id);
const { data: statuses } = await db
  .schema("orchard_calcs")
  .from("invoice_statuses")
  .select("invoice_id, payment_status, match_status")
  .in("invoice_id", ids);
const statusByInv = new Map(statuses.map((s) => [s.invoice_id, s]));

const updates = [];
for (const [num, desired] of Object.entries(USER_LIST)) {
  const inv = invByNumber.get(norm(num));
  if (!inv) continue;
  const cur = statusByInv.get(inv.id);
  if (cur?.payment_status === desired) continue;
  updates.push({
    invoice_id: inv.id,
    invoice_number: inv.invoice_number,
    from: cur?.payment_status ?? "(none)",
    to: desired,
    // upsert payload — preserve existing match_status if there's a row
    payload: {
      invoice_id: inv.id,
      payment_status: desired,
      ...(cur?.match_status ? { match_status: cur.match_status } : {}),
      updated_by: "Ryan Belanger",
    },
  });
}

console.log(`Applying ${updates.length} updates…`);
for (const u of updates) {
  const { error } = await db
    .schema("orchard_calcs")
    .from("invoice_statuses")
    .upsert(u.payload, { onConflict: "invoice_id" });
  if (error) {
    console.error(`FAIL ${u.invoice_number}: ${error.message}`);
  } else {
    console.log(`OK   ${u.invoice_number}  ${u.from} → ${u.to}`);
  }
}
console.log("Done.");
