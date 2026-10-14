'use strict';

const path = require('node:path');

module.exports = {
  port: Number(process.env.PORT) || 3100,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'referral.sqlite'),
  // Set in production so cookies are only sent over HTTPS.
  secureCookies: process.env.NODE_ENV === 'production',
  // Shared secret for the registration site (pcs2) to report new referees.
  webhookKey: process.env.REFERRAL_WEBHOOK_KEY || '',
  registerUrl: 'https://pcs2.daftarmindaoptima.com',

  // Promo: RM100 until end of 31 Dec 2026 (Malaysia time), RM50 after.
  promoDeadline: new Date('2026-12-31T23:59:59+08:00'),
  rewardPromo: 100,
  rewardStandard: 50,

  otpTtlMs: 5 * 60 * 1000,
  otpResendMs: 60 * 1000,
  otpMaxAttempts: 5,
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
};
