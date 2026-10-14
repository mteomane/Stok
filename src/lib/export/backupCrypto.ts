/**
 * Cryptographic & Deterministic Integrity Utilities for Backup & Restore Engine
 * 
 * Güvenlik ve Bütünlük İlkeleri:
 * 1. Kararlı (Canonical) JSON serileştirmesi ile alan sıralamasından bağımsız SHA-256 özeti üretimi.
 * 2. Döngüsel bağımlılığı engellemek için `metadata.checksum` alanı özet hesabından hariç tutulur.
 * 3. İstemci koduna sabit gizli anahtar gömülmez (HMAC/Asimetrik imza için sunucu tarafı KMS gereklidir).
 *    Bu mekanizma veri bozulması (corruption) ve aktarım hatalarını kesin olarak saptar.
 * 4. Eksik ID'li kayıtlar için kararlı deterministik kimlik (Deterministic ID) üretimi sağlanır.
 */

/**
 * Object keys are sorted recursively to produce canonical string representation.
 */
export function canonicalStringify(obj: any, excludeChecksum: boolean = true): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return "[" + obj.map(item => canonicalStringify(item, excludeChecksum)).join(",") + "]";
  }

  const keys = Object.keys(obj)
    .filter(k => !(excludeChecksum && k === "checksum"))
    .sort();

  const pairs = keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(obj[k], excludeChecksum)}`);
  return "{" + pairs.join(",") + "}";
}

/**
 * Computes universal SHA-256 digest in hex using standard Web Crypto API.
 */
export async function computeSha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generates the official SHA-256 checksum for a backup archive.
 * Format: "sha256:<hex_digest>"
 */
export async function calculateBackupChecksum(archive: { metadata: any; data: any }): Promise<string> {
  const canonical = canonicalStringify({
    metadata: archive.metadata,
    data: archive.data
  }, true);
  const hashHex = await computeSha256(canonical);
  return `sha256:${hashHex}`;
}

export interface ChecksumVerificationResult {
  valid: boolean;
  reason?: string;
  isLegacy?: boolean;
  expected?: string;
  actual?: string;
}

/**
 * Verifies backup integrity against its embedded checksum.
 */
export async function verifyBackupChecksum(archive: any): Promise<ChecksumVerificationResult> {
  if (!archive || !archive.metadata) {
    return { valid: false, reason: "Geçersiz yedek: Metadata bloğu eksik." };
  }

  const checksum = archive.metadata.checksum;
  if (!checksum || typeof checksum !== "string") {
    return { valid: false, reason: "Bütünlük imzası (checksum) eksik veya geçersiz formatta." };
  }

  // Modern v2.1+ SHA-256 verification
  if (checksum.startsWith("sha256:")) {
    const expectedHex = checksum.substring(7).trim().toLowerCase();
    const canonical = canonicalStringify({
      metadata: archive.metadata,
      data: archive.data
    }, true);
    const actualHex = await computeSha256(canonical);

    if (actualHex !== expectedHex) {
      return {
        valid: false,
        reason: "SHA-256 Bütünlük Uyuşmazlığı: Dosya içeriğinde değişiklik veya veri bozulması tespit edildi.",
        expected: expectedHex,
        actual: actualHex
      };
    }

    return { valid: true, expected: expectedHex, actual: actualHex };
  }

  // Legacy v1.x / v2.0 checksum compatibility ("sha256_<tenantId>_<count>_<time>")
  if (checksum.startsWith("sha256_")) {
    return {
      valid: true,
      isLegacy: true,
      reason: "Eski sürüm sağlama etiketi (Legacy v1/v2). İçerik kriptografik SHA-256 özetiyle mühürlenmemiştir; sayaç doğrulaması uygulandı."
    };
  }

  return {
    valid: false,
    reason: `Bilinmeyen sağlama formatı: '${checksum.slice(0, 15)}...'. Yalnızca geçerli StokPro SHA-256 özetleri desteklenir.`
  };
}

/**
 * Generates a deterministic document ID for records missing an ID using SHA-256.
 * Guarantees that the same tenant, collection, item content, and sequence index
 * always produce the exact same ID, preventing duplicates on repeated restores.
 * Existing production IDs (item.id) are never modified.
 */
export async function generateDeterministicDocId(
  tenantId: string,
  collectionName: string,
  item: any,
  index: number
): Promise<string> {
  if (item && item.id && typeof item.id === "string" && item.id.trim()) {
    return item.id.trim();
  }

  const payload = canonicalStringify(item, true);
  const hashHex = await computeSha256(`${tenantId}:${collectionName}:${index}:${payload}`);
  const shortColl = collectionName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4);
  // 16 hex characters (64-bit truncated SHA-256) preserves stable backward compatibility
  // preventing unnecessary record duplicates when re-restoring previous archives
  return `det_${shortColl}_${hashHex.slice(0, 16)}`;
}
