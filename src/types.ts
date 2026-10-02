export interface FabricRoll {
  id: string;
  rollNumber: string; // e.g. "Top #1", "Top #2"
  length: number;    // current length in meters
  initialLength: number; // original length in meters
  status: 'available' | 'sold' | 'reserved';
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
  minStock: number;
  // Dynamic fields
  attributes?: Record<string, string>;
  // Kısmi Stok / Paket İçi Eksiltme
  isPackaged?: boolean;
  packageUnitsCount?: number;
  packageUnitName?: string;
  subUnitStock?: number;
  // Kumaş topları takibi
  rolls?: FabricRoll[];
}

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface Sale {
  id: string;
  items: SaleItem[];
  totalAmount: number;
  timestamp: string;
  paymentMethod?: string;
  customerName?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedRollId?: string; // Optional specific fabric roll selected for sale
  cutLength?: number;       // Optional length cut from the roll
}

export interface CustomerTransaction {
  id: string;
  type: 'sale' | 'payment';
  amount: number;
  description: string;
  timestamp: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  instagram: string;
  totalDebt: number; // Ödenmemiş miktar (Borç)
  totalPaid: number; // Ödenen miktar
  notes?: string;
  transactions: CustomerTransaction[];
  address?: string;
  taxOffice?: string;
  taxNumber?: string;
}

export interface SectorField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date';
  required: boolean;
}

export interface SectorSettings {
  activeSector: string;
  customFields: SectorField[];
}

export interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxOffice: string;
  taxNumber: string;
  logo: string; // Base64 representation or url
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  rollId?: string; // If specific fabric roll was sold
  rollNumber?: string; // If specific fabric roll
  cutLength?: number; // If cut length
}

export interface Order {
  id: string;
  orderNo: string; // e.g. "SIP-1001"
  customerId?: string;
  customerName?: string; // text backup or anonymous
  customerDetails?: {
    name: string;
    address: string;
    phone: string;
    taxOffice?: string;
    taxNumber?: string;
  };
  items: OrderItem[];
  totalAmount: number;
  amountPaid: number;
  status: 'Sipariş Alındı' | 'Hazırlanıyor' | 'Sevk Edildi' | 'Teslim Edildi' | 'İptal Edildi';
  orderDate: string; // ISO string
  waybillNo?: string; // İrsaliye No
  waybillDate?: string; // İrsaliye Tarihi
  shipDate?: string; // Fiili Sevk Tarihi
  notes?: string;
}
