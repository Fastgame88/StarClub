import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import { initDb, db, nowIso, normalizePhone, randomToken, getOrCreateClientFromTelegram, createSession, getClientBySession, getSetting, awardStars, hashPassword, verifyPassword, getClientAvailableStars, getReservedStars, logAudit, generateCardNumber } from './db.js';
import { verifyTelegramInitData } from './telegram.js';
import { startStarClubBot } from './bot.js';

dotenv.config();
await initDb();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// STAR CLUB SERVER VERSION: v15.3-challenge-category-match
const app = express();
const port = Number(process.env.PORT || 3000);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, '..', 'public')));

function parseCsvEnv(name) {
  return String(process.env[name] || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function getAdminBySession(token) {
  if (!token) return null;
  return db.prepare(`SELECT a.* FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_user_id
    WHERE s.token = ? AND s.expires_at > ? AND a.is_active = 1`).get(token, nowIso()) || null;
}

function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_API_KEY || 'change-this-admin-key';
  const key = req.header('x-admin-key') || req.query.admin_key;
  if (key && key === expected) {
    req.admin = { id: 0, telegram_id: 'api-key', name: 'Owner API key', role: 'owner', permissions_json: null };
    return next();
  }
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.admin_session;
  const admin = getAdminBySession(token);
  if (!admin) return res.status(401).json({ ok: false, error: 'ADMIN_UNAUTHORIZED' });
  req.admin = admin;
  if (admin.role !== 'owner') {
    let permissions = [];
    try { permissions = admin.permissions_json ? JSON.parse(admin.permissions_json) : []; } catch {}
    const path = req.path;
    const permission = path.includes('/clients') ? 'clients'
      : path.includes('/catalog/rewards') ? 'rewards'
      : path.includes('/catalog/offers') ? 'offers'
      : path.includes('/catalog/challenges') ? 'challenges'
      : path.includes('/catalog/stamps') ? 'stamps'
      : path.includes('/catalog/news') ? 'news'
      : path.includes('/reward-qrs') ? 'qrs'
      : path.includes('/support') ? 'support'
      : path.includes('/settings') ? 'settings'
      : path.includes('/audit') ? 'audit'
      : path.includes('/summary') ? 'dashboard'
      : null;
    if (permission && !permissions.includes(permission)) {
      return res.status(403).json({ ok: false, error: 'ADMIN_PERMISSION_DENIED', permission });
    }
  }
  next();
}

function ownerAuth(req, res, next) {
  return adminAuth(req, res, () => {
    if (req.admin?.role !== 'owner') return res.status(403).json({ ok: false, error: 'OWNER_REQUIRED' });
    next();
  });
}

function oneCAuth(req, res, next) {
  const expected = process.env.ONE_C_API_TOKEN || 'change-this-1c-token';
  const got = req.header('x-starclub-token') || req.query.token;
  if (!got || got !== expected) return res.status(401).json({ ok: false, error: 'ONE_C_UNAUTHORIZED' });
  next();
}

function clientAuth(req, res, next) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.session;
  const client = getClientBySession(token);
  if (!client) return res.status(401).json({ ok: false, error: 'CLIENT_UNAUTHORIZED' });
  if (client.is_blocked) return res.status(403).json({ ok: false, error: 'CLIENT_BLOCKED' });
  req.client = client;
  next();
}

function optionalClientAuth(req, res, next) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.session;
  const client = getClientBySession(token);
  if (client && !client.is_blocked) req.client = client;
  next();
}


function formatAdmin(admin) {
  let permissions = [];
  try { permissions = admin?.permissions_json ? JSON.parse(admin.permissions_json) : []; } catch {}
  return admin ? {
    id: admin.id,
    telegram_id: admin.telegram_id,
    name: admin.name,
    username: admin.username,
    role: admin.role,
    permissions,
    is_active: Boolean(admin.is_active)
  } : null;
}

function createAdminSession(adminId) {
  const token = randomToken('adm_');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  db.prepare('INSERT INTO admin_sessions(token, admin_user_id, created_at, expires_at) VALUES(?, ?, ?, ?)')
    .run(token, adminId, nowIso(), expiresAt);
  return { token, expires_at: expiresAt };
}


function money(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

function formatClient(client) {
  if (!client) return null;
  const bonus = getProfileBonusConfig();
  const required = bonus.requiredFields;
  const completed = required.filter((key) => Boolean(client[key])).length;
  const reserved = getReservedStars(client.id);
  return {
    id: client.id,
    telegram_id: client.telegram_id,
    phone: client.phone,
    name: client.name,
    birth_date: client.birth_date,
    favorite_store: client.favorite_store,
    email: client.email,
    marketing_allowed: Boolean(client.marketing_allowed),
    preferences: client.preferences ? JSON.parse(client.preferences) : [],
    card_number: client.card_number,
    card_token: client.card_token,
    stars_balance: Number(client.stars_balance || 0),
    reserved_stars: reserved,
    available_stars: Math.max(0, Number(client.stars_balance || 0) - reserved),
    profile_bonus_awarded: Boolean(client.profile_bonus_awarded),
    password_set: Boolean(client.password_hash),
    registered: Boolean(client.phone && client.name && client.birth_date && client.favorite_store && client.password_hash),
    profile_progress: {
      completed,
      total: required.length,
      percent: required.length ? Math.round((completed / required.length) * 100) : 100,
      required_fields: required,
      bonus
    },
    registered_at: client.registered_at,
    last_purchase_at: client.last_purchase_at
  };
}

function getPeriodKey(periodType, date = new Date()) {
  const d = new Date(date);
  if (periodType === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const firstJan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - firstJan) / 86400000) + firstJan.getUTCDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function receiptHasEligibleItems(items = []) {
  return items.some((item) => !item.is_alcohol && !item.is_tobacco && !item.no_star_accrual);
}

function calculateEligibleCents(items = [], explicitEligible) {
  if (Number.isFinite(Number(explicitEligible))) return Math.round(Number(explicitEligible));
  return items.reduce((sum, item) => {
    const flags = item.flags || item;
    const excluded = Boolean(flags.is_alcohol || flags.is_tobacco || flags.is_min_margin || flags.no_star_accrual);
    return excluded ? sum : sum + Math.round(Number(item.line_total_cents ?? item.total_cents ?? item.sum_cents ?? 0));
  }, 0);
}

function normalizeMatchValue(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s\-_.]+/g, '');
}

function itemCategoryCandidates(item = {}) {
  return [
    item.category,
    item.category_code,
    item.category_name,
    item.product_group_code,
    item.product_group_name,
    item.parent_group_code,
    item.parent_group_name
  ].map(normalizeMatchValue).filter(Boolean);
}

function categoryMatches(expected, item = {}) {
  const wanted = normalizeMatchValue(expected);
  if (!wanted) return true;
  return itemCategoryCandidates(item).some((candidate) =>
    candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate)
  );
}

function challengeDebugEnabled() {
  return String(process.env.CHALLENGE_DEBUG || 'false').toLowerCase() === 'true';
}

function writeChallengeDebug(entry) {
  if (!challengeDebugEnabled()) return;
  try {
    console.log('[STARCLUB_CHALLENGE_DEBUG]', JSON.stringify(entry));
  } catch (error) {
    console.log('[STARCLUB_CHALLENGE_DEBUG]', entry);
  }
}

function offerMatchesItem(offer, item) {
  const externalId = normalizeMatchValue(item.external_product_id || item.product_id);
  if (offer.product_external_id) return externalId === normalizeMatchValue(offer.product_external_id);
  if (offer.category) return categoryMatches(offer.category, item);
  return true;
}

function getActiveOffers(storeId, purchasedAt) {
  const at = new Date(purchasedAt || Date.now()).getTime();
  return db.prepare('SELECT * FROM offers WHERE is_active = 1').all().filter((offer) => {
    if (offer.store_id && offer.store_id !== 'all' && String(offer.store_id) !== String(storeId || '')) return false;
    if (offer.active_from && new Date(offer.active_from).getTime() > at) return false;
    if (offer.active_to && new Date(offer.active_to).getTime() < at) return false;
    return true;
  });
}

function calculateAccrualWithOffers(items = [], storeId, purchasedAt) {
  const offers = getActiveOffers(storeId, purchasedAt);
  let stars = 0;
  const applied = [];
  for (const item of items) {
    const flags = item.flags || item;
    const excluded = Boolean(flags.is_alcohol || flags.is_tobacco || flags.is_min_margin || flags.no_star_accrual);
    if (excluded) continue;
    const lineCents = Math.round(Number(item.line_total_cents ?? item.total_cents ?? item.sum_cents ?? 0));
    let multiplier = 1;
    let matchedOffer = null;
    for (const offer of offers) {
      if (offer.type !== 'stars_multiplier' || !offer.stars_multiplier || !offerMatchesItem(offer, item)) continue;
      if (Number(offer.stars_multiplier) > multiplier) {
        multiplier = Number(offer.stars_multiplier);
        matchedOffer = offer;
      }
    }
    stars += Math.floor((lineCents / 100) * multiplier);
    if (matchedOffer) applied.push({ offer_id: matchedOffer.id, name: matchedOffer.name, multiplier, product: item.external_product_id || item.product_id || null, category: item.category || null });
  }
  return { stars, applied };
}


function parseWholesaleTiers(offer) {
  if (!offer?.tiers_json) return [];
  try {
    const tiers = JSON.parse(offer.tiers_json);
    return Array.isArray(tiers)
      ? tiers.map((tier) => ({ qty: Number(tier.qty || 0), priceCents: Math.round(Number(tier.price || 0) * 100) }))
          .filter((tier) => tier.qty > 0 && tier.priceCents >= 0)
          .sort((a, b) => a.qty - b.qty)
      : [];
  } catch {
    return [];
  }
}

function calculateDraftWithOffers({ items = [], storeId, purchasedAt }) {
  const offers = getActiveOffers(storeId, purchasedAt);
  const calculatedItems = [];
  const appliedConditions = [];
  let regularTotalCents = 0;
  let finalTotalCents = 0;
  let expectedStars = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const qty = Math.max(0, Number(item.qty || 0));
    const regularUnitPriceCents = Math.max(0, Math.round(Number(item.price_cents || 0)));
    const regularLineTotalCents = Math.max(0, Math.round(Number(item.line_total_cents ?? regularUnitPriceCents * qty)));
    const flags = item.flags || item;
    const priceCandidates = [{ priceCents: regularUnitPriceCents, offer: null, source: 'regular' }];

    for (const offer of offers) {
      if (!offerMatchesItem(offer, item)) continue;
      if (offer.type === 'club' && (offer.product_external_id || offer.category) && offer.club_price_cents !== null && offer.club_price_cents !== undefined && Number.isFinite(Number(offer.club_price_cents)) && Number(offer.club_price_cents) >= 0) {
        priceCandidates.push({ priceCents: Math.round(Number(offer.club_price_cents)), offer, source: 'club' });
      }
      if (offer.type === 'wholesale' && (offer.product_external_id || offer.category)) {
        const tiers = parseWholesaleTiers(offer);
        const eligibleTiers = tiers.filter((tier) => qty >= tier.qty);
        if (eligibleTiers.length) {
          const tier = eligibleTiers[eligibleTiers.length - 1];
          priceCandidates.push({ priceCents: tier.priceCents, offer, source: 'wholesale', tierQty: tier.qty });
        }
      }
    }

    const bestPrice = priceCandidates.reduce((best, candidate) => candidate.priceCents < best.priceCents ? candidate : best, priceCandidates[0]);
    const finalUnitPriceCents = bestPrice.priceCents;
    const finalLineTotalCents = Math.max(0, Math.round(finalUnitPriceCents * qty));

    let multiplier = 1;
    let multiplierOffer = null;
    const excluded = Boolean(flags.is_alcohol || flags.is_tobacco || flags.is_min_margin || flags.no_star_accrual);
    if (!excluded) {
      for (const offer of offers) {
        if (offer.type !== 'stars_multiplier' || !offer.stars_multiplier || !offerMatchesItem(offer, item)) continue;
        if (Number(offer.stars_multiplier) > multiplier) {
          multiplier = Number(offer.stars_multiplier);
          multiplierOffer = offer;
        }
      }
    }

    const itemExpectedStars = excluded ? 0 : Math.floor((finalLineTotalCents / 100) * multiplier);
    regularTotalCents += regularLineTotalCents;
    finalTotalCents += finalLineTotalCents;
    expectedStars += itemExpectedStars;

    const applied = [];
    if (bestPrice.offer) {
      applied.push({
        type: bestPrice.source,
        offer_id: bestPrice.offer.id,
        name: bestPrice.offer.name,
        regular_price_cents: regularUnitPriceCents,
        final_price_cents: finalUnitPriceCents,
        tier_qty: bestPrice.tierQty || null
      });
      appliedConditions.push({ offer_id: bestPrice.offer.id, name: bestPrice.offer.name, type: bestPrice.source, line_no: item.line_no ?? index + 1 });
    }
    if (multiplierOffer) {
      applied.push({ type: 'stars_multiplier', offer_id: multiplierOffer.id, name: multiplierOffer.name, multiplier });
      appliedConditions.push({ offer_id: multiplierOffer.id, name: multiplierOffer.name, type: 'stars_multiplier', multiplier, line_no: item.line_no ?? index + 1 });
    }

    calculatedItems.push({
      line_no: Number(item.line_no ?? index + 1),
      external_product_id: item.external_product_id || item.product_id || null,
      name: item.name || 'Товар',
      category: item.category || null,
      qty,
      regular_price_cents: regularUnitPriceCents,
      final_price_cents: finalUnitPriceCents,
      regular_line_total_cents: regularLineTotalCents,
      final_line_total_cents: finalLineTotalCents,
      discount_cents: Math.max(0, regularLineTotalCents - finalLineTotalCents),
      stars_multiplier: multiplier,
      expected_stars: itemExpectedStars,
      applied
    });
  }

  return {
    items: calculatedItems,
    regular_total_cents: regularTotalCents,
    final_total_cents: finalTotalCents,
    discount_total_cents: Math.max(0, regularTotalCents - finalTotalCents),
    expected_stars: expectedStars,
    applied_conditions: appliedConditions
  };
}

function getProfileBonusConfig() {
  const raw = getSetting('profile_bonus', {
    enabled: true,
    stars: 500,
    grantWhen: 'immediately',
    requiredFields: ['phone', 'name', 'birth_date', 'favorite_store']
  });
  const allowedFields = ['phone', 'name', 'birth_date', 'favorite_store', 'email', 'preferences'];
  const requiredFields = Array.isArray(raw.requiredFields) && raw.requiredFields.length
    ? raw.requiredFields.filter((field) => allowedFields.includes(field))
    : ['phone', 'name', 'birth_date', 'favorite_store'];
  return {
    enabled: raw.enabled !== false,
    stars: Math.max(0, Math.floor(Number(raw.stars ?? 500))),
    grantWhen: raw.grantWhen === 'after_first_purchase' ? 'after_first_purchase' : 'immediately',
    requiredFields
  };
}

function clientHasProfileFields(client, requiredFields = []) {
  return requiredFields.every((field) => {
    if (field === 'preferences') {
      try {
        const prefs = client.preferences ? JSON.parse(client.preferences) : [];
        return Array.isArray(prefs) && prefs.length > 0;
      } catch {
        return false;
      }
    }
    return Boolean(client[field]);
  });
}

function tryAwardProfileBonus(clientId, trigger = 'immediately') {
  let client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) return { awarded: false, reason: 'CLIENT_NOT_FOUND' };
  const bonus = getProfileBonusConfig();
  if (!bonus.enabled) return { awarded: false, reason: 'DISABLED' };
  if (Number(client.profile_bonus_awarded || 0)) return { awarded: false, reason: 'ALREADY_AWARDED' };
  if (bonus.grantWhen !== trigger) return { awarded: false, reason: 'WRONG_TRIGGER' };
  if (!clientHasProfileFields(client, bonus.requiredFields)) return { awarded: false, reason: 'PROFILE_INCOMPLETE' };

  const balance = awardStars(client.id, 'profile_bonus', bonus.stars, 'profile', `+${bonus.stars} ⭐ бонус за повний профіль`);
  db.prepare('UPDATE clients SET profile_bonus_awarded = 1, updated_at = ? WHERE id = ?').run(nowIso(), client.id);
  logAudit({ actorType: 'client', actorId: String(client.id), action: 'profile_bonus_awarded', entityType: 'client', entityId: String(client.id), payload: { stars: bonus.stars, balance, trigger, requiredFields: bonus.requiredFields } });
  return { awarded: true, stars: bonus.stars, balance };
}

function addChallengeVisit(clientId, receiptId, purchasedAt, totalCents, eligibleItems) {
  const diagnostics = [];
  const day = new Date(purchasedAt).toISOString().slice(0, 10);
  const challenges = db.prepare('SELECT * FROM challenges WHERE is_active = 1').all();

  for (const ch of challenges) {
    const diagnostic = {
      challenge_id: ch.id,
      challenge_code: ch.code,
      challenge_name: ch.name,
      expected_category: ch.category || '',
      min_total_cents: Number(ch.min_total_cents || 0),
      receipt_total_cents: Number(totalCents || 0),
      day,
      receipt_id: receiptId,
      matched: false,
      progress_added: false,
      reason: '',
      items: eligibleItems.map((item) => ({
        name: item.name || '',
        external_product_id: item.external_product_id || item.product_id || '',
        raw_category: item.category || '',
        raw_category_code: item.category_code || '',
        raw_category_name: item.category_name || '',
        raw_product_group_code: item.product_group_code || '',
        raw_product_group_name: item.product_group_name || '',
        raw_parent_group_code: item.parent_group_code || '',
        raw_parent_group_name: item.parent_group_name || '',
        normalized_candidates: itemCategoryCandidates(item)
      }))
    };

    if (totalCents < Number(ch.min_total_cents || 0)) {
      diagnostic.reason = 'MIN_TOTAL_NOT_REACHED';
      diagnostics.push(diagnostic);
      writeChallengeDebug(diagnostic);
      continue;
    }

    if (!receiptHasEligibleItems(eligibleItems)) {
      diagnostic.reason = 'NO_ELIGIBLE_ITEMS';
      diagnostics.push(diagnostic);
      writeChallengeDebug(diagnostic);
      continue;
    }

    if (ch.store_id && ch.store_id !== 'all') {
      diagnostic.store_id = ch.store_id;
    }

    if (ch.category) {
      const hasCategory = eligibleItems.some((item) =>
        categoryMatches(ch.category, item) ||
        normalizeMatchValue(item.name).includes(normalizeMatchValue(ch.category))
      );
      diagnostic.matched = hasCategory;
      if (!hasCategory) {
        diagnostic.reason = 'CATEGORY_NOT_MATCHED';
        logAudit({
          actorType: 'system',
          action: 'challenge_category_not_matched',
          entityType: 'challenge',
          entityId: String(ch.id),
          payload: diagnostic
        });
        diagnostics.push(diagnostic);
        writeChallengeDebug(diagnostic);
        continue;
      }
    } else {
      diagnostic.matched = true;
    }

    const periodKey = getPeriodKey(ch.period_type, new Date(purchasedAt));
    const before = db.prepare('SELECT COUNT(*) AS c FROM client_challenge_days WHERE client_id = ? AND challenge_id = ?').get(clientId, ch.id).c;
    const insertResult = db.prepare('INSERT OR IGNORE INTO client_challenge_days(client_id, challenge_id, day, receipt_id, created_at) VALUES(?, ?, ?, ?, ?)')
      .run(clientId, ch.id, day, receiptId, nowIso());
    const progress = db.prepare('SELECT COUNT(*) AS c FROM client_challenge_days WHERE client_id = ? AND challenge_id = ?').get(clientId, ch.id).c;
    const alreadyAwarded = db.prepare('SELECT 1 FROM client_challenge_rewards WHERE client_id = ? AND challenge_id = ? AND period_key = ?').get(clientId, ch.id, periodKey);

    diagnostic.progress_before = Number(before || 0);
    diagnostic.progress_after = Number(progress || 0);
    diagnostic.required_visits = Number(ch.required_visits || 0);
    diagnostic.insert_changes = Number(insertResult?.changes || 0);
    diagnostic.progress_added = diagnostic.progress_after > diagnostic.progress_before;
    diagnostic.period_key = periodKey;
    diagnostic.already_awarded = Boolean(alreadyAwarded);

    if (!diagnostic.progress_added) {
      diagnostic.reason = 'ALREADY_COUNTED_FOR_THIS_DAY';
    } else {
      diagnostic.reason = 'PROGRESS_ADDED';
    }

    if (progress >= ch.required_visits && !alreadyAwarded) {
      db.prepare('INSERT INTO client_challenge_rewards(client_id, challenge_id, period_key, awarded_at) VALUES(?, ?, ?, ?)')
        .run(clientId, ch.id, periodKey, nowIso());
      const balance = awardStars(clientId, 'challenge_bonus', ch.reward_stars, 'challenge', `+${ch.reward_stars} ⭐ бонус за челендж «${ch.name}»`, receiptId, null);
      logAudit({ actorType: 'system', actorId: 'system', action: 'challenge_awarded', entityType: 'client', entityId: String(clientId), payload: { challenge: ch.code, reward: ch.reward_stars, balance } });
      diagnostic.awarded = true;
      diagnostic.balance_after_award = balance;
      diagnostic.reason = 'CHALLENGE_AWARDED';
    } else {
      diagnostic.awarded = false;
    }

    diagnostics.push(diagnostic);
    writeChallengeDebug(diagnostic);
  }

  return diagnostics;
}

function updateStampProgress(clientId, receiptId, items = []) {
  const programs = db.prepare('SELECT * FROM stamp_programs WHERE is_active = 1').all();
  for (const program of programs) {
    const count = items.reduce((sum, item) => {
      const categories = itemCategoryCandidates(item).join(' ');
      const name = String(item.name || '').toLowerCase();
      if (program.category === 'coffee' && (categories.includes('coffee') || categories.includes('кава') || name.includes('кава'))) return sum + Math.ceil(Number(item.qty || 1));
      if (program.category === 'bakery' && (categories.includes('bakery') || categories.includes('випіч') || categories.includes('хліб') || name.includes('багет') || name.includes('круасан'))) return sum + Math.ceil(Number(item.qty || 1));
      return sum;
    }, 0);
    if (!count) continue;
    const existing = db.prepare('SELECT * FROM client_stamp_progress WHERE client_id = ? AND program_id = ?').get(clientId, program.id);
    if (!existing) {
      db.prepare('INSERT INTO client_stamp_progress(client_id, program_id, progress, completed_count, updated_at) VALUES(?, ?, 0, 0, ?)').run(clientId, program.id, nowIso());
    }
    const current = existing?.progress || 0;
    let next = current + count;
    let completed = existing?.completed_count || 0;
    while (next >= program.required_qty) {
      next -= program.required_qty;
      completed += 1;
      awardStars(clientId, 'stamp_bonus', program.reward_stars, 'stamp_program', `+${program.reward_stars} ⭐ бонус за програму «${program.name}»`, receiptId, null);
      if (!program.is_repeatable) {
        next = program.required_qty;
        break;
      }
    }
    db.prepare('UPDATE client_stamp_progress SET progress = ?, completed_count = ?, updated_at = ? WHERE client_id = ? AND program_id = ?')
      .run(next, completed, nowIso(), clientId, program.id);
  }
}

function normalizeCard(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .toUpperCase();
}

function makeRewardManualCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'SC-';
  for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out.slice(0, 6) + '-' + out.slice(6);
}

function expireReservedRewardQrs(clientId = null) {
  const now = nowIso();
  if (clientId) {
    db.prepare(`UPDATE reward_qrs SET status = 'expired', canceled_at = ? WHERE client_id = ? AND status = 'reserved' AND expires_at <= ?`).run(now, clientId, now);
  } else {
    db.prepare(`UPDATE reward_qrs SET status = 'expired', canceled_at = ? WHERE status = 'reserved' AND expires_at <= ?`).run(now, now);
  }
}

function getActiveRewardQr(clientId, rewardProductId) {
  expireReservedRewardQrs(clientId);
  return db.prepare(`SELECT q.*, r.name, r.image_url, r.stars_price, r.product_external_id, r.conditions
    FROM reward_qrs q
    JOIN reward_products r ON r.id = q.reward_product_id
    WHERE q.client_id = ? AND q.reward_product_id = ? AND q.status = 'reserved' AND q.expires_at > ?
    ORDER BY q.created_at DESC LIMIT 1`).get(clientId, rewardProductId, nowIso());
}

function formatRewardQr(row) {
  if (!row) return null;
  return {
    id: row.id,
    token: row.token,
    manual_code: row.token,
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    used_at: row.used_at,
    canceled_at: row.canceled_at,
    stars_reserved: row.stars_reserved,
    reward: {
      id: row.reward_product_id,
      name: row.name,
      image_url: row.image_url,
      stars_price: row.stars_price,
      product_external_id: row.product_external_id,
      conditions: row.conditions
    }
  };
}

function finalizeRewardQrOnce({ token, receiptId, actorId = '1c', storeId = '1c' }) {
  const cleanToken = String(token || '').trim();
  const cleanReceiptId = String(receiptId || '').trim();
  if (!cleanToken) return { ok: false, error: 'TOKEN_REQUIRED' };
  if (!cleanReceiptId) return { ok: false, error: 'RECEIPT_ID_REQUIRED' };

  expireReservedRewardQrs();

  const row = db.prepare(`SELECT q.*, r.name
    FROM reward_qrs q
    JOIN reward_products r ON r.id = q.reward_product_id
    WHERE q.token = ?`).get(cleanToken);

  if (!row) return { ok: false, error: 'QR_NOT_FOUND' };

  if (row.status === 'used') {
    if (String(row.receipt_id || '') === cleanReceiptId) {
      const client = db.prepare('SELECT stars_balance FROM clients WHERE id = ?').get(row.client_id);
      return { ok: true, status: 'used', duplicate: true, already_finalized: true, balance: client?.stars_balance ?? null };
    }
    return { ok: false, error: 'QR_ALREADY_USED', status: 'used', receipt_id: row.receipt_id };
  }

  if (row.status !== 'reserved') {
    return { ok: false, error: 'QR_STATUS_' + String(row.status || '').toUpperCase(), status: row.status };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('UPDATE reward_qrs SET status = ?, canceled_at = ? WHERE id = ?').run('expired', nowIso(), row.id);
    return { ok: false, error: 'QR_EXPIRED', status: 'expired' };
  }

  const alreadyLedger = db.prepare(`SELECT id FROM star_ledger
    WHERE reward_qr_id = ? AND type = 'reward_spend' LIMIT 1`).get(row.id);

  let balance;
  if (alreadyLedger) {
    const client = db.prepare('SELECT stars_balance FROM clients WHERE id = ?').get(row.client_id);
    balance = client?.stars_balance ?? null;
  } else {
    balance = awardStars(
      row.client_id,
      'reward_spend',
      -Math.abs(row.stars_reserved),
      'reward_qr',
      `-${row.stars_reserved} ⭐ ${row.name} за зірки`,
      cleanReceiptId,
      row.id
    );
  }

  db.prepare('UPDATE reward_qrs SET status = ?, receipt_id = ?, used_at = ? WHERE id = ?')
    .run('used', cleanReceiptId, nowIso(), row.id);
  db.prepare('UPDATE reward_products SET issued_count = issued_count + 1, updated_at = ? WHERE id = ?')
    .run(nowIso(), row.reward_product_id);

  logAudit({
    actorType: '1c',
    actorId,
    action: 'reward_qr_finalized',
    entityType: 'reward_qr',
    entityId: String(row.id),
    payload: { receiptId: cleanReceiptId, balance, token: cleanToken, storeId }
  });

  return { ok: true, status: 'used', token: cleanToken, receipt_id: cleanReceiptId, balance, stars_spent: Math.abs(row.stars_reserved), reward_name: row.name, reward_qr_id: row.id };
}

function findClientForOneC({ card_number, card_token, phone }) {
  const candidates = [
    card_number,
    card_token,
    phone
  ].filter(Boolean);

  if (!candidates.length) return null;

  const clients = db.prepare('SELECT * FROM clients WHERE is_blocked = 0').all();

  for (const client of clients) {
    for (const value of candidates) {
      const incoming = String(value || '').trim();

      if (phone && client.phone === incoming) {
        return client;
      }

      if (client.card_token && client.card_token === incoming) {
        return client;
      }

      if (normalizeCard(client.card_number) === normalizeCard(incoming)) {
        return client;
      }
    }
  }

  return null;
}

app.post('/api/admin/auth/telegram', (req, res) => {
  const initData = String(req.body?.initData || '');
  let user = null;
  if (initData) {
    const verified = verifyTelegramInitData(initData, process.env.BOT_TOKEN);
    if (!verified.ok) return res.status(401).json({ ok: false, error: 'TELEGRAM_AUTH_FAILED', reason: verified.reason });
    user = verified.user;
  } else if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_LOGIN === 'true' && req.body?.devUser) {
    user = req.body.devUser;
  }
  if (!user?.id) return res.status(400).json({ ok: false, error: 'TELEGRAM_USER_REQUIRED' });
  const telegramId = String(user.id);
  const ownerIds = parseCsvEnv('OWNER_TELEGRAM_IDS');
  const isEnvironmentOwner = ownerIds.includes(telegramId);

  let admin = db.prepare('SELECT * FROM admin_users WHERE telegram_id = ?').get(telegramId);

  // Only Owner is bootstrapped from ENV. All Admin users and their permissions
  // are created and managed by Owner from the admin panel.
  if (!admin && isEnvironmentOwner) {
    const now = nowIso();
    const r = db.prepare(`INSERT INTO admin_users(telegram_id, name, username, role, permissions_json, is_active, created_at, updated_at)
      VALUES(?, ?, ?, 'owner', '[]', 1, ?, ?)`).run(
        telegramId,
        [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Owner',
        user.username || null,
        now,
        now
      );
    admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(r.lastInsertRowid);
  }

  // OWNER_TELEGRAM_IDS is the recovery source of truth for Owner access.
  if (admin && isEnvironmentOwner && (admin.role !== 'owner' || !admin.is_active)) {
    db.prepare(`UPDATE admin_users
      SET role = 'owner', permissions_json = '[]', is_active = 1, updated_at = ?
      WHERE id = ?`).run(nowIso(), admin.id);
    admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(admin.id);
  }
  if (!admin || !admin.is_active) return res.status(403).json({ ok: false, error: 'ADMIN_ACCESS_DENIED' });
  db.prepare('UPDATE admin_users SET name = ?, username = ?, updated_at = ? WHERE id = ?')
    .run([user.first_name, user.last_name].filter(Boolean).join(' ') || admin.name, user.username || admin.username, nowIso(), admin.id);
  admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(admin.id);
  const session = createAdminSession(admin.id);
  logAudit({ actorType: 'admin', actorId: String(admin.id), action: 'admin_telegram_login', entityType: 'admin_user', entityId: String(admin.id), payload: { telegram_id: telegramId } });
  res.json({ ok: true, admin: formatAdmin(admin), session });
});

app.get('/api/admin/me', adminAuth, (req, res) => res.json({ ok: true, admin: formatAdmin(req.admin) }));

app.get('/health', (req, res) => res.json({ ok: true, service: 'star-club', time: nowIso() }));

app.get('/api/public/stores', (req, res) => {
  let stores = db.prepare('SELECT * FROM stores ORDER BY name').all();
  if (!stores.length) {
    const fallbackStores = [
      ['star-center', 'Star Центр', 'вул. Центральна, 10', '08:00–22:00', '+380000000001'],
      ['star-market', 'Star Маркет', 'вул. Шевченка, 24', '08:00–22:00', '+380000000002'],
      ['star-bakery', 'Star Bakery', 'вул. Миру, 5', '07:30–21:30', '+380000000003']
    ];
    const insertStore = db.prepare('INSERT OR IGNORE INTO stores(id, name, address, work_hours, phone) VALUES(?, ?, ?, ?, ?)');
    fallbackStores.forEach((store) => insertStore.run(...store));
    stores = db.prepare('SELECT * FROM stores ORDER BY name').all();
  }
  res.json({ ok: true, stores });
});


app.post('/api/auth/telegram', (req, res) => {
  const { initData, devUser } = req.body || {};
  let telegramUser = null;
  const token = process.env.BOT_TOKEN;
  const allowDev = String(process.env.ALLOW_DEV_LOGIN || (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true';

  if (initData && token && !token.startsWith('123456:')) {
    const check = verifyTelegramInitData(initData, token);
    if (!check.ok) return res.status(401).json({ ok: false, error: 'TELEGRAM_AUTH_FAILED', detail: check.reason });
    telegramUser = check.user;
  } else if (allowDev) {
    telegramUser = devUser || { id: '111111111', first_name: 'Андрій' };
  } else {
    return res.status(401).json({ ok: false, error: 'NO_TELEGRAM_AUTH' });
  }

  const client = getOrCreateClientFromTelegram(telegramUser);
  const session = createSession(client.id);
  res.json({ ok: true, session, client: formatClient(client) });
});


app.post('/api/auth/login', (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const password = String(req.body?.password || '');
  if (!phone || password.length < 6) {
    return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE phone = ?').get(phone);
  if (!client || !client.password_hash || !verifyPassword(password, client.password_hash)) {
    return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
  }
  if (client.is_blocked) return res.status(403).json({ ok: false, error: 'CLIENT_BLOCKED' });
  const session = createSession(client.id);
  res.json({ ok: true, session, client: formatClient(client) });
});

app.get('/api/client/me', clientAuth, (req, res) => {
  const fresh = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.client.id);
  res.json({ ok: true, client: formatClient(fresh) });
});

app.post('/api/client/set-password', clientAuth, (req, res) => {
  const password = String(req.body?.password || '');
  const passwordConfirm = String(req.body?.password_confirm || '');
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'PASSWORD_TOO_SHORT', message: 'Пароль має містити мінімум 6 символів' });
  if (password !== passwordConfirm) return res.status(400).json({ ok: false, error: 'PASSWORDS_DO_NOT_MATCH', message: 'Паролі не співпадають' });
  const t = nowIso();
  db.prepare('UPDATE clients SET password_hash = ?, password_set_at = ?, updated_at = ? WHERE id = ?')
    .run(hashPassword(password), t, t, req.client.id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.client.id);
  res.json({ ok: true, client: formatClient(client) });
});

app.post('/api/client/register', optionalClientAuth, (req, res) => {
  const body = req.body || {};
  if (!body.agree_rules || !body.agree_personal_data) return res.status(400).json({ ok: false, error: 'CONSENTS_REQUIRED' });
  if (!req.client?.id) {
    const t = nowIso();
    const webId = `web-${randomToken()}`;
    const cardNumber = generateCardNumber();
    const cardToken = randomToken('card_');
    const created = db.prepare(`INSERT INTO clients(telegram_id, name, card_number, card_token, registered_at, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)`).run(webId, String(body.name || 'Клієнт'), cardNumber, cardToken, t, t, t);
    req.client = db.prepare('SELECT * FROM clients WHERE id = ?').get(created.lastInsertRowid) || db.prepare('SELECT * FROM clients WHERE telegram_id = ?').get(webId);
  }
  if (!req.client?.id) return res.status(500).json({ ok: false, error: 'CLIENT_CREATE_FAILED', message: 'Не вдалося створити клієнта. Перезапустіть сервер і спробуйте ще раз.' });
  const phone = normalizePhone(body.phone);
  if (!phone) return res.status(400).json({ ok: false, error: 'INVALID_PHONE', message: 'Введіть номер у форматі +380XXXXXXXXX або 0XXXXXXXXX' });

  const name = String(body.name || '').trim();
  if (name.length < 2) return res.status(400).json({ ok: false, error: 'NAME_REQUIRED', message: 'Вкажіть імʼя мінімум з 2 символів' });

  const birthDate = String(body.birth_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return res.status(400).json({ ok: false, error: 'BIRTH_DATE_REQUIRED', message: 'Вкажіть дату народження' });
  }

  const favoriteStore = String(body.favorite_store || '').trim();
  const storeExists = db.prepare('SELECT id FROM stores WHERE id = ?').get(favoriteStore);
  if (!storeExists) return res.status(400).json({ ok: false, error: 'STORE_REQUIRED', message: 'Оберіть улюблений магазин зі списку' });

  const password = String(body.password || '');
  const passwordConfirm = String(body.password_confirm || '');
  const currentBeforeUpdate = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.client.id);
  const shouldSetPassword = password.length > 0 || !currentBeforeUpdate?.password_hash;
  if (shouldSetPassword) {
    if (password.length < 6) return res.status(400).json({ ok: false, error: 'PASSWORD_TOO_SHORT', message: 'Пароль має містити мінімум 6 символів' });
    if (password !== passwordConfirm) return res.status(400).json({ ok: false, error: 'PASSWORDS_DO_NOT_MATCH', message: 'Паролі не співпадають' });
  }

  const existingByPhone = db.prepare('SELECT id FROM clients WHERE phone = ? AND id != ?').get(phone, req.client.id);
  if (existingByPhone) return res.status(409).json({ ok: false, error: 'PHONE_ALREADY_REGISTERED', message: 'Клієнт з таким номером вже зареєстрований. Скористайтесь входом.' });

  const t = nowIso();
  const nextPasswordHash = shouldSetPassword ? hashPassword(password) : currentBeforeUpdate.password_hash;
  const nextPasswordSetAt = shouldSetPassword ? t : currentBeforeUpdate.password_set_at;
  const preferences = Array.isArray(body.preferences)
    ? body.preferences.map((v) => String(v).trim()).filter(Boolean)
    : String(body.preferences || '').split(',').map((v) => v.trim()).filter(Boolean);
  db.prepare(`UPDATE clients SET phone = ?, name = ?, birth_date = ?, favorite_store = ?, email = ?, marketing_allowed = ?, preferences = ?, password_hash = ?, password_set_at = ?, updated_at = ? WHERE id = ?`)
    .run(phone, name, birthDate, favoriteStore, body.email || null, body.marketing_allowed ? 1 : 0, JSON.stringify(preferences), nextPasswordHash, nextPasswordSetAt, t, req.client.id);

  let client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.client.id);
  tryAwardProfileBonus(client.id, 'immediately');
  client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.client.id);
  const session = createSession(client.id);
  res.json({ ok: true, session, client: formatClient(client) });
});

app.get('/api/client/stores', clientAuth, (req, res) => {
  let stores = db.prepare('SELECT * FROM stores ORDER BY name').all();
  if (!stores.length) {
    const fallbackStores = [
      ['star-center', 'Star Центр', 'вул. Центральна, 10', '08:00–22:00', '+380000000001'],
      ['star-market', 'Star Маркет', 'вул. Шевченка, 24', '08:00–22:00', '+380000000002'],
      ['star-bakery', 'Star Bakery', 'вул. Миру, 5', '07:30–21:30', '+380000000003']
    ];
    const insertStore = db.prepare('INSERT OR IGNORE INTO stores(id, name, address, work_hours, phone) VALUES(?, ?, ?, ?, ?)');
    fallbackStores.forEach((store) => insertStore.run(...store));
    stores = db.prepare('SELECT * FROM stores ORDER BY name').all();
  }
  res.json({ ok: true, stores });
});

app.get('/api/client/card', clientAuth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.client.id);
  res.json({ ok: true, card: {
    name: client.name || 'Клієнт Star Club',
    card_number: client.card_number,
    card_token: client.card_token,
    stars_balance: client.stars_balance,
    available_stars: getClientAvailableStars(client.id)
  } });
});

app.get('/api/client/star-history', clientAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM star_ledger WHERE client_id = ? ORDER BY created_at DESC LIMIT 100').all(req.client.id);
  res.json({ ok: true, items: rows });
});

app.get('/api/client/receipts', clientAuth, (req, res) => {
  const receipts = db.prepare('SELECT * FROM receipts WHERE client_id = ? ORDER BY purchased_at DESC LIMIT 50').all(req.client.id);
  const itemsStmt = db.prepare('SELECT * FROM receipt_items WHERE receipt_id = ?');
  res.json({ ok: true, receipts: receipts.map((r) => {
    const items = itemsStmt.all(r.id);
    const isRewardPurchase = Number(r.stars_spent || 0) > 0;
    return {
      ...r,
      total_uah: money(r.total_cents),
      eligible_uah: money(r.eligible_cents),
      is_reward_purchase: isRewardPurchase,
      display_title: isRewardPurchase ? 'Покупка за зірки' : (r.store_id || 'Магазин Star'),
      display_amount: isRewardPurchase ? `-${r.stars_spent} ⭐` : `${money(r.total_cents)} грн`,
      items
    };
  }) });
});

app.get('/api/client/receipts/:id', clientAuth, (req, res) => {
  const r = db.prepare('SELECT * FROM receipts WHERE id = ? AND client_id = ?').get(req.params.id, req.client.id);
  if (!r) return res.status(404).json({ ok: false, error: 'RECEIPT_NOT_FOUND' });
  const items = db.prepare('SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY id').all(r.id);
  const isRewardPurchase = Number(r.stars_spent || 0) > 0;
  res.json({ ok: true, receipt: {
    ...r,
    total_uah: money(r.total_cents),
    eligible_uah: money(r.eligible_cents),
    is_reward_purchase: isRewardPurchase,
    display_title: isRewardPurchase ? 'Покупка за зірки' : (r.store_id || 'Магазин Star'),
    display_amount: isRewardPurchase ? `-${r.stars_spent} ⭐` : `${money(r.total_cents)} грн`,
    items
  } });
});

app.get('/api/client/rewards', clientAuth, (req, res) => {
  expireReservedRewardQrs(req.client.id);
  const items = db.prepare('SELECT * FROM reward_products WHERE is_active = 1 ORDER BY stars_price ASC').all();
  const available = getClientAvailableStars(req.client.id);
  res.json({ ok: true, available_stars: available, items: items.map((item) => ({ ...item, can_get: available >= item.stars_price })) });
});

app.post('/api/client/rewards/:id/create-qr', clientAuth, (req, res) => {
  const reward = db.prepare('SELECT * FROM reward_products WHERE id = ? AND is_active = 1').get(req.params.id);
  if (!reward) return res.status(404).json({ ok: false, error: 'REWARD_NOT_FOUND' });

  const active = getActiveRewardQr(req.client.id, reward.id);
  if (active) return res.json({ ok: true, reused: true, qr: formatRewardQr(active) });

  const issuedByClient = db.prepare(`SELECT COUNT(*) AS c FROM reward_qrs WHERE client_id = ? AND reward_product_id = ? AND status = 'used'`).get(req.client.id, reward.id).c;
  if (reward.per_client_limit && issuedByClient >= reward.per_client_limit) {
    return res.status(400).json({ ok: false, error: 'CLIENT_LIMIT_REACHED' });
  }

  if (reward.total_limit && Number(reward.issued_count || 0) >= Number(reward.total_limit)) {
    return res.status(400).json({ ok: false, error: 'TOTAL_LIMIT_REACHED' });
  }

  const available = getClientAvailableStars(req.client.id);
  if (available < reward.stars_price) return res.status(400).json({ ok: false, error: 'NOT_ENOUGH_STARS', available_stars: available });

  let token = makeRewardManualCode();
  for (let i = 0; i < 10; i += 1) {
    const exists = db.prepare('SELECT id FROM reward_qrs WHERE token = ?').get(token);
    if (!exists) break;
    token = makeRewardManualCode();
  }

  const expires = new Date(Date.now() + 1000 * 60 * 15).toISOString();
  const result = db.prepare(`INSERT INTO reward_qrs(client_id, reward_product_id, token, status, stars_reserved, created_at, expires_at)
    VALUES(?, ?, ?, 'reserved', ?, ?, ?)`).run(req.client.id, reward.id, token, reward.stars_price, nowIso(), expires);
  logAudit({ actorType: 'client', actorId: String(req.client.id), action: 'reward_qr_created', entityType: 'reward_qr', entityId: String(result.lastInsertRowid), payload: { reward: reward.name, stars: reward.stars_price, token } });
  const row = getActiveRewardQr(req.client.id, reward.id);
  res.json({ ok: true, reused: false, qr: formatRewardQr(row) });
});

app.post('/api/client/reward-qr/cancel', clientAuth, (req, res) => {
  const token = String(req.body?.token || req.body?.manual_code || req.body?.code || '').trim();
  if (!token) return res.status(400).json({ ok: false, error: 'TOKEN_REQUIRED' });

  expireReservedRewardQrs(req.client.id);

  const row = db.prepare('SELECT * FROM reward_qrs WHERE token = ? AND client_id = ?').get(token, req.client.id);
  if (!row) return res.status(404).json({ ok: false, error: 'QR_NOT_FOUND' });
  if (row.status !== 'reserved') return res.status(400).json({ ok: false, error: 'QR_STATUS_' + row.status.toUpperCase(), status: row.status });

  db.prepare('UPDATE reward_qrs SET status = ?, canceled_at = ? WHERE id = ?').run('canceled', nowIso(), row.id);
  logAudit({ actorType: 'client', actorId: String(req.client.id), action: 'reward_qr_canceled_by_client', entityType: 'reward_qr', entityId: String(row.id), payload: { token } });
  const fresh = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.client.id);
  res.json({ ok: true, status: 'canceled', balance: fresh.stars_balance, available_stars: getClientAvailableStars(req.client.id) });
});

app.get('/api/client/reward-qrs', clientAuth, (req, res) => {
  expireReservedRewardQrs(req.client.id);
  const rows = db.prepare(`SELECT q.*, r.name, r.image_url, r.stars_price, r.product_external_id, r.conditions
    FROM reward_qrs q
    JOIN reward_products r ON r.id = q.reward_product_id
    WHERE q.client_id = ?
    ORDER BY q.created_at DESC
    LIMIT 100`).all(req.client.id);
  res.json({ ok: true, qrs: rows.map(formatRewardQr) });
});

app.get('/api/client/offers', clientAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM offers WHERE is_active = 1 ORDER BY id DESC').all();
  res.json({ ok: true, offers: rows.map((o) => ({ ...o, tiers: o.tiers_json ? JSON.parse(o.tiers_json) : null })) });
});

app.get('/api/client/progress', clientAuth, (req, res) => {
  const stamps = db.prepare(`SELECT p.id AS program_id, p.name, p.code, p.required_qty, p.reward_stars, COALESCE(sp.progress, 0) AS progress, COALESCE(sp.completed_count, 0) AS completed_count FROM stamp_programs p LEFT JOIN client_stamp_progress sp ON sp.program_id = p.id AND sp.client_id = ? WHERE p.is_active = 1 ORDER BY p.id`).all(req.client.id);
  const challenges = db.prepare(`SELECT ch.*, COUNT(d.day) AS progress FROM challenges ch LEFT JOIN client_challenge_days d ON d.challenge_id = ch.id AND d.client_id = ? WHERE ch.is_active = 1 GROUP BY ch.id ORDER BY ch.id`).all(req.client.id);
  res.json({ ok: true, stamps, challenges });
});

app.get('/api/client/news', clientAuth, (req, res) => {
  res.json({ ok: true, news: db.prepare('SELECT * FROM news WHERE is_active = 1 ORDER BY created_at DESC').all() });
});

app.get('/api/client/support/tickets', clientAuth, (req, res) => {
  const tickets = db.prepare('SELECT * FROM support_tickets WHERE client_id = ? ORDER BY updated_at DESC').all(req.client.id);
  const msg = db.prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC');
  res.json({ ok: true, tickets: tickets.map((t) => ({ ...t, messages: msg.all(t.id) })) });
});

app.post('/api/client/support/tickets', clientAuth, (req, res) => {
  const subject = String(req.body?.subject || '').trim();
  const message = String(req.body?.message || '').trim();
  if (!subject || !message) return res.status(400).json({ ok: false, error: 'SUBJECT_AND_MESSAGE_REQUIRED' });
  const now = nowIso();
  const r = db.prepare(`INSERT INTO support_tickets(client_id, subject, status, created_at, updated_at) VALUES(?, ?, 'open', ?, ?)`)
    .run(req.client.id, subject, now, now);
  db.prepare(`INSERT INTO support_messages(ticket_id, sender_type, sender_id, message, created_at) VALUES(?, 'client', ?, ?, ?)`)
    .run(r.lastInsertRowid, String(req.client.id), message, now);
  logAudit({ actorType: 'client', actorId: String(req.client.id), action: 'support_ticket_created', entityType: 'support_ticket', entityId: String(r.lastInsertRowid), payload: { subject } });
  res.json({ ok: true, ticket_id: r.lastInsertRowid });
});

app.post('/api/client/support/tickets/:id/messages', clientAuth, (req, res) => {
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ? AND client_id = ?').get(req.params.id, req.client.id);
  if (!ticket) return res.status(404).json({ ok: false, error: 'TICKET_NOT_FOUND' });
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ ok: false, error: 'MESSAGE_REQUIRED' });
  const now = nowIso();
  db.prepare(`INSERT INTO support_messages(ticket_id, sender_type, sender_id, message, created_at) VALUES(?, 'client', ?, ?, ?)`)
    .run(ticket.id, String(req.client.id), message, now);
  db.prepare(`UPDATE support_tickets SET status = 'open', updated_at = ? WHERE id = ?`).run(now, ticket.id);
  res.json({ ok: true });
});

app.get('/api/svg/qr', async (req, res) => {
  const text = String(req.query.text || '');
  if (!text) return res.status(400).send('text is required');
  const svg = await QRCode.toString(text, { type: 'svg', margin: 1, width: 256, color: { dark: '#111111', light: '#ffffff' } });
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
});

app.get('/api/svg/barcode', async (req, res) => {
  const text = String(req.query.text || '');
  if (!text) return res.status(400).send('text is required');
  const png = await bwipjs.toBuffer({ bcid: 'code128', text, scale: 2, height: 16, includetext: true, textxalign: 'center', backgroundcolor: 'FFFFFF' });
  res.setHeader('Content-Type', 'image/png');
  res.send(png);
});

// ---------------- 1C REST API ----------------

app.get('/api/1c/clients', oneCAuth, (req, res) => {
  expireReservedRewardQrs();
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 500)));
  const since = String(req.query.since || '').trim();
  const q = String(req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db.prepare(`SELECT * FROM clients
      WHERE is_blocked = 0 AND (name LIKE ? OR phone LIKE ? OR card_number LIKE ?)
      ORDER BY updated_at DESC LIMIT ?`).all(`%${q}%`, `%${q}%`, `%${q}%`, limit);
  } else if (since) {
    rows = db.prepare(`SELECT * FROM clients
      WHERE is_blocked = 0 AND COALESCE(updated_at, created_at, registered_at) >= ?
      ORDER BY updated_at DESC LIMIT ?`).all(since, limit);
  } else {
    rows = db.prepare(`SELECT * FROM clients
      WHERE is_blocked = 0
      ORDER BY updated_at DESC LIMIT ?`).all(limit);
  }

  const clients = rows.map((client) => ({
    id: client.id,
    name: client.name || '',
    phone: client.phone || '',
    email: client.email || '',
    birth_date: client.birth_date || '',
    favorite_store: client.favorite_store || '',
    card_number: client.card_number,
    card_token: client.card_token,
    barcode: normalizeCard(client.card_number),
    stars_balance: client.stars_balance || 0,
    available_stars: getClientAvailableStars(client.id),
    status: client.is_blocked ? 'blocked' : 'active',
    registered_at: client.registered_at,
    updated_at: client.updated_at || client.created_at || client.registered_at
  }));

  res.json({ ok: true, count: clients.length, clients });
});

app.get('/api/1c/client/search', oneCAuth, (req, res) => {
  expireReservedRewardQrs();
  const client = findClientForOneC(req.query);
  if (!client) return res.json({ ok: true, found: false });
  const rewards = db.prepare('SELECT id, name, stars_price FROM reward_products WHERE is_active = 1 AND stars_price <= ?').all(getClientAvailableStars(client.id));
  const stamps = db.prepare(`SELECT p.code, p.name, COALESCE(sp.progress, 0) AS progress, p.required_qty, p.reward_stars FROM stamp_programs p LEFT JOIN client_stamp_progress sp ON sp.program_id = p.id AND sp.client_id = ? WHERE p.is_active = 1 ORDER BY p.id`).all(client.id);
  res.json({ ok: true, found: true, client: {
    card_number: client.card_number,
    name: client.name,
    phone: client.phone,
    stars_balance: client.stars_balance,
    available_stars: getClientAvailableStars(client.id),
    status: client.is_blocked ? 'blocked' : 'active',
    available_rewards: rewards,
    stamp_rewards: stamps,
    restrictions: ['no_alcohol', 'no_tobacco', 'no_min_margin']
  } });
});


app.post('/api/1c/calculate', oneCAuth, (req, res) => {
  const body = req.body || {};
  const client = findClientForOneC({
    card_number: body.card_number,
    card_token: body.card_token,
    phone: body.phone
  });
  if (!client) return res.status(404).json({ ok: false, error: 'CLIENT_NOT_FOUND' });
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ ok: false, error: 'ITEMS_REQUIRED' });

  const calculation = calculateDraftWithOffers({
    items,
    storeId: body.store_id,
    purchasedAt: body.purchased_at || nowIso()
  });

  res.json({
    ok: true,
    client: {
      id: client.id,
      name: client.name,
      phone: client.phone,
      card_number: client.card_number,
      stars_balance: client.stars_balance,
      available_stars: getClientAvailableStars(client.id)
    },
    ...calculation
  });
});

app.post('/api/1c/receipts', oneCAuth, (req, res) => {
  const body = req.body || {};
  if (!body.id) return res.status(400).json({ ok: false, error: 'RECEIPT_ID_REQUIRED' });

  const rewardTokens = [];
  if (body.reward_qr_token) rewardTokens.push(String(body.reward_qr_token));
  if (Array.isArray(body.reward_qr_tokens)) rewardTokens.push(...body.reward_qr_tokens.map(String));
  const cleanRewardTokens = rewardTokens.map((t) => String(t || '').trim()).filter(Boolean);
  const isRewardReceipt = cleanRewardTokens.length > 0;

  const existing = db.prepare('SELECT * FROM receipts WHERE id = ?').get(body.id);
  if (existing) {
    const finalized = [];
    for (const rewardToken of cleanRewardTokens) {
      finalized.push(finalizeRewardQrOnce({
        token: rewardToken,
        receiptId: body.id,
        actorId: body.store_id || '1c',
        storeId: body.store_id || '1c'
      }));
    }
    const duplicateDebug = {
      reason: 'DUPLICATE_RECEIPT_ID',
      receipt_id: existing.id,
      note: 'Челенджі повторно не обробляються для вже імпортованого receipt_id. Створіть новий чек/новий номер документа в 1С.'
    };
    writeChallengeDebug(duplicateDebug);
    return res.json({
      ok: true,
      duplicate: true,
      receipt_id: existing.id,
      stars_accrued: existing.stars_accrued,
      stars_spent: existing.stars_spent,
      reward_finalize: finalized,
      challenge_debug: challengeDebugEnabled() ? [duplicateDebug] : undefined
    });
  }

  let client = findClientForOneC({ card_number: body.card_number, card_token: body.card_token, phone: body.phone });

  // Для чека за зірки клієнта можна визначити напряму через QR, навіть якщо карта не передалась у чеку.
  if (!client && cleanRewardTokens.length) {
    const row = db.prepare('SELECT c.* FROM reward_qrs q JOIN clients c ON c.id = q.client_id WHERE q.token = ? LIMIT 1').get(cleanRewardTokens[0]);
    if (row) client = row;
  }

  if (!client) return res.status(404).json({ ok: false, error: 'CLIENT_NOT_FOUND' });

  const items = Array.isArray(body.items) ? body.items : [];
  const totalCents = Math.round(Number(body.total_cents || 0));
  const eligibleCentsRaw = calculateEligibleCents(items, body.eligible_cents);
  const eligibleCents = isRewardReceipt ? 0 : eligibleCentsRaw;
  const excludedCents = Math.max(0, totalCents - eligibleCents);
  const purchasedAt = body.purchased_at || nowIso();
  const accrual = isRewardReceipt ? { stars: 0, applied: [] } : calculateAccrualWithOffers(items, body.store_id, purchasedAt);
  const starsAccrued = items.length ? accrual.stars : (isRewardReceipt ? 0 : Math.floor(eligibleCents / 100));

  let starsSpent = Math.abs(Number(body.stars_spent || 0));
  if (isRewardReceipt && starsSpent === 0) {
    for (const rewardToken of cleanRewardTokens) {
      const row = db.prepare('SELECT stars_reserved FROM reward_qrs WHERE token = ?').get(rewardToken);
      if (row) starsSpent += Math.abs(Number(row.stars_reserved || 0));
    }
  }

  db.prepare(`INSERT INTO receipts(id, fiscal_number, client_id, store_id, cash_register, cashier, total_cents, eligible_cents, excluded_cents, stars_accrued, stars_spent, club_conditions_json, is_return, purchased_at, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(
      body.id,
      body.fiscal_number || null,
      client.id,
      body.store_id || null,
      body.cash_register || null,
      body.cashier || null,
      totalCents,
      eligibleCents,
      excludedCents,
      starsAccrued,
      starsSpent,
      JSON.stringify([...(body.club_conditions || []), ...accrual.applied]),
      purchasedAt,
      nowIso()
    );

  const insertItem = db.prepare(`INSERT INTO receipt_items(receipt_id, product_id, external_product_id, name, category, qty, price_cents, line_total_cents, is_alcohol, is_tobacco, is_min_margin, no_star_accrual, no_redeem)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  for (const item of items) {
    const flags = item.flags || item;
    insertItem.run(
      body.id,
      item.product_id || null,
      item.external_product_id || null,
      item.name || 'Товар',
      item.category || null,
      Number(item.qty || 1),
      Math.round(Number(item.price_cents || 0)),
      Math.round(Number(item.line_total_cents || item.total_cents || 0)),
      flags.is_alcohol ? 1 : 0,
      flags.is_tobacco ? 1 : 0,
      flags.is_min_margin ? 1 : 0,
      isRewardReceipt ? 1 : (flags.no_star_accrual ? 1 : 0),
      isRewardReceipt ? 1 : (flags.no_redeem ? 1 : 0)
    );
  }

  if (starsAccrued > 0) {
    awardStars(client.id, 'purchase_accrual', starsAccrued, 'receipt', `+${starsAccrued} ⭐ за покупку`, body.id, null);
  }

  const finalized = [];
  for (const rewardToken of cleanRewardTokens) {
    finalized.push(finalizeRewardQrOnce({
      token: rewardToken,
      receiptId: body.id,
      actorId: body.store_id || '1c',
      storeId: body.store_id || '1c'
    }));
  }

  db.prepare('UPDATE clients SET last_purchase_at = ?, updated_at = ? WHERE id = ?')
    .run(purchasedAt, nowIso(), client.id);

  const profileBonusResult = tryAwardProfileBonus(client.id, 'after_first_purchase');

  let challengeDiagnostics = [];
  if (!isRewardReceipt) {
    challengeDiagnostics = addChallengeVisit(client.id, body.id, purchasedAt, totalCents, items);
    updateStampProgress(client.id, body.id, items);
  }

  logAudit({
    actorType: '1c',
    actorId: body.store_id || '1c',
    action: isRewardReceipt ? 'reward_receipt_imported' : 'receipt_imported',
    entityType: 'receipt',
    entityId: body.id,
    payload: { starsAccrued, starsSpent, eligibleCents, rewardTokens: cleanRewardTokens, profileBonus: profileBonusResult, challengeDebug: challengeDebugEnabled() ? challengeDiagnostics : undefined }
  });

  const fresh = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
  res.json({
    ok: true,
    duplicate: false,
    receipt_id: body.id,
    stars_accrued: starsAccrued,
    stars_spent: starsSpent,
    balance: fresh.stars_balance,
    reward_finalize: finalized,
    challenge_debug: challengeDebugEnabled() ? challengeDiagnostics : undefined
  });
});

app.post('/api/1c/reward-qr/validate', oneCAuth, (req, res) => {
  const token = String(req.body?.token || req.body?.manual_code || req.body?.code || '').trim();
  if (!token) return res.status(400).json({ ok: false, valid: false, error: 'TOKEN_REQUIRED' });

  expireReservedRewardQrs();

  const row = db.prepare(`SELECT q.*, r.name, r.stars_price, r.product_external_id, r.store_id, r.conditions,
      COALESCE(p.price_cents, 0) AS product_price_cents,
      p.name AS product_1c_name,
      c.card_number, c.phone, c.name AS client_name, c.stars_balance
    FROM reward_qrs q
    JOIN reward_products r ON r.id = q.reward_product_id
    JOIN clients c ON c.id = q.client_id
    LEFT JOIN products p ON p.external_id = r.product_external_id OR p.id = r.product_external_id
    WHERE q.token = ?`).get(token);

  if (!row) return res.status(404).json({ ok: false, valid: false, error: 'QR_NOT_FOUND' });
  if (row.status !== 'reserved') return res.status(400).json({ ok: false, valid: false, status: row.status, error: 'QR_ALREADY_' + row.status.toUpperCase() });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('UPDATE reward_qrs SET status = ?, canceled_at = ? WHERE id = ?').run('expired', nowIso(), row.id);
    return res.status(400).json({ ok: false, valid: false, status: 'expired', error: 'QR_EXPIRED' });
  }

  res.json({ ok: true, valid: true, status: 'reserved', qr: {
    id: row.id,
    token: row.token,
    manual_code: row.token,
    product_name: row.name,
    product_external_id: row.product_external_id,
    product_1c_name: row.product_1c_name || row.name,
    qty: 1,
    price_cents: Number(row.product_price_cents || 0),
    price_uah: money(row.product_price_cents || 0),
    line_total_cents: Number(row.product_price_cents || 0),
    stars_to_spend: row.stars_reserved,
    expires_at: row.expires_at,
    conditions: row.conditions,
    store_id: row.store_id,
    client: { card_number: row.card_number, phone: row.phone, name: row.client_name, balance: row.stars_balance }
  } });
});

app.post('/api/1c/reward-qr/finalize', oneCAuth, (req, res) => {
  const token = String(req.body?.token || req.body?.manual_code || req.body?.code || '').trim();
  const receiptId = String(req.body?.receipt_id || req.body?.receiptId || '').trim();
  const result = finalizeRewardQrOnce({
    token,
    receiptId,
    actorId: req.body?.store_id || '1c',
    storeId: req.body?.store_id || '1c'
  });
  if (!result.ok) {
    const status = result.error === 'QR_NOT_FOUND' ? 404 : 400;
    return res.status(status).json(result);
  }
  res.json(result);
});

app.post('/api/1c/reward-qr/cancel', oneCAuth, (req, res) => {
  const token = String(req.body?.token || '').trim();
  const row = db.prepare('SELECT * FROM reward_qrs WHERE token = ?').get(token);
  if (!row) return res.status(404).json({ ok: false, error: 'QR_NOT_FOUND' });
  if (row.status !== 'reserved') return res.status(400).json({ ok: false, error: 'QR_STATUS_' + row.status.toUpperCase() });
  db.prepare('UPDATE reward_qrs SET status = ?, canceled_at = ? WHERE id = ?').run('canceled', nowIso(), row.id);
  logAudit({ actorType: '1c', actorId: req.body?.store_id || '1c', action: 'reward_qr_canceled', entityType: 'reward_qr', entityId: String(row.id), payload: req.body });
  res.json({ ok: true, status: 'canceled' });
});

app.post('/api/1c/returns', oneCAuth, (req, res) => {
  const body = req.body || {};
  if (!body.id || !body.original_receipt_id) return res.status(400).json({ ok: false, error: 'RETURN_ID_AND_ORIGINAL_REQUIRED' });
  const existing = db.prepare('SELECT * FROM receipts WHERE id = ?').get(body.id);
  if (existing) return res.json({ ok: true, duplicate: true, return_id: existing.id });
  const original = db.prepare('SELECT * FROM receipts WHERE id = ?').get(body.original_receipt_id);
  if (!original) return res.status(404).json({ ok: false, error: 'ORIGINAL_RECEIPT_NOT_FOUND' });
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(original.client_id);
  if (!client) return res.status(404).json({ ok: false, error: 'CLIENT_NOT_FOUND' });
  const eligibleCents = calculateEligibleCents(body.items || [], body.eligible_cents);
  const starsToCancel = Math.floor(eligibleCents / 100);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO receipts(id, fiscal_number, client_id, store_id, cash_register, cashier, total_cents, eligible_cents, excluded_cents, stars_accrued, stars_spent, is_return, original_receipt_id, purchased_at, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`)
      .run(body.id, body.fiscal_number || null, client.id, body.store_id || original.store_id, body.cash_register || null, body.cashier || null, Math.round(Number(body.total_cents || 0)), eligibleCents, 0, -starsToCancel, body.original_receipt_id, body.returned_at || nowIso(), nowIso());
    if (starsToCancel > 0) awardStars(client.id, 'return_cancel', -starsToCancel, 'return', `-${starsToCancel} ⭐ скасування через повернення`, body.id, null);
    logAudit({ actorType: '1c', actorId: body.store_id || '1c', action: 'return_imported', entityType: 'receipt', entityId: body.id, payload: { original: body.original_receipt_id, starsToCancel } });
  });
  tx();
  const fresh = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
  res.json({ ok: true, return_id: body.id, stars_canceled: starsToCancel, balance: fresh.stars_balance });
});

app.post('/api/1c/products/sync', oneCAuth, (req, res) => {
  const products = Array.isArray(req.body?.products) ? req.body.products : [];
  const upsert = db.prepare(`INSERT INTO products(external_id, id, name, category, image_url, price_cents, is_alcohol, is_tobacco, is_min_margin, no_star_accrual, no_redeem, updated_at)
    VALUES(@external_id, @id, @name, @category, @image_url, @price_cents, @is_alcohol, @is_tobacco, @is_min_margin, @no_star_accrual, @no_redeem, @updated_at)
    ON CONFLICT(external_id) DO UPDATE SET name = excluded.name, category = excluded.category, image_url = excluded.image_url, price_cents = excluded.price_cents, is_alcohol = excluded.is_alcohol, is_tobacco = excluded.is_tobacco, is_min_margin = excluded.is_min_margin, no_star_accrual = excluded.no_star_accrual, no_redeem = excluded.no_redeem, updated_at = excluded.updated_at`);
  const tx = db.transaction(() => {
    for (const p of products) {
      const flags = p.flags || p;
      upsert.run({
        external_id: String(p.external_id),
        id: String(p.external_id),
        name: p.name || 'Товар',
        category: p.category || null,
        image_url: p.image_url || null,
        price_cents: Math.round(Number(p.price_cents || 0)),
        is_alcohol: flags.is_alcohol ? 1 : 0,
        is_tobacco: flags.is_tobacco ? 1 : 0,
        is_min_margin: flags.is_min_margin ? 1 : 0,
        no_star_accrual: flags.no_star_accrual ? 1 : 0,
        no_redeem: flags.no_redeem ? 1 : 0,
        updated_at: nowIso()
      });
    }
  });
  tx();
  res.json({ ok: true, synced: products.length });
});


// ---------------- Admin CRUD for ТЗ v1.1 ----------------
app.get('/api/admin/catalog/rewards', adminAuth, (req, res) => {
  res.json({ ok: true, items: db.prepare('SELECT * FROM reward_products ORDER BY id DESC').all() });
});

app.post('/api/admin/catalog/rewards', adminAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name || !Number(b.stars_price)) return res.status(400).json({ ok: false, error: 'NAME_AND_STARS_REQUIRED' });
  const t = nowIso();
  const row = {
    product_external_id: b.product_external_id || null,
    name: String(b.name).trim(),
    image_url: b.image_url || '/assets/star.svg',
    stars_price: Math.round(Number(b.stars_price)),
    store_id: b.store_id || 'all',
    active_from: b.active_from || t,
    active_to: b.active_to || null,
    total_limit: b.total_limit ? Number(b.total_limit) : null,
    per_client_limit: b.per_client_limit ? Number(b.per_client_limit) : 1,
    conditions: b.conditions || null,
    created_at: t,
    updated_at: t
  };
  const result = db.prepare(`INSERT INTO reward_products(product_external_id, name, image_url, stars_price, store_id, active_from, active_to, total_limit, per_client_limit, conditions, created_at, updated_at)
    VALUES(@product_external_id, @name, @image_url, @stars_price, @store_id, @active_from, @active_to, @total_limit, @per_client_limit, @conditions, @created_at, @updated_at)`).run(row);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'reward_product_created', entityType: 'reward_product', entityId: String(result.lastInsertRowid), payload: row });
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.patch('/api/admin/catalog/rewards/:id', adminAuth, (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM reward_products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'REWARD_NOT_FOUND' });
  db.prepare(`UPDATE reward_products SET name = ?, image_url = ?, stars_price = ?, store_id = ?, active_from = ?, active_to = ?, total_limit = ?, per_client_limit = ?, conditions = ?, is_active = ?, updated_at = ? WHERE id = ?`)
    .run(b.name ?? existing.name, b.image_url ?? existing.image_url, b.stars_price ?? existing.stars_price, b.store_id ?? existing.store_id, b.active_from ?? existing.active_from, b.active_to ?? existing.active_to, b.total_limit ?? existing.total_limit, b.per_client_limit ?? existing.per_client_limit, b.conditions ?? existing.conditions, b.is_active === undefined ? existing.is_active : (b.is_active ? 1 : 0), nowIso(), req.params.id);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'reward_product_updated', entityType: 'reward_product', entityId: req.params.id, payload: b });
  res.json({ ok: true });
});

app.get('/api/admin/catalog/offers', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM offers ORDER BY id DESC').all().map(o => ({ ...o, tiers: o.tiers_json ? JSON.parse(o.tiers_json) : null }));
  res.json({ ok: true, offers: rows });
});

app.post('/api/admin/catalog/offers', adminAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.type) return res.status(400).json({ ok: false, error: 'TYPE_AND_NAME_REQUIRED' });
  const t = nowIso();
  const row = {
    type: b.type,
    name: String(b.name).trim(),
    description: b.description || null,
    image_url: b.image_url || '/assets/star.svg',
    product_external_id: b.product_external_id || null,
    category: b.category || null,
    club_price_cents: b.club_price_cents ? Math.round(Number(b.club_price_cents)) : null,
    old_price_cents: b.old_price_cents ? Math.round(Number(b.old_price_cents)) : null,
    stars_multiplier: b.stars_multiplier ? Number(b.stars_multiplier) : null,
    tiers_json: Array.isArray(b.tiers) ? JSON.stringify(b.tiers) : (b.tiers_json || null),
    store_id: b.store_id || 'all',
    audience: b.audience || 'all',
    active_from: b.active_from || t,
    active_to: b.active_to || null,
    created_at: t,
    updated_at: t
  };
  const result = db.prepare(`INSERT INTO offers(type, name, description, image_url, product_external_id, category, club_price_cents, old_price_cents, stars_multiplier, tiers_json, store_id, audience, active_from, active_to, created_at, updated_at)
    VALUES(@type, @name, @description, @image_url, @product_external_id, @category, @club_price_cents, @old_price_cents, @stars_multiplier, @tiers_json, @store_id, @audience, @active_from, @active_to, @created_at, @updated_at)`).run(row);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'offer_created', entityType: 'offer', entityId: String(result.lastInsertRowid), payload: row });
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.get('/api/admin/catalog/challenges', adminAuth, (req, res) => {
  res.json({ ok: true, challenges: db.prepare('SELECT * FROM challenges ORDER BY id DESC').all() });
});

app.post('/api/admin/catalog/challenges', adminAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name || !Number(b.required_visits) || !Number(b.reward_stars)) return res.status(400).json({ ok: false, error: 'CHALLENGE_FIELDS_REQUIRED' });
  const code = b.code || randomToken('challenge_');
  const t = nowIso();
  const result = db.prepare(`INSERT INTO challenges(code, name, description, required_visits, min_total_cents, reward_stars, period_type, store_id, category, is_repeatable, is_active, active_from, active_to, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, b.name, b.description || null, Number(b.required_visits), Math.round(Number(b.min_total_cents || 0)), Number(b.reward_stars), b.period_type || 'week', b.store_id || 'all', b.category || null, b.is_repeatable ? 1 : 0, 1, b.active_from || t, b.active_to || null, t);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'challenge_created', entityType: 'challenge', entityId: String(result.lastInsertRowid), payload: b });
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.get('/api/admin/catalog/stamps', adminAuth, (req, res) => {
  res.json({ ok: true, programs: db.prepare('SELECT * FROM stamp_programs ORDER BY id DESC').all() });
});

app.post('/api/admin/catalog/stamps', adminAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.category || !Number(b.required_qty) || !Number(b.reward_stars)) return res.status(400).json({ ok: false, error: 'STAMP_FIELDS_REQUIRED' });
  const t = nowIso();
  const result = db.prepare('INSERT INTO stamp_programs(code, name, category, required_qty, reward_stars, is_repeatable, is_active, created_at) VALUES(?, ?, ?, ?, ?, ?, 1, ?)')
    .run(b.code || randomToken('stamp_'), b.name, b.category, Number(b.required_qty), Number(b.reward_stars), b.is_repeatable === false ? 0 : 1, t);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'stamp_program_created', entityType: 'stamp_program', entityId: String(result.lastInsertRowid), payload: b });
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.get('/api/admin/catalog/news', adminAuth, (req, res) => {
  res.json({ ok: true, news: db.prepare('SELECT * FROM news ORDER BY id DESC').all() });
});

app.post('/api/admin/catalog/news', adminAuth, (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.text) return res.status(400).json({ ok: false, error: 'NEWS_FIELDS_REQUIRED' });
  const result = db.prepare('INSERT INTO news(title, text, image_url, tag, is_active, created_at) VALUES(?, ?, ?, ?, ?, ?)')
    .run(b.title, b.text, b.image_url || '/assets/star.svg', b.tag || 'STAR CLUB', b.is_active === false ? 0 : 1, nowIso());
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'news_created', entityType: 'news', entityId: String(result.lastInsertRowid), payload: b });
  res.json({ ok: true, id: result.lastInsertRowid });
});


app.delete('/api/admin/catalog/rewards/:id', adminAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM reward_products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'REWARD_NOT_FOUND' });
  db.prepare('DELETE FROM reward_qrs WHERE reward_product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM reward_products WHERE id = ?').run(req.params.id);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'reward_product_deleted', entityType: 'reward_product', entityId: req.params.id, payload: {} });
  res.json({ ok: true });
});

app.patch('/api/admin/catalog/offers/:id', adminAuth, (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'OFFER_NOT_FOUND' });
  db.prepare(`UPDATE offers SET type=?, name=?, description=?, image_url=?, product_external_id=?, category=?, club_price_cents=?, old_price_cents=?, stars_multiplier=?, tiers_json=?, store_id=?, audience=?, active_from=?, active_to=?, is_active=?, updated_at=? WHERE id=?`)
    .run(b.type ?? existing.type, b.name ?? existing.name, b.description ?? existing.description, b.image_url ?? existing.image_url, b.product_external_id ?? existing.product_external_id, b.category ?? existing.category, b.club_price_cents === undefined ? existing.club_price_cents : b.club_price_cents, b.old_price_cents === undefined ? existing.old_price_cents : b.old_price_cents, b.stars_multiplier === undefined ? existing.stars_multiplier : b.stars_multiplier, b.tiers ? JSON.stringify(b.tiers) : (b.tiers_json === undefined ? existing.tiers_json : b.tiers_json), b.store_id ?? existing.store_id, b.audience ?? existing.audience, b.active_from ?? existing.active_from, b.active_to ?? existing.active_to, b.is_active === undefined ? existing.is_active : (b.is_active ? 1 : 0), nowIso(), req.params.id);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'offer_updated', entityType: 'offer', entityId: req.params.id, payload: b });
  res.json({ ok: true });
});

app.delete('/api/admin/catalog/offers/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM offers WHERE id = ?').run(req.params.id);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'offer_deleted', entityType: 'offer', entityId: req.params.id, payload: {} });
  res.json({ ok: true });
});

app.patch('/api/admin/catalog/challenges/:id', adminAuth, (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'CHALLENGE_NOT_FOUND' });
  db.prepare(`UPDATE challenges SET name=?, description=?, required_visits=?, min_total_cents=?, reward_stars=?, period_type=?, store_id=?, category=?, is_repeatable=?, is_active=?, active_from=?, active_to=? WHERE id=?`)
    .run(b.name ?? existing.name, b.description ?? existing.description, b.required_visits ?? existing.required_visits, b.min_total_cents ?? existing.min_total_cents, b.reward_stars ?? existing.reward_stars, b.period_type ?? existing.period_type, b.store_id ?? existing.store_id, b.category ?? existing.category, b.is_repeatable === undefined ? existing.is_repeatable : (b.is_repeatable ? 1 : 0), b.is_active === undefined ? existing.is_active : (b.is_active ? 1 : 0), b.active_from ?? existing.active_from, b.active_to ?? existing.active_to, req.params.id);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'challenge_updated', entityType: 'challenge', entityId: req.params.id, payload: b });
  res.json({ ok: true });
});

app.delete('/api/admin/catalog/challenges/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM client_challenge_days WHERE challenge_id = ?').run(req.params.id);
  db.prepare('DELETE FROM client_challenge_rewards WHERE challenge_id = ?').run(req.params.id);
  db.prepare('DELETE FROM challenges WHERE id = ?').run(req.params.id);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'challenge_deleted', entityType: 'challenge', entityId: req.params.id, payload: {} });
  res.json({ ok: true });
});

app.patch('/api/admin/catalog/stamps/:id', adminAuth, (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM stamp_programs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'STAMP_NOT_FOUND' });
  db.prepare('UPDATE stamp_programs SET name=?, category=?, required_qty=?, reward_stars=?, is_repeatable=?, is_active=? WHERE id=?')
    .run(b.name ?? existing.name, b.category ?? existing.category, b.required_qty ?? existing.required_qty, b.reward_stars ?? existing.reward_stars, b.is_repeatable === undefined ? existing.is_repeatable : (b.is_repeatable ? 1 : 0), b.is_active === undefined ? existing.is_active : (b.is_active ? 1 : 0), req.params.id);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'stamp_program_updated', entityType: 'stamp_program', entityId: req.params.id, payload: b });
  res.json({ ok: true });
});

app.delete('/api/admin/catalog/stamps/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM client_stamp_progress WHERE program_id = ?').run(req.params.id);
  db.prepare('DELETE FROM stamp_programs WHERE id = ?').run(req.params.id);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'stamp_program_deleted', entityType: 'stamp_program', entityId: req.params.id, payload: {} });
  res.json({ ok: true });
});

app.patch('/api/admin/catalog/news/:id', adminAuth, (req, res) => {
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: 'NEWS_NOT_FOUND' });
  db.prepare('UPDATE news SET title=?, text=?, image_url=?, tag=?, is_active=? WHERE id=?')
    .run(b.title ?? existing.title, b.text ?? existing.text, b.image_url ?? existing.image_url, b.tag ?? existing.tag, b.is_active === undefined ? existing.is_active : (b.is_active ? 1 : 0), req.params.id);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'news_updated', entityType: 'news', entityId: req.params.id, payload: b });
  res.json({ ok: true });
});

app.delete('/api/admin/catalog/news/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM news WHERE id = ?').run(req.params.id);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'news_deleted', entityType: 'news', entityId: req.params.id, payload: {} });
  res.json({ ok: true });
});

app.get('/api/admin/support/tickets', adminAuth, (req, res) => {
  const tickets = db.prepare(`SELECT t.*, c.name AS client_name, c.phone, c.card_number FROM support_tickets t
    JOIN clients c ON c.id = t.client_id ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, t.updated_at DESC`).all();
  const msg = db.prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC');
  res.json({ ok: true, tickets: tickets.map((t) => ({ ...t, messages: msg.all(t.id) })) });
});

app.post('/api/admin/support/tickets/:id/reply', adminAuth, (req, res) => {
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ ok: false, error: 'TICKET_NOT_FOUND' });
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ ok: false, error: 'MESSAGE_REQUIRED' });
  const now = nowIso();
  db.prepare(`INSERT INTO support_messages(ticket_id, sender_type, sender_id, message, created_at) VALUES(?, 'admin', ?, ?, ?)`)
    .run(ticket.id, String(req.admin.id), message, now);
  db.prepare(`UPDATE support_tickets SET status = 'answered', assigned_admin_id = ?, updated_at = ? WHERE id = ?`).run(req.admin.id || null, now, ticket.id);
  logAudit({ actorType: 'admin', actorId: String(req.admin.id), action: 'support_ticket_replied', entityType: 'support_ticket', entityId: String(ticket.id), payload: {} });
  res.json({ ok: true });
});

app.patch('/api/admin/support/tickets/:id', adminAuth, (req, res) => {
  const status = ['open', 'answered', 'closed'].includes(req.body?.status) ? req.body.status : 'open';
  db.prepare('UPDATE support_tickets SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?')
    .run(status, nowIso(), status === 'closed' ? nowIso() : null, req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/users', ownerAuth, (req, res) => {
  res.json({ ok: true, users: db.prepare('SELECT * FROM admin_users ORDER BY role DESC, created_at DESC').all().map(formatAdmin) });
});

app.post('/api/admin/users', ownerAuth, (req, res) => {
  const telegramId = String(req.body?.telegram_id || '').trim();
  if (!telegramId) return res.status(400).json({ ok: false, error: 'TELEGRAM_ID_REQUIRED' });
  const permissions = Array.isArray(req.body?.permissions) ? [...new Set(req.body.permissions.map(String))] : [];
  if (!permissions.length) return res.status(400).json({ ok: false, error: 'ADMIN_PERMISSIONS_REQUIRED' });
  const now = nowIso();
  db.prepare(`INSERT INTO admin_users(telegram_id, name, username, role, permissions_json, is_active, created_at, updated_at)
    VALUES(?, ?, ?, 'admin', ?, 1, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      name=excluded.name, username=excluded.username, role='admin',
      permissions_json=excluded.permissions_json, is_active=1, updated_at=excluded.updated_at`)
    .run(telegramId, req.body?.name || 'Admin', req.body?.username || null, JSON.stringify(permissions), now, now);
  const created = db.prepare('SELECT * FROM admin_users WHERE telegram_id = ?').get(telegramId);
  logAudit({ actorType: 'admin', actorId: String(req.admin.id), action: 'admin_created_or_updated', entityType: 'admin_user', entityId: String(created.id), payload: { telegram_id: telegramId, permissions } });
  res.json({ ok: true, user: formatAdmin(created) });
});

app.patch('/api/admin/users/:id', ownerAuth, (req, res) => {
  const current = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ ok: false, error: 'ADMIN_NOT_FOUND' });
  if (current.role === 'owner') return res.status(400).json({ ok: false, error: 'OWNER_CANNOT_BE_EDITED_HERE' });
  const permissions = Array.isArray(req.body?.permissions) ? [...new Set(req.body.permissions.map(String))] : [];
  if (req.body?.is_active !== false && !permissions.length) return res.status(400).json({ ok: false, error: 'ADMIN_PERMISSIONS_REQUIRED' });
  db.prepare(`UPDATE admin_users
    SET name = ?, username = ?, role = 'admin', permissions_json = ?, is_active = ?, updated_at = ?
    WHERE id = ?`)
    .run(req.body?.name || current.name || 'Admin', req.body?.username ?? current.username, JSON.stringify(permissions), req.body?.is_active === false ? 0 : 1, nowIso(), req.params.id);
  const updated = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.params.id);
  logAudit({ actorType: 'admin', actorId: String(req.admin.id), action: 'admin_permissions_updated', entityType: 'admin_user', entityId: String(updated.id), payload: { permissions, is_active: Boolean(updated.is_active) } });
  res.json({ ok: true, user: formatAdmin(updated) });
});

app.delete('/api/admin/users/:id', ownerAuth, (req, res) => {
  const current = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ ok: false, error: 'ADMIN_NOT_FOUND' });
  if (current.role === 'owner') return res.status(400).json({ ok: false, error: 'OWNER_CANNOT_BE_DELETED' });
  db.prepare('DELETE FROM admin_sessions WHERE admin_user_id = ?').run(current.id);
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(current.id);
  logAudit({ actorType: 'admin', actorId: String(req.admin.id), action: 'admin_deleted', entityType: 'admin_user', entityId: String(current.id), payload: { telegram_id: current.telegram_id } });
  res.json({ ok: true });
});

app.get('/api/admin/settings', adminAuth, (req, res) => {
  res.json({ ok: true, settings: db.prepare('SELECT * FROM settings ORDER BY key').all().map(r => ({ key: r.key, value: JSON.parse(r.value) })) });
});

app.put('/api/admin/settings/:key', adminAuth, (req, res) => {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(req.params.key, JSON.stringify(req.body?.value ?? req.body));
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'setting_updated', entityType: 'setting', entityId: req.params.key, payload: req.body });
  res.json({ ok: true });
});

// ---------------- Admin API ----------------
app.get('/api/admin/summary', adminAuth, (req, res) => {
  const clients = db.prepare('SELECT COUNT(*) AS c FROM clients').get().c;
  const active = db.prepare('SELECT COUNT(*) AS c FROM clients WHERE last_purchase_at IS NOT NULL').get().c;
  const stars = db.prepare('SELECT COALESCE(SUM(stars_balance), 0) AS s FROM clients').get().s;
  const receipts = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(total_cents), 0) AS total FROM receipts WHERE is_return = 0').get();
  const rewards = db.prepare('SELECT COUNT(*) AS c FROM reward_qrs WHERE status = "used"').get().c;
  res.json({ ok: true, summary: { clients, active, stars, receipts: receipts.c, total_sales_uah: money(receipts.total), rewards_used: rewards } });
});

app.get('/api/admin/clients', adminAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = q
    ? db.prepare('SELECT * FROM clients WHERE phone LIKE ? OR name LIKE ? OR card_number LIKE ? ORDER BY created_at DESC LIMIT 200').all(`%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM clients ORDER BY created_at DESC LIMIT 200').all();
  res.json({ ok: true, clients: rows.map(formatClient) });
});

app.get('/api/admin/clients/:id', adminAuth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ ok: false, error: 'CLIENT_NOT_FOUND' });
  const ledger = db.prepare('SELECT * FROM star_ledger WHERE client_id = ? ORDER BY created_at DESC LIMIT 100').all(client.id);
  const receipts = db.prepare('SELECT * FROM receipts WHERE client_id = ? ORDER BY purchased_at DESC LIMIT 50').all(client.id);
  const progress = db.prepare(`SELECT p.name, COALESCE(sp.progress, 0) AS progress, p.required_qty, p.reward_stars FROM stamp_programs p LEFT JOIN client_stamp_progress sp ON sp.program_id = p.id AND sp.client_id = ? WHERE p.is_active = 1 ORDER BY p.id`).all(client.id);
  res.json({ ok: true, client: formatClient(client), ledger, receipts, progress });
});

app.post('/api/admin/clients/:id/block', adminAuth, (req, res) => {
  db.prepare('UPDATE clients SET is_blocked = ?, updated_at = ? WHERE id = ?').run(req.body?.blocked ? 1 : 0, nowIso(), req.params.id);
  logAudit({ actorType: 'admin', actorId: 'admin', action: req.body?.blocked ? 'client_blocked' : 'client_unblocked', entityType: 'client', entityId: req.params.id, payload: req.body });
  res.json({ ok: true });
});

app.post('/api/admin/clients/:id/adjust-stars', adminAuth, (req, res) => {
  const amount = Math.round(Number(req.body?.amount || 0));
  if (!amount) return res.status(400).json({ ok: false, error: 'AMOUNT_REQUIRED' });
  const balance = awardStars(Number(req.params.id), 'manual_adjustment', amount, 'admin', req.body?.description || 'Ручне коригування');
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'manual_star_adjustment', entityType: 'client', entityId: req.params.id, payload: { amount, balance } });
  res.json({ ok: true, balance });
});

app.get('/api/admin/reward-qrs', adminAuth, (req, res) => {
  const rows = db.prepare(`SELECT q.*, c.name AS client_name, c.phone, r.name AS reward_name FROM reward_qrs q JOIN clients c ON c.id = q.client_id JOIN reward_products r ON r.id = q.reward_product_id ORDER BY q.created_at DESC LIMIT 200`).all();
  res.json({ ok: true, qrs: rows });
});

app.get('/api/admin/debug/challenges', adminAuth, (req, res) => {
  const logs = db.prepare(`SELECT * FROM audit_logs
    WHERE action IN ('challenge_category_not_matched', 'challenge_awarded', 'receipt_imported')
    ORDER BY created_at DESC LIMIT 100`).all().map((row) => {
      let payload = null;
      try { payload = row.payload_json ? JSON.parse(row.payload_json) : null; } catch {}
      return { ...row, payload };
    });
  const activeChallenges = db.prepare('SELECT * FROM challenges WHERE is_active = 1 ORDER BY id DESC').all();
  res.json({ ok: true, debug_enabled: challengeDebugEnabled(), active_challenges: activeChallenges, logs });
});

app.get('/api/admin/audit', adminAuth, (req, res) => {
  res.json({ ok: true, logs: db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all() });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const server = app.listen(port, async () => {
  console.log(`Star Club prototype is running on http://localhost:${port}`);

  if (process.env.RUN_BOT === 'true') {
    try {
      const bot = await startStarClubBot();
      const stop = (signal) => {
        try { bot.stop(signal); } catch {}
        server.close(() => process.exit(0));
      };
      process.once('SIGINT', () => stop('SIGINT'));
      process.once('SIGTERM', () => stop('SIGTERM'));
    } catch (error) {
      console.error('Telegram bot was not started:', error.message || error);
    }
  }
});
