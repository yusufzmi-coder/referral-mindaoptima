/* Shared helpers for all pages. Loaded right after the Tailwind CDN script. */

tailwind.config = {
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0D2A5C', light: '#1B4A94', dark: '#081B3D' },
        gold: { DEFAULT: '#FFB800', light: '#FFE08A', dark: '#C98F00' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
};

const MO = (() => {
  // RM100 promo ends 31 Dec 2026, 11:59:59 PM Malaysia time.
  const PROMO_DEADLINE = new Date('2026-12-31T23:59:59+08:00');

  function countdownParts(target, now = new Date()) {
    const ms = Math.max(0, target.getTime() - now.getTime());
    const s = Math.floor(ms / 1000);
    return {
      done: ms === 0,
      days: Math.floor(s / 86400),
      hours: Math.floor((s % 86400) / 3600),
      minutes: Math.floor((s % 3600) / 60),
      seconds: s % 60,
    };
  }

  /** Fill every [data-countdown] element with a live countdown to the promo deadline. */
  function startCountdowns(target = PROMO_DEADLINE) {
    const els = document.querySelectorAll('[data-countdown]');
    if (!els.length) return;
    const pad = (n) => String(n).padStart(2, '0');
    const tick = () => {
      const p = countdownParts(target);
      const text = p.done
        ? 'Tawaran telah tamat'
        : `${p.days} hari ${pad(p.hours)}j ${pad(p.minutes)}m ${pad(p.seconds)}s`;
      els.forEach((el) => { el.textContent = text; });
      if (p.done) clearInterval(timer);
    };
    const timer = setInterval(tick, 1000);
    tick();
  }

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Ralat rangkaian. Sila cuba lagi.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  document.addEventListener('DOMContentLoaded', () => startCountdowns());

  return { PROMO_DEADLINE, countdownParts, startCountdowns, api, copyText, escapeHtml };
})();
