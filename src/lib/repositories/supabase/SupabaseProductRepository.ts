import { ProductRepository } from "../interfaces";
import { Product } from "../../../types";

/**
 * Supabase / PostgreSQL Product Repository Adapter (Example Implementation)
 * Demonstrates how easily the backend can be swapped from Firebase to Supabase/PostgreSQL
 * without touching any UI component or business domain logic.
 */
export class SupabaseProductRepository implements ProductRepository {
  private client: any; // e.g. createClient(supabaseUrl, supabaseKey)

  constructor(supabaseClient?: any) {
    this.client = supabaseClient || null;
  }

  async getAll(uid: string, includeArchived = false): Promise<Product[]> {
    if (!this.client) {
      throw new Error("Supabase client not initialized. Configure SUPABASE_URL and SUPABASE_ANON_KEY.");
    }
    let query = this.client.from("products").select("*").eq("user_id", uid);
    if (!includeArchived) {
      query = query.eq("is_active", true);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data as Product[];
  }

  async getById(id: string): Promise<Product | null> {
    if (!this.client) return null;
    const { data, error } = await this.client.from("products").select("*").eq("id", id).single();
    if (error) return null;
    return data as Product;
  }

  async create(uid: string, product: Omit<Product, "id">): Promise<Product> {
    if (!this.client) throw new Error("Supabase client not initialized");
    const { data, error } = await this.client.from("products").insert([{ ...product, user_id: uid }]).select().single();
    if (error) throw error;
    return data as Product;
  }

  async batchCreate(uid: string, products: Omit<Product, "id">[]): Promise<Product[]> {
    if (!this.client) throw new Error("Supabase client not initialized");
    const payloads = products.map(p => ({ ...p, user_id: uid }));
    const { data, error } = await this.client.from("products").insert(payloads).select();
    if (error) throw error;
    return data as Product[];
  }

  async update(productId: string, updates: Partial<Product>): Promise<void> {
    if (!this.client) throw new Error("Supabase client not initialized");
    const { error } = await this.client.from("products").update(updates).eq("id", productId);
    if (error) throw error;
  }

  async delete(productId: string): Promise<void> {
    if (!this.client) throw new Error("Supabase client not initialized");
    const { error } = await this.client.from("products").update({ is_active: false, deleted_at: new Date().toISOString() }).eq("id", productId);
    if (error) throw error;
  }

  async restore(productId: string): Promise<void> {
    if (!this.client) throw new Error("Supabase client not initialized");
    const { error } = await this.client.from("products").update({ is_active: true, deleted_at: null }).eq("id", productId);
    if (error) throw error;
  }
}
