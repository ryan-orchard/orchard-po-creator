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
};

export interface AirtableRecord {
  id: string;
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
