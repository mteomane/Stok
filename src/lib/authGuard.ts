import { auth } from "./firebase";

/**
 * Global compile-time flag injected by Vite build (`define`).
 * In production Vite builds, this is statically replaced with `false`.
 */
declare const __ALLOW_TEST_AUTH_OVERRIDE__: boolean | undefined;

/**
 * Detects whether the current runtime environment is production.
 * Evaluates Vite build flags (import.meta.env.PROD / MODE === 'production')
 * and Node process.env.NODE_ENV === 'production'.
 */
export function isProductionEnvironment(): boolean {
  if (typeof import.meta !== "undefined" && (import.meta as any).env) {
    if ((import.meta as any).env.PROD) return true;
    if ((import.meta as any).env.MODE === "production") return true;
  }
  if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "production") {
    return true;
  }
  // Browser live domain protection: Cloud Run (.run.app) or any non-localhost domain
  if (typeof window !== "undefined" && window.location) {
    const host = window.location.hostname;
    if (host && !host.includes("localhost") && !host.includes("127.0.0.1") && !host.includes("0.0.0.0")) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether test authentication override is strictly permitted.
 * Returns false in:
 * - Production builds (Vite define __ALLOW_TEST_AUTH_OVERRIDE__ === false, import.meta.env.PROD, NODE_ENV === 'production')
 * - Browser runtime (window/document exists; test override is exclusively for Node.js test runners)
 */
export function isTestOverrideAllowed(): boolean {
  // 1. Compile-time constant injected by bundler (cannot be spoofed at runtime)
  if (typeof __ALLOW_TEST_AUTH_OVERRIDE__ !== "undefined" && !__ALLOW_TEST_AUTH_OVERRIDE__) {
    return false;
  }

  // 2. Production environment detection (Vite PROD / MODE === 'production' / NODE_ENV === 'production')
  if (isProductionEnvironment()) {
    return false;
  }

  // 3. Browser environment check: tests run strictly in Node.js test runner processes (e.g. tsx scripts/...)
  // Browser clients must NEVER permit test override under any circumstance.
  if (typeof window !== "undefined" || typeof document !== "undefined") {
    return false;
  }

  // 4. Node.js environment check: NODE_ENV must NOT be production
  if (typeof process !== "undefined" && process.env) {
    if (process.env.NODE_ENV === "production") {
      return false;
    }
  }

  return true;
}

/**
 * Demo / LocalStorage fallback is strictly allowed ONLY in non-production (development) environments.
 * In production builds, this returns false unconditionally.
 */
export function isDemoAllowed(): boolean {
  return !isProductionEnvironment();
}

/**
 * Determines if a given UID represents an unauthenticated/synthetic demo user.
 * In production: ALWAYS returns false to prevent any localStorage authentication bypass.
 */
export function isDemoUser(uid?: string | null): boolean {
  if (!isDemoAllowed()) {
    return false;
  }
  return Boolean(uid && (uid === "demo-user" || uid.startsWith("local-") || uid.startsWith("demo-")));
}

/**
 * Asserts that the provided UID corresponds to a legitimately authenticated Firebase user.
 * In Production:
 * - Rejects null, undefined, or empty UIDs with Unauthorized error.
 * - Rejects "demo-user", "local-*", or any unauthenticated synthetic IDs.
 * 
 * In Development:
 * - If demo mode is active, permits the development demo user safely without polluting production.
 */
export function assertAuthenticated(uid: string | null | undefined, operationName?: string): string {
  const op = operationName ? `[${operationName}] ` : "";

  if (!uid || typeof uid !== "string" || uid.trim() === "") {
    throw new Error(`Unauthorized: ${op}Geçerli bir kullanıcı oturumu bulunamadı. Lütfen giriş yapın.`);
  }

  const isSynthetic = uid === "demo-user" || uid.startsWith("local-") || uid.startsWith("demo-");

  if (isProductionEnvironment()) {
    if (isSynthetic) {
      throw new Error(
        `Unauthorized: ${op}Demo veya yerel kullanıcılar (demo-user, local-*) production ortamında kesinlikle kullanılamaz.`
      );
    }
  } else {
    // In development mode:
    if (isSynthetic && !isDemoAllowed()) {
      throw new Error(`Unauthorized: ${op}Geliştirme ortamında demo kullanıcı erişimi kısıtlandı.`);
    }
  }

  return uid;
}

let testUidOverride: string | null = null;

/**
 * Sets an authenticated UID for test contexts without modifying production logic.
 * In production or browser environments: throws an Error immediately and rejects the call.
 */
export function setTestAuthenticatedUid(uid: string | null): void {
  if (!isTestOverrideAllowed()) {
    throw new Error(
      "Security Violation: [setTestAuthenticatedUid] Test kimlik override mekanizması üretim derlemesinde ve tarayıcı ortamında kesinlikle devre dışıdır."
    );
  }
  testUidOverride = uid;
}

/**
 * Retrieves the currently authenticated Firebase user's UID safely.
 * In production:
 * - Test override is strictly bypassed/ignored even if set.
 * - If auth.currentUser is not present, throws Unauthorized.
 * - Never falls back to "demo-user".
 */
export function getAuthenticatedUid(operationName?: string): string {
  // Defense-in-depth: testUidOverride can ONLY be used if isTestOverrideAllowed() is true!
  // In production builds, this branch is completely unreachable or evaluates to false.
  if (isTestOverrideAllowed() && testUidOverride) {
    return assertAuthenticated(testUidOverride, operationName);
  }

  const currentUser = auth.currentUser;
  if (!currentUser?.uid) {
    if (isDemoAllowed()) {
      return "demo-user";
    }
    throw new Error(`Unauthorized: ${operationName ? `[${operationName}] ` : ""}Oturum açmış kullanıcı bulunamadı.`);
  }

  return assertAuthenticated(currentUser.uid, operationName);
}
