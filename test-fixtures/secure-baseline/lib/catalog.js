// Prices and plans live on the server. The client only says which product it wants.
export const CATALOG = {
  basic: { name: 'Basic plan', unit_amount: 900, plan: 'basic' },
  pro: { name: 'Pro plan', unit_amount: 2900, plan: 'pro' },
};

export function findProduct(sku) {
  return typeof sku === 'string' && Object.hasOwn(CATALOG, sku) ? CATALOG[sku] : null;
}
