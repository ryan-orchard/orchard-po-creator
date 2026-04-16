import { db } from "./supabase";

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
 * Log an event for a PO or WO. Fire-and-forget — errors are logged
 * but never block the calling API route.
 */
export function logActivity(params: LogActivityParams): void {
  const recordType = params.woId ? "wo" : "po";
  const recordId = params.woId ?? params.poId;

  if (!recordId) {
    console.error("[activity-log] No poId or woId provided");
    return;
  }

  db.schema("orchard_calcs")
    .from("events")
    .insert({
      record_type: recordType,
      record_id: recordId,
      event_type: params.action,
      payload: {
        description: params.description,
        relatedRecordType: params.relatedRecordType ?? null,
        relatedRecordId: params.relatedRecordId ?? null,
      },
      created_by: params.actor,
    })
    .then(({ error }) => {
      if (error) console.error("[activity-log] Failed to log event:", error);
    });
}
