/**
 * firebase.js — Firebase Realtime Database module
 *
 * Responsibilities:
 *  - Initialize Firebase app
 *  - Subscribe to live crowd density data
 *  - Subscribe to live concession wait times
 *  - Subscribe to event schedule
 *  - Provide helper functions to read/format data
 *
 * @module firebase
 */

/* ─────────────────────────────────────────
   INITIALIZATION
───────────────────────────────────────── */

/** @type {firebase.database.Database|null} */
let db = null;

/** Active listener references — stored so we can detach on teardown */
const _listeners = {};

/**
 * Initialize Firebase and expose the database reference.
 * Called once from main.js after config.js has loaded.
 */
function initFirebase() {
  if (!window.APP_CONFIG || !window.APP_CONFIG.firebase) {
    console.error('[firebase] APP_CONFIG.firebase not found. Did config.js load?');
    return;
  }

  // Prevent double-init
  if (firebase.apps.length === 0) {
    firebase.initializeApp(window.APP_CONFIG.firebase);
  }

  db = firebase.database();
  console.log('[firebase] Initialized ✓');
}

/* ─────────────────────────────────────────
   CROWD DENSITY
───────────────────────────────────────── */

/**
 * Subscribe to real-time crowd density updates.
 * Calls `callback` with an array of zone objects whenever data changes.
 *
 * @param {function(Array<CrowdZone>): void} callback
 */
function onCrowdUpdate(callback) {
  if (!db) { console.warn('[firebase] db not ready'); return; }

  const ref = db.ref('crowd_density');

  _listeners.crowd = ref.on('value', snapshot => {
    const raw = snapshot.val();
    if (!raw) return;

    // Convert Firebase object → sorted array
    const zones = Object.entries(raw)
      .map(([id, data]) => ({
        id,
        name:    data.name    || id,
        pct:     data.pct     || 0,       // 0–100
        level:   levelFromPct(data.pct),  // 'low' | 'mid' | 'high'
        updated: data.updated || Date.now()
      }))
      .sort((a, b) => b.pct - a.pct);    // highest crowd first

    callback(zones);
  }, err => console.error('[firebase] crowd_density error:', err));
}

/* ─────────────────────────────────────────
   CONCESSION WAIT TIMES
───────────────────────────────────────── */

/**
 * Subscribe to real-time concession wait time updates.
 * Calls `callback` with an array of stall objects whenever data changes.
 *
 * @param {function(Array<ConcessionStall>): void} callback
 */
function onWaitTimesUpdate(callback) {
  if (!db) { console.warn('[firebase] db not ready'); return; }

  const ref = db.ref('concessions');

  _listeners.waits = ref.on('value', snapshot => {
    const raw = snapshot.val();
    if (!raw) return;

    const stalls = Object.entries(raw)
      .map(([id, data]) => ({
        id,
        name:    data.name    || id,
        waitMin: data.waitMin || 0,
        isOpen:  data.isOpen  !== false,
        section: data.section || 'General',
        level:   waitLevelFromMin(data.waitMin)
      }))
      .filter(s => s.isOpen)
      .sort((a, b) => a.waitMin - b.waitMin);   // shortest wait first

    callback(stalls);
  }, err => console.error('[firebase] concessions error:', err));
}

/* ─────────────────────────────────────────
   EVENT SCHEDULE
───────────────────────────────────────── */

/**
 * Subscribe to the event schedule.
 * Calls `callback` with the upcoming event object.
 *
 * @param {function(ScheduleEvent|null): void} callback
 */
function onScheduleUpdate(callback) {
  if (!db) { console.warn('[firebase] db not ready'); return; }

  const ref = db.ref('schedule');

  _listeners.schedule = ref.on('value', snapshot => {
    const raw = snapshot.val();
    if (!raw) { callback(null); return; }

    const now = Date.now();

    // Find next upcoming event
    const upcoming = Object.values(raw)
      .filter(e => e.time > now)
      .sort((a, b) => a.time - b.time)[0] || null;

    callback(upcoming);
  }, err => console.error('[firebase] schedule error:', err));
}

/* ─────────────────────────────────────────
   UTILITY HELPERS
───────────────────────────────────────── */

/**
 * Returns a crowd level string from a percentage value.
 * @param {number} pct  0–100
 * @returns {'low'|'mid'|'high'}
 */
function levelFromPct(pct) {
  if (pct < 40) return 'low';
  if (pct < 70) return 'mid';
  return 'high';
}

/**
 * Returns a wait level string from wait minutes.
 * @param {number} min
 * @returns {'low'|'mid'|'high'}
 */
function waitLevelFromMin(min) {
  if (min < 5)  return 'low';
  if (min < 12) return 'mid';
  return 'high';
}

/**
 * Detaches all Firebase listeners. Call on page unload.
 */
function detachAll() {
  if (!db) return;
  if (_listeners.crowd)    db.ref('crowd_density').off('value', _listeners.crowd);
  if (_listeners.waits)    db.ref('concessions').off('value', _listeners.waits);
  if (_listeners.schedule) db.ref('schedule').off('value', _listeners.schedule);
}

/**
 * One-time fetch of all live data for use in the Gemini context snapshot.
 * Returns a plain object (not a live listener).
 *
 * @returns {Promise<LiveSnapshot>}
 */
async function getLiveSnapshot() {
  if (!db) return {};

  try {
    const [crowdSnap, concessSnap, schedSnap] = await Promise.all([
      db.ref('crowd_density').once('value'),
      db.ref('concessions').once('value'),
      db.ref('schedule').once('value')
    ]);

    const crowd     = crowdSnap.val()  || {};
    const concess   = concessSnap.val()|| {};
    const schedule  = schedSnap.val()  || {};
    const now       = Date.now();

    // Next event
    const nextEvent = Object.values(schedule)
      .filter(e => e.time > now)
      .sort((a, b) => a.time - b.time)[0] || null;

    // Stall with shortest wait
    const bestStall = Object.values(concess)
      .filter(s => s.isOpen !== false)
      .sort((a, b) => a.waitMin - b.waitMin)[0] || null;

    return { crowd, concessions: concess, nextEvent, bestStall };
  } catch (err) {
    console.error('[firebase] getLiveSnapshot error:', err);
    return {};
  }
}

/* ─────────────────────────────────────────
   EXPORTS (attached to window for module-less script loading)
───────────────────────────────────────── */
window.StadiumFirebase = {
  init:                initFirebase,
  onCrowdUpdate,
  onWaitTimesUpdate,
  onScheduleUpdate,
  getLiveSnapshot,
  detachAll
};

/* ─────────────────────────────────────────
   JSDoc TYPE DEFINITIONS
───────────────────────────────────────── */

/**
 * @typedef {Object} CrowdZone
 * @property {string} id
 * @property {string} name
 * @property {number} pct     0–100 crowd percentage
 * @property {'low'|'mid'|'high'} level
 * @property {number} updated  Unix timestamp
 */

/**
 * @typedef {Object} ConcessionStall
 * @property {string} id
 * @property {string} name
 * @property {number} waitMin   Wait time in minutes
 * @property {boolean} isOpen
 * @property {string} section   Nearest stadium section
 * @property {'low'|'mid'|'high'} level
 */

/**
 * @typedef {Object} ScheduleEvent
 * @property {string} label   Human-readable event name
 * @property {number} time    Unix timestamp (ms)
 */

/**
 * @typedef {Object} LiveSnapshot
 * @property {Object} crowd
 * @property {Object} concessions
 * @property {ScheduleEvent|null} nextEvent
 * @property {ConcessionStall|null} bestStall
 */
