/**
 * config.js — StadiumAI API Configuration
 *
 * ⚠️  THIS FILE IS IN .gitignore — NEVER COMMIT YOUR REAL KEYS
 *
 * HOW TO SET UP:
 * 1. Copy this file: cp js/config.template.js js/config.js
 * 2. Fill in your real API keys below
 * 3. The real config.js is gitignored — safe to add keys there
 *
 * WHERE TO GET KEYS:
 * - mapsApiKey  → https://console.cloud.google.com → APIs → Maps JS API
 *   (restrict the key to your GitHub Pages domain!)
 * - geminiApiKey → https://aistudio.google.com/app/apikey
 * - Firebase config → Firebase Console → Project Settings → Your Apps
 * - calendarApiKey → https://console.cloud.google.com → APIs → Calendar API
 */

window.APP_CONFIG = {

  /* ── Google Maps JS API ── */
  mapsApiKey: 'YOUR_MAPS_API_KEY_HERE',

  /* ── Gemini API ── */
  geminiApiKey: 'YOUR_GEMINI_API_KEY_HERE',
  geminiModel: 'gemini-1.5-flash',

  /* ── Firebase ── */
  firebase: {
    apiKey:            'YOUR_FIREBASE_API_KEY',
    authDomain:        'YOUR_PROJECT.firebaseapp.com',
    databaseURL:       'https://YOUR_PROJECT-default-rtdb.firebaseio.com',
    projectId:         'YOUR_PROJECT_ID',
    storageBucket:     'YOUR_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId:             'YOUR_APP_ID'
  },

  /* ── Google Calendar ── */
  calendarApiKey:  'YOUR_CALENDAR_API_KEY',
  calendarId:      'YOUR_CALENDAR_ID@group.calendar.google.com',

  /* ── App settings ── */
  app: {
    venueName:     'City Arena',
    venueLocation: { lat: 28.6139, lng: 77.2090 },  // Default: New Delhi — update to your venue
    venueZoom:     17,
    refreshIntervalMs: 30000,  // how often to refresh live data (30s)

    // Optional: Register a Map ID at Cloud Console → Maps Platform → Map Management
    // then paste the hex ID here (e.g. '8e0a97af9386fef'). Leave blank to use custom styles.
    mapId: ''
  }

};
