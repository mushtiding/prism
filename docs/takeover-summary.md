# Prism Takeover Summary

Last inspected during this handoff pass and updated after env-location cleanup.
This repo is mid-change; treat the current worktree as active user work.

## Product Shape

Prism is a once-daily market briefing app. It builds a neutral base layer of
market key points, then has five fixed investor personas react to those same
facts. The main product signal is divergence: where the personas disagree.

The repo is an npm workspace TypeScript monorepo:

- `shared/`: shared contract and constants, especially `DayContent`.
- `server/`: Express API, market/LLM generation pipeline, guardrails, cache,
  bundled sample data, and time-machine data.
- `web/`: React + Vite SPA that only renders API data.
- `docs/superpowers/specs/2026-06-10-prism-web-app-design.md`: original design
  plan. Some implementation details now drift from it.

Core scripts:

- `npm run dev`: concurrently starts server and web.
- `npm test`: server Vitest suite.
- `npm run typecheck`: shared, server, and web TypeScript checks.
- `npm run build`: builds all three workspaces.

## Current Architecture

API endpoints are defined in `server/src/routes.ts`:

- `GET /api/health`
- `GET /api/personas`
- `GET /api/day/latest`
- `GET /api/day/:date`
- `GET /api/timemachine`
- `GET /api/timemachine/:id`

Daily flow:

1. `latestTradingDay()` chooses the prior weekday, holidays ignored.
2. `getDay()` checks `server/cache/<date>.json`.
3. On cache miss, if live mode is unavailable, it serves bundled sample data.
4. In live mode, it creates `OpenRouterClient` and `ResilientMarketDataProvider`.
5. `generateDay()` fetches market data, asks the LLM for a neutral briefing,
   asks all five personas for POVs in parallel, then computes deterministic
   divergence.
6. Generated live content is cached under the requested date key.
7. Any generation/provider/guardrail failure falls back to sample data.

Shared contract details:

- `DayContent.source` is `"live"` or `"sample"` and drives the UI badge.
- `DayContent.kind` is `"daily"` or `"timeMachine"`.
- `KeyPoint.divergence` and `dayDivergence` are deterministic from persona
  stance scores, not an LLM judgment.
- Personas are fixed in `server/src/domain/personas.ts`.

Frontend shape:

- `web/src/App.tsx` loads personas, latest day, health, and time-machine catalog.
- Today and Time Machine reuse the same `Hero`, `KeyPointCard`, and `CastStrip`
  rendering paths.
- Persona details open in `PersonaDrawer`.
- `Habitat`, `PixelPet`, and `pixelPets.ts` add the current playful cast
  interaction layer.

## Dirty Worktree / WIP

Current WIP includes:

- Modified: `.env.example`
- Modified: `README.md`
- Modified: `server/src/config.ts`
- Modified: `server/src/index.ts`
- Modified: `server/src/pipeline/generate.ts`
- Modified: `server/src/providers/llm.ts`
- Modified: `server/src/providers/marketData.ts`
- Modified: `server/src/store/dailyStore.ts`
- Modified: `server/src/startup.ts`
- Modified: `web/src/App.tsx`
- Modified: `web/vite.config.ts`
- Untracked: `server/src/logger.ts`
- Untracked: `server/src/providers/resilientMarketData.ts`
- Untracked: `server/src/providers/yahooFinance.ts`

The WIP theme is "make live generation observable and more resilient":

- `server/src/logger.ts` adds a terminal status board, HTTP tracking, external
  API tracking, pipeline phase tracking, fallback reasons, and client URL
  capture.
- `server/src/config.ts` explicitly loads `server/.env`; this is now the
  authoritative local key file. A repo-root `.env` should not be needed.
- `server/src/startup.ts` logs startup diagnostics: cwd, `server/.env` presence,
  legacy root `.env` presence, key presence, bundled sample readiness,
  time-machine catalog, cache contents, and latest trading day.
- `server/src/index.ts` wires startup checks, status reporter, request tracking,
  and timestamped error logs.
- `server/src/providers/llm.ts` adds OpenRouter call labels, external-call
  tracking, a heartbeat log, optional reasoning, and
  `OPENROUTER_TIMEOUT_MS`.
- `server/src/config.ts` changes the default model from Nemotron Ultra with
  reasoning to `meta-llama/llama-3.2-3b-instruct:free` with reasoning `none`.
- `server/src/providers/marketData.ts` now spaces Alpha Vantage calls, classifies
  rate/auth/input errors, tries multiple NEWS_SENTIMENT calls, and can synthesize
  citable quote/mover headlines when news is unavailable.
- `server/src/providers/yahooFinance.ts` is a keyless fallback provider using
  Yahoo chart and RSS endpoints.
- `server/src/providers/resilientMarketData.ts` falls back to Yahoo only when
  Alpha Vantage hits quota/rate-limit errors.
- `server/src/store/dailyStore.ts` uses the resilient provider, records day
  outcomes, logs fallback reasons, and still serves bundled sample on failure.
- `server/src/pipeline/generate.ts` labels pipeline phases and LLM calls.
- `web/src/App.tsx` now shows "Sample data" if health says live but today's day
  is actually sample, which covers live-generation fallback.
- `web/vite.config.ts` uses `strictPort: false` so Vite can pick another port.

## Verification

These passed in the current worktree:

- `npm test`: 5 test files, 33 tests passed.
- `npm run typecheck`: shared, server, and web passed.
- `npm run build`: shared/server TypeScript builds and Vite production build
  passed.

No browser/dev-server smoke test was run in this pass.

## Important Hazards

- Real keys live in ignored `server/.env`. Do not print or commit this file.
- `.env.example` is sanitized and instructs people to copy it to `server/.env`.
- The stale root `.env` duplicate and `.oldnevexample` were removed during the
  env cleanup. If they reappear, treat them as likely local/secret artifacts.
- README and the design doc are stale on default model/reasoning. They still
  mention Nemotron Ultra + medium reasoning in some places, but current config
  defaults to Llama 3.2 free + no reasoning. README's env-location instructions
  have been updated.
- Live mode still requires both `OPENROUTER_API_KEY` and
  `ALPHAVANTAGE_API_KEY`. Yahoo is not a general no-key market-data mode; it is
  only reached after Alpha Vantage quota/rate-limit errors.
- The pipeline now publishes a live day with a quorum of 3 of 5 personas. The
  spec says exactly one POV per persona. The UI mostly tolerates missing POVs,
  but cast cards can still render for missing personas and clicking one will
  not open a drawer. This needs a product/UI decision.
- `recordDayStarted(date)` is called even when a request merely joins an
  existing in-flight generation. That may make the status board's "started"
  time look newer than the actual generation start.
- `clearPipeline()` is called both inside `generateDay()` and in `getDay()`'s
  finally block. It appears harmless but can make pipeline status timing less
  precise.
- Yahoo Finance provider and Alpha Vantage fallback behavior have no dedicated
  tests yet. Existing tests cover divergence, guardrails, JSON extraction,
  latest trading day, and generation quorum behavior.
- Cache files are written under the requested date, but the returned
  `DayContent.date` may come from the provider's trading day. This is intentional
  per comments, but can still confuse date display/debugging on holidays or
  manual date requests.

## Likely Next Steps

1. Decide whether to commit the observability/resilience WIP as the new baseline.
2. Avoid committing any real key; keep secrets only in ignored `server/.env`.
3. Update the design doc for current defaults, timeout env, and Yahoo
   fallback semantics.
4. Decide whether quorum-based persona publication is acceptable; if yes, update
   spec/UI copy and disable missing-persona cards.
5. Add tests for provider fallback and the live-vs-sample badge behavior.
6. Run a browser smoke test with `npm run dev` once env behavior is settled.
