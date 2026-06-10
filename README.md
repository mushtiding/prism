# Prism

> One neutral beam of news, refracted into a spectrum of biased lenses.

Prism is a once-daily market app built on a single idea: **the disagreement
between viewpoints is the signal.** It stacks two layers on the same facts:

1. **The neutral base layer** — a flat, source-attributed account of what moved
   markets on the previous trading day.
2. **The persona layer** — a fixed cast of five investor archetypes, each a
   distinct and deliberately *biased* lens, reacting to that base layer in
   character.

When the lenses converge, the read is probably efficient and uninteresting.
When they diverge sharply, that's the thing to surface. Prism computes a
**divergence signal** (per day and per key point) as its headline output.

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
and serves it. If API keys are missing or any call fails, it gracefully serves a
**bundled sample day** (badged "Sample data").

- **Market data:** Alpha Vantage (US equities).
- **LLM:** OpenRouter via the OpenAI SDK — default
  `nvidia/nemotron-3-ultra-550b-a55b:free` with reasoning effort. Model-agnostic
  by design.
- **Divergence:** computed deterministically from each persona's structured
  −2..+2 conviction stances — no LLM judge.
- **Guardrails:** neutral-tone enforcement on the briefing, ≤200-word + plain
  English + no-advice checks on every POV, and grounding (every stance must
  reference a real key point). Each stage retries once, then falls back.

## Running

```bash
npm install

# Sample mode (no keys needed) — opens straight to the bundled sample day:
npm run dev          # server on :8787, web on :5173 → open http://localhost:5173

# Live mode — copy .env.example to .env and set:
#   OPENROUTER_API_KEY=...      ALPHAVANTAGE_API_KEY=...
```

Other scripts:

```bash
npm test             # server unit tests (divergence, guardrails, pipeline, cache)
npm run typecheck    # all three packages
npm run build        # build shared + server + web
npm -w server run build:data   # regenerate bundled sample + time-machine data
```

## What's built

MVP (FR-1, 2, 3, 4, 6, 9, 10, 11) plus the **Time Machine** (FR-8): replay famous
past market days (Black Monday 1987, the 2021 GameStop squeeze) and watch the
same five lenses react. Deferred: track record (FR-5), onboarding (FR-7),
follow-up Q&A.

## Compliance

Every persona take is **one lens — an opinion, not investment advice.** Prism is
not personalized and never instructs the user to buy, sell, or hold. A
persistent disclaimer is shown across the app, and a guardrail blocks concrete
buy/sell/hold instructions in generated content. Legal review is required before
any real launch.
