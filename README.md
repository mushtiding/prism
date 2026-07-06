# Prism

> See where market views split.

Prism is a daily market app that shows where deliberately biased perspectives
agree and disagree on the same evidence. It stacks two layers on the same facts:

1. **The neutral base layer** — a flat, source-attributed account of what moved
   markets on the previous trading day.
2. **The perspective layer** — a fixed cast of five investor archetypes, each a
   distinct and deliberately *biased* view, reacting to that base layer in
   character.

Prism calculates a deterministic **disagreement score** for each brief and
market driver so readers can quickly find where the perspectives split.

See [`SPEC.md`](./SPEC.md) for the functional spec and
[`docs/superpowers/specs/`](./docs/superpowers/specs/) for the implementation
design.

## Architecture

A TypeScript monorepo (npm workspaces):

```
shared/   Types shared by server + web (the DayContent contract)
server/   Express API · generation pipeline · daily cache · sample/time-machine data
web/      React + Vite SPA (Uber-style monochrome UI)
```

The frontend only ever calls the Prism API and renders the `DayContent` it gets
back — API keys stay server-side, and all users see identical daily content.

**Daily content flow:** a request for a trading day serves a dated JSON cache if
present; on a miss it runs the pipeline once (market data → neutral briefing →
5 persona POVs in parallel → deterministic divergence math), caches the result,
and serves it. Persona failures leave retryable unavailable lenses on the live
briefing; failures that prevent the briefing itself use the bundled sample day.

- **Market data:** Alpha Vantage (US equities).
- **LLM:** OpenRouter via the OpenAI SDK, defaulting to
  `nvidia/nemotron-3-super-120b-a12b:free`, with `openrouter/free` as the
  recommended fallback. Model-agnostic by design.
- **Divergence:** computed deterministically from each persona's structured
  −2..+2 conviction stances — no LLM judge.
- **Guardrails:** neutral-tone enforcement on the briefing, ≤200-word + plain
  English + no-advice checks on every POV, and grounding (every stance must
  reference a real key point). Each stage retries once, then falls back.

## Running

```bash
npm install

# Sample mode (no keys needed) — opens straight to the bundled sample day:
npm run dev          # server on :8788, web on :5173 → open http://localhost:5173

# Live mode — copy .env.example to server/.env and set:
#   OPENROUTER_API_KEY=...      ALPHAVANTAGE_API_KEY=...
# The server loads keys from server/.env, not from a repo-root .env.
```

The dev and preview servers also listen on the Tailscale interface. Depending
on which Vite port is printed at startup, open either
`http://sakuranbo.tail96df1c.ts.net:<port>` or
`http://100.67.88.54:<port>` from the tailnet.

Other scripts:

```bash
npm test             # server unit tests (divergence, guardrails, pipeline, cache)
npm run typecheck    # all three packages
npm run build        # build shared + server + web
npm -w server run build:data   # regenerate bundled sample and archived fixtures
```

## What's built

The app has three workspaces: **Today** shows the current daily brief,
**Your Brief** analyzes up to five user-provided finance articles, and the
**Archive** opens saved daily briefs. The Archive never backfills or generates
an earlier date.

## Compliance

Every character provides **one deliberately biased perspective, not investment
advice.** Prism is not personalized and never instructs the user to buy, sell,
or hold. A
persistent disclaimer is shown across the app, and a guardrail blocks concrete
buy/sell/hold instructions in generated content. Legal review is required before
any real launch.
