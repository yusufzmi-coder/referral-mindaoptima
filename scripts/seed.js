'use strict';

/**
 * Dev seed: creates a demo referrer with a few referrals.
 * Usage: npm run seed   (then log in with 012-3456789; OTP is printed in the server log)
 */
const config = require('../src/config');
const { openDb } = require('../src/db');

const db = openDb(config.dbPath);
const phone = '0123456789';
const code = 'MO-6789-DEMO';

db.prepare('INSERT OR IGNORE INTO referrers (phone, name, code) VALUES (?, ?, ?)').run(phone, 'Puan Siti Aminah', code);

const insert = db.prepare(`
  INSERT OR IGNORE INTO referrals (referrer_code, referee_phone, referee_name, status, reward_amount, created_at)
  VALUES (?, ?, ?, ?, ?, ?)`);
insert.run(code, '0171112222', 'Ahmad Faiz', 'paid', 100, '2026-09-02T03:00:00.000Z');
insert.run(code, '0183334444', 'Nurul Huda', 'approved', 100, '2026-09-20T05:30:00.000Z');
insert.run(code, '0195556666', 'Lim Mei Ling', 'pending', 100, '2026-10-10T08:15:00.000Z');

console.log(`Seeded demo referrer ${code} (phone 012-3456789) into ${config.dbPath}`);
db.close();
