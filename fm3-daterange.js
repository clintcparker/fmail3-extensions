// fm3-daterange.js — Date-range picker for Fastmail in FMail3
// Paste into FMail3 Settings → JavaScript
// Companion CSS: fm3-daterange.css

(function FMail3DateRangeAddon() {
  if (window.__fm3DateAddon) return;
  window.__fm3DateAddon = true;

  console.log('[fm3-date] addon init', location.href);

  // ── State ────────────────────────────────────────────────────────────────────
  const STATE = { picker: null, icon: null, input: null, rafPending: false };

  // ── Utilities ────────────────────────────────────────────────────────────────

  /** YYYY-MM-DD in the user's LOCAL time zone — never call toISOString() (that's UTC). */
  function fmtLocalISO(d) {
    const z = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }

  /**
   * Write a value into a framework-bound <input> in a way that bypasses
   * Overture's (and React's) cached-value guard, then fire the events
   * Fastmail needs to pick up the change and commit the search.
   */
  function setSearch(value) {
    const i = STATE.input;
    if (!i) return;
    try {
      const proto  = Object.getPrototypeOf(i);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(i, value);
    } catch (_) {
      i.value = value; // fallback
    }
    i.dispatchEvent(new Event('input',  { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
    i.focus();
    i.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
    }));
    console.log('[fm3-date] setSearch:', JSON.stringify(value));
  }

  // ── localStorage persistence ─────────────────────────────────────────────────

  function saveRange(from, to) {
    try { localStorage.setItem('fm3DateRange', JSON.stringify({ from, to })); } catch (_) {}
  }

  function loadRange() {
    try { return JSON.parse(localStorage.getItem('fm3DateRange') || 'null'); } catch (_) { return null; }
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────────

  function findSearchInput() {
    // Primary: ARIA landmark (most stable)
    const region = document.querySelector('[role="search"]');
    if (region) {
      const inp = region.querySelector('input');
      if (inp) return { input: inp, host: region };
    }
    // Fallback: placeholder text
    const inp = document.querySelector('input[placeholder*="Search" i]');
    if (inp) return { input: inp, host: inp.parentElement };
    return null;
  }

  // Inline SVG calendar glyph — uses currentColor so it inherits Fastmail's text color.
  const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8"  y1="2" x2="8"  y2="6"/>
    <line x1="3"  y1="10" x2="21" y2="10"/>
  </svg>`;

  // ── Icon injection ────────────────────────────────────────────────────────────

  function ensureIcon() {
    const found = findSearchInput();
    if (!found) return;

    // Already present — update STATE references in case Overture re-created the input.
    const existing = document.getElementById('fm3-daterange-icon');
    if (existing) {
      STATE.icon  = existing;
      STATE.input = found.input;
      return;
    }

    const btn = document.createElement('button');
    btn.id        = 'fm3-daterange-icon';
    btn.type      = 'button';
    btn.title     = 'Filter by date range';
    btn.setAttribute('aria-label', 'Filter by date range');
    btn.innerHTML = ICON_SVG;

    // Prevent blurring the search input when clicking the icon
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', togglePicker);

    // Append to body and position via fixed coords — avoids all flex/DOM layout fights.
    document.body.appendChild(btn);

    STATE.icon  = btn;
    STATE.input = found.input;

    // Keep icon aligned when window resizes or Fastmail re-lays out
    window.addEventListener('resize', placeIcon);

    // Schedule several retries — WKWebView finishes its own layout asynchronously,
    // so the first getBoundingClientRect() call may return stale coords.
    [0, 100, 250, 500, 1000, 2000].forEach(ms => setTimeout(placeIcon, ms));
    console.log('[fm3-date] icon inserted');
  }

  function placeIcon() {
    if (!STATE.icon || !STATE.input) return;
    const r = STATE.input.getBoundingClientRect();
    const SIZE = 28;
    STATE.icon.style.position = 'fixed';
    STATE.icon.style.top      = Math.round(r.top + (r.height - SIZE) / 2) + 'px';
    STATE.icon.style.left     = Math.round(r.left - SIZE - 4) + 'px';
    STATE.icon.style.zIndex   = '99998';
  }

  // ── Picker UI ─────────────────────────────────────────────────────────────────

  function buildPicker() {
    const saved = loadRange() || {};
    const wrap  = document.createElement('div');
    wrap.id = 'fm3-daterange-popover';
    wrap.innerHTML = `
      <label class="fm3-label">
        <span>From</span>
        <input type="date" id="fm3-from" value="${saved.from || ''}">
      </label>
      <label class="fm3-label">
        <span>To</span>
        <input type="date" id="fm3-to" value="${saved.to || ''}">
      </label>
      <div class="fm3-actions">
        <button id="fm3-clear" type="button">Clear</button>
        <button id="fm3-apply" type="button">Apply</button>
      </div>`;
    return wrap;
  }

  function positionPicker(wrap) {
    const r = STATE.icon.getBoundingClientRect();
    wrap.style.left = Math.max(0, r.left) + 'px';
    wrap.style.top  = (r.bottom + 4) + window.scrollY + 'px';
  }

  function outsideClick(e) {
    if (
      STATE.picker &&
      !STATE.picker.contains(e.target) &&
      e.target !== STATE.icon &&
      !STATE.icon.contains(e.target)
    ) {
      closePicker();
      document.removeEventListener('mousedown', outsideClick, true);
    }
  }

  function closePicker() {
    if (STATE.picker) {
      STATE.picker.remove();
      STATE.picker = null;
      console.log('[fm3-date] picker closed');
    }
  }

  function togglePicker() {
    if (STATE.picker) {
      closePicker();
      document.removeEventListener('mousedown', outsideClick, true);
      return;
    }

    const p = buildPicker();
    document.body.appendChild(p);
    positionPicker(p);
    STATE.picker = p;

    p.querySelector('#fm3-apply').addEventListener('click', applyRange);
    p.querySelector('#fm3-clear').addEventListener('click', clearRange);

    // Close when clicking outside — use setTimeout so this click doesn't immediately close it
    setTimeout(() => document.addEventListener('mousedown', outsideClick, true));
    console.log('[fm3-date] picker opened');
  }

  // ── Apply / Clear ─────────────────────────────────────────────────────────────

  function applyRange() {
    const from = document.getElementById('fm3-from').value; // "YYYY-MM-DD" or ""
    const to   = document.getElementById('fm3-to').value;
    if (!from && !to) { closePicker(); return; }

    const parts = [];
    if (from) {
      parts.push('after:' + from);
    }
    if (to) {
      // Add 1 day so `before:` is inclusive of the chosen end date.
      const d = new Date(to + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      parts.push('before:' + fmtLocalISO(d));
    }

    saveRange(from, to);
    setSearch(parts.join(' '));
    closePicker();
  }

  function clearRange() {
    saveRange('', '');
    setSearch('');
    closePicker();
  }

  // ── MutationObserver (throttled) ──────────────────────────────────────────────

  const mo = new MutationObserver(() => {
    if (STATE.rafPending) return;
    STATE.rafPending = true;
    requestAnimationFrame(() => {
      STATE.rafPending = false;
      ensureIcon();
    });
  });

  // ── Startup & SPA navigation guard ───────────────────────────────────────────

  let startTimeout = null;
  let lastHref     = location.href;

  function start() {
    clearTimeout(startTimeout);
    // document.body may be null if injected at document-start; wait for it
    const bodyTarget = document.body || document.documentElement;
    mo.observe(bodyTarget, { childList: true, subtree: true });

    // Try immediately, then poll briefly for the search bar to appear
    let attempts = 0;
    const MAX_ATTEMPTS = 50; // 50 × 100 ms = 5 s max

    function attempt() {
      ensureIcon();
      if (document.getElementById('fm3-daterange-icon')) {
        console.log('[fm3-date] icon confirmed after', attempts, 'attempts');
        return; // success — MutationObserver takes it from here
      }
      if (++attempts < MAX_ATTEMPTS) {
        startTimeout = setTimeout(attempt, 100);
      } else {
        console.warn('[fm3-date] search bar not found after 5 s — stopping poll');
      }
    }
    attempt();
  }

  // Restart when Fastmail does an SPA navigation (URL change without full page reload)
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      console.log('[fm3-date] navigation detected, restarting');
      closePicker();
      start();
    }
  }, 500);

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();
