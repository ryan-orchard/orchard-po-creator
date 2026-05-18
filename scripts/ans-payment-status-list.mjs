/**
 * List ANS invoices and compare against a user-provided payment status list.
 * Read-only: prints proposed changes, does NOT update.
 * Usage: node --env-file=.env.local scripts/ans-payment-status-list.mjs
 */
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// User's list: invoice_number → status from screenshot
// "Past due" treated as "Unpaid" for our system (no Past due payment status).
const USER_LIST = {
  "538279": "Unpaid", "538264": "Unpaid", "538263": "Unpaid", "538262": "Unpaid",
  "538265": "Unpaid", "538266": "Unpaid", "538267": "Unpaid", "538168": "Unpaid",
  "538167": "Unpaid", "538076": "Unpaid", "538073": "Unpaid", "537983": "Unpaid",
  "537979": "Unpaid", "537977": "Unpaid", "537987": "Unpaid", "537981": "Unpaid",
  "537980": "Unpaid", "537978": "Unpaid", "537986": "Unpaid", "537982": "Unpaid",
  "537988": "Unpaid",
  "537870": "Unpaid", // Past due → Unpaid
  "537843": "Paid", "537844": "Paid", "537742": "Paid", "537730": "Paid",
  "537646": "Paid", "537645": "Paid", "537647": "Paid", "537640": "Paid",
  "537633": "Paid", "537634": "Paid", "537629": "Paid", "537480": "Paid",
  "537494": "Paid", "537488": "Paid", "537416": "Paid", "537417": "Paid",
  "537406": "Paid", "537372": "Paid", "537371": "Paid",
  // CFC-001964 looks like a freight/customs invoice, not ANS — included in case
  "CFC-001964": "Unpaid", // Past due → Unpaid
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
  // Truncated entries from the screenshot — left as best guesses
  "010-2": "Paid", "10": "Paid", "6": "Paid", "006-2": "Paid",
};

async function main() {
  // Find ANS supplier
  const { data: suppliers, error: supErr } = await db
    .schema("org_config")
    .from("suppliers")
    .select("id, name, code");
  if (supErr) throw supErr;

  const ans = suppliers.find(
    (s) => s.code === "ANS" || /^ANS\b/i.test(s.name || "")
  );
  if (!ans) {
    console.error("ANS supplier not found. Suppliers:", suppliers.map((s) => `${s.code}/${s.name}`));
    process.exit(1);
  }
  console.log(`ANS supplier: id=${ans.id} name=${ans.name} code=${ans.code}`);

  // Fetch all ANS invoices
  const { data: invoices, error: invErr } = await db
    .schema("orchard")
    .from("invoices")
    .select("id, invoice_number, invoice_type, total_amount")
    .eq("supplier_id", ans.id);
  if (invErr) throw invErr;
  console.log(`Total ANS invoices in system: ${invoices.length}`);

  // Fetch current statuses for all
  const ids = invoices.map((i) => i.id);
  const { data: statuses, error: stErr } = await db
    .schema("orchard_calcs")
    .from("invoice_statuses")
    .select("invoice_id, payment_status, match_status")
    .in("invoice_id", ids);
  if (stErr) throw stErr;
  const statusByInv = new Map(statuses.map((s) => [s.invoice_id, s]));

  // Build a lookup by invoice_number. Try exact, and also strip leading zeros
  // since the system stores ANS invoices as "00538279" but the user pasted "538279".
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

  console.log("");
  console.log("=== Proposed changes ===");
  let willUpdate = 0;
  let alreadyMatches = 0;
  let notInSystem = 0;

  for (const [num, desiredStatus] of Object.entries(USER_LIST)) {
    const inv = invByNumber.get(norm(num));
    if (!inv) {
      console.log(`SKIP   ${num.padEnd(14)} → not in system`);
      notInSystem++;
      continue;
    }
    const current = statusByInv.get(inv.id)?.payment_status ?? "Unpaid";
    if (current === desiredStatus) {
      alreadyMatches++;
      continue;
    }
    console.log(`UPDATE ${String(num).padEnd(14)} ${current.padEnd(8)} → ${desiredStatus}    (id=${inv.id}, type=${inv.invoice_type})`);
    willUpdate++;
  }

  console.log("");
  console.log(`Summary: ${willUpdate} to update, ${alreadyMatches} already matching, ${notInSystem} not in system`);
  console.log(`(Total in user list: ${Object.keys(USER_LIST).length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
