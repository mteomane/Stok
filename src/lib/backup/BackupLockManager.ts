import { db } from "../firebase";
import { doc, runTransaction, getDoc } from "firebase/firestore";

export interface LockAcquisitionResult {
  acquired: boolean;
  lockId: string;
  expiresAt: number;
  reason?: string;
}

export interface IBackupLockManager {
  acquireLock(tenantId: string, ttlMs?: number): Promise<LockAcquisitionResult>;
  releaseLock(tenantId: string, lockId: string): Promise<boolean>;
  isLocked(tenantId: string): Promise<boolean>;
}

/**
 * In-Memory Lock Manager
 * Used for fast unit tests and environments without Firestore emulator.
 */
export class InMemoryLockManager implements IBackupLockManager {
  private locks: Map<string, { lockId: string; expiresAt: number; acquiredAt: number }> = new Map();

  async acquireLock(tenantId: string, ttlMs: number = 15 * 60 * 1000): Promise<LockAcquisitionResult> {
    const now = Date.now();
    const existing = this.locks.get(tenantId);

    if (existing && existing.expiresAt > now) {
      return {
        acquired: false,
        lockId: existing.lockId,
        expiresAt: existing.expiresAt,
        reason: `Tenant (${tenantId}) için devam eden aktif bir kilit bulunmaktadır. (Kilit ID: ${existing.lockId}, Bitiş: ${new Date(existing.expiresAt).toISOString()})`
      };
    }

    // Lock is either free or expired -> take over safely
    const lockId = `lock_${tenantId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const expiresAt = now + ttlMs;

    this.locks.set(tenantId, {
      lockId,
      expiresAt,
      acquiredAt: now
    });

    return {
      acquired: true,
      lockId,
      expiresAt
    };
  }

  async releaseLock(tenantId: string, lockId: string): Promise<boolean> {
    const existing = this.locks.get(tenantId);
    if (!existing) {
      return true; // Already free
    }

    // Only release if we own the lock
    if (existing.lockId === lockId) {
      this.locks.delete(tenantId);
      return true;
    }

    return false;
  }

  async isLocked(tenantId: string): Promise<boolean> {
    const existing = this.locks.get(tenantId);
    if (!existing) return false;
    return existing.expiresAt > Date.now();
  }

  clear(): void {
    this.locks.clear();
  }
}

/**
 * Distributed Firestore Lease/Lock Manager.
 * 
 * Guarantees across serverless Cloud Function instances / Cloud Run containers:
 * - Uses atomic Firestore transactions on document `backup_locks/{tenantId}`.
 * - Prevents race conditions and duplicate concurrent backup runs.
 * - Enforces expiration lease TTL (default 15 minutes).
 * - Safely re-claims dead/zombie locks if a previous instance crashed before release.
 */
export class FirestoreBackupLockManager implements IBackupLockManager {
  private collectionName: string = "backup_locks";

  async acquireLock(tenantId: string, ttlMs: number = 15 * 60 * 1000): Promise<LockAcquisitionResult> {
    const lockRef = doc(db, this.collectionName, tenantId);
    const lockId = `lock_${tenantId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = Date.now();
    const expiresAt = now + ttlMs;

    try {
      return await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(lockRef);

        if (snap.exists()) {
          const data = snap.data();
          const existingExpiresAt = Number(data.expiresAt || 0);

          // If lock is still valid and not expired, reject acquisition
          if (existingExpiresAt > now) {
            return {
              acquired: false,
              lockId: data.lockId,
              expiresAt: existingExpiresAt,
              reason: `Aktif dağıtık kilit mevcut (Kilit: ${data.lockId}, Süre Sonu: ${new Date(existingExpiresAt).toISOString()})`
            };
          }
        }

        // Lock is absent or has expired -> acquire/take over
        transaction.set(lockRef, {
          lockId,
          tenantId,
          acquiredAt: new Date(now).toISOString(),
          expiresAt,
          expiresAtIso: new Date(expiresAt).toISOString(),
          ownerInstance: process.env.K_SERVICE || "node-runner"
        });

        return {
          acquired: true,
          lockId,
          expiresAt
        };
      });
    } catch (err: any) {
      return {
        acquired: false,
        lockId: "",
        expiresAt: 0,
        reason: `Dağıtık kilit alınırken veritabanı hatası: ${err.message}`
      };
    }
  }

  async releaseLock(tenantId: string, lockId: string): Promise<boolean> {
    const lockRef = doc(db, this.collectionName, tenantId);

    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(lockRef);
        if (!snap.exists()) return;

        const data = snap.data();
        // Only release if we hold this specific lockId
        if (data.lockId === lockId) {
          transaction.delete(lockRef);
        }
      });
      return true;
    } catch (err: any) {
      console.warn(`Could not release lock for tenant ${tenantId}:`, err);
      return false;
    }
  }

  async isLocked(tenantId: string): Promise<boolean> {
    try {
      const lockRef = doc(db, this.collectionName, tenantId);
      const snap = await getDoc(lockRef);
      if (!snap.exists()) return false;
      const data = snap.data();
      return Number(data.expiresAt || 0) > Date.now();
    } catch {
      return false;
    }
  }
}
