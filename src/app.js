'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const defaultConfig = require('./config');
const lib = require('./lib');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_COOKIE = 'mo_session';

const PAGES = {
  '/': 'index.html',
  '/login': 'login.html',
  '/dashboard': 'dashboard.html',
  '/daftar': 'daftar.html',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Dev mock: log the OTP instead of sending a WhatsApp message. */
function consoleOtpSender(phone, code) {
  console.log(`[OTP][WhatsApp mock] ${lib.formatPhone(phone)} -> ${code}`);
}

function createApp({ db, config = defaultConfig, sendOtp = consoleOtpSender, now = () => Date.now() }) {
  const stmt = {
    referrerByPhone: db.prepare('SELECT * FROM referrers WHERE phone = ?'),
    referrerByCode: db.prepare('SELECT * FROM referrers WHERE code = ?'),
    referrerById: db.prepare('SELECT * FROM referrers WHERE id = ?'),
    insertReferrer: db.prepare('INSERT INTO referrers (phone, name, code) VALUES (?, ?, ?)'),
    otpByPhone: db.prepare('SELECT * FROM otps WHERE phone = ?'),
    upsertOtp: db.prepare(`
      INSERT INTO otps (phone, code_hash, attempts, expires_at, created_at) VALUES (?, ?, 0, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, attempts = 0,
        expires_at = excluded.expires_at, created_at = excluded.created_at`),
    bumpOtpAttempts: db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?'),
    deleteOtp: db.prepare('DELETE FROM otps WHERE phone = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, referrer_id, expires_at) VALUES (?, ?, ?)'),
    sessionByHash: db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    referralsByCode: db.prepare('SELECT * FROM referrals WHERE referrer_code = ? ORDER BY created_at DESC'),
    insertReferral: db.prepare(`
      INSERT INTO referrals (referrer_code, referee_phone, referee_name, reward_amount, created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(referrer_code, referee_phone) DO NOTHING`),
  };

  function createReferrer(phone, name) {
    // Random suffix gives 26^4 combinations per last-4 digits; retry on the rare collision.
    for (let i = 0; i < 10; i++) {
      const code = lib.generateReferralCode(phone);
      if (stmt.referrerByCode.get(code)) continue;
      stmt.insertReferrer.run(phone, name, code);
      return stmt.referrerByPhone.get(phone);
    }
    throw new HttpError(500, 'Gagal menjana kod rujukan. Sila cuba lagi.');
  }

  function currentReferrer(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const session = stmt.sessionByHash.get(lib.sha256(token), now());
    return session ? stmt.referrerById.get(session.referrer_id) : null;
  }

  // ---- API handlers ----

  function requestOtp(body) {
    const phone = lib.normalizePhone(body.phone);
    if (!phone) throw new HttpError(422, 'Nombor telefon tidak sah. Contoh: 012-3456789');

    const existing = stmt.otpByPhone.get(phone);
    if (existing && now() - existing.created_at < config.otpResendMs) {
      const wait = Math.ceil((config.otpResendMs - (now() - existing.created_at)) / 1000);
      throw new HttpError(429, `Sila tunggu ${wait} saat sebelum minta OTP baru.`);
    }

    const code = lib.generateOtp();
    stmt.upsertOtp.run(phone, lib.sha256(`${phone}:${code}`), now() + config.otpTtlMs, now());
    sendOtp(phone, code);

    return {
      ok: true,
      phone: lib.formatPhone(phone),
      isNew: !stmt.referrerByPhone.get(phone),
      expiresIn: config.otpTtlMs / 1000,
    };
  }

  function verifyOtp(body, res) {
    const phone = lib.normalizePhone(body.phone);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!phone || !/^\d{6}$/.test(code)) throw new HttpError(422, 'Sila masukkan OTP 6 digit.');

    const otp = stmt.otpByPhone.get(phone);
    if (!otp || otp.expires_at < now()) throw new HttpError(400, 'OTP telah tamat tempoh. Sila minta OTP baru.');
    if (otp.attempts >= config.otpMaxAttempts) {
      throw new HttpError(429, 'Terlalu banyak cubaan. Sila minta OTP baru.');
    }

    const expected = Buffer.from(otp.code_hash, 'hex');
    const actual = Buffer.from(lib.sha256(`${phone}:${code}`), 'hex');
    if (!crypto.timingSafeEqual(expected, actual)) {
      stmt.bumpOtpAttempts.run(phone);
      throw new HttpError(400, 'OTP salah. Sila cuba lagi.');
    }

    let referrer = stmt.referrerByPhone.get(phone);
    if (!referrer) {
      const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
      if (name.length < 2 || name.length > 80) {
        throw new HttpError(422, 'Sila masukkan nama penuh anda.');
      }
      referrer = createReferrer(phone, name);
    }
    stmt.deleteOtp.run(phone);

    const token = crypto.randomBytes(32).toString('hex');
    stmt.insertSession.run(lib.sha256(token), referrer.id, now() + config.sessionTtlMs);
    res.setHeader('Set-Cookie', sessionCookie(token, config.sessionTtlMs / 1000));
    return { ok: true, redirect: '/dashboard' };
  }

  function dashboard(req) {
    const referrer = currentReferrer(req);
    if (!referrer) throw new HttpError(401, 'Sila log masuk.');

    const rows = stmt.referralsByCode.all(referrer.code);
    const stats = { totalReferrals: rows.length, rewardPending: 0, totalEarned: 0 };
    for (const r of rows) {
      if (r.status === 'pending') stats.rewardPending += r.reward_amount;
      if (r.status === 'approved' || r.status === 'paid') stats.totalEarned += r.reward_amount;
    }

    return {
      referrer: {
        name: referrer.name,
        phone: lib.formatPhone(referrer.phone),
        code: referrer.code,
      },
      stats,
      referrals: rows.map((r) => ({
        name: lib.maskName(r.referee_name),
        phone: lib.maskPhone(r.referee_phone),
        registeredAt: r.created_at,
        status: r.status,
        reward: r.reward_amount,
      })),
      shareUrl: `${config.registerUrl}?ref=${encodeURIComponent(referrer.code)}`,
      promo: {
        deadline: config.promoDeadline.toISOString(),
        currentReward: lib.rewardAmountFor(new Date(now()), config),
      },
    };
  }

  function lookupReferral(rawCode) {
    const code = lib.normalizeCode(rawCode);
    const referrer = code && stmt.referrerByCode.get(code);
    if (!referrer) throw new HttpError(404, 'Kod rujukan tidak dijumpai.');
    return {
      code: referrer.code,
      referrerName: lib.maskName(referrer.name),
      registerUrl: `${config.registerUrl}?ref=${encodeURIComponent(referrer.code)}`,
    };
  }

  /** Called by the registration site when a referee signs up with a code. */
  function recordReferral(req, body) {
    const key = req.headers['x-api-key'];
    if (!config.webhookKey) throw new HttpError(503, 'Webhook not configured.');
    if (typeof key !== 'string' || !safeEqual(key, config.webhookKey)) {
      throw new HttpError(401, 'Invalid API key.');
    }

    const code = lib.normalizeCode(body.code);
    const referrer = code && stmt.referrerByCode.get(code);
    if (!referrer) throw new HttpError(404, 'Kod rujukan tidak dijumpai.');

    const phone = lib.normalizePhone(body.phone);
    if (!phone) throw new HttpError(422, 'Nombor telefon tidak sah.');
    if (phone === referrer.phone) throw new HttpError(422, 'Tidak boleh merujuk diri sendiri.');

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) || null : null;
    const createdAt = new Date(now());
    const result = stmt.insertReferral.run(
      referrer.code, phone, name, lib.rewardAmountFor(createdAt, config), createdAt.toISOString(),
    );
    return { ok: true, created: result.changes === 1 };
  }

  // ---- Router ----

  async function route(req, res, url) {
    const { pathname } = url;
    const method = req.method;

    if (pathname.startsWith('/api/')) {
      if (method === 'POST' && pathname === '/api/otp/request') return requestOtp(await readJson(req));
      if (method === 'POST' && pathname === '/api/otp/verify') return verifyOtp(await readJson(req), res);
      if (method === 'GET' && pathname === '/api/dashboard') return dashboard(req);
      if (method === 'POST' && pathname === '/api/logout') {
        const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        if (token) stmt.deleteSession.run(lib.sha256(token));
        res.setHeader('Set-Cookie', sessionCookie('', 0));
        return { ok: true };
      }
      if (method === 'POST' && pathname === '/api/referrals') return recordReferral(req, await readJson(req));
      const match = pathname.match(/^\/api\/referral\/([^/]+)$/);
      if (method === 'GET' && match) return lookupReferral(decodeURIComponent(match[1]));
      throw new HttpError(404, 'Not found');
    }

    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed');

    // Logged-in users skip the login page.
    if (pathname === '/login' && currentReferrer(req)) {
      res.writeHead(302, { Location: '/dashboard' }).end();
      return undefined;
    }

    const file = PAGES[pathname.replace(/\/+$/, '') || '/'] || pathname.slice(1);
    serveStatic(res, file, method === 'HEAD');
    return undefined;
  }

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const payload = await route(req, res, url);
      if (payload !== undefined) sendJson(res, 200, payload);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      if (req.url.startsWith('/api/')) {
        sendJson(res, status, { ok: false, error: status === 500 ? 'Ralat pelayan.' : err.message });
      } else {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(status === 404 ? 'Halaman tidak dijumpai' : 'Ralat');
      }
    }
  };

  function sessionCookie(token, maxAgeSec) {
    const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeSec)}`];
    if (config.secureCookies) parts.push('Secure');
    return parts.join('; ');
  }
}

function serveStatic(res, file, headOnly) {
  const resolved = path.resolve(PUBLIC_DIR, file);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found');
  let data;
  try {
    data = fs.readFileSync(resolved);
  } catch {
    throw new HttpError(404, 'Not found');
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream',
    'Content-Length': data.length,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(headOnly ? undefined : data);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10_000) throw new HttpError(413, 'Payload too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return cookies;
}

function safeEqual(a, b) {
  const ha = Buffer.from(lib.sha256(a), 'hex');
  const hb = Buffer.from(lib.sha256(b), 'hex');
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { createApp };
