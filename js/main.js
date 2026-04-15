/**
 * main.js — StadiumAI Application Entry Point
 *
 * Responsibilities:
 *  - Boot sequence: Firebase → Maps → Chat
 *  - Wire Firebase listeners to DOM render functions
 *  - Handle user interactions (section picker, quick nav, map layer toggles)
 *  - Countdown timer for upcoming events
 *  - Toast notification utility
 *
 * @module main
 */

/* ─────────────────────────────────────────
   BOOT
───────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Init Firebase and start live listeners
  StadiumFirebase.init();
  startLiveListeners();

  // 2. Wire UI interactions
  wireUI();

  // 3. Init chat (from chat.js)
  if (typeof StadiumChat !== 'undefined') {
    StadiumChat.init();
  }

  // 4. Maps loads async via callback — map.js handles it
  console.log('[main] App booted ✓');
});

// Graceful teardown
window.addEventListener('beforeunload', () => {
  StadiumFirebase.detachAll();
});

/* ─────────────────────────────────────────
   LIVE DATA → DOM
───────────────────────────────────────── */

/** Currently selected section (set by user) */
let activeSection = null;

function startLiveListeners() {
  // ── Crowd density ──
  StadiumFirebase.onCrowdUpdate(renderCrowdZones);

  // ── Wait times ──
  StadiumFirebase.onWaitTimesUpdate(renderWaitTimes);

  // ── Schedule ──
  StadiumFirebase.onScheduleUpdate(renderSchedule);
}

/* ─────────────────────────────────────────
   RENDER: CROWD ZONES
───────────────────────────────────────── */

/**
 * Renders crowd density zone cards in the sidebar.
 * @param {import('./firebase.js').CrowdZone[]} zones
 */
function renderCrowdZones(zones) {
  const container = document.getElementById('crowd-zones');
  if (!container) return;

  if (!zones.length) {
    container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:4px 0">No zone data available</p>';
    return;
  }

  container.innerHTML = zones.map(z => `
    <div class="crowd-zone level-${z.level}" role="listitem">
      <span class="crowd-zone__name">${escHtml(z.name)}</span>
      <div class="crowd-zone__bar-wrap" aria-hidden="true">
        <div class="crowd-zone__bar" style="width:${z.pct}%"></div>
      </div>
      <span class="crowd-zone__pct" aria-label="${z.pct}% crowd">${z.pct}%</span>
    </div>
  `).join('');
}

/* ─────────────────────────────────────────
   RENDER: WAIT TIMES
───────────────────────────────────────── */

/**
 * Renders concession stall wait time list in the sidebar.
 * @param {import('./firebase.js').ConcessionStall[]} stalls
 */
function renderWaitTimes(stalls) {
  const list   = document.getElementById('wait-list');
  const banner = document.getElementById('best-stall-banner');
  const bestEl = document.getElementById('best-stall-text');
  if (!list) return;

  if (!stalls.length) {
    list.innerHTML = '<li style="font-size:12px;color:var(--text-muted);padding:4px 8px">No concessions open</li>';
    if (banner) banner.hidden = true;
    return;
  }

  // Show "shortest queue" banner
  if (banner && bestEl && stalls[0]) {
    banner.hidden = false;
    bestEl.textContent = `${stalls[0].name} — ${stalls[0].waitMin} min`;
  }

  list.innerHTML = stalls.map(s => `
    <li class="wait-item wait-${s.level}">
      <span class="wait-item__name">${escHtml(s.name)}</span>
      <span class="wait-item__time" aria-label="${s.waitMin} minute wait">${s.waitMin} min</span>
      <span class="wait-item__dot" aria-hidden="true"></span>
    </li>
  `).join('');
}

/* ─────────────────────────────────────────
   RENDER: SCHEDULE / COUNTDOWN
───────────────────────────────────────── */

let _countdownInterval = null;

/**
 * Starts the live countdown for the next scheduled event.
 * @param {import('./firebase.js').ScheduleEvent|null} event
 */
function renderSchedule(event) {
  const labelEl     = document.getElementById('next-event-label');
  const countdownEl = document.getElementById('event-countdown');
  if (!labelEl || !countdownEl) return;

  if (_countdownInterval) clearInterval(_countdownInterval);

  if (!event) {
    labelEl.textContent     = 'No upcoming events';
    countdownEl.textContent = '--:--';
    return;
  }

  labelEl.textContent = `Next: ${event.label}`;

  // Update every second
  function tick() {
    const diff = event.time - Date.now();
    if (diff <= 0) {
      countdownEl.textContent = 'NOW';
      clearInterval(_countdownInterval);
      return;
    }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    countdownEl.textContent = h > 0
      ? `${h}:${pad(m)}:${pad(s)}`
      : `${pad(m)}:${pad(s)}`;
  }

  tick();
  _countdownInterval = setInterval(tick, 1000);
}

/* ─────────────────────────────────────────
   UI INTERACTIONS
───────────────────────────────────────── */

function wireUI() {
  wireVenueName();
  wireSectionPicker();
  wireQuickNav();
  wireMapLayers();
  wireRouteClose();
}

/** Set venue name from config */
function wireVenueName() {
  const el = document.getElementById('venue-name');
  if (el && window.APP_CONFIG && window.APP_CONFIG.app) {
    el.textContent = `— ${window.APP_CONFIG.app.venueName}`;
  }
}

/** Section picker — confirm button updates activeSection and badge */
function wireSectionPicker() {
  const btn    = document.getElementById('set-section-btn');
  const select = document.getElementById('seat-section');
  const badge  = document.getElementById('active-section-badge');
  const text   = document.getElementById('active-section-text');

  if (!btn || !select) return;

  btn.addEventListener('click', () => {
    const val = select.value;
    if (!val) { showToast('Please choose a section first', 'error'); return; }

    activeSection = val;
    const label = select.options[select.selectedIndex].text;

    if (badge && text) {
      text.textContent = label;
      badge.hidden = false;
    }

    // Notify map to highlight the section
    if (typeof StadiumMap !== 'undefined') {
      StadiumMap.highlightSection(val);
    }

    // Notify chat of the updated context
    if (typeof StadiumChat !== 'undefined') {
      StadiumChat.setSection(val, label);
    }

    showToast(`Location set: ${label}`, 'success');
  });
}

/** Quick navigation buttons */
function wireQuickNav() {
  const actions = {
    'nav-toilet': 'nearest toilet',
    'nav-exit':   'best exit',
    'nav-food':   'shortest queue food stall',
    'nav-aid':    'first aid station'
  };

  Object.entries(actions).forEach(([id, query]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!activeSection) {
        showToast('Set your section first so we can give you accurate directions', 'error');
        return;
      }
      // Delegate to map module for routing
      if (typeof StadiumMap !== 'undefined') {
        StadiumMap.routeTo(query, activeSection);
      }
    });
  });
}

/** Map layer toggle buttons */
function wireMapLayers() {
  const layerBtns = document.querySelectorAll('.map-ctrl-btn');
  layerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const isActive = btn.classList.toggle('active');
      btn.setAttribute('aria-pressed', isActive.toString());

      const layerId = btn.id.replace('layer-', '');
      if (typeof StadiumMap !== 'undefined') {
        StadiumMap.toggleLayer(layerId, isActive);
      }
    });
  });
}

/** Close route banner */
function wireRouteClose() {
  const closeBtn = document.getElementById('route-close-btn');
  const banner   = document.getElementById('route-banner');
  if (!closeBtn || !banner) return;

  closeBtn.addEventListener('click', () => {
    banner.hidden = true;
    if (typeof StadiumMap !== 'undefined') {
      StadiumMap.clearRoute();
    }
  });
}

/* ─────────────────────────────────────────
   TOAST UTILITY (exported for use by other modules)
───────────────────────────────────────── */

/**
 * Shows a temporary toast notification.
 * @param {string} message
 * @param {'default'|'success'|'error'} type
 * @param {number} durationMs
 */
function showToast(message, type = 'default', durationMs = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.style.transition = 'opacity 0.3s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, durationMs);
}

/* ─────────────────────────────────────────
   UTILITIES
───────────────────────────────────────── */

/**
 * Zero-pads a number to 2 digits.
 * @param {number} n
 * @returns {string}
 */
function pad(n) { return String(n).padStart(2, '0'); }

/**
 * Escapes HTML special characters to prevent XSS in innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─────────────────────────────────────────
   EXPORTS
───────────────────────────────────────── */
window.StadiumApp = {
  showToast,
  getActiveSection: () => activeSection
};
