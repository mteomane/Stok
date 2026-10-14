import { 
  ProductRepository, 
  SalesRepository, 
  CustomerRepository, 
  SupplierRepository, 
  SubscriptionRepository, 
  UserRepository,
  OrderRepository
} from "./interfaces";
import { FirebaseUserRepository } from "./firebase/FirebaseUserRepository";
import { FirebaseSubscriptionRepository } from "./firebase/FirebaseSubscriptionRepository";
import { FirebaseProductRepository } from "./firebase/FirebaseProductRepository";
import { FirebaseSalesRepository } from "./firebase/FirebaseSalesRepository";
import { FirebaseCustomerRepository } from "./firebase/FirebaseCustomerRepository";
import { FirebaseSupplierRepository } from "./firebase/FirebaseSupplierRepository";
import { FirebaseOrderRepository } from "./firebase/FirebaseOrderRepository";
import { SupabaseProductRepository } from "./supabase/SupabaseProductRepository";

export * from "./interfaces";
export * from "./firebase/FirebaseProductRepository";
export * from "./firebase/FirebaseSalesRepository";
export * from "./firebase/FirebaseCustomerRepository";
export * from "./firebase/FirebaseSupplierRepository";
export * from "./firebase/FirebaseSubscriptionRepository";
export * from "./firebase/FirebaseUserRepository";
export * from "./firebase/FirebaseOrderRepository";
export * from "./supabase/SupabaseProductRepository";

/**
 * Global App Repositories Container
 * Central registry decoupling the UI and business domains from any concrete database.
 */
export interface AppRepositories {
  products: ProductRepository;
  sales: SalesRepository;
  customers: CustomerRepository;
  suppliers: SupplierRepository;
  subscriptions: SubscriptionRepository;
  users: UserRepository;
  orders: OrderRepository;
}

// Default Firebase-backed instances
export const userRepo = new FirebaseUserRepository();
export const subscriptionRepo = new FirebaseSubscriptionRepository(userRepo);
export const productRepo = new FirebaseProductRepository(userRepo, subscriptionRepo);
export const salesRepo = new FirebaseSalesRepository(userRepo);
export const customerRepo = new FirebaseCustomerRepository(userRepo);
export const supplierRepo = new FirebaseSupplierRepository(userRepo);
export const orderRepo = new FirebaseOrderRepository(userRepo);

export const repositories: AppRepositories = {
  products: productRepo,
  sales: salesRepo,
  customers: customerRepo,
  suppliers: supplierRepo,
  subscriptions: subscriptionRepo,
  users: userRepo,
  orders: orderRepo
};

/**
 * Allows swapping the repository implementations dynamically (e.g. for testing,
 * offline mode, or migrating to PostgreSQL/Supabase).
 */
export function setRepositories(overrides: Partial<AppRepositories>): void {
  if (overrides.products) repositories.products = overrides.products;
  if (overrides.sales) repositories.sales = overrides.sales;
  if (overrides.customers) repositories.customers = overrides.customers;
  if (overrides.suppliers) repositories.suppliers = overrides.suppliers;
  if (overrides.subscriptions) repositories.subscriptions = overrides.subscriptions;
  if (overrides.users) repositories.users = overrides.users;
  if (overrides.orders) repositories.orders = overrides.orders;
}
