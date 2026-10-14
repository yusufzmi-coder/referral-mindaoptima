'use strict';

const crypto = require('node:crypto');

/**
 * Normalise a Malaysian mobile number to local form "01XXXXXXXX".
 * Accepts "012-3456789", "+60 12 345 6789", "60123456789", etc.
 * Returns null if it is not a valid 01X mobile number.
 */
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('60')) digits = '0' + digits.slice(2);
  return /^01\d{8,9}$/.test(digits) ? digits : null;
}

/** "0123456789" -> "012-3456789" */
function formatPhone(phone) {
  return `${phone.slice(0, 3)}-${phone.slice(3)}`;
}

/** "0123456789" -> "012-***6789" */
function maskPhone(phone) {
  return `${phone.slice(0, 3)}-${'*'.repeat(phone.length - 7)}${phone.slice(-4)}`;
}

/** "Siti Aminah binti Ali" -> "Siti A." */
function maskName(name) {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0].toUpperCase()}.` : parts[0];
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Kod format: MO-[LAST4_PHONE]-[RANDOM4UPPER] */
function generateReferralCode(phone) {
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += LETTERS[crypto.randomInt(LETTERS.length)];
  return `MO-${phone.slice(-4)}-${suffix}`;
}

function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  return /^MO-\d{4}-[A-Z]{4}$/.test(code) ? code : null;
}

function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function rewardAmountFor(date, config) {
  return date <= config.promoDeadline ? config.rewardPromo : config.rewardStandard;
}

module.exports = {
  normalizePhone,
  formatPhone,
  maskPhone,
  maskName,
  generateReferralCode,
  normalizeCode,
  generateOtp,
  sha256,
  rewardAmountFor,
};
