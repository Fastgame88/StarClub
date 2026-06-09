import crypto from 'crypto';

export function parseInitData(initData) {
  const params = new URLSearchParams(initData || '');
  const data = {};
  for (const [key, value] of params.entries()) data[key] = value;
  if (data.user) {
    try { data.user = JSON.parse(data.user); } catch { data.user = null; }
  }
  return data;
}

export function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return { ok: false, reason: 'initData or botToken is missing' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'hash is missing' };
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const ok = crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(hash, 'hex'));
  if (!ok) return { ok: false, reason: 'invalid hash' };

  const parsed = parseInitData(initData);
  const authDate = Number(parsed.auth_date || 0);
  if (authDate && Date.now() / 1000 - authDate > 60 * 60 * 24) {
    return { ok: false, reason: 'initData is too old' };
  }
  return { ok: true, data: parsed, user: parsed.user };
}
