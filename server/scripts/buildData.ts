// Authors the bundled sample day + time-machine replays as data, then runs them
// through the REAL divergence math so the committed JSON is guaranteed
// consistent with what the live pipeline would produce. Run: npm -w server run build:data
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISCLAIMER,
  type DayContent,
  type KeyPoint,
  type PersonaPOV,
  type StanceLabel,
  type TimeMachineEvent,
} from "@prism/shared";
import {
  computeDayDivergence,
  withKeyPointDivergence,
} from "../src/domain/divergence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");

// Convenience: a key point before divergence is attached.
type RawKp = Omit<KeyPoint, "divergence">;

const emptyDiv = {
  score: 0,
  level: "consensus" as const,
  spread: 0,
  mostBullish: null,
  mostBearish: null,
};

function kp(raw: RawKp): KeyPoint {
  return { ...raw, divergence: emptyDiv };
}

function st(keyPointId: string, label: StanceLabel, score: number, rationale: string) {
  return { keyPointId, label, score, rationale };
}

/** Assemble a full DayContent, computing divergence from the POVs. */
function assemble(
  base: Omit<DayContent, "keyPoints" | "dayDivergence" | "disclaimer" | "generatedAt"> & {
    keyPoints: KeyPoint[];
    povs: PersonaPOV[];
  },
): DayContent {
  const keyPoints = withKeyPointDivergence(base.keyPoints, base.povs);
  const dayDivergence = computeDayDivergence(base.povs);
  return {
    date: base.date,
    kind: base.kind,
    source: base.source,
    title: base.title,
    keyPoints,
    povs: base.povs,
    dayDivergence,
    generatedAt: "2026-06-10T00:00:00.000Z",
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// SAMPLE DAY — built around the Appendix A chipmaker example (high divergence).
// ---------------------------------------------------------------------------
const sampleKeyPoints: KeyPoint[] = [
  kp({
    id: "kp1",
    summary:
      "A major chipmaker reported record quarterly revenue and raised full-year guidance; its shares rose about 9% in after-hours trading.",
    detail:
      "The company reported revenue above its prior guidance and lifted its outlook for the full year, citing demand tied to AI infrastructure. The after-hours move added roughly 9% to the share price following the release.",
    magnitude: "+9% after hours",
    sources: [
      {
        title: "Chipmaker posts record revenue, raises guidance",
        publisher: "Reuters",
        url: "https://www.reuters.com/technology/",
      },
    ],
  }),
  kp({
    id: "kp2",
    summary:
      "The S&P 500 closed up 0.4% and the Nasdaq Composite closed up 0.7%, with most gains in large-cap technology.",
    detail:
      "Index gains were concentrated in a small number of large technology names. Breadth was narrow, with roughly half of S&P 500 constituents finishing lower on the day.",
    magnitude: "S&P +0.4%, Nasdaq +0.7%",
    sources: [
      {
        title: "US stocks close higher led by technology",
        publisher: "Associated Press",
        url: "https://apnews.com/hub/financial-markets",
      },
    ],
  }),
  kp({
    id: "kp3",
    summary:
      "The 10-year Treasury yield rose 6 basis points to 4.38% after data showed services prices increasing more than economists expected.",
    detail:
      "A monthly services inflation reading came in above consensus. Government bond yields moved up across maturities, with the 10-year yield reaching 4.38%.",
    magnitude: "10Y yield +6bps to 4.38%",
    sources: [
      {
        title: "Treasury yields rise on hotter services data",
        publisher: "Bloomberg",
        url: "https://www.bloomberg.com/markets/rates-bonds",
      },
    ],
  }),
  kp({
    id: "kp4",
    summary:
      "Crude oil fell 2.1% to settle at $71.40 a barrel after a report showed US inventories rising more than expected.",
    detail:
      "Weekly inventory data showed a larger-than-expected build in crude stockpiles. Front-month futures settled 2.1% lower at $71.40 per barrel.",
    magnitude: "Crude -2.1% to $71.40",
    sources: [
      {
        title: "Oil settles lower on inventory build",
        publisher: "Reuters",
        url: "https://www.reuters.com/business/energy/",
      },
    ],
  }),
];

const samplePovs: PersonaPOV[] = [
  {
    personaId: "momentum",
    text: "The chip name is breaking out on huge volume, and I'm not going to argue with the tape. When a leader moves like this after numbers, the path of least resistance is usually higher for a few sessions. The Nasdaq closing green confirms money is still chasing the same winners. Higher yields and softer oil? Background noise today — they aren't what's moving my screens. The crowd is leaning one way and the trend is my friend until it bends. I'd rather be riding what's already working than sitting on my hands waiting for a cleaner setup that may never come.",
    activeBias: "chasing strength — trusting the breakout over any caution flag",
    stances: [
      st("kp1", "bullish", 2, "Clean breakout on volume; ride it."),
      st("kp2", "bullish", 1, "Index green confirms the trend is intact."),
      st("kp3", "neutral", 0, "Yields aren't moving my charts today."),
      st("kp4", "neutral", 0, "Oil isn't where the momentum is."),
    ],
  },
  {
    personaId: "growth",
    text: "This is the long-term story doing exactly what it's supposed to do. One record quarter inside a multi-year build-out of computing demand — that's the trend showing up in the numbers, not a surprise. The day-to-day index wiggle and a few basis points on yields don't change where this is going over five years. I care about whether the destination is intact, and raised guidance says it is. Cheaper oil is a small tailwind for the broader economy but not central to my thinking. When a secular winner delivers and lifts its outlook, the right instinct for a long-term holder is patience, not reaction. Noise fades; compounding doesn't.",
    activeBias: "extrapolating the long arc — treating one quarter as trend confirmation",
    stances: [
      st("kp1", "bullish", 2, "The secular thesis is compounding on schedule."),
      st("kp2", "bullish", 1, "Tech leadership fits the long-term story."),
      st("kp3", "neutral", 0, "A few basis points don't change a five-year view."),
      st("kp4", "bullish", 1, "Cheaper energy is a mild economic tailwind."),
    ],
  },
  {
    personaId: "value",
    text: "Great business, but the price already assumes years of perfection. A 9% jump on a good quarter tells me expectations were sky-high going in — and when you pay for flawless, any stumble gets punished hard. I'm not interested in buying after the move; I want a margin of safety, and there isn't one here. What does interest me: hotter services inflation pushing yields up. Higher rates lower what any future cash flow is worth today, and that math matters far more than one earnings headline. I'd rather hold cash and wait for a quarter that disappoints for non-fundamental reasons. Discipline means being willing to miss this.",
    activeBias: "anchoring to a demanded discount — refusing to pay up after the move",
    stances: [
      st("kp1", "bearish", -1, "Priced for perfection; no margin of safety."),
      st("kp2", "neutral", 0, "Narrow breadth, not a broad bargain."),
      st("kp3", "bearish", -1, "Higher rates lower the value of future cash flows."),
      st("kp4", "neutral", 0, "Lower oil is marginal to intrinsic value."),
    ],
  },
  {
    personaId: "macro",
    text: "The market keeps leaning on a handful of names tied to one spending cycle, and today proves it — the index only rose because a few giants did. That's fragility, not strength. If that cycle cools, a lot falls together. More telling: services inflation ran hot and yields jumped. That makes near-term rate cuts less likely and tightens financial conditions just as everyone crowds the same trade. Lower oil helps the inflation picture a little, but not enough to offset sticky services. When concentration and rising rates show up on the same day, my job is to ask what breaks if sentiment turns. I'd be managing risk here, not adding it.",
    activeBias: "weighting downside heavily — reading concentration and rates as tail risk",
    stances: [
      st("kp1", "bearish", -1, "One more reason the index is dangerously concentrated."),
      st("kp2", "bearish", -2, "Narrow breadth is fragility, not health."),
      st("kp3", "bearish", -2, "Hot services data tightens conditions and delays cuts."),
      st("kp4", "neutral", 0, "Helpful for inflation but not decisive."),
    ],
  },
  {
    personaId: "contrarian",
    text: "Everyone already loves this chip story, and that's exactly what makes me cautious. When the reaction to good news is this uniform — every headline cheering, every index green on the same few names — the surprise usually isn't more upside. It's whatever nobody is watching. Right now nobody's watching the bond market, and yet that's where the hot inflation print just landed. The crowd is staring at one shiny earnings beat while the thing that could actually reprice everything sits quietly in the corner. I'm not calling a top. I'm just noting that consensus this tidy rarely gets rewarded. The interesting trade is almost never the one everybody's already in.",
    activeBias: "fading consensus — distrusting a reaction this unanimous",
    stances: [
      st("kp1", "bearish", -1, "A reaction this unanimous rarely has more upside."),
      st("kp2", "neutral", 0, "Narrow, crowded leadership — I'd fade the enthusiasm."),
      st("kp3", "bearish", -1, "The ignored bond signal is the real story."),
      st("kp4", "neutral", 0, "Nobody's positioned around oil here."),
    ],
  },
];

const sampleDay = assemble({
  date: "2026-06-09",
  kind: "daily",
  source: "sample",
  keyPoints: sampleKeyPoints,
  povs: samplePovs,
});

// ---------------------------------------------------------------------------
// TIME MACHINE 1 — Black Monday, Oct 19, 1987 (high consensus: everyone bearish)
// ---------------------------------------------------------------------------
const bmKeyPoints: KeyPoint[] = [
  kp({
    id: "kp1",
    summary:
      "The Dow Jones Industrial Average fell 22.6% in a single session, its largest one-day percentage decline on record.",
    detail:
      "The decline occurred in one trading session with very high volume. It remains the largest single-day percentage drop in the index's history.",
    magnitude: "Dow -22.6% in one day",
    sources: [
      {
        title: "Stocks plunge 508 points",
        publisher: "The New York Times (archive)",
        url: "https://www.nytimes.com/1987/10/20/business/",
      },
    ],
  }),
  kp({
    id: "kp2",
    summary:
      "Program trading and portfolio-insurance selling strategies were widely cited as amplifying the decline as prices fell.",
    detail:
      "Automated strategies designed to sell as markets dropped contributed additional selling pressure, accelerating the move lower through the session.",
    magnitude: "mechanism, not a price",
    sources: [
      {
        title: "The role of program trading in the crash",
        publisher: "Brady Commission Report (archive)",
        url: "https://en.wikipedia.org/wiki/Black_Monday_(1987)",
      },
    ],
  }),
  kp({
    id: "kp3",
    summary:
      "Markets across Asia and Europe fell sharply in the same period, with several major indexes down double digits.",
    detail:
      "The decline was global. Major markets in Asia and Europe recorded large losses over the same and following sessions.",
    magnitude: "global double-digit declines",
    sources: [
      {
        title: "A global market rout",
        publisher: "Financial Times (archive)",
        url: "https://en.wikipedia.org/wiki/Black_Monday_(1987)",
      },
    ],
  }),
];

const bmPovs: PersonaPOV[] = [
  {
    personaId: "momentum",
    text: "The tape just broke in the most violent way I've ever seen, and the one rule that keeps you alive is don't fight a move like this. Everything is going down together, and there's no bid to lean on. When the trend flips this hard, I'm flat — cash is a position. I'm not trying to be a hero catching a falling knife on day one of a global rout. The momentum is straight down across every market, and until the selling exhausts itself and I see real strength again, there's nothing here for me but danger.",
    activeBias: "following the move down — refusing to fight a violent trend",
    stances: [
      st("kp1", "bearish", -2, "Largest down move ever; do not fight it."),
      st("kp2", "bearish", -2, "Forced mechanical selling feeds the trend."),
      st("kp3", "bearish", -2, "Every market down together — no shelter."),
    ],
  },
  {
    personaId: "growth",
    text: "Days like this are terrifying, and even a long-term optimist has to respect a 22% single-session drop. My instinct is that great businesses are still great the morning after a crash, and that selling driven by machines rather than fundamentals eventually creates opportunity. But I won't pretend the ground is steady. The global nature of this scares me, because it suggests something broader than any one company's prospects. For now the long arc I believe in is intact, yet the near-term damage is real and I'd be foolish to call a bottom into mechanical selling I don't understand. Patience now, conviction later.",
    activeBias: "looking through the crash — trusting fundamentals over price action",
    stances: [
      st("kp1", "bearish", -1, "Respect the damage, but it's price not fundamentals."),
      st("kp2", "neutral", 0, "Mechanical selling may create later opportunity."),
      st("kp3", "bearish", -1, "The global reach is genuinely worrying."),
    ],
  },
  {
    personaId: "value",
    text: "When price falls 22% in a day and the business hasn't changed, that's the math finally working in my favor. Panic is exactly when margin of safety appears. I'm not buying the whole market blindly, but quality names that were too expensive last week may be reaching prices I'd actually pay. Mechanical selling that ignores fundamentals is the value investor's best friend — it sells me good assets cheap from people who have to sell. I'd be making a list and starting to nibble, slowly, on the highest-quality names. The crowd is terrified; that's usually when the patient buyer is rewarded.",
    activeBias: "demanding a discount — treating the panic as a chance to buy quality",
    stances: [
      st("kp1", "bullish", 2, "A violent drop creates the discount I demand."),
      st("kp2", "bullish", 1, "Forced selling hands me quality cheaply."),
      st("kp3", "neutral", 0, "Global selling widens the menu but warrants care."),
    ],
  },
  {
    personaId: "macro",
    text: "This is the kind of day I'm always bracing for. A 22% single-session collapse spreading across every major market is a systemic event, not a stock story. My first question isn't what's cheap — it's what breaks. Forced, mechanical selling means leverage is unwinding, and when leverage unwinds you find out who was over-exposed only after they fail. The global synchronization tells me this is about plumbing and confidence, not earnings. I'd be defensive, focused on whether the financial system itself holds. Bargain-hunting can wait until I know the machine isn't seizing up. Capital preservation is the only job today.",
    activeBias: "asking what breaks next — reading the crash as systemic risk",
    stances: [
      st("kp1", "bearish", -2, "A systemic shock, not a buying signal yet."),
      st("kp2", "bearish", -2, "Leverage unwinding; hidden failures come next."),
      st("kp3", "bearish", -2, "Global synchronization signals a plumbing crisis."),
    ],
  },
  {
    personaId: "contrarian",
    text: "Everyone is selling, the headlines are apocalyptic, and that is precisely the setting in which I start to get interested. I won't catch the exact bottom and I'm not pretending the fear is irrational — but maximum unanimity in one direction is rarely the moment to join in. When selling is this mechanical and this universal, a lot of it is forced rather than considered, and forced sellers don't price things; they just dump them. The crowd is certain the world is ending. That certainty itself is the signal. I'd be quietly looking for what's been thrown out with no regard for what it's actually worth.",
    activeBias: "fading panic — distrusting unanimous, forced selling",
    stances: [
      st("kp1", "bullish", 1, "Maximum fear is rarely the time to sell with the crowd."),
      st("kp2", "bullish", 1, "Forced sellers misprice; that's my opportunity."),
      st("kp3", "neutral", 0, "Global panic is broad — selective, not reckless."),
    ],
  },
];

const blackMonday = assemble({
  date: "1987-10-19",
  kind: "timeMachine",
  source: "sample",
  title: "Black Monday — Oct 19, 1987",
  keyPoints: bmKeyPoints,
  povs: bmPovs,
});

// ---------------------------------------------------------------------------
// TIME MACHINE 2 — GameStop short squeeze, Jan 27, 2021 (very high divergence)
// ---------------------------------------------------------------------------
const gmeKeyPoints: KeyPoint[] = [
  kp({
    id: "kp1",
    summary:
      "Shares of a video-game retailer rose 135% in a single session and were up roughly 1,700% over the month.",
    detail:
      "The stock's move was driven largely by coordinated buying among retail investors organizing on social media, rather than by a change in the company's financial results.",
    magnitude: "+135% in a day, ~1,700% MTD",
    sources: [
      {
        title: "Retail traders drive video-game retailer's stock surge",
        publisher: "The Wall Street Journal",
        url: "https://www.wsj.com/articles/gamestop-mania",
      },
    ],
  }),
  kp({
    id: "kp2",
    summary:
      "Several hedge funds with large short positions in the stock reported significant losses, and at least one received an external capital injection.",
    detail:
      "Funds that had bet against the stock faced large mark-to-market losses as it rose. One prominent short-seller received an injection of outside capital during the episode.",
    magnitude: "multi-billion short losses",
    sources: [
      {
        title: "Short sellers hit with heavy losses",
        publisher: "Reuters",
        url: "https://www.reuters.com/business/",
      },
    ],
  }),
  kp({
    id: "kp3",
    summary:
      "Broad market indexes fell about 2.5% on the session, with commentary linking the move to forced selling by funds covering short positions.",
    detail:
      "The S&P 500 declined around 2.5%. Market commentary connected part of the broad weakness to funds raising cash and unwinding positions to cover losses elsewhere.",
    magnitude: "S&P -2.5%",
    sources: [
      {
        title: "Stocks slide as short squeeze ripples through market",
        publisher: "Bloomberg",
        url: "https://www.bloomberg.com/markets",
      },
    ],
  }),
];

const gmePovs: PersonaPOV[] = [
  {
    personaId: "momentum",
    text: "This is the most extreme momentum I've ever seen, and the only thing that matters is that it's going up violently on enormous volume. I don't care about the company's fundamentals — price and crowd energy are the whole story here, and both are screaming. You ride a move like this with tight discipline and you respect that it can reverse just as fast. The crowd is the catalyst, and right now the crowd is overwhelmingly one direction. I'm with the move while it runs, fully aware the exit could be brutal. This is pure tape-reading, and the tape says higher until it violently doesn't.",
    activeBias: "riding the parabola — pure trend-following with no fundamental anchor",
    stances: [
      st("kp1", "bullish", 2, "Violent uptrend on massive volume — ride it."),
      st("kp2", "bullish", 1, "Short covering adds fuel to the move."),
      st("kp3", "neutral", 0, "Broad weakness isn't where the action is."),
    ],
  },
  {
    personaId: "growth",
    text: "I have to be honest: this doesn't fit how I think at all. My job is to back businesses whose earnings compound over many years, and nothing about a 1,700% monthly move reflects the underlying company getting better. This is a positioning event, not a growth story. A struggling retailer is still a struggling retailer no matter what the share price does this week. I'd stay completely away — not because I'm bearish on the trade's momentum, but because there's no long-term thesis here for me to own. When price detaches this far from fundamentals, it's outside my circle entirely. I'll wait for real businesses doing real things.",
    activeBias: "ignoring the noise — refusing to engage a fundamentals-free move",
    stances: [
      st("kp1", "bearish", -1, "Price has detached from any business reality."),
      st("kp2", "neutral", 0, "A positioning fight, not a growth signal."),
      st("kp3", "neutral", 0, "Index wobble is a side effect, not my concern."),
    ],
  },
  {
    personaId: "value",
    text: "From where I sit, this is the clearest example of price divorced from worth I can imagine. The business is worth what its future cash flows are worth, and those haven't changed because a crowd online decided to buy. A stock up 1,700% in a month on no fundamental news is the opposite of margin of safety — it's maximum danger. I wouldn't touch it long, and as a matter of principle I don't short manias either, because they can stay irrational longer than you can stay solvent. This ends with the price reconnecting to value, and value here is a small fraction of the quote. I'm simply staying away.",
    activeBias: "anchoring to intrinsic value — seeing pure overvaluation",
    stances: [
      st("kp1", "bearish", -2, "Price is wildly above any intrinsic worth."),
      st("kp2", "neutral", 0, "Not my fight; I don't short manias."),
      st("kp3", "bearish", -1, "Forced unwinds reveal how stretched things are."),
    ],
  },
  {
    personaId: "macro",
    text: "What worries me isn't the one stock — it's what it reveals. When a single crowded squeeze forces multi-billion-dollar funds to sell their good positions to cover the bad ones, that's contagion plumbing, and the broad index falling 2.5% on the same day proves the ripple is real. My question is always what breaks next, and forced deleveraging is exactly how isolated blowups become market-wide ones. The leverage and interconnection on display here are the actual story. I'd be reducing risk and watching funding markets, not playing the squeeze. One corner of the market melting up while the index falls is precisely the kind of stress signal I don't ignore.",
    activeBias: "tracing contagion — reading the squeeze as a deleveraging signal",
    stances: [
      st("kp1", "bearish", -1, "A symptom of dangerous leverage in the system."),
      st("kp2", "bearish", -2, "Forced fund selling is contagion plumbing."),
      st("kp3", "bearish", -2, "The index drop confirms deleveraging is spreading."),
    ],
  },
  {
    personaId: "contrarian",
    text: "My whole discipline is fading the crowd, and here the crowd is overwhelmingly long with religious conviction — so my instinct is to be deeply skeptical of the upside, not to join the party. Everyone piling in is certain they've found a free money machine, and unanimity that loud almost never pays. But I'll add the twist: the people on the other side, the shorts, were the original crowd everyone fed on, and they got run over. The real lesson is that whatever position is most crowded and most certain is the most dangerous — and right now that's the euphoric longs. I'd be looking at what everyone's ignoring while they stare at this one ticker.",
    activeBias: "fading euphoria — distrusting the most crowded, certain side",
    stances: [
      st("kp1", "bearish", -1, "Euphoric unanimity rarely gets rewarded."),
      st("kp2", "neutral", 0, "The squeeze punished the previously crowded shorts."),
      st("kp3", "neutral", 0, "The ignored fallout matters more than the ticker."),
    ],
  },
];

const gme = assemble({
  date: "2021-01-27",
  kind: "timeMachine",
  source: "sample",
  title: "The GameStop squeeze — Jan 27, 2021",
  keyPoints: gmeKeyPoints,
  povs: gmePovs,
});

const catalog: TimeMachineEvent[] = [
  {
    id: "black-monday-1987",
    title: blackMonday.title!,
    date: blackMonday.date,
    blurb:
      "The largest one-day percentage drop in Dow history. Watch the cast converge in fear — and the contrarian and value lenses break away.",
  },
  {
    id: "gamestop-2021",
    title: gme.title!,
    date: gme.date,
    blurb:
      "A retail-driven short squeeze detaches price from fundamentals. A textbook high-divergence read across the five lenses.",
  },
];

async function main() {
  await fs.mkdir(path.join(DATA_DIR, "timemachine"), { recursive: true });
  await fs.writeFile(
    path.join(DATA_DIR, "sample-day.json"),
    JSON.stringify(sampleDay, null, 2),
  );
  await fs.writeFile(
    path.join(DATA_DIR, "timemachine", "black-monday-1987.json"),
    JSON.stringify(blackMonday, null, 2),
  );
  await fs.writeFile(
    path.join(DATA_DIR, "timemachine", "gamestop-2021.json"),
    JSON.stringify(gme, null, 2),
  );
  await fs.writeFile(
    path.join(DATA_DIR, "timemachine", "index.json"),
    JSON.stringify(catalog, null, 2),
  );
  console.log("Wrote sample + time-machine data to", DATA_DIR);
  console.log(
    "Day divergence — sample:",
    sampleDay.dayDivergence.score,
    "| black monday:",
    blackMonday.dayDivergence.score,
    "| gme:",
    gme.dayDivergence.score,
  );
}

main();
