# Referral Portal

Minda Optima referral system — **referral.mindaoptima.com**.

Node.js (no npm dependencies, uses built-in `node:sqlite`) + plain HTML/JS + Tailwind (CDN).
Requires Node **22.13+**.

## Run

```bash
npm start          # http://localhost:3100
npm run seed       # optional: demo referrer 012-3456789 with sample referrals
npm test
```

In development the OTP is **not** sent to WhatsApp; it is printed in the server log:

```
[OTP][WhatsApp mock] 012-3456789 -> 483920
```

## Pages

| Path | Description |
| --- | --- |
| `/` | Landing page with promo countdown (ends 31 Dis 2026, 11:59 PM MYT) |
| `/login` | Phone + WhatsApp OTP login. New numbers are asked for a name and get a referral code. |
| `/dashboard` | Referral code, stats, WhatsApp share and referral list |
| `/daftar?ref=KOD` | Referee landing, shows who invited them, then redirects to `pcs2.daftarmindaoptima.com?ref=KOD` |

## API

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/otp/request` | `{ phone }` → `{ isNew }`. 60s resend throttle, 5 min expiry. |
| POST | `/api/otp/verify` | `{ phone, code, name? }`, sets an HttpOnly `mo_session` cookie. Max 5 attempts per OTP. |
| GET | `/api/dashboard` | Requires session. |
| POST | `/api/logout` | |
| GET | `/api/referral/{code}` | Public lookup: masked referrer name and register URL. |
| POST | `/api/referrals` | For the registration site. Header `X-Api-Key: $REFERRAL_WEBHOOK_KEY`, body `{ code, phone, name? }`. Reward is RM100 until the promo deadline, RM50 after. |

Referral codes use the format `MO-[last 4 digits of phone]-[4 random uppercase letters]`.
Referral status: `pending` → `approved` / `paid` (counted as earned) or `rejected`.

## Configuration (env)

| Var | Default |
| --- | --- |
| `PORT` | `3100` |
| `DB_PATH` | `data/referral.sqlite` |
| `NODE_ENV` | set `production` to mark cookies `Secure` |
| `REFERRAL_WEBHOOK_KEY` | empty means `/api/referrals` is disabled |

## Deploy

See `deploy/referral-portal.service` (systemd) and `deploy/nginx.conf`.
To send OTPs through WhatsApp, pass a real `sendOtp(phone, code)` to `createApp()` in `server.js`.
