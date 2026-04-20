/**
 * map.js — Google Maps Integration Module
 *
 * Responsibilities:
 *  - Initialize Google Maps centered on the venue
 *  - Draw colour-coded crowd density polygons per section
 *  - Toggle overlay layers (crowd / exits / food / first aid)
 *  - Highlight a user's selected section
 *  - Route finder: Directions API from user's section to any facility
 *  - Place markers for concessions, exits, toilets, first aid
 *
 * Depends on: config.js (APP_CONFIG), firebase.js (StadiumFirebase)
 * Loaded after Google Maps API callback fires (onMapsReady)
 *
 * @module map
 */

/* ─────────────────────────────────────────
   STATE
───────────────────────────────────────── */

/** @type {google.maps.Map|null} */
let map = null;

/** @type {google.maps.DirectionsService|null} */
let directionsService = null;

/** @type {google.maps.DirectionsRenderer|null} */
let directionsRenderer = null;

/** Section polygon overlays — keyed by section id */
const _sectionPolygons = {};

/** Marker arrays per layer */
const _markers = { exits: [], food: [], aid: [], toilets: [] };

/** Active layer visibility */
const _layers = { crowd: true, exits: false, food: false, aid: false };

/** Last known crowd data — used to re-colour polygons on update */
let _crowdData = {};

/** Currently highlighted section polygon */
let _highlightedSection = null;

/* ─────────────────────────────────────────
   SECTION GEOMETRY
   These are approximate polygon coordinates for a generic oval stadium.
   In production, replace with real venue GIS data.
───────────────────────────────────────── */

/**
 * Returns section polygon paths relative to a venue center.
 * Each section is a trapezoid segment of the oval.
 *
 * @param {{ lat: number, lng: number }} center
 * @returns {Object.<string, google.maps.LatLng[]>}
 */
function getSectionPaths(center) {
  const c = center;
  const d = 0.0012; // ~130m radius

  return {
    A: [ // North Stand
      { lat: c.lat + d * 0.5,  lng: c.lng - d * 0.9 },
      { lat: c.lat + d * 0.5,  lng: c.lng + d * 0.9 },
      { lat: c.lat + d * 1.0,  lng: c.lng + d * 0.6 },
      { lat: c.lat + d * 1.0,  lng: c.lng - d * 0.6 }
    ],
    B: [ // East Stand
      { lat: c.lat + d * 0.5,  lng: c.lng + d * 0.9 },
      { lat: c.lat - d * 0.5,  lng: c.lng + d * 0.9 },
      { lat: c.lat - d * 0.3,  lng: c.lng + d * 1.3 },
      { lat: c.lat + d * 0.3,  lng: c.lng + d * 1.3 }
    ],
    C: [ // South Stand
      { lat: c.lat - d * 0.5,  lng: c.lng + d * 0.9 },
      { lat: c.lat - d * 0.5,  lng: c.lng - d * 0.9 },
      { lat: c.lat - d * 1.0,  lng: c.lng - d * 0.6 },
      { lat: c.lat - d * 1.0,  lng: c.lng + d * 0.6 }
    ],
    D: [ // West Stand
      { lat: c.lat - d * 0.5,  lng: c.lng - d * 0.9 },
      { lat: c.lat + d * 0.5,  lng: c.lng - d * 0.9 },
      { lat: c.lat + d * 0.3,  lng: c.lng - d * 1.3 },
      { lat: c.lat - d * 0.3,  lng: c.lng - d * 1.3 }
    ],
    E: [ // Upper Tier — thin outer ring (approximate)
      { lat: c.lat + d * 1.0,  lng: c.lng - d * 0.6 },
      { lat: c.lat + d * 1.0,  lng: c.lng + d * 0.6 },
      { lat: c.lat + d * 1.25, lng: c.lng + d * 0.4 },
      { lat: c.lat + d * 1.25, lng: c.lng - d * 0.4 }
    ],
    F: [ // VIP — small box, West lower tier
      { lat: c.lat + d * 0.15, lng: c.lng - d * 0.85 },
      { lat: c.lat + d * 0.15, lng: c.lng - d * 0.65 },
      { lat: c.lat - d * 0.15, lng: c.lng - d * 0.65 },
      { lat: c.lat - d * 0.15, lng: c.lng - d * 0.85 }
    ]
  };
}

/* ─────────────────────────────────────────
   COLOUR HELPERS
───────────────────────────────────────── */

/**
 * Returns fill/stroke colour for a crowd percentage.
 * @param {number} pct 0–100
 * @returns {{ fill: string, stroke: string, opacity: number }}
 */
function crowdColor(pct) {
  if (pct < 40) return { fill: '#00d68f', stroke: '#00b87a', opacity: 0.35 };
  if (pct < 70) return { fill: '#ffb627', stroke: '#e09a00', opacity: 0.40 };
  return               { fill: '#ff4b4b', stroke: '#dd2222', opacity: 0.50 };
}

/* ─────────────────────────────────────────
   INITIALIZATION
───────────────────────────────────────── */

/**
 * Initialize the Google Map. Called from onMapsReady (index.html callback).
 */
function initMap() {
  const cfg = window.APP_CONFIG && window.APP_CONFIG.app;
  if (!cfg) { console.error('[map] APP_CONFIG.app not found'); return; }

  const center = cfg.venueLocation;

  // Build map options — mapId is optional and must be a registered ID from
  // Google Cloud Console → Maps Platform → Map Management.
  // If not configured, omit it so the custom styles array works correctly.
  const mapOptions = {
    center,
    zoom: cfg.venueZoom || 17,

    // Dark map style to match our UI theme
    styles: darkMapStyle(),

    // Disable default UI clutter — we have our own controls
    disableDefaultUI: true,
    zoomControl: true,
    zoomControlOptions: {
      position: google.maps.ControlPosition.LEFT_BOTTOM
    },
    gestureHandling: 'greedy'
  };

  // Only add mapId if explicitly configured (must be registered in Cloud Console)
  if (cfg.mapId) mapOptions.mapId = cfg.mapId;

  map = new google.maps.Map(document.getElementById('venue-map'), mapOptions);

  // Init Directions services
  directionsService  = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: false,
    polylineOptions: {
      strokeColor:   '#0a84ff',
      strokeWeight:  5,
      strokeOpacity: 0.85
    }
  });

  // Draw section polygons once map is ready
  map.addListener('idle', () => {
    drawSectionPolygons(center);
    drawFacilityMarkers(center);
    hideMapLoader();
    console.log('[map] Map ready ✓');
  });

  // Subscribe to live crowd data to re-colour polygons
  StadiumFirebase.onCrowdUpdate(zones => {
    zones.forEach(z => {
      // Map zone id (e.g. 'north_stand') to section letter (e.g. 'A')
      _crowdData[z.id] = z.pct;
    });
    if (_layers.crowd) updatePolygonColors();
  });
}

/* ─────────────────────────────────────────
   SECTION POLYGONS
───────────────────────────────────────── */

/**
 * Draw coloured polygons for each stadium section.
 * @param {{ lat: number, lng: number }} center
 */
function drawSectionPolygons(center) {
  const paths = getSectionPaths(center);

  // Map zone db keys → section letters for colouring
  const zoneToSection = {
    north_stand: 'A',
    east_stand:  'B',
    south_stand: 'C',
    west_stand:  'D',
    upper_tier:  'E',
    vip_section: 'F'
  };

  // Build reverse map: section letter → zone key
  const sectionToZone = Object.fromEntries(
    Object.entries(zoneToSection).map(([k, v]) => [v, k])
  );

  Object.entries(paths).forEach(([sectionId, path]) => {
    const zoneKey = sectionToZone[sectionId];
    const pct = _crowdData[zoneKey] || 0;
    const col = crowdColor(pct);

    const polygon = new google.maps.Polygon({
      paths: path,
      map,
      strokeColor:   col.stroke,
      strokeOpacity: 0.8,
      strokeWeight:  1.5,
      fillColor:     col.fill,
      fillOpacity:   col.opacity,
      zIndex: 1
    });

    // Label in center of polygon
    const labelPos = getPolygonCenter(path);
    const label = new google.maps.Marker({
      map,
      position: labelPos,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 }, // invisible icon
      label: {
        text: `Section ${sectionId}`,
        color: '#ffffff',
        fontSize: '11px',
        fontWeight: '600',
        fontFamily: "'Barlow Condensed', sans-serif"
      },
      zIndex: 2
    });

    // Click on section → select it
    polygon.addListener('click', () => {
      const select = document.getElementById('seat-section');
      if (select) select.value = sectionId;
      highlightSection(sectionId);
      if (typeof StadiumApp !== 'undefined') {
        StadiumApp.showToast(`Section ${sectionId} selected`, 'success');
      }
    });

    _sectionPolygons[sectionId] = { polygon, label, pct };
  });
}

/**
 * Update polygon fill colours to reflect latest crowd data.
 */
function updatePolygonColors() {
  const zoneToSection = {
    north_stand: 'A', east_stand: 'B', south_stand: 'C',
    west_stand:  'D', upper_tier: 'E', vip_section: 'F'
  };
  const sectionToZone = Object.fromEntries(
    Object.entries(zoneToSection).map(([k, v]) => [v, k])
  );

  Object.entries(_sectionPolygons).forEach(([sectionId, { polygon }]) => {
    const zoneKey = sectionToZone[sectionId];
    const pct = _crowdData[zoneKey] || 0;
    const col = crowdColor(pct);
    polygon.setOptions({
      fillColor:    col.fill,
      strokeColor:  col.stroke,
      fillOpacity:  col.opacity
    });
  });
}

/**
 * Toggle crowd polygon visibility.
 * @param {boolean} visible
 */
function setCrowdLayerVisible(visible) {
  Object.values(_sectionPolygons).forEach(({ polygon, label }) => {
    polygon.setMap(visible ? map : null);
    label.setMap(visible ? map : null);
  });
}

/* ─────────────────────────────────────────
   SECTION HIGHLIGHT
───────────────────────────────────────── */

/**
 * Visually highlight a section polygon (called when user sets their section).
 * @param {string} sectionId  e.g. 'A'
 */
function highlightSection(sectionId) {
  // Reset previous highlight
  if (_highlightedSection && _sectionPolygons[_highlightedSection]) {
    const prev = _sectionPolygons[_highlightedSection].polygon;
    prev.setOptions({ strokeWeight: 1.5, strokeOpacity: 0.8, zIndex: 1 });
  }

  const entry = _sectionPolygons[sectionId];
  if (!entry) return;

  entry.polygon.setOptions({
    strokeColor:   '#0a84ff',
    strokeWeight:  3,
    strokeOpacity: 1,
    zIndex: 5
  });

  _highlightedSection = sectionId;

  // Pan map to section
  const paths = getSectionPaths(window.APP_CONFIG.app.venueLocation);
  if (paths[sectionId]) {
    const center = getPolygonCenter(paths[sectionId]);
    map.panTo(center);
  }
}

/* ─────────────────────────────────────────
   FACILITY MARKERS
───────────────────────────────────────── */

/**
 * Place markers for exits, food stalls, and first aid.
 * Uses approximate positions around the venue center.
 * @param {{ lat: number, lng: number }} center
 */
function drawFacilityMarkers(center) {
  const c = center;
  const d = 0.0012;

  const exits = [
    { id: 'exit_north', label: 'N', pos: { lat: c.lat + d * 1.1, lng: c.lng },        title: 'North Exit (Gates 1–4)' },
    { id: 'exit_east',  label: 'E', pos: { lat: c.lat,           lng: c.lng + d * 1.4 }, title: 'East Exit (Gates 5–8)' },
    { id: 'exit_south', label: 'S', pos: { lat: c.lat - d * 1.1, lng: c.lng },        title: 'South Exit (Gates 9–12)' },
    { id: 'exit_west',  label: 'W', pos: { lat: c.lat,           lng: c.lng - d * 1.4 }, title: 'West Exit (Gates 13–16)' }
  ];

  const food = [
    { id: 'stall_a1', label: '🍔', pos: { lat: c.lat + d * 0.7, lng: c.lng - d * 0.5 }, title: 'Stall A1 — North Burgers' },
    { id: 'stall_b2', label: '🍟', pos: { lat: c.lat + d * 0.3, lng: c.lng + d * 1.0 }, title: 'Stall B2 — East Snacks' },
    { id: 'stall_d2', label: '🌯', pos: { lat: c.lat - d * 0.2, lng: c.lng - d * 1.0 }, title: 'Stall D2 — West Wraps (2 min)' }
  ];

  const aid = [
    { id: 'aid_north', label: '✚', pos: { lat: c.lat + d * 0.85, lng: c.lng + d * 0.3 }, title: 'First Aid — North' },
    { id: 'aid_south', label: '✚', pos: { lat: c.lat - d * 0.85, lng: c.lng - d * 0.3 }, title: 'First Aid — South' }
  ];

  exits.forEach(e => {
    const m = createIconMarker(e.pos, e.title, '#1c2640', '#0a84ff', e.label, 'exit');
    _markers.exits.push(m);
    m.setMap(_layers.exits ? map : null);
  });

  food.forEach(f => {
    const m = createIconMarker(f.pos, f.title, '#1c2640', '#ffb627', f.label, 'food');
    _markers.food.push(m);
    m.setMap(_layers.food ? map : null);
  });

  aid.forEach(a => {
    const m = createIconMarker(a.pos, a.title, '#1c2640', '#ff4b4b', a.label, 'aid');
    _markers.aid.push(m);
    m.setMap(_layers.aid ? map : null);
  });
}

/**
 * Creates a styled Google Maps marker.
 * @param {{ lat: number, lng: number }} pos
 * @param {string} title
 * @param {string} bg      Background colour
 * @param {string} accent  Border/icon colour
 * @param {string} label   Short label text
 * @param {string} type    Marker type for click info
 * @returns {google.maps.Marker}
 */
function createIconMarker(pos, title, bg, accent, label, type) {
  const marker = new google.maps.Marker({
    position: pos,
    map: null, // hidden until layer is toggled on
    title,
    label: {
      text:       label,
      color:      accent,
      fontSize:   '12px',
      fontWeight: '700',
      fontFamily: "'Space Mono', monospace"
    },
    icon: {
      path:        google.maps.SymbolPath.CIRCLE,
      scale:       16,
      fillColor:   bg,
      fillOpacity: 0.95,
      strokeColor: accent,
      strokeWeight: 2
    },
    zIndex: 10
  });

  // Info window on click
  const infoWin = new google.maps.InfoWindow({
    content: `
      <div style="
        font-family: 'Barlow', sans-serif;
        font-size: 13px;
        padding: 4px 2px;
        color: #0d1225;
        min-width: 140px;
      ">
        <strong>${escHtml(title)}</strong>
        ${type === 'food' ? '<br><span style="color:#888;font-size:11px">Tap to get directions</span>' : ''}
      </div>
    `
  });

  marker.addListener('click', () => {
    infoWin.open(map, marker);
    // Auto-route to this facility if user has set a section
    if (typeof StadiumApp !== 'undefined' && StadiumApp.getActiveSection()) {
      routeTo(title, StadiumApp.getActiveSection());
    }
  });

  return marker;
}

/* ─────────────────────────────────────────
   LAYER TOGGLE
───────────────────────────────────────── */

/**
 * Toggle a map layer on or off.
 * @param {'crowd'|'exits'|'food'|'aid'} layerId
 * @param {boolean} visible
 */
function toggleLayer(layerId, visible) {
  _layers[layerId] = visible;

  if (layerId === 'crowd') {
    setCrowdLayerVisible(visible);
    return;
  }

  const markerList = _markers[layerId] || [];
  markerList.forEach(m => m.setMap(visible ? map : null));
}

/* ─────────────────────────────────────────
   ROUTE FINDER
───────────────────────────────────────── */

/**
 * Route from user's section to a named facility type.
 * Uses the venue center + section offset as origin.
 * @param {string} query      e.g. 'nearest toilet', 'best exit', 'first aid station'
 * @param {string} sectionId  User's current section letter
 */
function routeTo(query, sectionId) {
  if (!map || !directionsService || !directionsRenderer) {
    console.warn('[map] Map not ready for routing');
    return;
  }

  const center = window.APP_CONFIG.app.venueLocation;
  const paths  = getSectionPaths(center);
  const sectionPath = paths[sectionId];

  if (!sectionPath) {
    if (typeof StadiumApp !== 'undefined') {
      StadiumApp.showToast('Could not find your section on the map', 'error');
    }
    return;
  }

  const origin      = getPolygonCenter(sectionPath);
  const destination = resolveDestination(query, center, sectionId);

  showRouteBanner('Calculating route…');

  directionsService.route(
    {
      origin,
      destination,
      travelMode: google.maps.TravelMode.WALKING
    },
    (result, status) => {
      if (status === 'OK') {
        directionsRenderer.setDirections(result);
        const leg     = result.routes[0].legs[0];
        const distStr = leg.distance ? leg.distance.text : '';
        const timeStr = leg.duration ? leg.duration.text : '';
        showRouteBanner(`${escHtml(destination.label || query)} — ${timeStr} walk (${distStr})`);
      } else {
        console.warn('[map] Directions failed:', status);
        // Fallback: just pan the map to the destination
        map.panTo(destination);
        map.setZoom(18);
        showRouteBanner(`Head to ${escHtml(destination.label || query)}`);
      }
    }
  );
}

/**
 * Resolve a natural-language query to a map LatLng destination.
 * In production, this would use the Places API with real venue data.
 * @param {string} query
 * @param {{ lat: number, lng: number }} center
 * @param {string} sectionId
 * @returns {{ lat: number, lng: number, label?: string }}
 */
function resolveDestination(query, center, sectionId) {
  const c = center;
  const d = 0.0012;
  const q = query.toLowerCase();

  // Nearest exit — pick the one closest to user's section
  const exitMap = { A: 'North', B: 'East', C: 'South', D: 'West', E: 'North', F: 'West' };
  const exitPositions = {
    North: { lat: c.lat + d * 1.1, lng: c.lng,           label: 'North Exit' },
    East:  { lat: c.lat,           lng: c.lng + d * 1.4,  label: 'East Exit' },
    South: { lat: c.lat - d * 1.1, lng: c.lng,           label: 'South Exit' },
    West:  { lat: c.lat,           lng: c.lng - d * 1.4,  label: 'West Exit' }
  };

  if (q.includes('exit')) {
    const exitDir = exitMap[sectionId] || 'North';
    return exitPositions[exitDir];
  }

  if (q.includes('toilet') || q.includes('restroom') || q.includes('bathroom')) {
    // Toilet near user's section
    const toiletOffsets = {
      A: { lat: c.lat + d * 0.6, lng: c.lng - d * 0.3, label: 'North Toilets' },
      B: { lat: c.lat + d * 0.2, lng: c.lng + d * 0.9, label: 'East Toilets' },
      C: { lat: c.lat - d * 0.6, lng: c.lng + d * 0.3, label: 'South Toilets' },
      D: { lat: c.lat - d * 0.2, lng: c.lng - d * 0.9, label: 'West Toilets' },
      E: { lat: c.lat + d * 1.0, lng: c.lng,            label: 'Upper Tier Toilets' },
      F: { lat: c.lat,           lng: c.lng - d * 0.7,  label: 'West Toilets (VIP)' }
    };
    return toiletOffsets[sectionId] || toiletOffsets['A'];
  }

  if (q.includes('food') || q.includes('queue') || q.includes('eat') || q.includes('hungry')) {
    // Shortest queue stall — West Wraps (D2) has 2 min wait in seed data
    return { lat: c.lat - d * 0.2, lng: c.lng - d * 1.0, label: 'Stall D2 — West Wraps (2 min)' };
  }

  if (q.includes('first aid') || q.includes('medical') || q.includes('emergency')) {
    return { lat: c.lat + d * 0.85, lng: c.lng + d * 0.3, label: 'First Aid Station' };
  }

  // Fallback: venue center
  return { ...center, label: query };
}

/* ─────────────────────────────────────────
   ROUTE BANNER
───────────────────────────────────────── */

/**
 * Show route information in the bottom banner.
 * @param {string} text
 */
function showRouteBanner(text) {
  const banner  = document.getElementById('route-banner');
  const bannerT = document.getElementById('route-banner-text');
  if (!banner || !bannerT) return;

  bannerT.textContent = text;
  banner.hidden = false;
}

/**
 * Clear the active route from the map and hide the banner.
 */
function clearRoute() {
  if (directionsRenderer) directionsRenderer.setDirections({ routes: [] });
  const banner = document.getElementById('route-banner');
  if (banner) banner.hidden = true;
}

/* ─────────────────────────────────────────
   MAP LOADER
───────────────────────────────────────── */

function hideMapLoader() {
  const loader = document.getElementById('map-loading');
  if (loader) loader.classList.add('hidden');
}

/* ─────────────────────────────────────────
   UTILITIES
───────────────────────────────────────── */

/**
 * Calculates the centroid of a polygon path.
 * @param {{ lat: number, lng: number }[]} path
 * @returns {{ lat: number, lng: number }}
 */
function getPolygonCenter(path) {
  const lat = path.reduce((s, p) => s + p.lat, 0) / path.length;
  const lng = path.reduce((s, p) => s + p.lng, 0) / path.length;
  return { lat, lng };
}

/**
 * Escapes HTML for safe insertion into info window content.
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
   DARK MAP STYLE
───────────────────────────────────────── */

/**
 * Returns a dark Google Maps style array matching the app's colour palette.
 * @returns {google.maps.MapTypeStyle[]}
 */
function darkMapStyle() {
  return [
    { elementType: 'geometry',       stylers: [{ color: '#080c18' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#080c18' }] },
    { elementType: 'labels.text.fill',   stylers: [{ color: '#4a5168' }] },
    { featureType: 'road',               elementType: 'geometry',       stylers: [{ color: '#161e30' }] },
    { featureType: 'road',               elementType: 'geometry.stroke', stylers: [{ color: '#0d1225' }] },
    { featureType: 'road',               elementType: 'labels.text.fill', stylers: [{ color: '#8a91a8' }] },
    { featureType: 'road.highway',       elementType: 'geometry',       stylers: [{ color: '#1c2640' }] },
    { featureType: 'road.highway',       elementType: 'geometry.stroke', stylers: [{ color: '#111828' }] },
    { featureType: 'poi',                elementType: 'geometry',       stylers: [{ color: '#0d1225' }] },
    { featureType: 'poi',                elementType: 'labels.text.fill', stylers: [{ color: '#4a5168' }] },
    { featureType: 'poi.park',           elementType: 'geometry',       stylers: [{ color: '#0d1f14' }] },
    { featureType: 'water',              elementType: 'geometry',       stylers: [{ color: '#050a12' }] },
    { featureType: 'water',              elementType: 'labels.text.fill', stylers: [{ color: '#2a3550' }] },
    { featureType: 'transit',            elementType: 'geometry',       stylers: [{ color: '#0d1225' }] },
    { featureType: 'transit.station',    elementType: 'labels.text.fill', stylers: [{ color: '#4a5168' }] },
    { featureType: 'administrative',     elementType: 'geometry',       stylers: [{ color: '#111828' }] },
    { featureType: 'administrative.country',     elementType: 'labels.text.fill', stylers: [{ color: '#4a5168' }] },
    { featureType: 'administrative.locality',    elementType: 'labels.text.fill', stylers: [{ color: '#8a91a8' }] },
    { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#4a5168' }] }
  ];
}

/* ─────────────────────────────────────────
   GOOGLE MAPS READY HOOK
───────────────────────────────────────── */

// When Google Maps API loads it fires window.onMapsReady (set in index.html).
// We override it here to run our init immediately.
const _prevMapsReady = window.onMapsReady;
window.onMapsReady = function() {
  if (typeof _prevMapsReady === 'function') _prevMapsReady();
  initMap();
};

// If Maps already loaded before this script (edge case), init immediately.
if (window.__MAPS_READY) initMap();

/* ─────────────────────────────────────────
   EXPORTS
───────────────────────────────────────── */
window.StadiumMap = {
  highlightSection,
  toggleLayer,
  routeTo,
  clearRoute
};
