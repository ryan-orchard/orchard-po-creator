const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const BASE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

const headers = {
  Authorization: `Bearer ${AIRTABLE_API_KEY}`,
  "Content-Type": "application/json",
};

// Table IDs
export const TABLES = {
  SUPPLIERS: "tblSLIR0VhQLtR86J",
  SKUS: "tblWsQCZxKtLTRyK3",
  SHIP_TO: "tblbqGnSNW73ERvtb",
  PURCHASE_ORDERS: "tbl711R2Jksca6GIg",
  PO_LINE_ITEMS: "tblEcEunHZgysdz4t",
  SHIPMENTS: "tblJ7git6niHxXszj",
  SHIPMENT_LINES: "tbltFOuTRS4iBMCIL",
  RECEIPTS: "tbl2jmxFtJYFDFALa",
  RECEIPT_LINES: "tbllMDF4pUw5T4q8T",
  WAREHOUSES: "tblbqGnSNW73ERvtb",
  INVOICES: "tblsqhIIwY94HPW4j",
  INVOICE_LINES: "tblmVy4gKNijRTFEm",
  ACTIVITY_LOG: "tbllLQCZQj16oc0zX",
  INVENTORY_SNAPSHOTS: "tblXFUhjdVW7uGtK1",
  WORK_ORDERS: "tblEVzkLvd7Vfb5LB",
  WORK_ORDER_LINES: "tblFOVJ9GA479tcJZ",
};

export interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

export async function getRecords(
  tableId: string,
  options?: { filterByFormula?: string; sort?: { field: string; direction: "asc" | "desc" }[] }
): Promise<AirtableRecord[]> {
  const params = new URLSearchParams();
  if (options?.filterByFormula) {
    params.set("filterByFormula", options.filterByFormula);
  }
  if (options?.sort) {
    options.sort.forEach((s, i) => {
      params.set(`sort[${i}][field]`, s.field);
      params.set(`sort[${i}][direction]`, s.direction);
    });
  }

  const allRecords: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    if (offset) params.set("offset", offset);
    const url = `${BASE_URL}/${tableId}?${params.toString()}`;
    const res = await fetch(url, { headers, next: { revalidate: 0 } });
    const data = await res.json();
    allRecords.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return allRecords;
}

export async function createRecord(
  tableId: string,
  fields: Record<string, unknown>
): Promise<AirtableRecord> {
  const res = await fetch(`${BASE_URL}/${tableId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ records: [{ fields }] }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Airtable error: ${data.error.message || data.error.type || JSON.stringify(data.error)}`);
  }
  return data.records[0];
}

export async function createRecords(
  tableId: string,
  records: { fields: Record<string, unknown> }[]
): Promise<AirtableRecord[]> {
  // Airtable max 10 records per request
  const allCreated: AirtableRecord[] = [];
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const res = await fetch(`${BASE_URL}/${tableId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ records: batch }),
    });
    const data = await res.json();
    if (data.error) {
      throw new Error(`Airtable error: ${data.error.message || data.error.type || JSON.stringify(data.error)}`);
    }
    allCreated.push(...(data.records || []));
  }
  return allCreated;
}

export async function updateRecord(
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<AirtableRecord> {
  const res = await fetch(`${BASE_URL}/${tableId}/${recordId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  return res.json();
}

export async function getRecord(
  tableId: string,
  recordId: string
): Promise<AirtableRecord> {
  const res = await fetch(`${BASE_URL}/${tableId}/${recordId}`, {
    headers,
    next: { revalidate: 0 },
  });
  return res.json();
}

export async function deleteRecord(
  tableId: string,
  recordId: string
): Promise<void> {
  await fetch(`${BASE_URL}/${tableId}/${recordId}`, {
    method: "DELETE",
    headers,
  });
}

export async function deleteRecords(
  tableId: string,
  recordIds: string[]
): Promise<void> {
  // Airtable max 10 records per delete request
  for (let i = 0; i < recordIds.length; i += 10) {
    const batch = recordIds.slice(i, i + 10);
    const params = batch.map((id) => `records[]=${id}`).join("&");
    await fetch(`${BASE_URL}/${tableId}?${params}`, {
      method: "DELETE",
      headers,
    });
  }
}

/**
 * Fetch records by ID in batches to avoid Airtable 5 req/sec rate limit.
 */
export async function fetchInBatches<T>(
  ids: string[],
  fn: (id: string) => Promise<T>,
  batchSize = 5
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < ids.length) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return results;
}
