# Prism Takeover Summary

Updated 2026-06-27 after the My Lens feature was implemented.

## Product

Prism refracts the same finance source material through five fixed investor
personas, then measures how much their directional reads disagree. The app has
three workspaces:

- **Today**: deterministically curates up to four market-moving articles, then
  asks the personas to react.
- **My Lens**: accepts one to three user-provided finance articles as pasted
  text or URLs, validates the first 1,500 characters, and runs valid articles
  through the same persona/divergence pipeline.
- **Time machine**: replays bundled historical market events.

The npm workspace contains `shared/`, `server/`, and `web/` packages. Core
commands are `npm run dev`, `npm test`, `npm run typecheck`, and
`npm run build`.

## Runtime

- Local secrets belong only in ignored `server/.env`.
- The active model is `openrouter/owl-alpha` through OpenRouter.
- The OpenRouter timeout is 480 seconds; raw responses are written to
  `server/logs/openrouter-raw-responses.log` with secrets redacted.
- Alpha Vantage is the primary market provider. Yahoo Finance provides the
  keyless quota fallback and RSS article pool.
- The dev API is `http://localhost:8787`; Vite chooses an available port.

## Daily Pipeline

1. `server/src/pipeline/neutralBriefing.ts` deterministically scores and
   curates article-backed key points. The neutral layer does not use an LLM.
2. `server/src/pipeline/generate.ts` starts five Owl Alpha persona calls in
   parallel. Each has compact JSON retries and provider-error backoff.
3. At a three-persona quorum, the pipeline waits another 60 seconds for late
   lenses. Below quorum, it still caches and serves the live article briefing;
   missing personas appear unavailable and can be retried in the app.
4. Divergence is computed deterministically from persona stance scores.
5. Daily content is cached under `server/cache/<requested-date>.json`.
6. Missing daily personas are disabled in the UI and can be retried in place.
   A retry has a 60-second UI/server deadline and merges a valid POV back into
   the cached day without regenerating articles.

## My Lens

Relevant files:

- `web/src/components/MyLensView.tsx`: one-to-three article editor, URL/text
  detection, 1,500-character indicator, per-entry validation status, and
  results rendering.
- `server/src/providers/articleReader.ts`: guarded HTTP(S) reader. It blocks
  credentials, localhost, private/non-public IPs, and validates every redirect;
  downloads at most 512 KB and parses HTML with `node-html-parser`.
- `server/src/pipeline/userArticles.ts`: truncation, deterministic finance-topic
  validation, key-point construction, and persona analysis.
- `server/src/store/myLensJobs.ts`: in-memory 30-minute jobs, progress state,
  preserved article validation results, and sanitized provider errors.
- `POST /api/my-lens/analyze`: accepts `{ articles: [{ id, value }] }` and
  returns HTTP 202 with a job id.
- `GET /api/my-lens/jobs/:jobId`: reports reading, validation, persona, and
  scoring progress, then returns per-entry statuses and any `DayContent` result.

Invalid entries do not block valid entries in the same request. My Lens is not
cached and currently waits up to 120 seconds after persona quorum to improve
the chance of returning all five lenses. User article text is explicitly
treated as untrusted source material in the persona system prompt.
OpenRouter 429 responses stop after one request per persona and surface a
specific rate-limit message instead of a generic internal error.

## Frontend Notes

- `Hero`, `KeyPointCard`, `CastStrip`, and `PersonaDrawer` are shared by all
  three workspaces.
- The divergence label has an accessible hover/focus/tap tooltip that explains
  the 0-to-1 index and interprets the current value.
- Missing persona cards never masquerade as neutral. Daily cards expose Retry;
  My Lens partial results currently show unavailable lenses without retry.
- My Lens drafts remain mounted and survive navigation between app tabs, but
  they are intentionally not persisted across a full page reload.

## API

- `GET /api/health`
- `GET /api/personas`
- `GET /api/day/latest`
- `POST /api/day/latest/personas/:personaId/retry`
- `GET /api/day/:date`
- `POST /api/my-lens/analyze`
- `GET /api/my-lens/jobs/:jobId`
- `GET /api/timemachine`
- `GET /api/timemachine/:id`

## Verification

At this handoff:

- `npm test`: 11 files, 57 tests passed.
- `npm run typecheck`: all workspaces passed.
- `npm run build`: all workspaces passed.
- `npm audit --omit=dev`: no production vulnerabilities.
- Browser checks covered invalid text, the three-article cap, URL mode, tab
  draft persistence, 390px layout, mixed valid/invalid submission, result
  rendering, and the live progress/error state for a Yahoo Finance URL.
- The exact Yahoo URL from the June 27 bug report was extracted and validated.
  OpenRouter was over its free-model quota, so the job preserved `VALID` for
  the article and returned the explicit rate-limit outcome in about four seconds.

## Known Limits

- The finance validator is deterministic keyword/context matching, not a
  classifier. It is intentionally conservative and only sees the first 1,500
  source characters.
- Some publishers block server-side article extraction or put useful content
  behind scripts/paywalls; those URLs return invalid/read errors.
- My Lens results are in-memory browser state and are not restored after reload.
- The active model can still return malformed JSON or upstream capacity errors. Retry,
  quorum, and unavailable states keep those failures explicit. Daily persona
  failures do not replace successfully curated live news with sample content.
- Today is keyed and displayed by the server's current local calendar date;
  provider quote data may still describe the previous market session.
