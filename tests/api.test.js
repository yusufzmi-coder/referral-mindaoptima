'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const defaultConfig = require('../src/config');

async function startServer(overrides = {}) {
  const db = openDb(':memory:');
  const sentOtps = [];
  let clock = Date.parse('2026-10-15T10:00:00+08:00');
  const config = { ...defaultConfig, webhookKey: 'test-key', secureCookies: false, ...overrides };
  const app = createApp({
    db,
    config,
    sendOtp: (phone, code) => sentOtps.push({ phone, code }),
    now: () => clock,
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  let cookie = '';
  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }

  return {
    request,
    sentOtps,
    advance: (ms) => { clock += ms; },
    clearCookie: () => { cookie = ''; },
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}

async function login(t, phone = '012-3456789', name = 'Siti Aminah') {
  const req = await t.request('/api/otp/request', { method: 'POST', body: { phone } });
  assert.equal(req.status, 200);
  const { code } = t.sentOtps.at(-1);
  const res = await t.request('/api/otp/verify', { method: 'POST', body: { phone, code, name } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res;
}

test('pages load', async () => {
  const t = await startServer();
  try {
    for (const [path, needle] of [
      ['/', 'Jemput Kawan,'],
      ['/login', 'Hantar OTP via WhatsApp'],
      ['/dashboard', 'Kod Rujukan Anda'],
      ['/daftar?ref=MO-1234-ABCD', 'Kelas Percubaan'],
      ['/js/common.js', 'PROMO_DEADLINE'],
    ]) {
      const res = await t.request(path);
      assert.equal(res.status, 200, path);
      assert.ok(res.data.includes(needle), `${path} should contain ${needle}`);
    }
    assert.equal((await t.request('/nope.html')).status, 404);
    assert.equal((await t.request('/..%2fpackage.json')).status, 404);
  } finally {
    await t.close();
  }
});

test('OTP flow creates referrer and logs into dashboard', async () => {
  const t = await startServer();
  try {
    const req = await t.request('/api/otp/request', { method: 'POST', body: { phone: '012-3456789' } });
    assert.equal(req.status, 200);
    assert.equal(req.data.isNew, true);
    assert.equal(req.data.phone, '012-3456789');
    assert.equal(t.sentOtps.length, 1);
    assert.match(t.sentOtps[0].code, /^\d{6}$/);

    // New number must supply a name.
    const noName = await t.request('/api/otp/verify', {
      method: 'POST', body: { phone: '0123456789', code: t.sentOtps[0].code },
    });
    assert.equal(noName.status, 422);

    const ok = await t.request('/api/otp/verify', {
      method: 'POST', body: { phone: '0123456789', code: t.sentOtps[0].code, name: 'Siti Aminah' },
    });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('set-cookie'), /mo_session=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Lax/);

    const dash = await t.request('/api/dashboard');
    assert.equal(dash.status, 200);
    assert.equal(dash.data.referrer.name, 'Siti Aminah');
    assert.match(dash.data.referrer.code, /^MO-6789-[A-Z]{4}$/);
    assert.deepEqual(dash.data.stats, { totalReferrals: 0, rewardPending: 0, totalEarned: 0 });
    assert.equal(dash.data.shareUrl, `https://pcs2.daftarmindaoptima.com?ref=${dash.data.referrer.code}`);
    assert.equal(dash.data.promo.currentReward, 100);

    // OTP is single-use.
    const reuse = await t.request('/api/otp/verify', {
      method: 'POST', body: { phone: '0123456789', code: t.sentOtps[0].code },
    });
    assert.equal(reuse.status, 400);

    // Logged-in user is redirected away from /login.
    const loginPage = await t.request('/login');
    assert.equal(loginPage.status, 302);
    assert.equal(loginPage.headers.get('location'), '/dashboard');
  } finally {
    await t.close();
  }
});

test('returning referrer keeps the same code', async () => {
  const t = await startServer();
  try {
    await login(t);
    const first = (await t.request('/api/dashboard')).data.referrer.code;
    await t.request('/api/logout', { method: 'POST' });
    assert.equal((await t.request('/api/dashboard')).status, 401);

    t.advance(61_000);
    const req = await t.request('/api/otp/request', { method: 'POST', body: { phone: '+60123456789' } });
    assert.equal(req.data.isNew, false);
    await t.request('/api/otp/verify', { method: 'POST', body: { phone: '0123456789', code: t.sentOtps.at(-1).code } });
    assert.equal((await t.request('/api/dashboard')).data.referrer.code, first);
  } finally {
    await t.close();
  }
});

test('OTP validation, expiry, resend throttle and attempt limit', async () => {
  const t = await startServer();
  try {
    assert.equal((await t.request('/api/otp/request', { method: 'POST', body: { phone: '03-1234567' } })).status, 422);

    await t.request('/api/otp/request', { method: 'POST', body: { phone: '0198765432' } });
    assert.equal((await t.request('/api/otp/request', { method: 'POST', body: { phone: '0198765432' } })).status, 429);

    const { code } = t.sentOtps.at(-1);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < defaultConfig.otpMaxAttempts; i++) {
      const res = await t.request('/api/otp/verify', { method: 'POST', body: { phone: '0198765432', code: wrong } });
      assert.equal(res.status, 400);
    }
    // Locked out even with the right code.
    const locked = await t.request('/api/otp/verify', { method: 'POST', body: { phone: '0198765432', code, name: 'Ali' } });
    assert.equal(locked.status, 429);

    t.advance(61_000);
    await t.request('/api/otp/request', { method: 'POST', body: { phone: '0198765432' } });
    t.advance(defaultConfig.otpTtlMs + 1);
    const expired = await t.request('/api/otp/verify', {
      method: 'POST', body: { phone: '0198765432', code: t.sentOtps.at(-1).code, name: 'Ali' },
    });
    assert.equal(expired.status, 400);
    assert.match(expired.data.error, /tamat tempoh/);
  } finally {
    await t.close();
  }
});

test('referral lookup, webhook and dashboard stats', async () => {
  const t = await startServer();
  try {
    await login(t, '012-3456789', 'Siti Aminah binti Ali');
    const { code } = (await t.request('/api/dashboard')).data.referrer;
    t.clearCookie();

    const lookup = await t.request(`/api/referral/${code.toLowerCase()}`);
    assert.equal(lookup.status, 200);
    assert.deepEqual(lookup.data, {
      code,
      referrerName: 'Siti A.',
      registerUrl: `https://pcs2.daftarmindaoptima.com?ref=${code}`,
    });
    assert.equal((await t.request('/api/referral/MO-0000-ZZZZ')).status, 404);
    assert.equal((await t.request('/api/referral/garbage')).status, 404);

    const hook = (body, key = 'test-key') =>
      t.request('/api/referrals', { method: 'POST', body, headers: { 'X-Api-Key': key } });

    assert.equal((await hook({ code, phone: '0171112222' }, 'wrong')).status, 401);
    assert.equal((await hook({ code, phone: '0123456789' })).status, 422, 'self-referral');
    assert.equal((await hook({ code: 'MO-0000-ZZZZ', phone: '0171112222' })).status, 404);

    const created = await hook({ code, phone: '017-1112222', name: 'Ahmad Faiz' });
    assert.deepEqual(created.data, { ok: true, created: true });
    assert.deepEqual((await hook({ code, phone: '0171112222' })).data, { ok: true, created: false });

    // After the promo deadline the reward drops to RM50.
    t.advance(Date.parse('2027-01-01T00:00:00+08:00') - Date.parse('2026-10-15T10:00:00+08:00'));
    await hook({ code, phone: '0183334444' });

    await login(t, '012-3456789');
    const dash = (await t.request('/api/dashboard')).data;
    assert.equal(dash.stats.totalReferrals, 2);
    assert.equal(dash.stats.rewardPending, 150);
    assert.equal(dash.stats.totalEarned, 0);
    assert.deepEqual(dash.referrals.map((r) => [r.name, r.phone, r.reward, r.status]), [
      [null, '018-***4444', 50, 'pending'],
      ['Ahmad F.', '017-***2222', 100, 'pending'],
    ]);
  } finally {
    await t.close();
  }
});

test('webhook is disabled without a configured key', async () => {
  const t = await startServer({ webhookKey: '' });
  try {
    const res = await t.request('/api/referrals', {
      method: 'POST', body: { code: 'MO-1234-ABCD', phone: '0171112222' }, headers: { 'X-Api-Key': '' },
    });
    assert.equal(res.status, 503);
  } finally {
    await t.close();
  }
});
