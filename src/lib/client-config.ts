import skuMappingData from "@/../clients/magna/config/stord-sku-mapping.json";

export const SKU_MAPPING: Record<
  string,
  { standardSku: string; airtableId: string } | null
> = skuMappingData as Record<
  string,
  { standardSku: string; airtableId: string } | null
>;

// BMC Item No. → Standard SKU mapping
export const BMC_SKU_MAP: Record<string, string> = {
  // Raw materials (sticks from ANS)
  SINAJU0101: "ELEC-APPLEJUICE-STICK",
  SINBLO0101: "ELEC-BLOODORANGE-STICK",
  SINLML0101: "ELEC-LEMONLIME-STICK",
  SINTLM0101: "ELEC-TEALEMONADE-STICK",
  SINWML0101: "ELEC-WATERMELONLIME-STICK",
  // Packaging (cartons, seals, master cases)
  PKGAJU1001: "PKG-APPLEJUICE-10",
  PKGBLO1001: "PKG-BLOODORANGE-10",
  PKGLML1001: "PKG-LEMONLIME-10",
  PKGTLM1001: "PKG-TEALEMONADE-10",
  PKGWML1001: "PKG-WATERMELONLIME-10",
  PKGWAF1001: "PKG-WAFERSEAL",
  PKGMCP1001: "PKG-MASTERCASE",
  // Finished goods (cases — 6 × 10ct = 60 sticks)
  MAGAJU1001: "ELEC-APPLEJUICE-60",
  MAGBLO1001: "ELEC-BLOODORANGE-60",
  MAGLML1001: "ELEC-LEMONLIME-60",
  MAGTLM1001: "ELEC-TEALEMONADE-60",
  MAGWML1001: "ELEC-WATERMELONLIME-60",
};

// Stord facility identifiers → our warehouse code
const FACILITY_MAP: Record<string, string> = {
  // UUID mapping (from webhooks)
  "7e59a430-ae3b-4915-8414-6c064d0b9876": "STORD",
  // Alias mapping (from API sync / adjustments report)
  RNOs003: "STORD",
  RNOs004: "STORD",
};

/**
 * Resolve a Stord facility identifier (UUID or alias) to our warehouse code.
 */
export function resolveFacilityCode(facilityId: string): string {
  return FACILITY_MAP[facilityId] ?? facilityId;
}
