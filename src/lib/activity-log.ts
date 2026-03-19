import { createRecord, TABLES } from "./airtable";

interface LogActivityParams {
  poId: string;
  action: string;
  description: string;
  actor: "Ryan Belanger" | "Orchard AI";
  relatedRecordType?: "shipment" | "receipt" | "invoice" | "po";
  relatedRecordId?: string;
}

/**
 * Log an activity entry for a PO. Fire-and-forget — errors are logged
 * but never block the calling API route.
 */
export function logActivity(params: LogActivityParams): void {
  const fields: Record<string, unknown> = {
    Description: params.description,
    "Purchase Order": [params.poId],
    "PO Record ID": params.poId,
    Action: params.action,
    Actor: params.actor,
  };

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
