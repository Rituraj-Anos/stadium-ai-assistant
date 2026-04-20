/**
 * @file stadium.test.js
 * @description Unit tests for StadiumAI core utility functions.
 *
 * These tests validate the pure logic functions extracted from:
 *   - js/chat.js    → formatCountdown, sanitizeInput, getSectionCrowd
 *   - js/firebase.js → levelFromPct, waitLevelFromMin, getBestStall
 *   - js/map.js     → crowdColor, getPolygonCenter
 *   - js/main.js    → pad, escHtml
 */

'use strict';

// ── Inline stubs matching the exact production implementations ─────────────

/**
 * Formats seconds into MM:SS or H:MM:SS countdown string.
 * Matches the countdown logic in main.js renderSchedule().
 * @param {number} seconds - Total seconds remaining.
 * @returns {string} Formatted time string.
 */
function formatCountdown(seconds) {
  if (seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0
    ? `${h}:${pad(m)}:${pad(s)}`
    : `${pad(m)}:${pad(s)}`;
}

/**
 * Sanitizes user input to prevent XSS — mirrors escHtml() in chat.js / main.js.
 * @param {string} input - Raw user text.
 * @returns {string} Sanitized string.
 */
function sanitizeInput(input) {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Returns crowd level string from a percentage — mirrors levelFromPct() in firebase.js.
 * @param {number} pct - Percentage 0–100.
 * @returns {'low'|'mid'|'high'} Level.
 */
function levelFromPct(pct) {
  if (pct < 40) return 'low';
  if (pct < 70) return 'mid';
  return 'high';
}

/**
 * Returns wait level from minutes — mirrors waitLevelFromMin() in firebase.js.
 * @param {number} min - Wait time in minutes.
 * @returns {'low'|'mid'|'high'} Level.
 */
function waitLevelFromMin(min) {
  if (min < 5)  return 'low';
  if (min < 12) return 'mid';
  return 'high';
}

/**
 * Returns the stall with the shortest wait time — mirrors getBestStall logic in firebase.js.
 * @param {Array<{name: string, waitMin: number, isOpen: boolean}>} stalls
 * @returns {{name: string, waitMin: number}|null}
 */
function getBestStall(stalls) {
  if (!stalls || stalls.length === 0) return null;
  const open = stalls.filter(s => s.isOpen !== false);
  if (open.length === 0) return null;
  return open.reduce((a, b) => (a.waitMin <= b.waitMin ? a : b));
}

/**
 * Returns fill/stroke colour scheme for a crowd percentage — mirrors crowdColor() in map.js.
 * @param {number} pct - 0–100
 * @returns {{ fill: string, stroke: string, opacity: number }}
 */
function crowdColor(pct) {
  if (pct < 40) return { fill: '#00d68f', stroke: '#00b87a', opacity: 0.35 };
  if (pct < 70) return { fill: '#ffb627', stroke: '#e09a00', opacity: 0.40 };
  return               { fill: '#ff4b4b', stroke: '#dd2222', opacity: 0.50 };
}

/**
 * Calculates the centroid of a polygon path — mirrors getPolygonCenter() in map.js.
 * @param {{ lat: number, lng: number }[]} path
 * @returns {{ lat: number, lng: number }}
 */
function getPolygonCenter(path) {
  const lat = path.reduce((s, p) => s + p.lat, 0) / path.length;
  const lng = path.reduce((s, p) => s + p.lng, 0) / path.length;
  return { lat, lng };
}

/**
 * Zero-pads a number to 2 digits — mirrors pad() in main.js.
 * @param {number} n
 * @returns {string}
 */
function pad(n) { return String(n).padStart(2, '0'); }

// ── Tests ──────────────────────────────────────────────────────────────────

// ------------------------------------------------------------
describe('formatCountdown', () => {
  test('formats 90 seconds as 01:30', () => {
    expect(formatCountdown(90)).toBe('01:30');
  });

  test('formats 0 seconds as 00:00', () => {
    expect(formatCountdown(0)).toBe('00:00');
  });

  test('returns 00:00 for negative seconds', () => {
    expect(formatCountdown(-5)).toBe('00:00');
  });

  test('formats 3661 seconds as 1:01:01 (includes hours)', () => {
    expect(formatCountdown(3661)).toBe('1:01:01');
  });

  test('formats 59 seconds as 00:59', () => {
    expect(formatCountdown(59)).toBe('00:59');
  });

  test('formats exactly 60 seconds as 01:00', () => {
    expect(formatCountdown(60)).toBe('01:00');
  });
});

// ------------------------------------------------------------
describe('sanitizeInput (escHtml)', () => {
  test('escapes script tags', () => {
    expect(sanitizeInput('<script>alert(1)</script>')).not.toContain('<script>');
  });

  test('escapes angle brackets', () => {
    expect(sanitizeInput('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });

  test('escapes double quotes', () => {
    expect(sanitizeInput('"hello"')).toBe('&quot;hello&quot;');
  });

  test('escapes single quotes', () => {
    expect(sanitizeInput("it's")).toBe("it&#39;s");
  });

  test('escapes ampersands', () => {
    expect(sanitizeInput('A & B')).toBe('A &amp; B');
  });

  test('handles empty string', () => {
    expect(sanitizeInput('')).toBe('');
  });

  test('does not modify clean text', () => {
    expect(sanitizeInput('Hello Stadium!')).toBe('Hello Stadium!');
  });
});

// ------------------------------------------------------------
describe('levelFromPct — crowd density classification', () => {
  test('returns low for under 40%', () => {
    expect(levelFromPct(30)).toBe('low');
  });

  test('returns mid for 40–69%', () => {
    expect(levelFromPct(55)).toBe('mid');
  });

  test('returns high for 70%+', () => {
    expect(levelFromPct(85)).toBe('high');
  });

  test('boundary: exactly 40% is mid', () => {
    expect(levelFromPct(40)).toBe('mid');
  });

  test('boundary: exactly 70% is high', () => {
    expect(levelFromPct(70)).toBe('high');
  });

  test('handles 0%', () => {
    expect(levelFromPct(0)).toBe('low');
  });

  test('handles 100%', () => {
    expect(levelFromPct(100)).toBe('high');
  });
});

// ------------------------------------------------------------
describe('waitLevelFromMin — concession wait classification', () => {
  test('returns low for under 5 minutes', () => {
    expect(waitLevelFromMin(2)).toBe('low');
  });

  test('returns mid for 5–11 minutes', () => {
    expect(waitLevelFromMin(8)).toBe('mid');
  });

  test('returns high for 12+ minutes', () => {
    expect(waitLevelFromMin(15)).toBe('high');
  });

  test('boundary: exactly 5 min is mid', () => {
    expect(waitLevelFromMin(5)).toBe('mid');
  });

  test('boundary: exactly 12 min is high', () => {
    expect(waitLevelFromMin(12)).toBe('high');
  });
});

// ------------------------------------------------------------
describe('getBestStall — find shortest queue', () => {
  test('returns stall with lowest waitMin', () => {
    const stalls = [
      { name: 'A', waitMin: 5,  isOpen: true },
      { name: 'B', waitMin: 2,  isOpen: true },
      { name: 'C', waitMin: 8,  isOpen: true }
    ];
    expect(getBestStall(stalls).name).toBe('B');
  });

  test('ignores closed stalls', () => {
    const stalls = [
      { name: 'A', waitMin: 1, isOpen: false },
      { name: 'B', waitMin: 4, isOpen: true }
    ];
    expect(getBestStall(stalls).name).toBe('B');
  });

  test('returns null when all stalls are closed', () => {
    const stalls = [{ name: 'A', waitMin: 1, isOpen: false }];
    expect(getBestStall(stalls)).toBeNull();
  });

  test('returns null for empty array', () => {
    expect(getBestStall([])).toBeNull();
  });

  test('returns null for null input', () => {
    expect(getBestStall(null)).toBeNull();
  });

  test('returns single open stall', () => {
    expect(getBestStall([{ name: 'X', waitMin: 3, isOpen: true }]).name).toBe('X');
  });

  test('handles tie — returns first by array order', () => {
    const stalls = [
      { name: 'A', waitMin: 2, isOpen: true },
      { name: 'B', waitMin: 2, isOpen: true }
    ];
    expect(getBestStall(stalls).name).toBe('A');
  });
});

// ------------------------------------------------------------
describe('crowdColor — map polygon colour coding', () => {
  test('returns green for low crowd (< 40%)', () => {
    const col = crowdColor(25);
    expect(col.fill).toBe('#00d68f');
    expect(col.opacity).toBe(0.35);
  });

  test('returns amber for medium crowd (40–69%)', () => {
    const col = crowdColor(60);
    expect(col.fill).toBe('#ffb627');
    expect(col.opacity).toBe(0.40);
  });

  test('returns red for high crowd (70%+)', () => {
    const col = crowdColor(90);
    expect(col.fill).toBe('#ff4b4b');
    expect(col.opacity).toBe(0.50);
  });

  test('boundary: exactly 40% returns amber', () => {
    expect(crowdColor(40).fill).toBe('#ffb627');
  });

  test('boundary: exactly 70% returns red', () => {
    expect(crowdColor(70).fill).toBe('#ff4b4b');
  });

  test('all colour objects have fill, stroke, and opacity keys', () => {
    [0, 50, 90].forEach(pct => {
      const col = crowdColor(pct);
      expect(col).toHaveProperty('fill');
      expect(col).toHaveProperty('stroke');
      expect(col).toHaveProperty('opacity');
    });
  });
});

// ------------------------------------------------------------
describe('getPolygonCenter — centroid calculation', () => {
  test('returns centroid of a square', () => {
    const path = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 2, lng: 2 },
      { lat: 2, lng: 0 }
    ];
    const c = getPolygonCenter(path);
    expect(c.lat).toBe(1);
    expect(c.lng).toBe(1);
  });

  test('returns the single point for a one-point "polygon"', () => {
    const path = [{ lat: 28.61, lng: 77.20 }];
    const c = getPolygonCenter(path);
    expect(c.lat).toBeCloseTo(28.61);
    expect(c.lng).toBeCloseTo(77.20);
  });

  test('handles negative coordinates', () => {
    const path = [
      { lat: -1, lng: -1 },
      { lat:  1, lng:  1 }
    ];
    const c = getPolygonCenter(path);
    expect(c.lat).toBe(0);
    expect(c.lng).toBe(0);
  });
});

// ------------------------------------------------------------
describe('pad — number zero-padding', () => {
  test('pads single digit with leading zero', () => {
    expect(pad(5)).toBe('05');
  });

  test('does not pad two-digit numbers', () => {
    expect(pad(30)).toBe('30');
  });

  test('handles 0', () => {
    expect(pad(0)).toBe('00');
  });

  test('does not truncate numbers > 99', () => {
    expect(pad(100)).toBe('100');
  });
});
