import { SectorField, Product, ProductMetadata } from "../types";

export interface SectorProfile {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  defaultUnit: string;
  allowedUnits: string[];
  supportsRolls: boolean; // Tekstil kumaş topu / metraj takibi
  supportsPackaging: boolean; // Koli/paket içi eksiltme
  badgeColor: string;
  fields: (SectorField & { placeholder?: string; tip?: string })[];
}

export const SECTOR_PROFILES: Record<string, SectorProfile> = {
  tekstil: {
    id: "tekstil",
    name: "Tekstil, Kumaş & Konfeksiyon",
    shortLabel: "Tekstil & Kumaş",
    description: "Kumaş topları (rulo) takibi, metraj kesimi, renk, en ve kumaş cinsi yönetimi.",
    defaultUnit: "Metre",
    allowedUnits: ["Metre", "Adet", "Top", "Kg", "Paket"],
    supportsRolls: true,
    supportsPackaging: true,
    badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    fields: [
      { key: "fabricType", label: "Kumaş Tipi", type: "text", required: false, placeholder: "Örn: Viskon, Pamuk, Poplin, Şifon" },
      { key: "color", label: "Renk / Varyasyon", type: "text", required: false, placeholder: "Örn: Gece Mavisi, Taş Grisi, Haki" },
      { key: "width", label: "Kumaş Eni (cm)", type: "text", required: false, placeholder: "Örn: 140 cm, 150 cm" },
      { key: "pattern", label: "Desen / Baskı", type: "text", required: false, placeholder: "Örn: Düz, Çiçekli, Çizgili" }
    ]
  },
  gida: {
    id: "gida",
    name: "Gıda & Hızlı Tüketim (Market / Toptan)",
    shortLabel: "Gıda & Market",
    description: "Son Tüketim Tarihi (SKT), Parti/Lot numarası, saklama koşulları ve gramaj takibi.",
    defaultUnit: "Adet",
    allowedUnits: ["Adet", "Kg", "Gram", "Litre", "Koli", "Paket"],
    supportsRolls: false,
    supportsPackaging: true,
    badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
    fields: [
      { key: "expiryDate", label: "Son Tüketim Tarihi (SKT)", type: "date", required: false, tip: "Tarihi yaklaşan ürünler otomatik uyarılır." },
      { key: "batchNumber", label: "Parti / Lot Numarası", type: "text", required: false, placeholder: "Örn: LOT-2026-44B" },
      { key: "storageCondition", label: "Saklama Koşulu", type: "text", required: false, placeholder: "Örn: +4°C Soğuk Hava, Kuru ve Serin" },
      { key: "producerBrand", label: "Üretici / Marka", type: "text", required: false, placeholder: "Örn: Sütaş, Pınar, Torku" }
    ]
  },
  yedek_parca: {
    id: "yedek_parca",
    name: "Otomotiv & Teknik Yedek Parça",
    shortLabel: "Yedek Parça",
    description: "Parça / OEM kodları, uyumlu araç/model uyumluluğu ve depo raf konumu.",
    defaultUnit: "Adet",
    allowedUnits: ["Adet", "Takım", "Kutu", "Çift"],
    supportsRolls: false,
    supportsPackaging: true,
    badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
    fields: [
      { key: "partNumber", label: "Parça / OEM Kodu", type: "text", required: false, placeholder: "Örn: 04E 115 561 H, 7701478505" },
      { key: "vehicleCompatibility", label: "Uyumlu Araç / Model", type: "text", required: false, placeholder: "Örn: VW Golf 7 / Passat B8 1.4 TSI" },
      { key: "shelfLocation", label: "Depo Raf / Göz Konumu", type: "text", required: false, placeholder: "Örn: Raf B-14 / Göz 2" },
      { key: "brand", label: "Üretici / Yan Sanayi", type: "text", required: false, placeholder: "Örn: Bosch, Valeo, Febi, Orijinal" }
    ]
  },
  genel: {
    id: "genel",
    name: "Genel Perakende & Diğer Ticaret",
    shortLabel: "Genel Perakende",
    description: "Evrensel stok, barkod, marka ve raf yönetimi.",
    defaultUnit: "Adet",
    allowedUnits: ["Adet", "Paket", "Koli", "Kutu"],
    supportsRolls: false,
    supportsPackaging: true,
    badgeColor: "bg-slate-50 text-slate-700 border-slate-200",
    fields: [
      { key: "barcode", label: "Barkod / EAN", type: "text", required: false, placeholder: "Örn: 8690000000000" },
      { key: "brand", label: "Marka", type: "text", required: false, placeholder: "Örn: Philips, Samsung, Yerli" },
      { key: "shelfLocation", label: "Raf Numarası", type: "text", required: false, placeholder: "Örn: Kat 1 / Reyon 4" }
    ]
  }
};

/**
 * Returns the sector profile or defaults to 'genel'
 */
export function getSectorProfile(sectorKey?: string): SectorProfile {
  if (!sectorKey) return SECTOR_PROFILES.genel;
  const normalized = sectorKey.toLowerCase().trim();
  if (SECTOR_PROFILES[normalized]) {
    return SECTOR_PROFILES[normalized];
  }
  if (normalized.includes("tekstil") || normalized.includes("kumaş") || normalized.includes("kumas")) {
    return SECTOR_PROFILES.tekstil;
  }
  if (normalized.includes("gıda") || normalized.includes("gida") || normalized.includes("market")) {
    return SECTOR_PROFILES.gida;
  }
  if (normalized.includes("parca") || normalized.includes("parça") || normalized.includes("oto")) {
    return SECTOR_PROFILES.yedek_parca;
  }
  return SECTOR_PROFILES.genel;
}

/**
 * Checks whether rolls (fabric rolls) should be visible and manageable for a product.
 * Respects existing textile products even if sector is set to general!
 */
export function shouldShowRolls(product: Product | null | undefined, activeSector?: string): boolean {
  if (!product) {
    const profile = getSectorProfile(activeSector);
    return profile.supportsRolls;
  }

  // 1. If product already has rolls defined, always preserve and show them!
  if (product.rolls && product.rolls.length > 0) {
    return true;
  }

  // 2. If product category is "Kumaş", show rolls
  const cat = (product.category || "").toLowerCase();
  if (cat.includes("kumaş") || cat.includes("kumas")) {
    return true;
  }

  // 3. Otherwise rely on active sector capability
  const profile = getSectorProfile(activeSector);
  return profile.supportsRolls;
}

/**
 * Normalizes and synchronizes metadata and attributes bidirectionally.
 * Guarantees zero data loss across legacy `attributes` and new `metadata`.
 */
export function syncSectorMetadata(input: {
  metadata?: ProductMetadata;
  attributes?: Record<string, string>;
}): { metadata: ProductMetadata; attributes: Record<string, string> } {
  const merged: Record<string, any> = {
    ...(input.attributes || {}),
    ...(input.metadata || {})
  };

  // Convert all stringifiable values for legacy attributes
  const cleanAttributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== null && v !== "") {
      cleanAttributes[k] = String(v);
    }
  }

  return {
    metadata: merged,
    attributes: cleanAttributes
  };
}
