import { Product, FabricRoll, ProductBox } from "../types";
import { getAvailableStock, getAvailableRollLength, shouldShowRolls } from "./sectorConfig";

const normalize = (value: unknown): string =>
  String(value ?? "").normalize("NFKC").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();

function displayFabricName(name: string): string {
  return String(name || "").replace(/[\s\-_–—]*(?:\(|\[)?\s*(?:top|rulo|roll)\s*(?:no\.?|#)?\s*[a-z0-9._-]+\s*(?:\)|\])?$/i, "").trim() || name;
}

function baseFabricName(name: string): string {
  return normalize(name)
    .replace(/[\s\-_–—]*(?:\(|\[)?\s*(?:top|rulo|roll)\s*(?:no\.?|#)?\s*[a-z0-9._-]+\s*(?:\)|\])?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(product: Product, keys: string[]): string {
  const metadata = (product.metadata || {}) as Record<string, unknown>;
  const attributes = (product.attributes || {}) as Record<string, unknown>;
  for (const key of keys) {
    const value = metadata[key] ?? attributes[key];
    if (value !== undefined && value !== null && String(value).trim()) return normalize(value);
  }
  return "";
}

function isFabricRecord(product: Product): boolean {
  const category = normalize(product.category);
  const metadata = (product.metadata || {}) as Record<string, unknown>;
  const attributes = product.attributes || {};
  return shouldShowRolls(product) && (
    ["kumaş", "kumas", "dokuma", "örme", "orme", "tekstil"].some((term) => category.includes(term)) ||
    Boolean(metadata.fabricType || metadata.rollNumber || attributes["Rulo No"] || attributes.rollNumber)
  );
}

function groupKey(product: Product): string {
  const category = normalize(product.category);
  const name = baseFabricName(product.name);
  const brand = normalize(product.brand || product.metadata?.brand || "");
  const unit = normalize(product.unit || "metre");
  const fabricType = attr(product, ["fabricType", "Kumaş Tipi"]);
  const color = attr(product, ["color", "colorName", "Renk", "Renk Adı"]);
  const colorCode = attr(product, ["colorCode", "RenkKodu", "Renk Kodu"]);
  const width = attr(product, ["width", "En", "Kumaş Eni"]);
  const pattern = attr(product, ["pattern", "Desen", "Desen / Baskı"]);
  // Legacy fabric tops are physical stock lots of the same sellable variety.
  // Their purchase/sale prices may differ per top, so price must not split the parent group.
  const archived = product.isActive === false ? "archived" : "active";
  return JSON.stringify([name, category, brand, unit, fabricType, color, colorCode, width, pattern, archived]);
}

function stableTopOrder(a: Product, b: Product): number {
  const da = String((a as any).createdAt || a.metadata?.entryDate || "");
  const db = String((b as any).createdAt || b.metadata?.entryDate || "");
  return da.localeCompare(db) || a.id.localeCompare(b.id);
}

function makeSyntheticRoll(product: Product, index: number): FabricRoll {
  const metadata = (product.metadata || {}) as Record<string, unknown>;
  const attributes = product.attributes || {};
  const label = metadata.rollNumber || attributes["Rulo No"] || attributes.rollNumber || ("Top " + (index + 1));
  const reserved = Number(product.reservedStock || 0);
  return {
    id: "product-roll:" + product.id,
    productId: product.id,
    rollNumber: String(label),
    length: Number(product.stock || 0),
    initialLength: Number(product.stock || 0),
    reservedLength: reserved,
    soldLength: 0,
    status: Number(product.stock || 0) <= 0 ? "sold" : "available",
    createdAt: String((product as any).createdAt || ""),
  };
}

/** Combines explicitly related product variants for every sector, while retaining legacy textile grouping. */
export function groupProducts(products: Product[]): Product[] {
  const groups = new Map<string, Product[]>();
  const untouched: Product[] = [];

  for (const product of products) {
    const key = product.productFamilyId
      ? "family:" + normalize(product.productFamilyId)
      : isFabricRecord(product) ? "legacy-fabric:" + groupKey(product) : "";
    if (!key) {
      untouched.push(product);
      continue;
    }
    const list = groups.get(key) || [];
    list.push(product);
    groups.set(key, list);
  }

  const grouped: Product[] = [...untouched];
  for (const membersUnsorted of groups.values()) {
    const members = [...membersUnsorted].sort(stableTopOrder);
    if (members.length === 1) {
      grouped.push(members[0]);
      continue;
    }

    const representative = members[0];
    const totalStock = Number(members.reduce((sum, member) => sum + Number(member.stock || 0), 0).toFixed(3));
    const totalReserved = Number(members.reduce((sum, member) => sum + Number(member.reservedStock || 0), 0).toFixed(3));
    const flattenedRolls: FabricRoll[] = [];
    const flattenedBoxes: ProductBox[] = [];

    members.forEach((member, index) => {
      if (member.rolls?.length) {
        member.rolls.forEach((roll) => {
          flattenedRolls.push({ ...roll, id: member.id + "::" + roll.id, productId: member.id });
        });
      } else if (isFabricRecord(member)) {
        flattenedRolls.push(makeSyntheticRoll(member, index));
      }
      (member.boxes || []).forEach((box) => {
        flattenedBoxes.push({ ...box, id: member.id + "::" + box.id, productId: member.id });
      });
    });

    grouped.push({
      ...representative,
      name: members.some(isFabricRecord) ? displayFabricName(representative.name) : representative.name,
      stock: totalStock,
      reservedStock: totalReserved,
      minStock: Math.max(...members.map((member) => Number(member.minStock || 0))),
      rolls: flattenedRolls.length ? flattenedRolls : representative.rolls,
      boxes: flattenedBoxes.length ? flattenedBoxes : representative.boxes,
      productFamilyId: representative.productFamilyId || undefined,
      groupProductIds: members.map((member) => member.id),
      groupMembers: members,
    });
  }

  return grouped.sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export const groupFabricProducts = groupProducts;

export function getGroupedAvailableStock(product: Product): number {
  if (product.groupProductIds?.length && product.groupMembers?.length) {
    return Number(product.groupMembers.reduce((sum, member) => sum + getAvailableStock(member), 0).toFixed(3));
  }
  return getAvailableStock(product);
}

export function getGroupedAvailableRolls(product: Product): number {
  return Number((product.rolls || []).reduce((sum, roll) => sum + getAvailableRollLength(roll), 0).toFixed(3));
}
