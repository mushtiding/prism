# Prism — Functional Specification

**Working title:** Prism *(placeholder — one neutral beam of news, refracted into a spectrum of biased lenses)*
**Document type:** Functional requirements (what the app does — implementation deliberately out of scope)
**Status:** Concept locked, pre-layout
**Last updated:** 2026-06-09

---

## 1. Product overview

### 1.1 What it is
Prism is a daily market app built around a single idea: **the disagreement between viewpoints is the signal.** It presents two layers stacked on the same facts:

1. **The neutral base layer** — a deliberately flat, source-attributed account of what moved markets on the previous trading day.
2. **The persona layer** — a fixed cast of investor archetypes, each a distinct and deliberately *biased* lens, that reacts to that same base layer in character.

The user's goal is not to be told what to do. It is to see the same facts refracted through several independent minds, and to notice **where those minds split** — because that divergence flags contested, possibly-mispriced situations worth a second look.

### 1.2 North-star goal
**Edge through structured disagreement.** When the lenses converge, the read is probably efficient and uninteresting. When they diverge sharply, that is the thing to surface.

### 1.3 What it is NOT
- Not a robo-advisor and not personalized advice. It never tells the user to buy, sell, or hold.
- Not a single "AI assistant" voice. The value is the *spread* of voices, not one synthesized opinion.
- Not a trading or brokerage product. No execution, no portfolio connection (this phase).
- Not a live/intraday ticker. It is a once-daily briefing.

---

## 2. Core concepts (glossary)

| Term | Meaning |
|---|---|
| **Base layer / neutral briefing** | The day's key market movements, stated flatly and with sources. The shared reference all personas react to. |
| **Persona** | A fixed investor archetype with a defined worldview, time horizon, risk appetite, and cognitive biases. |
| **Lens** | A persona's interpretation of the base layer. Explicitly an opinion, never a recommendation. |
| **POV** | The persona's written daily take (see FR-2). |
| **Divergence signal** | A measure of how much the personas disagree on a given event or on the day overall. The app's headline output. |
| **Track record** | The accumulated history of how each persona's past reads aged. |

---

## 3. The persona cast

The cast is chosen to **span the interpretation space** — each persona is as independent a lens as possible, so that between them they cover the main ways a market read can go wrong. Axes: time horizon (short ↔ long) and risk appetite (defensive ↔ aggressive).

| Persona | Horizon | Risk | Dominant biases | One-line worldview |
|---|---|---|---|---|
| **Momentum trader** | Short | Aggressive | Herding, FOMO, overconfidence | Price action and sentiment are the truth; ride what's moving. |
| **Growth bull** | Long | Aggressive | Extrapolation, optimism | Back the secular winners; near-term noise doesn't matter. |
| **Value / quality** | Long | Defensive | Anchoring, margin-of-safety | Price vs. intrinsic worth is all that matters; demand a discount. |
| **Macro / risk manager** | Short | Defensive | Loss aversion, fighting the last crisis | Every story is a macro symptom; ask what breaks next. |
| **Contrarian** | (origin) | Neutral | Disposition to fade the crowd | Defined relative to consensus; if everyone agrees, be suspicious. |

**Design rules for personas (all personas must satisfy):**
- Each persona has a stable, documented definition: archetype, horizon, risk appetite, named biases, voice/tone, and an explicit list of what it over-weights and under-weights.
- Personas are a **fixed editorial cast**, not user-generated (this phase).
- Bias is a feature, not a defect. A persona should be *consistently* biased so its track record is interpretable.

**Decision to lock (see §9):** ship the full **5**, or a **3-persona core** (Momentum, Value, Macro) with Growth bull + Contrarian as the first expansion.

---

## 4. Functional requirements

Priority key: **[MVP]** required for first release · **[P2]** fast-follow.

### FR-1 — Daily neutral briefing **[MVP]**
- The app presents the key market movements from the previous trading day as a short set of discrete **key points** (target 3–6 per day).
- Each key point is written in a **flat, non-evaluative register**: no loaded verbs ("soared," "plunged," "fears"), no implied judgment. It states what happened and the magnitude.
- Each key point is **source-attributed** and can be expanded to reveal the underlying detail and sources.
- The briefing is the shared input every persona reacts to; personas never react to anything outside it.

### FR-2 — Persona daily POV **[MVP]**  *(core requirement)*
- Each persona produces **exactly one POV per trading day**, reacting to that day's / previous trading day's movements as captured in the base layer (FR-1).
- **Each POV is written in plain, accessible English and is capped at 200 words.** This is a hard limit.
  - Readable by a non-expert. Jargon is avoided; where a technical term is unavoidable it is briefly explained in plain language inline.
  - The persona's character comes through *tone and focus* (what it fixates on, what it dismisses), not through impenetrable terminology.
- The POV is **in the persona's voice and reflects its bias** — two personas reading the same base layer should reach visibly different conclusions.
- Every POV is clearly labeled as **one lens / opinion, never a recommendation.**
- POVs are **consistent within a day** (every user sees the same POV for a given persona on a given day).

### FR-3 — Persona detail & bias transparency **[MVP]**
- From any persona, the user can open a detail view that shows: who the persona is, its worldview, and **which bias lens it is applying today** (e.g. "anchoring to the prior high," "weighting downside heavily").
- The user can see the persona's full definition (horizon, risk appetite, named biases, what it over-/under-weights).

### FR-4 — Divergence & consensus signal **[MVP]**
- For each day (and ideally each key point), the app computes and surfaces **how much the personas agree vs. disagree.**
- High-divergence events are visibly flagged as the day's most interesting reads; high-consensus events are de-emphasized ("likely already priced in").
- The signal is presented as the app's headline takeaway, so the user does not have to read and compare five POVs manually to find the split.

### FR-5 — Track record / accountability **[P2]**
- Each persona carries a visible, accumulating record of **how its past reads aged.**
- Supported via a lightweight **notional position log** per persona (a persona's stated stance is recorded and scored against subsequent market moves) — no real money, no real portfolio.
- The user can see, over time, which lens has had signal in which conditions, so the five personas are not treated as equally credible.
- Surfaces the "cried wolf, then was right" pattern: when a persistently-dissenting persona is finally joined by the others, that convergence is highlighted.

### FR-6 — Core interactions **[MVP unless noted]**
- **[MVP]** Tap a base-layer key point → expand to detail + sources.
- **[MVP]** Tap a persona → read that persona's POV for the day.
- **[P2]** Follow-up Q&A: the user can ask a persona a question and get an in-character answer grounded in the day's base layer.
- *(Visual layout and the moving-character dynamics are specified in a separate layout document — see §7.)*

### FR-7 — Onboarding & "your lens" **[P2]**
- A short onboarding identifies which persona the user most resembles.
- The app can then **highlight the persona most unlike the user** ("the anti-you") to maximize new perspective — supporting the edge goal of seeing minds unlike one's own.

### FR-8 — Historical / time-machine mode **[P2]**
- The user can replay a notable past market event and watch the cast react to it.
- Works without live data, which makes it useful for onboarding, demos, and education.

### FR-9 — Content generation behavior **[MVP]**
*(Functional behavior, not implementation.)*
- All daily content (neutral briefing + every persona POV) is **generated once per day and shared across all users** — not regenerated per user or per app-open. This guarantees consistency (FR-2) and predictable freshness.
- The persona definitions are the durable inputs; only the daily base layer changes.
- The generation source for persona text is interchangeable (model-agnostic) so the cast's quality can be tuned and compared over time.

### FR-10 — Compliance & disclaimers **[MVP]**
- Persistent, unmissable framing that all content is **lenses / hypotheses for understanding, not investment advice**, and is not personalized to the user.
- No persona output may contain a concrete instruction to buy, sell, or hold a specific security.
- (Legal review required before launch — flagged, not resolved, in this document.)

### FR-11 — Safety & quality guardrails **[MVP]**
- **Neutral-tone enforcement:** the base layer is checked to stay factual and non-evaluative.
- **In-lane enforcement:** each persona stays within its defined character and within the lens-not-advice boundary (FR-10).
- **Grounding:** every POV must be traceable to the day's base layer; no invented events.
- **Readability check:** every POV passes the plain-English + 200-word constraints of FR-2 before it is published.

---

## 5. Data inputs (functional)
- A daily feed of market movements and market-relevant headlines is required to build the base layer (FR-1).
- The base layer needs, at minimum: the day's notable index/asset moves with magnitudes, and the headline events plausibly driving them, each with a citable source.
- Provider selection is an implementation detail and out of scope here (see §9 for the decision).

---

## 6. Non-functional requirements
- **Cadence:** one refresh per trading day; content is dated and clearly tied to a specific trading session.
- **Consistency:** all users see identical daily content (FR-9).
- **Accessibility / readability:** plain-English constraint (FR-2) applies to persona text; the neutral layer is likewise written for a general audience.
- **Latency:** because content is pre-generated daily, the app should open to ready content with no per-session generation wait.
- **Transparency:** sources on the base layer and the active bias on each persona are always reachable.

---

## 7. Out of scope (this phase)
- Visual design, screen layout, and the moving-character dynamics — covered in the forthcoming **layout & interaction** document.
- Real brokerage connection, portfolio import, and any trade execution.
- Live / intraday updates.
- User-created or user-tunable personas.
- Monetization, accounts, and notifications.

---

## 8. MVP definition (first release)
The smallest version that proves the concept:
- FR-1 neutral daily briefing (3–6 sourced key points).
- FR-2 one ≤200-word plain-English POV per persona, for the full or core cast.
- FR-3 persona detail + active-bias transparency.
- FR-4 a working divergence signal as the headline takeaway.
- FR-6 tap-to-expand (key points) and tap-to-read (personas).
- FR-9 once-daily shared generation.
- FR-10 / FR-11 disclaimers and guardrails.

Everything marked **[P2]** is explicitly deferred.

---

## 9. Open decisions to lock
1. **Cast size for MVP:** full 5 personas, or 3-person core (Momentum / Value / Macro)?
2. **Market scope:** US equities only at launch, or broader (rates, FX, crypto, global indices)?
3. **Divergence signal depth:** per-day only, or also per-key-point, for MVP?
4. **Follow-up Q&A (FR-6):** MVP or P2? (Currently P2.)
5. **Data provider** for the daily feed (implementation track, but gates the build).

---

## Appendix A — Example content shape (illustrative)

**Neutral key point (base layer):**
> A major chipmaker reported record quarterly revenue and raised full-year guidance; its shares rose about 9% after hours. (source)

**Same fact, five lenses (each ≤200 words, plain English):**
- **Momentum trader** — "It's breaking out on huge volume. I'm not going to argue with the tape — when a name moves like this, I'd rather be on it than explain why it shouldn't have."
- **Growth bull** — "This is the long-term story working exactly as expected. One great quarter in a multi-year trend; I'd add and ignore the day-to-day."
- **Value / quality** — "Great business, but the price already assumes years of perfection. I'm not paying up here; I'd wait for a stumble."
- **Macro / risk manager** — "The market keeps leaning on a handful of names tied to one spending cycle. If that cycle cools, a lot falls together. Strong like this also makes rate cuts less likely. I'd be hedging, not adding."
- **Contrarian** — "Everyone already loves this. When the reaction to good news is this uniform, the surprise usually isn't more upside — it's whatever nobody's watching."

*(High divergence here → the app would flag this as a contested read worth attention.)*
