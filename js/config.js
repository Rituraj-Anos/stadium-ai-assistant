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
  mapsApiKey: 'AIzaSyDqn0YVa7d8PrIrpEM_RhnCjuqKMWLx7tU',

  /* ── Gemini API ── */
  geminiApiKey: 'AQ.Ab8RN6LV5XioEwom_dFUTzH3AfJZLe9KiBY_-QTYnfDbLPHx2w',
  geminiModel: 'gemini-1.5-flash',

  /* ── Firebase ── */
  firebase: {
    apiKey: 'AIzaSyCPnxMPat_W2N90GVF3wAa07hG93ZDPcNc',
    authDomain: 'stadium-ai-assistant-10ec3.firebaseapp.com',
    databaseURL: 'https://stadium-ai-assistant-10ec3-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'stadium-ai-assistant-10ec3',
    storageBucket: 'stadium-ai-assistant-10ec3.firebasestorage.app',
    messagingSenderId: '583792184823',
    appId: '1:583792184823:web:da6cd23bc7624bc4dc32f2',
    measurementId: 'G-Z1BJXQGK7E',
  },

  /* ── Google Calendar ── */
  calendarApiKey: 'AIzaSyDqn0YVa7d8PrIrpEM_RhnCjuqKMWLx7tU',
  calendarId: '',

  /* ── App settings ── */
  app: {
    venueName: 'Eden Gardens',
    venueLocation: { lat: 22.5646, lng: 88.3433 },
    venueZoom: 17,
    refreshIntervalMs: 30000
  }

};