import { UserRepository } from "../interfaces";
import { Tenant, TenantUser, TenantContext } from "../../../types";
import { db } from "../../firebase";
import { Firestore, doc, getDoc, setDoc } from "firebase/firestore";
import { assertAuthenticated, isDemoUser } from "../../authGuard";

const tenantContextCache = new Map<string, TenantContext>();

export function clearTenantContextCache(): void {
  tenantContextCache.clear();
}

export class FirebaseUserRepository implements UserRepository {
  private db: Firestore;

  constructor(customDb?: Firestore) {
    this.db = customDb || db;
  }

  async getOrCreateContext(uid: string, email?: string, displayName?: string): Promise<TenantContext> {
    // SECURITY ENFORCEMENT:
    // In production, reject unauthenticated calls, "demo-user", and "local-*" with Unauthorized.
    const validUid = assertAuthenticated(uid, "UserRepository.getOrCreateContext");

    if (tenantContextCache.has(validUid)) {
      return tenantContextCache.get(validUid)!;
    }

    // Demo Mode Handling: ONLY permitted in non-production development environments!
    if (isDemoUser(validUid)) {
      const demoContext: TenantContext = {
        tenantId: "demo-tenant",
        role: "owner",
        tenant: {
          id: "demo-tenant",
          name: "StokPro Demo İşletmesi",
          ownerUid: "demo-user",
          plan: "pro",
          createdAt: new Date().toISOString()
        },
        userProfile: {
          uid: "demo-user",
          tenantId: "demo-tenant",
          role: "owner",
          email: "demo@stokpro.com",
          displayName: "Demo Yönetici",
          createdAt: new Date().toISOString(),
          isActive: true
        }
      };
      tenantContextCache.set(validUid, demoContext);
      return demoContext;
    }

    try {
      const userRef = doc(this.db, "users", validUid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const uData = userSnap.data() as TenantUser;
        const tenantSnap = await getDoc(doc(this.db, "tenants", uData.tenantId));
        const tData = tenantSnap.exists() ? (tenantSnap.data() as Tenant) : undefined;

        const context: TenantContext = {
          tenantId: uData.tenantId,
          role: uData.role || "owner",
          tenant: tData,
          userProfile: uData
        };
        tenantContextCache.set(validUid, context);
        return context;
      }

      // Legacy user or first-time sign-in: Auto-provision Tenant in Firestore
      const tenantId = validUid;
      const defaultCompanyName = displayName ? `${displayName} İşletmesi` : "Şirketim";

      const newTenant: Tenant = {
        id: tenantId,
        name: defaultCompanyName,
        ownerUid: validUid,
        plan: "pro",
        createdAt: new Date().toISOString()
      };

      const newUserProfile: TenantUser = {
        uid: validUid,
        tenantId,
        role: "owner",
        email: email || "",
        displayName: displayName || "Yönetici",
        createdAt: new Date().toISOString(),
        isActive: true
      };

      await setDoc(doc(this.db, "tenants", tenantId), newTenant);
      await setDoc(userRef, newUserProfile);

      const context: TenantContext = {
        tenantId,
        role: "owner",
        tenant: newTenant,
        userProfile: newUserProfile
      };
      tenantContextCache.set(validUid, context);
      return context;
    } catch (err) {
      console.warn("FirebaseUserRepository tenant context lookup notice:", err);
      const fallback: TenantContext = {
        tenantId: validUid,
        role: "owner"
      };
      return fallback;
    }
  }

  async getUserProfile(uid: string): Promise<TenantUser | null> {
    const validUid = assertAuthenticated(uid, "UserRepository.getUserProfile");

    if (isDemoUser(validUid)) {
      return {
        uid: "demo-user",
        tenantId: "demo-tenant",
        role: "owner",
        email: "demo@stokpro.com",
        displayName: "Demo Yönetici",
        createdAt: new Date().toISOString(),
        isActive: true
      };
    }

    try {
      const userSnap = await getDoc(doc(this.db, "users", validUid));
      if (!userSnap.exists()) return null;
      return userSnap.data() as TenantUser;
    } catch (err) {
      console.error("getUserProfile error:", err);
      return null;
    }
  }
}
