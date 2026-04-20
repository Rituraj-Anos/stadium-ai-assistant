/**
 * chat.js — Gemini AI Chat Module
 *
 * Responsibilities:
 *  - Render the chat panel UI (open/close, messages, chips)
 *  - Build context-rich system prompts from live Firebase data
 *  - Call Gemini 1.5 Flash API with full venue context per request
 *  - Handle intent detection and surface quick-action responses
 *  - Display typing indicator and stream responses
 *
 * Depends on: config.js (APP_CONFIG), firebase.js (StadiumFirebase)
 *
 * @module chat
 */

/* ─────────────────────────────────────────
   STATE
───────────────────────────────────────── */

/** User's confirmed section (set by main.js via setSection()) */
let _userSection     = null;
let _userSectionName = null;

/** Conversation history for multi-turn context (last 10 turns max) */
const _history = [];
const MAX_HISTORY = 10;

/* ─────────────────────────────────────────
   INITIALIZATION
───────────────────────────────────────── */

/**
 * Initialize the chat module. Wire all UI events and show welcome message.
 * Called from main.js after DOM is ready.
 */
function initChat() {
  wireChatToggle();
  wireSendForm();
  wireChips();
  showWelcome();
  console.log('[chat] Initialized ✓');
}

/* ─────────────────────────────────────────
   UI WIRING
───────────────────────────────────────── */

function wireChatToggle() {
  const fab       = document.getElementById('chat-fab');
  const panel     = document.getElementById('chat-panel');
  const closeBtn  = document.getElementById('chat-close-btn');

  if (!fab || !panel || !closeBtn) return;

  fab.addEventListener('click', () => {
    const isOpen = !panel.hidden;
    panel.hidden = isOpen;
    fab.setAttribute('aria-expanded', (!isOpen).toString());

    if (!isOpen) {
      // Focus the input when opening
      const input = document.getElementById('chat-input');
      if (input) setTimeout(() => input.focus(), 100);
    }
  });

  closeBtn.addEventListener('click', () => {
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    fab.focus();
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.hidden) {
      panel.hidden = true;
      fab.setAttribute('aria-expanded', 'false');
    }
  });
}

function wireSendForm() {
  const form  = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');

  if (!form || !input) return;

  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendMessage(text);
  });
}

function wireChips() {
  const chips = document.querySelectorAll('.chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      if (prompt) sendMessage(prompt);

      // Open panel if closed
      const panel = document.getElementById('chat-panel');
      if (panel && panel.hidden) {
        panel.hidden = false;
        const fab = document.getElementById('chat-fab');
        if (fab) fab.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

/* ─────────────────────────────────────────
   WELCOME MESSAGE
───────────────────────────────────────── */

function showWelcome() {
  const venueName = window.APP_CONFIG && window.APP_CONFIG.app
    ? window.APP_CONFIG.app.venueName
    : 'the venue';

  appendMessage('ai', `Hi! I'm your AI assistant for ${venueName}. I have live data on crowd levels, wait times, and the event schedule — just ask me anything.\n\nTry: "Where should I eat?" or "How crowded is it near me?"`);
}

/* ─────────────────────────────────────────
   SEND MESSAGE
───────────────────────────────────────── */

/**
 * Handle a user message: add to UI, build context, call Gemini.
 * @param {string} text  User's message
 */
async function sendMessage(text) {
  if (!text.trim()) return;

  // Show user message
  appendMessage('user', text);
  scrollToBottom();

  // Disable input while waiting
  setInputEnabled(false);

  // Show typing indicator
  const typingId = showTyping();

  try {
    const reply = await callGemini(text);

    // Translate the reply if user has selected a non-English language
    const targetLang = getSelectedLanguage();
    const finalReply = (targetLang && targetLang !== 'en')
      ? await translateText(reply, targetLang)
      : reply;

    removeTyping(typingId);
    appendMessage('ai', finalReply);
  } catch (err) {
    removeTyping(typingId);
    console.error('[chat] Gemini error:', err);
    const friendlyMsg = typeof StadiumErrors !== 'undefined'
      ? StadiumErrors.friendlyGeminiError(err)
      : 'Sorry, I couldn\'t reach the AI right now. Please try again in a moment.';
    appendMessage('ai', friendlyMsg);
  } finally {
    setInputEnabled(true);
    scrollToBottom();
    const input = document.getElementById('chat-input');
    if (input) input.focus();
  }
}

/* ─────────────────────────────────────────
   GEMINI API CALL
───────────────────────────────────────── */

/**
 * Calls the Gemini 1.5 Flash API with a context-rich system prompt.
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function callGemini(userMessage) {
  const cfg = window.APP_CONFIG;
  if (!cfg || !cfg.geminiApiKey || cfg.geminiApiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    return buildOfflineReply(userMessage);
  }

  // Build live context snapshot
  const snapshot    = await StadiumFirebase.getLiveSnapshot();
  const systemPrompt = buildSystemPrompt(snapshot);

  // Add to history
  _history.push({ role: 'user', parts: [{ text: userMessage }] });
  if (_history.length > MAX_HISTORY * 2) _history.splice(0, 2);

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiModel || 'gemini-1.5-flash'}:generateContent?key=${cfg.geminiApiKey}`;

  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: _history,
    generationConfig: {
      temperature:     0.7,
      maxOutputTokens: 300,
      topP:            0.9
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
    ]
  };

  const response = await (typeof StadiumErrors !== 'undefined'
    ? StadiumErrors.withTimeout(
        fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        10000, 'Gemini API'
      )
    : fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`Gemini API ${response.status}: ${errData.error?.message || response.statusText}`);
  }

  const data  = await response.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'I couldn\'t generate a response. Please try again.';

  // Add assistant reply to history
  _history.push({ role: 'model', parts: [{ text: reply }] });

  return reply;
}

/* ─────────────────────────────────────────
   SYSTEM PROMPT BUILDER
   This is the core intelligence injection.
───────────────────────────────────────── */

/**
 * Builds a detailed system prompt with live venue context.
 * The richer this is, the smarter the AI's answers will be.
 *
 * @param {import('./firebase.js').LiveSnapshot} snapshot
 * @returns {string}
 */
function buildSystemPrompt(snapshot) {
  const cfg        = window.APP_CONFIG && window.APP_CONFIG.app;
  const venueName  = cfg ? cfg.venueName : 'the venue';
  const section    = _userSection     || 'unknown';
  const sectionName = _userSectionName || 'not set';

  // Format crowd data
  const crowdLines = snapshot.crowd
    ? Object.entries(snapshot.crowd)
        .map(([id, d]) => `  - ${d.name || id}: ${d.pct}% (${d.pct < 40 ? 'LOW' : d.pct < 70 ? 'MODERATE' : 'HIGH'})`)
        .join('\n')
    : '  - Data unavailable';

  // Format concession data
  const stallLines = snapshot.concessions
    ? Object.values(snapshot.concessions)
        .filter(s => s.isOpen !== false)
        .sort((a, b) => a.waitMin - b.waitMin)
        .map(s => `  - ${s.name}: ${s.waitMin} min wait (near Section ${s.section})`)
        .join('\n')
    : '  - Data unavailable';

  // Format next event
  const nextEventStr = snapshot.nextEvent
    ? `${snapshot.nextEvent.label} in ${msToCountdown(snapshot.nextEvent.time - Date.now())}`
    : 'No upcoming events';

  // Best stall
  const bestStallStr = snapshot.bestStall
    ? `${snapshot.bestStall.name} — only ${snapshot.bestStall.waitMin} min wait (near Section ${snapshot.bestStall.section})`
    : 'All queues similar length';

  return `You are StadiumAI, a real-time smart assistant for sports venue attendees at ${venueName}.
Your job is to help fans navigate the venue, avoid crowds, find food, and stay informed — all based on live data.

ATTENDEE CONTEXT:
- User's section: ${sectionName} (Section ${section})
- Their section crowd level: ${getSectionCrowd(section, snapshot.crowd)}

LIVE CROWD DENSITY (right now):
${crowdLines}

CONCESSION STALL WAIT TIMES (sorted by wait, shortest first):
${stallLines}
- Best recommendation: ${bestStallStr}

NEXT EVENT:
- ${nextEventStr}

VENUE FACILITIES:
- Exits: North (Gates 1-4), East (Gates 5-8), South (Gates 9-12), West (Gates 13-16)
- First Aid: North Stand area, South Stand area, Pitch-side Medical
- Toilets: Available in all sections, upper tier, VIP area

RESPONSE RULES:
1. Keep answers SHORT and DIRECT — 2-3 sentences max. People are at a live event.
2. Always recommend based on the user's section and current crowd/wait data.
3. For navigation, name the specific stall, exit, or facility and say approx walking time.
4. If asked about a section, use the real crowd percentages above.
5. If asked what to do, prioritise low-crowd areas and shortest queues.
6. Be friendly and enthusiastic — this is a sports event!
7. Never make up data. If you don't have the answer, say so.`;
}

/* ─────────────────────────────────────────
   OFFLINE FALLBACK (no API key)
───────────────────────────────────────── */

/**
 * Returns a smart static reply when Gemini API isn't configured.
 * Used during development or when the key isn't set.
 * @param {string} msg
 * @returns {Promise<string>}
 */
async function buildOfflineReply(msg) {
  const snapshot = await StadiumFirebase.getLiveSnapshot().catch(() => ({}));
  const q        = msg.toLowerCase();

  if (q.includes('eat') || q.includes('food') || q.includes('hungry') || q.includes('queue')) {
    const best = snapshot.bestStall;
    return best
      ? `Your best option right now is ${best.name} — only ${best.waitMin} min wait (near Section ${best.section}). Head there while it's quiet!`
      : 'Check the wait times panel on the left — it shows live queue lengths for all open stalls.';
  }

  if (q.includes('crowd') || q.includes('busy') || q.includes('packed')) {
    const section = _userSection;
    return section
      ? `I'm checking your section now. The crowd panel on the left shows live percentages for every stand.`
      : 'Set your section first (use the dropdown on the left) and I can give you specific crowd info!';
  }

  if (q.includes('exit') || q.includes('leave') || q.includes('out')) {
    return 'Use the Quick Navigate panel → "Best Exit" to get a route based on your section. It picks the least crowded gate automatically.';
  }

  if (q.includes('halftime') || q.includes('half time') || q.includes('when')) {
    return 'The countdown strip at the top of the page shows the exact time until the next event. Check it for live timing!';
  }

  if (q.includes('toilet') || q.includes('bathroom') || q.includes('restroom')) {
    return 'Tap "Nearest Toilet" in the Quick Navigate panel and the map will route you to the closest facilities from your section.';
  }

  return `I'm ready to help! Set your section in the left panel and I can give you personalised recommendations based on live crowd and wait time data. (Note: add your Gemini API key to config.js for full AI responses.)`;
}

/* ─────────────────────────────────────────
   GOOGLE CLOUD TRANSLATION API (5th Google Service)
───────────────────────────────────────── */

/**
 * Translates text using the Google Cloud Translation API (v2 / Basic).
 * Enables non-English speakers to receive AI responses in their language.
 * Uses the same Maps API key as other Google services in the project.
 *
 * @param {string} text        - Text to translate.
 * @param {string} targetLang  - BCP-47 language code (e.g. 'hi', 'es', 'fr').
 * @returns {Promise<string>}   Translated text, or original on error.
 */
async function translateText(text, targetLang = 'en') {
  if (!text || targetLang === 'en') return text;

  const cfg = window.APP_CONFIG;
  if (!cfg || !cfg.mapsApiKey || cfg.mapsApiKey === 'YOUR_MAPS_API_KEY_HERE') {
    // Key not configured — return original text silently
    return text;
  }

  const url = `https://translation.googleapis.com/language/translate/v2?key=${cfg.mapsApiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q:      text,
        target: targetLang,
        format: 'text'
      })
    });

    if (!response.ok) {
      console.warn('[chat] Translation API error:', response.status);
      return text; // Graceful fallback to original text
    }

    const data = await response.json();
    return data?.data?.translations?.[0]?.translatedText || text;
  } catch (err) {
    console.warn('[chat] Translation failed, using original:', err.message);
    return text; // Always degrade gracefully
  }
}

/**
 * Reads the currently selected language code from the chat language selector.
 * @returns {string} BCP-47 language code (e.g. 'en', 'hi', 'es').
 */
function getSelectedLanguage() {
  const select = document.getElementById('chat-lang');
  return select ? select.value : 'en';
}

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */

/**
 * Gets crowd level string for a specific section from snapshot data.
 * @param {string} sectionId  Section letter e.g. 'A'
 * @param {Object} crowdData
 * @returns {string}
 */
function getSectionCrowd(sectionId, crowdData) {
  if (!crowdData) return 'Unknown';
  const sectionToZone = {
    A: 'north_stand', B: 'east_stand', C: 'south_stand',
    D: 'west_stand',  E: 'upper_tier', F: 'vip_section'
  };
  const zoneKey = sectionToZone[sectionId];
  const zone = zoneKey && crowdData[zoneKey];
  if (!zone) return 'Unknown';
  return `${zone.pct}% (${zone.pct < 40 ? 'LOW' : zone.pct < 70 ? 'MODERATE' : 'HIGH'})`;
}

/**
 * Converts milliseconds to a MM:SS or H:MM:SS countdown string.
 * @param {number} ms
 * @returns {string}
 */
function msToCountdown(ms) {
  if (ms <= 0) return 'NOW';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

/* ─────────────────────────────────────────
   DOM HELPERS
───────────────────────────────────────── */

/**
 * Append a message bubble to the chat.
 * @param {'ai'|'user'} role
 * @param {string} text
 */
function appendMessage(role, text) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const div = document.createElement('div');
  div.className = `msg msg--${role}`;

  const avatarHtml = role === 'ai'
    ? `<span class="msg__avatar" aria-hidden="true">AI</span>`
    : '';

  div.innerHTML = `
    ${avatarHtml}
    <div class="msg__bubble">${escHtml(text).replace(/\n/g, '<br>')}</div>
  `;

  container.appendChild(div);
}

/**
 * Show a typing indicator.
 * @returns {string} ID of the indicator element (for removal)
 */
function showTyping() {
  const container = document.getElementById('chat-messages');
  if (!container) return 'typing';

  const id  = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.id        = id;
  div.className = 'msg msg--ai';
  div.innerHTML = `
    <span class="msg__avatar" aria-hidden="true">AI</span>
    <div class="typing-indicator" role="status" aria-label="AI is typing">
      <span></span><span></span><span></span>
    </div>
  `;
  container.appendChild(div);
  scrollToBottom();
  return id;
}

/**
 * Remove a typing indicator.
 * @param {string} id
 */
function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

function setInputEnabled(enabled) {
  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (input)   input.disabled   = !enabled;
  if (sendBtn) sendBtn.disabled = !enabled;
}

/**
 * Escapes HTML for safe text insertion.
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
window.StadiumChat = {
  init: initChat,
  /**
   * Update the user's current section (called by main.js after section confirmation).
   * @param {string} sectionId   e.g. 'A'
   * @param {string} sectionName e.g. 'Section A (North Stand)'
   */
  setSection(sectionId, sectionName) {
    _userSection     = sectionId;
    _userSectionName = sectionName;
    // Update status text in chat header
    const statusEl = document.getElementById('chat-status-text');
    if (statusEl) statusEl.textContent = `${sectionName} · Gemini`;
  }
};
