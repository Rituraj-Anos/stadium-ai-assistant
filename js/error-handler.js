/**
 * error-handler.js — Centralised Error Handling & Resilience Module
 *
 * Responsibilities:
 *  - Detect online/offline state and update UI accordingly
 *  - Provide retry wrapper with exponential backoff
 *  - Surface user-friendly error messages (never raw stack traces)
 *  - Handle Firebase connection loss gracefully
 *  - Handle Gemini API quota / network errors gracefully
 *  - Log errors safely without exposing internals to users
 *
 * @module error-handler
 */

/* ─────────────────────────────────────────
   NETWORK STATUS MONITOR
───────────────────────────────────────── */

/**
 * Start listening to online/offline browser events.
 * Updates the topbar status indicator and shows a toast.
 */
function initNetworkMonitor() {
  window.addEventListener('online',  handleOnline);
  window.addEventListener('offline', handleOffline);

  // Set initial state
  if (!navigator.onLine) handleOffline();
}

function handleOnline() {
  setConnectionStatus(true);
  if (typeof StadiumApp !== 'undefined') {
    StadiumApp.showToast('Connection restored — live data resuming', 'success');
  }
  console.log('[error-handler] Network online');
}

function handleOffline() {
  setConnectionStatus(false);
  if (typeof StadiumApp !== 'undefined') {
    StadiumApp.showToast('You\'re offline — showing last known data', 'error');
  }
  console.warn('[error-handler] Network offline');
}

/**
 * Update the topbar live indicator dot and text.
 * @param {boolean} isOnline
 */
function setConnectionStatus(isOnline) {
  const dot    = document.getElementById('live-dot');
  const status = document.getElementById('live-status');

  if (dot) {
    dot.classList.toggle('offline', !isOnline);
    dot.setAttribute('aria-label', isOnline ? 'Connection status: live' : 'Connection status: offline');
  }
  if (status) {
    status.textContent = isOnline ? 'LIVE' : 'OFFLINE';
    status.style.color = isOnline ? 'var(--green)' : 'var(--red)';
  }
}

/* ─────────────────────────────────────────
   FIREBASE ERROR HANDLING
───────────────────────────────────────── */

/**
 * Wraps a Firebase operation with user-friendly error messaging.
 * Prevents raw Firebase error objects from surfacing to the user.
 *
 * @param {function(): Promise<any>} fn   Async function to execute
 * @param {string} context                Human-readable context label for logging
 * @param {any} fallback                  Value to return on failure
 * @returns {Promise<any>}
 */
async function safeFirebase(fn, context = 'Firebase', fallback = null) {
  try {
    return await fn();
  } catch (err) {
    const msg = friendlyFirebaseError(err);
    console.error(`[${context}]`, err.code || err.message, err);
    // Only show toast for user-visible operations, not background syncs
    if (context !== 'background-sync') {
      showErrorToast(msg);
    }
    return fallback;
  }
}

/**
 * Maps Firebase error codes to friendly messages.
 * @param {Error} err
 * @returns {string}
 */
function friendlyFirebaseError(err) {
  const code = err?.code || '';

  if (code.includes('network-request-failed') || code.includes('unavailable')) {
    return 'Live data unavailable — check your connection';
  }
  if (code.includes('permission-denied')) {
    return 'Unable to access venue data — please refresh';
  }
  if (code.includes('quota-exceeded')) {
    return 'Data limit reached — some features may be limited';
  }
  if (code.includes('app-deleted') || code.includes('invalid-api-key')) {
    return 'Configuration error — contact support';
  }
  return 'Live data temporarily unavailable';
}

/* ─────────────────────────────────────────
   GEMINI API ERROR HANDLING
───────────────────────────────────────── */

/**
 * Maps Gemini API HTTP status codes and error messages to friendly text.
 * @param {Error|Response} err
 * @returns {string}
 */
function friendlyGeminiError(err) {
  const msg  = err?.message || '';
  const code = err?.status  || 0;

  if (code === 429 || msg.includes('429') || msg.includes('quota')) {
    return 'AI assistant is busy right now — please try again in a moment';
  }
  if (code === 403 || msg.includes('403') || msg.includes('API key')) {
    return 'AI assistant configuration issue — using offline mode';
  }
  if (code === 400 || msg.includes('400')) {
    return 'I couldn\'t understand that request — please try rephrasing';
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch')) {
    return 'Can\'t reach the AI right now — check your connection';
  }
  if (code >= 500) {
    return 'AI service temporarily unavailable — try again shortly';
  }
  return 'Something went wrong — please try again';
}

/* ─────────────────────────────────────────
   RETRY WITH EXPONENTIAL BACKOFF
───────────────────────────────────────── */

/**
 * Retries an async function with exponential backoff on failure.
 *
 * @param {function(): Promise<any>} fn     Async function to retry
 * @param {object} opts
 * @param {number} opts.maxRetries          Max attempts (default: 3)
 * @param {number} opts.baseDelayMs         Initial delay in ms (default: 500)
 * @param {function(Error): boolean} opts.shouldRetry  Return false to stop retrying
 * @returns {Promise<any>}
 */
async function withRetry(fn, opts = {}) {
  const { maxRetries = 3, baseDelayMs = 500, shouldRetry = () => true } = opts;
  let lastErr;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries || !shouldRetry(err)) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 500, 1000, 2000...
      console.warn(`[retry] Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ─────────────────────────────────────────
   MAPS API ERROR HANDLING
───────────────────────────────────────── */

/**
 * Handles Google Maps API load failure.
 * Called if the Maps script tag fails to load.
 */
function handleMapsLoadError() {
  const mapEl = document.getElementById('venue-map');
  const loader = document.getElementById('map-loading');

  if (loader) {
    loader.innerHTML = `
      <div style="text-align:center;padding:24px;max-width:280px">
        <p style="color:var(--red);font-size:14px;margin-bottom:8px">Map unavailable</p>
        <p style="color:var(--text-secondary);font-size:12px;line-height:1.6">
          Google Maps could not be loaded. Check your API key configuration and internet connection.
        </p>
        <button
          onclick="location.reload()"
          style="margin-top:16px;padding:8px 20px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px"
          aria-label="Retry loading the map"
        >
          Retry
        </button>
      </div>
    `;
  }

  console.error('[map] Google Maps failed to load — check your API key and domain restrictions');
}

// Expose globally so index.html onerror callback can call it
window.gm_authFailure = handleMapsLoadError;

/* ─────────────────────────────────────────
   GENERIC UNCAUGHT ERROR SAFETY NET
───────────────────────────────────────── */

/**
 * Global unhandled promise rejection handler.
 * Prevents silent failures and logs details without exposing internals to users.
 */
window.addEventListener('unhandledrejection', event => {
  const err = event.reason;
  console.error('[unhandled-rejection]', err);

  // Only show a toast for non-trivial errors
  if (err && err.message && !err.message.includes('AbortError')) {
    // Suppress — don't spam the user with internal promise errors
    // but log for debugging
  }
  event.preventDefault(); // Prevents console noise in production
});

/* ─────────────────────────────────────────
   LOADING SKELETON HELPERS
───────────────────────────────────────── */

/**
 * Replace skeleton placeholders with a "no data" empty state.
 * Called when data fails to load after a timeout.
 *
 * @param {string} containerId   ID of the container holding skeletons
 * @param {string} message       Message to display
 */
function showEmptyState(containerId, message) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <p role="status" style="
      font-size: 12px;
      color: var(--text-muted);
      padding: 8px 4px;
      line-height: 1.5;
    ">${escHtml(message)}</p>
  `;
}

/**
 * Show skeleton loaders in a container while data is fetching.
 * @param {string} containerId
 * @param {number} count   Number of skeleton rows to show
 */
function showSkeletons(containerId, count = 3) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = Array(count)
    .fill('<div class="loading-skeleton" aria-busy="true" aria-label="Loading"></div>')
    .join('');
}

/* ─────────────────────────────────────────
   TIMEOUT WRAPPER
───────────────────────────────────────── */

/**
 * Races a promise against a timeout.
 * @param {Promise<any>} promise
 * @param {number} ms          Timeout in milliseconds
 * @param {string} label       Label for the error message
 * @returns {Promise<any>}
 */
function withTimeout(promise, ms = 8000, label = 'Request') {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

/* ─────────────────────────────────────────
   INTERNAL HELPERS
───────────────────────────────────────── */

function showErrorToast(message) {
  if (typeof StadiumApp !== 'undefined') {
    StadiumApp.showToast(message, 'error');
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─────────────────────────────────────────
   AUTO-INIT
───────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', initNetworkMonitor);

/* ─────────────────────────────────────────
   EXPORTS
───────────────────────────────────────── */
window.StadiumErrors = {
  safeFirebase,
  friendlyFirebaseError,
  friendlyGeminiError,
  withRetry,
  withTimeout,
  showEmptyState,
  showSkeletons,
  handleMapsLoadError,
  setConnectionStatus
};
