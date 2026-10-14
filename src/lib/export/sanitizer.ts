/**
 * Sensitive Data Sanitizer for Export & Backup
 * Guarantees that credentials, internal secrets, and cross-tenant leaks are purged before file creation.
 */

const FORBIDDEN_KEYS = new Set([
  "secret",
  "secretkey",
  "apikey",
  "privatekey",
  "accesstoken",
  "refreshtoken",
  "password",
  "passwordhash",
  "webhooksecret",
  "iyzicosecret",
  "stripesecret",
  "serviceaccount",
  "authcredential",
  "sessionid",
  "bearer"
]);

/**
 * Strips any sensitive properties from an object recursively.
 */
export function sanitizeRecord<T>(record: T): T {
  if (!record || typeof record !== "object") {
    return record;
  }

  if (Array.isArray(record)) {
    return record.map(item => sanitizeRecord(item)) as unknown as T;
  }

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Skip forbidden secret keys
    if (FORBIDDEN_KEYS.has(normalizedKey)) {
      continue;
    }

    if (value !== null && typeof value === "object") {
      sanitized[key] = sanitizeRecord(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}

/**
 * Validates that an array of records belongs exclusively to the specified tenant.
 * Any record with a different tenantId is purged immediately.
 */
export function enforceTenantIsolation<T extends { tenantId?: string; userId?: string }>(
  records: T[],
  expectedTenantId: string,
  expectedUserId: string
): T[] {
  return records.filter(r => {
    // If tenantId exists, it must strictly match expectedTenantId
    if (r.tenantId) {
      return r.tenantId === expectedTenantId;
    }
    // Fallback legacy tenant check: userId must match
    if (r.userId) {
      return r.userId === expectedUserId;
    }
    // Safety: reject if neither matches
    return false;
  }).map(r => sanitizeRecord(r));
}

export { sanitizeCsvCell } from "./csvUtils";
