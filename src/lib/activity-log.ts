import { createRecord, TABLES } from "./airtable";

interface LogActivityParams {
  poId?: string;
  woId?: string;
  action: string;
  description: string;
  actor: "Ryan Belanger" | "Orchard AI";
  relatedRecordType?: "shipment" | "receipt" | "invoice" | "po" | "work_order";
  relatedRecordId?: string;
}

/**
 * Log an activity entry for a PO or WO. Fire-and-forget — errors are logged
 * but never block the calling API route.
 */
export function logActivity(params: LogActivityParams): void {
  const fields: Record<string, unknown> = {
    Description: params.description,
    Action: params.action,
    Actor: params.actor,
  };

  if (params.poId) {
    fields["Purchase Order"] = [params.poId];
    fields["PO Record ID"] = params.poId;
  }

  if (params.woId) {
    fields["Work Orders"] = [params.woId];
  }

  if (params.relatedRecordType) {
    fields["Related Record Type"] = params.relatedRecordType;
  }
  if (params.relatedRecordId) {
    fields["Related Record ID"] = params.relatedRecordId;
  }

  createRecord(TABLES.ACTIVITY_LOG, fields).catch((err) => {
    console.error("[activity-log] Failed to log activity:", err);
  });
}
