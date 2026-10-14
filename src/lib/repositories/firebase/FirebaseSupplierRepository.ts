import { SupplierRepository } from "../interfaces";
import { Supplier } from "../../../types";
import { db } from "../../firebase";
import { 
  Firestore,
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where 
} from "firebase/firestore";
import { getLocal, setLocal, SEED_SUPPLIERS } from "./helpers";
import { FirebaseUserRepository } from "./FirebaseUserRepository";
import { assertAuthenticated, isDemoUser, getAuthenticatedUid } from "../../authGuard";

export class FirebaseSupplierRepository implements SupplierRepository {
  private userRepo: FirebaseUserRepository;
  private db: Firestore;

  constructor(userRepo?: FirebaseUserRepository, customDb?: Firestore) {
    this.userRepo = userRepo || new FirebaseUserRepository(customDb);
    this.db = customDb || db;
  }

  async getAll(uid: string): Promise<Supplier[]> {
    const validUid = assertAuthenticated(uid, "SupplierRepository.getAll");
    const context = await this.userRepo.getOrCreateContext(validUid);
    const tenantId = context.tenantId;

    if (isDemoUser(validUid)) {
      return getLocal<Supplier[]>("stokpro_demo_suppliers", SEED_SUPPLIERS);
    }

    try {
      const q = query(collection(this.db, "suppliers"), where("tenantId", "==", tenantId));
      const snapshot = await getDocs(q);
      const list: Supplier[] = [];
      snapshot.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Supplier);
      });
      return list;
    } catch (err) {
      console.error("FirebaseSupplierRepository getAll error:", err);
      throw err;
    }
  }

  async getById(id: string): Promise<Supplier | null> {
    const validUid = getAuthenticatedUid("SupplierRepository.getById");

    if (isDemoUser(validUid)) {
      const list = getLocal<Supplier[]>("stokpro_demo_suppliers", SEED_SUPPLIERS);
      return list.find(s => s.id === id) || null;
    }

    try {
      const docSnap = await getDoc(doc(this.db, "suppliers", id));
      if (!docSnap.exists()) return null;
      return { id: docSnap.id, ...docSnap.data() } as Supplier;
    } catch (err) {
      console.error("FirebaseSupplierRepository getById error:", err);
      return null;
    }
  }

  async create(uid: string, supplier: Omit<Supplier, "id" | "createdAt">): Promise<Supplier> {
    const validUid = assertAuthenticated(uid, "SupplierRepository.create");
    const context = await this.userRepo.getOrCreateContext(validUid);
    const newSupplierData = {
      ...supplier,
      createdAt: (supplier as any).createdAt || new Date().toISOString(),
      tenantId: context.tenantId,
      userId: validUid
    };

    if (isDemoUser(validUid)) {
      const list = getLocal<Supplier[]>("stokpro_demo_suppliers", SEED_SUPPLIERS);
      const newId = "SUP_" + Math.random().toString(36).substring(2, 9).toUpperCase();
      const created = { id: newId, ...newSupplierData } as Supplier;
      list.push(created);
      setLocal("stokpro_demo_suppliers", list);
      return created;
    }

    try {
      const docRef = await addDoc(collection(this.db, "suppliers"), newSupplierData);
      return { id: docRef.id, ...newSupplierData } as Supplier;
    } catch (err) {
      console.error("FirebaseSupplierRepository create error:", err);
      throw err;
    }
  }

  async update(id: string, updates: Partial<Supplier>): Promise<void> {
    const validUid = getAuthenticatedUid("SupplierRepository.update");

    if (isDemoUser(validUid)) {
      const list = getLocal<Supplier[]>("stokpro_demo_suppliers", SEED_SUPPLIERS);
      const updated = list.map(s => s.id === id ? { ...s, ...updates } : s);
      setLocal("stokpro_demo_suppliers", updated);
      return;
    }

    try {
      const docRef = doc(this.db, "suppliers", id);
      await updateDoc(docRef, updates);
    } catch (err) {
      console.error("FirebaseSupplierRepository update error:", err);
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    const validUid = getAuthenticatedUid("SupplierRepository.delete");

    if (isDemoUser(validUid)) {
      const list = getLocal<Supplier[]>("stokpro_demo_suppliers", SEED_SUPPLIERS);
      const filtered = list.filter(s => s.id !== id);
      setLocal("stokpro_demo_suppliers", filtered);
      return;
    }

    try {
      const docRef = doc(this.db, "suppliers", id);
      await deleteDoc(docRef);
    } catch (err) {
      console.error("FirebaseSupplierRepository delete error:", err);
      throw err;
    }
  }
}
