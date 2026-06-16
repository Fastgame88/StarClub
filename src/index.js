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

dotenv.config();
await initDb();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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

function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_API_KEY || 'change-this-admin-key';
  const got = req.header('x-admin-key') || req.query.admin_key;
  if (!got || got !== expected) return res.status(401).json({ ok: false, error: 'ADMIN_UNAUTHORIZED' });
  next();
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

function makeGoogleDemoPhone(email) {
  const digits = String(email || 'google').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0).toString().padStart(7, '0').slice(-7);
  return `+38099${digits}`;
}

function money(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

function formatClient(client) {
  if (!client) return null;
  const required = getSetting('profile_bonus', { requiredFields: ['phone', 'name', 'birth_date', 'favorite_store'] }).requiredFields;
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
    registered: Boolean(client.phone),
    profile_progress: {
      completed,
      total: required.length,
      percent: Math.round((completed / required.length) * 100),
      required_fields: required
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

function addChallengeVisit(clientId, receiptId, purchasedAt, totalCents, eligibleItems) {
  const day = new Date(purchasedAt).toISOString().slice(0, 10);
  const challenges = db.prepare('SELECT * FROM challenges WHERE is_active = 1').all();
  for (const ch of challenges) {
    if (totalCents < Number(ch.min_total_cents || 0)) continue;
    if (!receiptHasEligibleItems(eligibleItems)) continue;
    const periodKey = getPeriodKey(ch.period_type, new Date(purchasedAt));
    db.prepare('INSERT OR IGNORE INTO client_challenge_days(client_id, challenge_id, day, receipt_id, created_at) VALUES(?, ?, ?, ?, ?)')
      .run(clientId, ch.id, day, receiptId, nowIso());
    const progress = db.prepare('SELECT COUNT(*) AS c FROM client_challenge_days WHERE client_id = ? AND challenge_id = ?').get(clientId, ch.id).c;
    const alreadyAwarded = db.prepare('SELECT 1 FROM client_challenge_rewards WHERE client_id = ? AND challenge_id = ? AND period_key = ?').get(clientId, ch.id, periodKey);
    if (progress >= ch.required_visits && !alreadyAwarded) {
      db.prepare('INSERT INTO client_challenge_rewards(client_id, challenge_id, period_key, awarded_at) VALUES(?, ?, ?, ?)')
        .run(clientId, ch.id, periodKey, nowIso());
      const balance = awardStars(clientId, 'challenge_bonus', ch.reward_stars, 'challenge', `+${ch.reward_stars} ⭐ бонус за челендж «${ch.name}»`, receiptId, null);
      logAudit({ actorType: 'system', action: 'challenge_awarded', entityType: 'client', entityId: String(clientId), payload: { challenge: ch.code, reward: ch.reward_stars, balance } });
    }
  }
}

function updateStampProgress(clientId, receiptId, items = []) {
  const programs = db.prepare('SELECT * FROM stamp_programs WHERE is_active = 1').all();
  for (const program of programs) {
    const count = items.reduce((sum, item) => {
      const category = String(item.category || '').toLowerCase();
      const name = String(item.name || '').toLowerCase();
      if (program.category === 'coffee' && (category.includes('coffee') || category.includes('кава') || name.includes('кава'))) return sum + Math.ceil(Number(item.qty || 1));
      if (program.category === 'bakery' && (category.includes('bakery') || category.includes('випіч') || category.includes('хліб') || name.includes('багет') || name.includes('круасан'))) return sum + Math.ceil(Number(item.qty || 1));
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
    expires_at: row.expires_at,
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

app.post('/api/auth/google-demo', (req, res) => {
  // Локальний режим входу через Google для прототипу.
  // Він НЕ додає фейкові покупки, відвідування, прогрес або баланс.
  // У production цей endpoint замінюється на перевірку справжнього Google ID token.
  const email = String(req.body?.email || 'google.demo@starclub.local').trim().toLowerCase();
  const name = String(req.body?.name || 'Google User').trim() || 'Google User';
  const googleId = `google:${email}`;
  let client = getOrCreateClientFromTelegram({ id: googleId, first_name: name, username: 'google' });
  db.prepare(`UPDATE clients SET name = COALESCE(NULLIF(name, ''), ?), email = COALESCE(email, ?), updated_at = ? WHERE id = ?`)
    .run(name, email, nowIso(), client.id);
  client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
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
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'PASSWORD_TOO_SHORT', message: 'Пароль має містити мінімум 6 символів' });
  if (password !== passwordConfirm) return res.status(400).json({ ok: false, error: 'PASSWORDS_DO_NOT_MATCH', message: 'Паролі не співпадають' });

  const existingByPhone = db.prepare('SELECT id FROM clients WHERE phone = ? AND id != ?').get(phone, req.client.id);
  if (existingByPhone) return res.status(409).json({ ok: false, error: 'PHONE_ALREADY_REGISTERED', message: 'Клієнт з таким номером вже зареєстрований. Скористайтесь входом.' });

  const t = nowIso();
  db.prepare(`UPDATE clients SET phone = ?, name = ?, birth_date = ?, favorite_store = ?, email = ?, marketing_allowed = ?, preferences = ?, password_hash = ?, password_set_at = ?, updated_at = ? WHERE id = ?`)
    .run(phone, name, birthDate, favoriteStore, body.email || null, body.marketing_allowed ? 1 : 0, JSON.stringify(body.preferences || []), hashPassword(password), t, t, req.client.id);

  let client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.client.id);
  const bonus = getSetting('profile_bonus', { enabled: true, stars: 500, grantWhen: 'immediately', requiredFields: ['phone', 'name', 'birth_date', 'favorite_store'] });
  const full = bonus.requiredFields.every((key) => Boolean(client[key]));
  if (bonus.enabled && full && !client.profile_bonus_awarded && bonus.grantWhen === 'immediately') {
    const balance = awardStars(client.id, 'profile_bonus', bonus.stars, 'profile', `+${bonus.stars} ⭐ бонус за повний профіль`);
    db.prepare('UPDATE clients SET profile_bonus_awarded = 1, updated_at = ? WHERE id = ?').run(nowIso(), client.id);
    logAudit({ actorType: 'client', actorId: String(client.id), action: 'profile_bonus_awarded', entityType: 'client', entityId: String(client.id), payload: { stars: bonus.stars, balance } });
  }
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
  res.json({ ok: true, receipts: receipts.map((r) => ({ ...r, total_uah: money(r.total_cents), eligible_uah: money(r.eligible_cents), items: itemsStmt.all(r.id) })) });
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

app.post('/api/1c/receipts', oneCAuth, (req, res) => {
  const body = req.body || {};
  if (!body.id) return res.status(400).json({ ok: false, error: 'RECEIPT_ID_REQUIRED' });
  const existing = db.prepare('SELECT * FROM receipts WHERE id = ?').get(body.id);
  if (existing) return res.json({ ok: true, duplicate: true, receipt_id: existing.id, stars_accrued: existing.stars_accrued });

  const client = findClientForOneC({ card_number: body.card_number, card_token: body.card_token, phone: body.phone });
  if (!client) return res.status(404).json({ ok: false, error: 'CLIENT_NOT_FOUND' });

  const items = Array.isArray(body.items) ? body.items : [];
  const totalCents = Math.round(Number(body.total_cents || 0));
  const eligibleCents = calculateEligibleCents(items, body.eligible_cents);
  const excludedCents = Math.max(0, totalCents - eligibleCents);
  const starsAccrued = Math.floor(eligibleCents / 100);
  const purchasedAt = body.purchased_at || nowIso();

   db.prepare(`INSERT INTO receipts(id, fiscal_number, client_id, store_id, cash_register, cashier, total_cents, eligible_cents, excluded_cents, stars_accrued, stars_spent, club_conditions_json, is_return, purchased_at, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(
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
      Number(body.stars_spent || 0),
      JSON.stringify(body.club_conditions || []),
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
      flags.no_star_accrual ? 1 : 0,
      flags.no_redeem ? 1 : 0
    );
  }

  if (starsAccrued > 0) {
    awardStars(
      client.id,
      'purchase_accrual',
      starsAccrued,
      'receipt',
      `+${starsAccrued} ⭐ за покупку`,
      body.id,
      null
    );
  }

  db.prepare('UPDATE clients SET last_purchase_at = ?, updated_at = ? WHERE id = ?')
    .run(purchasedAt, nowIso(), client.id);

  addChallengeVisit(client.id, body.id, purchasedAt, totalCents, items);
  updateStampProgress(client.id, body.id, items);

  logAudit({
    actorType: '1c',
    actorId: body.store_id || '1c',
    action: 'receipt_imported',
    entityType: 'receipt',
    entityId: body.id,
    payload: { starsAccrued, eligibleCents }
  });

  const rewardTokens = [];
  if (body.reward_qr_token) rewardTokens.push(String(body.reward_qr_token));
  if (Array.isArray(body.reward_qr_tokens)) rewardTokens.push(...body.reward_qr_tokens.map(String));
  for (const rewardToken of rewardTokens.filter(Boolean)) {
    const row = db.prepare(`SELECT q.*, r.name FROM reward_qrs q JOIN reward_products r ON r.id = q.reward_product_id WHERE q.token = ?`).get(rewardToken);
    if (row && row.status === 'reserved' && new Date(row.expires_at).getTime() >= Date.now()) {
      awardStars(row.client_id, 'reward_spend', -Math.abs(row.stars_reserved), 'reward_qr', `-${row.stars_reserved} ⭐ ${row.name} за зірки`, body.id, row.id);
      db.prepare('UPDATE reward_qrs SET status = ?, receipt_id = ?, used_at = ? WHERE id = ?').run('used', body.id, nowIso(), row.id);
      db.prepare('UPDATE reward_products SET issued_count = issued_count + 1, updated_at = ? WHERE id = ?').run(nowIso(), row.reward_product_id);
      logAudit({ actorType: '1c', actorId: body.store_id || '1c', action: 'reward_qr_finalized_by_receipt', entityType: 'reward_qr', entityId: String(row.id), payload: { receiptId: body.id, rewardToken } });
    }
  }

  const fresh = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
  res.json({ ok: true, duplicate: false, receipt_id: body.id, stars_accrued: starsAccrued, balance: fresh.stars_balance });
});

app.post('/api/1c/reward-qr/validate', oneCAuth, (req, res) => {
  const token = String(req.body?.token || req.body?.manual_code || req.body?.code || '').trim();
  if (!token) return res.status(400).json({ ok: false, valid: false, error: 'TOKEN_REQUIRED' });

  expireReservedRewardQrs();

  const row = db.prepare(`SELECT q.*, r.name, r.stars_price, r.product_external_id, r.store_id, r.conditions, c.card_number, c.phone, c.name AS client_name, c.stars_balance
    FROM reward_qrs q
    JOIN reward_products r ON r.id = q.reward_product_id
    JOIN clients c ON c.id = q.client_id
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
    qty: 1,
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
  if (!token) return res.status(400).json({ ok: false, error: 'TOKEN_REQUIRED' });
  if (!receiptId) return res.status(400).json({ ok: false, error: 'RECEIPT_ID_REQUIRED' });

  expireReservedRewardQrs();

  const row = db.prepare(`SELECT q.*, r.name FROM reward_qrs q JOIN reward_products r ON r.id = q.reward_product_id WHERE q.token = ?`).get(token);
  if (!row) return res.status(404).json({ ok: false, error: 'QR_NOT_FOUND' });
  if (row.status !== 'reserved') return res.status(400).json({ ok: false, error: 'QR_STATUS_' + row.status.toUpperCase(), status: row.status });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('UPDATE reward_qrs SET status = ?, canceled_at = ? WHERE id = ?').run('expired', nowIso(), row.id);
    return res.status(400).json({ ok: false, error: 'QR_EXPIRED', status: 'expired' });
  }

  const balance = awardStars(row.client_id, 'reward_spend', -Math.abs(row.stars_reserved), 'reward_qr', `-${row.stars_reserved} ⭐ ${row.name} за зірки`, receiptId, row.id);
  db.prepare('UPDATE reward_qrs SET status = ?, receipt_id = ?, used_at = ? WHERE id = ?').run('used', receiptId, nowIso(), row.id);
  db.prepare('UPDATE reward_products SET issued_count = issued_count + 1, updated_at = ? WHERE id = ?').run(nowIso(), row.reward_product_id);
  logAudit({ actorType: '1c', actorId: req.body?.store_id || '1c', action: 'reward_qr_finalized', entityType: 'reward_qr', entityId: String(row.id), payload: { receiptId, balance, token } });
  res.json({ ok: true, status: 'used', token, receipt_id: receiptId, balance });
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
  db.prepare('UPDATE reward_products SET is_active = 0, updated_at = ? WHERE id = ?').run(nowIso(), req.params.id);
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
  db.prepare('UPDATE offers SET is_active = 0, updated_at = ? WHERE id = ?').run(nowIso(), req.params.id);
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
  db.prepare('UPDATE challenges SET is_active = 0 WHERE id = ?').run(req.params.id);
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
  db.prepare('UPDATE stamp_programs SET is_active = 0 WHERE id = ?').run(req.params.id);
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
  db.prepare('UPDATE news SET is_active = 0 WHERE id = ?').run(req.params.id);
  logAudit({ actorType: 'admin', actorId: 'admin', action: 'news_deleted', entityType: 'news', entityId: req.params.id, payload: {} });
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

app.get('/api/admin/audit', adminAuth, (req, res) => {
  res.json({ ok: true, logs: db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all() });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(port, () => {
  console.log(`Star Club prototype is running on http://localhost:${port}`);
});
