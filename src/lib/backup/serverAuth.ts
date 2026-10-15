import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export interface AuthenticatedUserContext {
  uid: string;
  tenantId: string;
  role: "owner" | "admin" | "staff" | "cashier";
  email?: string;
}

export interface TenantAuthVerificationResult {
  authorized: boolean;
  statusCode?: 401 | 403;
  error?: string;
  user?: AuthenticatedUserContext;
}

// In-memory registry of test mock tokens for unit/integration testing without live auth
const mockTestTokens: Map<string, AuthenticatedUserContext> = new Map([
  [
    "test_token_tenant_alpha_admin",
    { uid: "usr_alpha_admin", tenantId: "tenant_alpha_ltd", role: "admin", email: "admin@alpha.com" }
  ],
  [
    "test_token_tenant_alpha_owner",
    { uid: "usr_alpha_owner", tenantId: "tenant_alpha_ltd", role: "owner", email: "owner@alpha.com" }
  ],
  [
    "test_token_tenant_alpha_staff",
    { uid: "usr_alpha_staff", tenantId: "tenant_alpha_ltd", role: "staff", email: "staff@alpha.com" }
  ],
  [
    "test_token_tenant_beta_admin",
    { uid: "usr_beta_admin", tenantId: "tenant_beta_as", role: "admin", email: "admin@beta.com" }
  ]
]);

export function registerMockAuthToken(token: string, user: AuthenticatedUserContext): void {
  mockTestTokens.set(token, user);
}

/**
 * Server-Side Authentication & Multi-Tenant Authorization Guard
 * 
 * Security Invariants:
 * 1. Checks valid Firebase ID token in Authorization header.
 * 2. Never trusts client-supplied tenantId alone.
 * 3. Resolves user's assigned tenantId and role from Firestore/Auth.
 * 4. Strictly checks user's tenantId matches the requested URL tenantId.
 * 5. Requires 'owner' or 'admin' role to trigger backups or read backup metadata.
 */
export async function verifyServerTenantAuth(
  authHeader: string | undefined,
  requestedTenantId: string,
  options: {
    requiredRole?: ("owner" | "admin")[];
    firestoreDb?: any;
  } = {}
): Promise<TenantAuthVerificationResult> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      authorized: false,
      statusCode: 401,
      error: "Yetkisiz Erişim: 'Authorization: Bearer <ID_TOKEN>' başlığı zorunludur."
    };
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return {
      authorized: false,
      statusCode: 401,
      error: "Yetkisiz Erişim: Boş kimlik doğrulama token'ı."
    };
  }

  const isProduction = process.env.NODE_ENV === "production";

  // Check test mock tokens in non-production environments
  if (!isProduction && mockTestTokens.has(token)) {
    const mockUser = mockTestTokens.get(token)!;

    // Cross-tenant check
    if (mockUser.tenantId !== requestedTenantId) {
      return {
        authorized: false,
        statusCode: 403,
        error: `Güvenlik İhlali: Kullanıcı (${mockUser.uid}) ait olduğu işletme (${mockUser.tenantId}) dışındaki bir işletmenin (${requestedTenantId}) verilerine erişemez.`
      };
    }

    // Role check
    const requiredRoles = options.requiredRole || ["owner", "admin"];
    if (!requiredRoles.includes(mockUser.role as any)) {
      return {
        authorized: false,
        statusCode: 403,
        error: `Yetkisiz Rol: Bulut yedekleme işlemleri yalnızca şirket sahibi veya yöneticisi tarafından gerçekleştirilebilir. (Mevcut rol: ${mockUser.role})`
      };
    }

    return { authorized: true, user: mockUser };
  }

  // Real Firebase Admin ID Token Verification
  try {
    let decodedToken: DecodedIdToken;

    if (!getApps().length) {
      initializeApp();
    }

    decodedToken = await getAuth().verifyIdToken(token);

    // Resolve tenantId and role
    const uid = decodedToken.uid;
    let tenantId = (decodedToken.tenantId || decodedToken.companyId) as string | undefined;
    let role = (decodedToken.role as "owner" | "admin" | "staff" | "cashier") || "staff";

    // Query Firestore user document if custom claims do not contain tenantId
    if (!tenantId || !decodedToken.role) {
      const db = options.firestoreDb || getFirestore();
      const userDoc = await db.collection("users").doc(uid).get();

      if (userDoc.exists) {
        const userData = userDoc.data();
        tenantId = userData?.tenantId || uid;
        role = userData?.role || role;
      } else {
        tenantId = uid; // fallback for initial bootstrap
      }
    }

    // Verify tenant isolation
    if (tenantId !== requestedTenantId) {
      return {
        authorized: false,
        statusCode: 403,
        error: `Güvenlik İhlali: Kullanıcı (${uid}) ait olduğu işletme (${tenantId}) dışındaki bir işletmenin (${requestedTenantId}) verilerine erişemez.`
      };
    }

    // Verify role permissions
    const requiredRoles = options.requiredRole || ["owner", "admin"];
    if (!requiredRoles.includes(role as any)) {
      return {
        authorized: false,
        statusCode: 403,
        error: `Yetkisiz Rol: Bulut yedekleme işlemleri yalnızca şirket sahibi veya yöneticisi tarafından gerçekleştirilebilir. (Mevcut rol: ${role})`
      };
    }

    return {
      authorized: true,
      user: {
        uid,
        tenantId,
        role,
        email: decodedToken.email
      }
    };
  } catch (err: any) {
    return {
      authorized: false,
      statusCode: 401,
      error: `Geçersiz veya süresi dolmuş kimlik doğrulama token'ı: ${err.message}`
    };
  }
}
