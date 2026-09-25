// Refunds use the original receipt snapshot, never today's promotion/settings.
const yes = (v) => v === true || v === 1 || String(v).toLowerCase() === 'true';
export function isReturnPayload(body = {}) {
  return yes(body.is_return) || yes(body.is_refund) || Boolean(body.original_receipt_id)
    || /return|refund|возврат|повернен/i.test(String(body.operation_type || body.operation || ''))
    || Number(body.total_cents) < 0
    || (Array.isArray(body.items) && body.items.some((i) => Number(i.qty) < 0 || Number(i.line_total_cents) < 0));
}
const codeOf = (i) => String(i.external_product_id || i.product_id || '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '');
const excluded = (i) => Boolean(i.no_star_accrual || i.is_alcohol || i.is_tobacco || i.is_min_margin);
const fail = (code) => { throw new Error(code); };
export function planReturn(original, originalItems, previous, previousItems, body) {
  const items = Array.isArray(body.items) ? body.items : [];
  const full = yes(body.full_return);
  if (!items.length && !full) fail('RETURN_ITEMS_REQUIRED');
  if (!Number.isFinite(Number(body.total_cents))) fail('INVALID_RETURN_TOTAL');
  const groups = new Map();
  let conditions = [];
  try { conditions = JSON.parse(original.club_conditions_json || '[]'); } catch {}
  if (!Array.isArray(conditions)) conditions = [];

  for (const item of originalItems) {
    const code = codeOf(item);
    if (!code) continue;
    const group = groups.get(code) || { qty: 0, eligible: 0, earned: 0, used: 0 };
    group.qty += Math.abs(Number(item.qty));
    group.eligible += excluded(item) ? 0 : Math.max(0, Number(item.line_total_cents));
    const multiplier = Math.max(1, ...conditions.filter((c) => c.product && codeOf({ product_id: c.product }) === code
      && Number.isFinite(Number(c.multiplier))).map((c) => Number(c.multiplier)));
    group.earned += excluded(item) ? 0 : Math.floor(Math.max(0, Number(item.line_total_cents)) / 100 * multiplier);
    groups.set(code, group);
  }
  for (const item of previousItems) {
    const group = groups.get(codeOf(item));
    if (group) group.used += Math.abs(Number(item.qty));
  }
  let eligible = 0;
  const normalized = items.map((item) => {
    const group = groups.get(codeOf(item));
    const qty = Math.abs(Number(item.qty));
    if (!group) fail('RETURN_PRODUCT_NOT_IN_ORIGINAL');
    if (!Number.isFinite(qty) || qty <= 0 || group.used + qty > group.qty + 0.000001) fail('RETURN_QTY_EXCEEDS_ORIGINAL');
    const price = Math.abs(Number(item.price_cents));
    const total = Math.abs(Number(item.line_total_cents ?? item.total_cents));
    if (!Number.isFinite(price) || !Number.isFinite(total)) fail('INVALID_RETURN_ITEM_AMOUNT');
    group.used += qty;
    eligible += group.eligible * qty / group.qty;
    return { ...item, qty, price_cents: Math.round(price), line_total_cents: Math.round(total),
      flags: { ...(item.flags || item), no_star_accrual: group.eligible === 0 } };
  });
  const originalEligible = Math.max(0, Number(original.eligible_cents));
  const originalStars = Math.max(0, Number(original.stars_accrued));
  const canceled = previous.reduce((sum, r) => sum + Math.max(0, -Number(r.stars_accrued)), 0);
  const returned = previous.reduce((sum, r) => sum + Math.max(0, -Number(r.eligible_cents)), 0);
  const remaining = Math.max(0, originalStars - canceled);
  const returnedEligible = full ? Math.max(0, originalEligible - returned)
    : Math.min(Math.max(0, originalEligible - returned), Math.max(0, Math.round(eligible)));
  // Original saved multipliers are included; no current settings/promotions are read.
  // Cumulative quantities avoid losing rounding remainders on partial returns.
  const totalWeight = [...groups.values()].reduce((sum, g) => sum + g.earned, 0);
  const returnedWeight = [...groups.values()].reduce((sum, g) => sum + g.earned * Math.min(1, g.used / g.qty), 0);
  const target = full ? originalStars : totalWeight > 0
    ? Math.min(originalStars, Math.floor(originalStars * returnedWeight / totalWeight + 1e-9))
    : originalEligible > 0 ? Math.min(originalStars, Math.floor(originalStars * Math.min(originalEligible, returned + returnedEligible) / originalEligible)) : 0;
  return { items: normalized, isFullReturn: full, returnedEligibleCents: returnedEligible,
    starsToCancel: Math.min(remaining, Math.max(0, target - canceled)) };
}
