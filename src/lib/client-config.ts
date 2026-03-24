import skuMappingData from "@/../clients/magna/config/stord-sku-mapping.json";

export const SKU_MAPPING: Record<
  string,
  { standardSku: string; airtableId: string } | null
> = skuMappingData as Record<
  string,
  { standardSku: string; airtableId: string } | null
>;

// Stord facility identifiers → our warehouse code
const FACILITY_MAP: Record<string, string> = {
  // UUID mapping (from webhooks)
  "7e59a430-ae3b-4915-8414-6c064d0b9876": "STORD",
  // Alias mapping (from API sync)
  RNOs003: "STORD",
};

/**
 * Resolve a Stord facility identifier (UUID or alias) to our warehouse code.
 */
export function resolveFacilityCode(facilityId: string): string {
  return FACILITY_MAP[facilityId] ?? facilityId;
}
