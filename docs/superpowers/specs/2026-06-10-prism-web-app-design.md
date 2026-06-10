# Prism — Web App Design

**Date:** 2026-06-10
**Status:** Approved, ready for implementation planning
**Source spec:** `SPEC.md` (functional requirements)

This document is the *implementation design* for the Prism web app. It assumes the
functional spec in `SPEC.md` and records the technical decisions locked during
brainstorming.

---

## 1. Locked decisions

| Decision | Choice |
|---|---|
| Content source | **Live LLM + market feed** (real generation pipeline) |
| Frontend stack | **React + Vite + TypeScript** (SPA) |
| Backend | **Node + Express + TypeScript**, on-demand daily JSON cache |
| Cast size | **Full 5 personas** (Momentum, Growth bull, Value/quality, Macro/risk, Contrarian) |
| Feature scope | **MVP (FR-1,2,3,4,6,9,10,11) + FR-8 Time Machine** |
| LLM access | **OpenRouter via the OpenAI SDK** (`baseURL=https://openrouter.ai/api/v1`, `OPENROUTER_API_KEY`) |
| Default model | **`nvidia/nemotron-3-ultra-550b-a55b:free`** with `reasoning` effort; env-configurable |
| Market data | **Alpha Vantage** (`ALPHAVANTAGE_API_KEY`) |
| Divergence calc | **Structured per-keypoint stance + deterministic math** (no LLM judge) |
| Market scope | **US equities**; divergence computed **per-day AND per-keypoint** |
| Failure / no-keys behavior | **Graceful fallback to a bundled sample day**, clearly flagged |
| Design language | **Uber-style monochrome** — black / white / gray ramp, no red-green |

Notes that shape implementation:
- `:free` OpenRouter models are rate-limited and some require a small account credit
  balance to unlock higher daily caps. Once-daily generation is ~6 calls/day, well
  within limits. Live mode depends on the configured account being allowed to call
  free models.
- Nemotron-3 **Ultra** does *not* expose native `response_format`/structured outputs
  (only the smaller `super-120b` sibling does). Structured stance data is obtained via
  a strict prompted JSON block + parse-with-repair, not native schema enforcement.

---

## 2. Repository layout

Single repo, three TypeScript units:

```
prism/
  shared/      Types shared by server + web (DayContent, KeyPoint, PersonaPOV, Stance, Divergence, PersonaDef)
  server/      Express API, generation pipeline, daily cache, sample/time-machine day files, persona defs
  web/         React SPA (Uber monochrome UI)
  docs/        This design doc + future plans
```

The frontend never calls OpenRouter or Alpha Vantage directly. It only calls the Prism
API and renders the `DayContent` it receives. This keeps API keys server-side and
guarantees all users see identical daily content (FR-9).

---

## 3. Shared data model (`shared/`)

The single contract between server and web. (Field names indicative, not final.)

```ts
type StanceLabel = "bullish" | "neutral" | "bearish";

interface Source {
  title: string;
  publisher: string;
  url: string;
}

interface KeyPoint {
  id: string;              // stable within a day, referenced by stances
  summary: string;         // flat, non-evaluative, ≤ ~40 words (FR-1)
  detail: string;          // expandable detail (FR-6)
  magnitude?: string;      // e.g. "+9% after hours"
  sources: Source[];       // ≥1 citable source (FR-1)
  divergence: Divergence;  // per-keypoint divergence (FR-4, §9.3)
}

interface Stance {
  keyPointId: string;
  label: StanceLabel;
  score: number;           // -2..+2 conviction (bear..bull)
  rationale?: string;      // short, optional
}

interface PersonaPOV {
  personaId: string;
  text: string;            // ≤200 words, plain English (FR-2)
  activeBias: string;      // the bias lens applied today (FR-3)
  stances: Stance[];       // one per key point (drives divergence)
}

interface Divergence {
  score: number;           // 0..1 normalized disagreement
  level: "consensus" | "mixed" | "contested";
  spread: number;          // raw stat (e.g. stddev of scores)
  // optional: min/max persona ids for "who splits" UI
}

interface PersonaDef {     // durable input (FR-3, FR-9), static in repo
  id: string;
  name: string;
  horizon: "short" | "long" | "origin";
  risk: "defensive" | "neutral" | "aggressive";
  biases: string[];
  worldview: string;       // one-line
  overweights: string[];
  underweights: string[];
  voice: string;           // tone guidance for generation
}

interface DayContent {
  date: string;            // trading session date, ISO (YYYY-MM-DD)
  kind: "daily" | "timeMachine";
  source: "live" | "sample";   // for UI badge (FR-9 / fallback)
  title?: string;              // time-machine event label
  keyPoints: KeyPoint[];       // 3–6 (FR-1)
  povs: PersonaPOV[];          // one per persona (FR-2)
  dayDivergence: Divergence;   // headline takeaway (FR-4)
  generatedAt: string;         // ISO timestamp
  disclaimer: string;          // FR-10 framing text
}
```

`PersonaDef[]` is exposed via its own endpoint so the persona-detail view (FR-3) can
render full definitions independent of any given day.

---

## 4. Backend (`server/`)

### 4.1 API surface
- `GET /api/day/latest` → `DayContent` for the most recent trading day.
- `GET /api/day/:date` → `DayContent` for a specific date (used by history).
- `GET /api/personas` → `PersonaDef[]` (full cast definitions for FR-3).
- `GET /api/timemachine` → list of available historical events (id, label, date).
- `GET /api/timemachine/:id` → `DayContent` (`kind: "timeMachine"`) for a curated event.
- `GET /api/health` → key presence + mode (live/sample) for diagnostics.

### 4.2 Once-daily cache (FR-9, latency NFR)
1. Request for a trading day → check dated cache file `server/cache/<date>.json`.
2. **Cache hit → serve immediately** (no per-session generation wait).
3. Cache miss → run the generation pipeline **once**, write the cache, then serve.
4. Concurrent misses for the same day **await a single in-flight promise** — never
   double-generate.
5. Any failure (missing keys, provider error, guardrail giving up) → serve the
   **bundled sample day**, with `source: "sample"`.

"Latest trading day" = most recent weekday (US-market calendar approximation; holidays
are acceptable imperfection for this phase since fallback covers empty data).

### 4.3 Generation pipeline
```
Alpha Vantage ─▶ [1] Neutral briefing  ─▶ base layer (3–6 key points + sources)
                                              │  (same base layer fed to all personas)
                 ┌────────────┬────────────┬──┴─────────┬─────────────┐
                 ▼            ▼            ▼             ▼             ▼
            [2] Momentum   Growth      Value/Q     Macro/Risk    Contrarian   (5 parallel LLM calls)
                 │  each returns: POV (≤200w, plain English, activeBias) + stance[] per key point
                 ▼
            [3] Deterministic divergence math (TypeScript, no LLM) → per-keypoint + day-level
```

- **Step 1 — neutral briefing.** Fetch US-equity daily quotes + market/company news
  (Alpha Vantage `NEWS_SENTIMENT` + quote/top-movers endpoints). One LLM call converts
  raw data into a flat, non-evaluative briefing of 3–6 key points; sources attached from
  the news payload. Stable `id` assigned per key point.
- **Step 2 — persona POVs.** Five calls (parallelizable). Each receives the *same* base
  layer plus that persona's fixed `PersonaDef`. Returns the ≤200-word POV, the named
  `activeBias`, and a structured `stances[]` (one per key point) via a strict prompted
  JSON block (parse-with-repair; one retry on malformed JSON).
- **Step 3 — divergence (deterministic).** For each key point: take the five conviction
  scores (−2..+2), compute spread (stddev), normalize to 0..1, classify
  consensus/mixed/contested. Day-level divergence aggregates across key points. No LLM
  in this step → transparent and reproducible (the headline output, FR-4).

### 4.4 Provider abstraction (FR-9 model-agnostic)
- `LlmClient` — thin interface `generate(messages, opts) -> { text, reasoning? }`,
  implemented with the OpenAI SDK pointed at OpenRouter. Model id, `reasoning` effort,
  temperature read from env. Swappable.
- `MarketDataProvider` — interface returning normalized quotes + news; Alpha Vantage
  implementation. Swappable.

### 4.5 Guardrails (FR-11), enforced in-pipeline
- **Neutral-tone check** on the briefing: loaded-verb blocklist ("soared", "plunged",
  "fears", etc.) + validation pass; regenerate once if it trips.
- **Length / readability check** per POV: enforce ≤200 words; regenerate once if over.
  Plain-English bias via prompt + simple checks.
- **Grounding check**: every stance must reference an existing `keyPointId`; reject
  invented events.
- **No-advice check**: blocklist scan for concrete "buy/sell/hold <security>"
  instructions in persona output (FR-10).
- If a guardrail can't be satisfied after its single retry, fall back to the sample day
  for that run.

### 4.6 Personas (static, version-controlled)
`server/personas/*.ts` — one `PersonaDef` each for the full cast of 5, matching
`SPEC.md` §3. These are durable inputs; only the daily base layer changes (FR-9).

### 4.7 Time Machine (FR-8)
Curated historical events stored as pre-written `DayContent` files
(`kind: "timeMachine"`) in `server/timemachine/`, reusing the exact same data shape — so
the UI renders them with zero special-casing. Works fully offline (no live data needed),
useful for demos/onboarding.

### 4.8 Bundled sample day
`server/sample/sample-day.json` — a complete, realistic `DayContent` including the
Appendix A chipmaker example (high divergence). Served whenever live generation is
unavailable, badged `source: "sample"`.

---

## 5. Frontend (`web/`) — Uber monochrome UI

### 5.1 Design language
- **Palette:** true monochrome — near-black `#000`, white, and a gray ramp. **No
  red/green.** Stance and divergence are encoded by **position, weight, and grayscale**,
  never hue (also avoids implying advice). The bear↔bull axis is a horizontal scale;
  persona dots sit on it; **divergence = the spread of the dots**.
- **Type:** clean grotesque sans (Inter / system stack as an Uber-Move stand-in), tight
  high-contrast hierarchy, generous whitespace, hairline dividers.
- Polished micro-interactions (expand/collapse, dots settling into position) — applied
  at implementation time via the frontend-design + make-interfaces-feel-better skills.

### 5.2 Screens
1. **Today**
   - Session date + `source` badge if sample.
   - **Divergence headline** (hero) — the day's takeaway: how split the cast is (FR-4).
   - Briefing key points (FR-1): each shows its flat summary + a mini per-keypoint
     divergence axis; **tap to expand** → detail + sources (FR-6).
   - Persistent **"lenses, not advice"** disclaimer (FR-10).
2. **Cast / persona POVs**
   - The five personas; **tap a persona** → its ≤200-word POV for the day (FR-6),
     the `activeBias` chip, and a link to the full definition (FR-3).
3. **Persona detail** (FR-3) — worldview, horizon, risk, named biases, over-/under-
   weights, today's active bias lens.
4. **Time Machine** (FR-8) — pick a historical event → the cast reacts (same views).

### 5.3 Data fetching
Single API client; fetch `DayContent` once per view; render from the shared types. No
client-side generation. App opens to ready (cached) content with no wait (NFR latency).

---

## 6. Testing & verification
- **Type contract:** `shared` types compile-checked by both server and web.
- **Pipeline unit tests:** divergence math against fixed score sets; guardrail checks
  (tone blocklist, ≤200 words, grounding, no-advice) against fixtures.
- **Fallback test:** with no keys set, API serves the sample day (`source: "sample"`).
- **Cache test:** second request for a day does not re-run generation (in-flight promise
  + dated file).
- **E2E smoke (Playwright):** Today, Cast→POV, Persona detail, Time Machine all render
  monochrome content from the API.
- **Definition of done:** app opens to ready content; with keys set, live generation
  produces a valid `DayContent`; without keys, sample day renders; all guardrails pass on
  fixtures.

---

## 7. Out of scope (this build)
Per `SPEC.md` §7 plus: FR-5 track record, FR-7 onboarding/"your lens", FR-6 follow-up
Q&A — all deferred. No accounts, notifications, monetization, real-money/portfolio, or
intraday updates.

---

## 8. Environment / config
```
OPENROUTER_API_KEY        # enables live LLM generation
OPENROUTER_MODEL          # default: nvidia/nemotron-3-ultra-550b-a55b:free
OPENROUTER_REASONING      # reasoning effort (e.g. "low"/"medium"/"high")
ALPHAVANTAGE_API_KEY      # enables live market data
PORT                      # server port
```
With either key absent → graceful sample-day fallback (still fully usable for demos).
