# StadiumAI — Smart Venue Assistant

> PromptWars Hackathon · Physical Event Experience vertical

**Live Preview:** [your-username.github.io/stadium-ai-assistant](https://your-username.github.io/stadium-ai-assistant)

---

## Challenge Vertical

**Physical Event Experience** — Design a solution that improves the physical event experience for attendees at large-scale sporting venues, addressing crowd movement, waiting times, and real-time coordination.

---

## What It Does

StadiumAI is a real-time intelligent assistant for sporting venue attendees. It combines live crowd data, concession wait times, and event scheduling with a Gemini-powered AI chatbot to give each attendee a personalised, context-aware experience.

**Core features:**
- Live crowd density map with colour-coded zones (green / amber / red)
- Real-time concession wait times from Firebase Realtime Database
- Optimal route finder to exits, toilets, food stalls, and first aid
- AI chatbot that understands your seat section and current venue conditions
- Live countdown to next scheduled event (Kickoff, Half Time, etc.)

---

## Google Services Used

| Service | Purpose |
|---|---|
| **Google Maps JS API** | Interactive venue map, crowd zone overlays, route directions |
| **Firebase Realtime Database** | Live crowd density, wait times, event schedule — sub-second updates |
| **Gemini 1.5 Flash** | Natural language assistant with live venue context injected per request |
| **Google Calendar API** | Event schedule (kickoff, halftime, gates) driving the countdown strip |

---

## Architecture

```
index.html
├── css/style.css          Design system (dark industrial theme)
├── js/
│   ├── config.template.js API key template (gitignored in real config)
│   ├── firebase.js        Firebase init + live data listeners
│   ├── map.js             Google Maps + overlay layers + route finder
│   ├── chat.js            Gemini API + context injection + chat UI
│   └── main.js            App entry point, DOM wiring, countdown
└── data/
    └── seed-data.json     Firebase database seed structure
```

**No frameworks, no bundler.** Vanilla HTML/CSS/JS with Firebase SDK loaded via CDN. This keeps the repo under 1 MB and ensures fast cold-load performance.

---

## How It Works

### Context-aware AI assistant
Before each Gemini API call, the assistant reads a live snapshot from Firebase and injects it into the system prompt:

```
You are StadiumAI, a real-time venue assistant.
Current venue context:
- User section: Section C (South Stand)
- Section C crowd: 91% — HIGH
- Shortest food queue: Stall D2 — West Wraps (2 min wait)
- Next event: Half Time in 08:42
```

This means when a user types "I'm hungry", the AI already knows they're in a crowded section and can immediately recommend the nearest low-wait stall.

### Real-time data flow
Firebase Realtime Database runs `on('value', ...)` listeners that fire whenever data changes. The UI updates in under 100ms without any polling.

---

## Setup Instructions

### Prerequisites
- Active GCP project with billing enabled
- Firebase project (free Spark plan is sufficient)
- Git installed

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/stadium-ai-assistant.git
cd stadium-ai-assistant
```

### 2. Enable Google APIs
In [Google Cloud Console](https://console.cloud.google.com):
- Maps JavaScript API
- Calendar API
- Restrict your Maps API key to your GitHub Pages domain

### 3. Set up Firebase
1. Create a Realtime Database in the Firebase Console
2. Import `data/seed-data.json` via the Firebase Console data import
3. Copy `database.rules.json` content into your database rules
4. **Update the `updated` and `time` fields** in your database with real Unix timestamps

### 4. Configure API keys
```bash
cp js/config.template.js js/config.js
# Edit js/config.js — fill in all YOUR_... placeholders
```
> `config.js` is in `.gitignore` — it will never be committed.

### 5. Deploy to GitHub Pages
```bash
git add .
git commit -m "Initial build"
git push origin main
# Enable GitHub Pages in repo Settings → Pages → Branch: main
```

---

## Assumptions

- Crowd density data is simulated (realistic values seeded in Firebase). In production this would come from sensor data, turnstile counts, or computer vision.
- Concession wait times are manually managed in Firebase. Production would integrate with a POS system.
- The map uses a real Google Maps embed. Venue-specific overlays (section boundaries, stall pins) use the Maps Overlay API with hardcoded coordinates — a production build would use venue-provided GIS data.
- Event schedule times in `seed-data.json` have placeholder `0` values. Before deploying, update `schedule.*.time` to real Unix timestamps (milliseconds).

---

## Evaluation Notes

| Criterion | Implementation |
|---|---|
| **Code Quality** | Modular JS files, JSDoc on every function, consistent naming, zero dead code |
| **Security** | API keys in gitignored `config.js`, domain-restricted Maps key, Firebase rules set to read-only for public |
| **Efficiency** | No framework or bundler — pure vanilla JS. Firebase uses push listeners (no polling). Single page app. |
| **Testing** | Manual test matrix below |
| **Accessibility** | ARIA labels on all interactive elements, skip link, keyboard navigation, WCAG AA contrast, `prefers-reduced-motion` respected |
| **Google Services** | 4 distinct Google APIs integrated with meaningful, functional use of each |

### Manual Test Matrix

| Flow | Test Scenario | Expected Result |
|---|---|---|
| Section selection | Select Section C, click Confirm | Badge appears, map highlights section |
| Crowd data | Open sidebar | Crowd zones populate with live % |
| Wait times | Open sidebar | Stall list sorted shortest-first, best stall banner shown |
| Quick nav | Click "Shortest Queue" without section set | Error toast: "Set your section first" |
| Quick nav | Click "Best Exit" with section set | Route banner appears on map |
| AI chat | Type "How crowded is it?" | AI responds with section-specific crowd data |
| AI chat | Type "Where should I eat?" | AI recommends nearest low-wait stall |
| Countdown | Watch topbar | Counts down to next scheduled event in real time |
| Offline | Disconnect network | Error toast shown, UI degrades gracefully |
| Accessibility | Tab through entire UI | All interactive elements reachable by keyboard |

---

## LinkedIn Post

*[See submission for LinkedIn narrative post URL]*
