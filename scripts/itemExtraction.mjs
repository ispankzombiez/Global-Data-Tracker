const ITEM_BAG_KEYS = new Set([
  "inventory",
  "stock",
  "wardrobe",
  "wearables",
  "collectibles",
  "items"
]);

const EXCLUDED_ITEM_NAMES = new Set([
  "id",
  "x",
  "y",
  "width",
  "height",
  "count",
  "amount",
  "rate",
  "total",
  "goal",
  "day",
  "date",
  "durationms",
  "produced",
  "storedcharges",
  "rank",
  "sfl",
  "tickets",
  "taxfreesfl",
  "withdrawnamount"
]);

const EXCLUDED_NAME_PATTERNS = [
  /^-?\d+$/,
  /at$/i
];

export function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function isAllowedItemName(name) {
  const normalized = String(name ?? "").trim();
  if (!normalized) {
    return false;
  }

  const lowered = normalized.toLowerCase();
  if (EXCLUDED_ITEM_NAMES.has(lowered)) {
    return false;
  }

  for (const pattern of EXCLUDED_NAME_PATTERNS) {
    if (pattern.test(normalized)) {
      return false;
    }
  }

  return true;
}

export function addItem(totals, name, value) {
  if (!isAllowedItemName(name)) {
    return;
  }

  if (!Number.isFinite(value) || value <= 0) {
    return;
  }

  const current = totals.get(name) ?? 0;
  totals.set(name, current + value);
}

export function walkForItems(node, totals, parentKey = "") {
  if (node === null || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      walkForItems(child, totals, parentKey);
    }
    return;
  }

  if (ITEM_BAG_KEYS.has(parentKey)) {
    for (const [itemName, rawValue] of Object.entries(node)) {
      const amount = asNumber(rawValue);
      if (amount !== null) {
        addItem(totals, itemName, amount);
      }
    }
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    walkForItems(value, totals, key.toLowerCase());
  }
}
