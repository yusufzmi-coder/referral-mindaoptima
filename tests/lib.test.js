'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../src/lib');
const config = require('../src/config');

test('normalizePhone accepts Malaysian mobile formats', () => {
  assert.equal(lib.normalizePhone('012-3456789'), '0123456789');
  assert.equal(lib.normalizePhone('011-12345678'), '01112345678');
  assert.equal(lib.normalizePhone('+60 12 345 6789'), '0123456789');
  assert.equal(lib.normalizePhone('60123456789'), '0123456789');
});

test('normalizePhone rejects invalid numbers', () => {
  for (const bad of ['', '03-12345678', '012345', '0123456789012', 'abc', null, 123]) {
    assert.equal(lib.normalizePhone(bad), null, String(bad));
  }
});

test('generateReferralCode follows MO-[LAST4]-[RANDOM4UPPER]', () => {
  for (let i = 0; i < 50; i++) {
    const code = lib.generateReferralCode('0123456789');
    assert.match(code, /^MO-6789-[A-Z]{4}$/);
  }
});

test('normalizeCode uppercases and validates', () => {
  assert.equal(lib.normalizeCode(' mo-6789-abcd '), 'MO-6789-ABCD');
  assert.equal(lib.normalizeCode('MO-678-ABCD'), null);
  assert.equal(lib.normalizeCode('XX-6789-ABCD'), null);
});

test('masking hides personal details', () => {
  assert.equal(lib.maskPhone('0123456789'), '012-***6789');
  assert.equal(lib.maskPhone('01112345678'), '011-****5678');
  assert.equal(lib.maskName('Siti Aminah binti Ali'), 'Siti A.');
  assert.equal(lib.maskName('Ahmad'), 'Ahmad');
  assert.equal(lib.maskName(null), null);
});

test('generateOtp returns 6 digits', () => {
  for (let i = 0; i < 50; i++) assert.match(lib.generateOtp(), /^\d{6}$/);
});

test('reward is RM100 until 31 Dec 2026 MYT, RM50 after', () => {
  assert.equal(lib.rewardAmountFor(new Date('2026-12-31T23:59:59+08:00'), config), 100);
  assert.equal(lib.rewardAmountFor(new Date('2027-01-01T00:00:00+08:00'), config), 50);
});
