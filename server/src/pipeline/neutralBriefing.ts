import type { Divergence, KeyPoint, Source } from "@prism/shared";
import type { MarketSnapshot, NewsItem, Quote } from "../providers/marketData.js";

const TARGET_KEY_POINTS = 4;
const MIN_KEY_POINTS = 3;

const INDEX_META: Record<string, { label: string; keywords: string[] }> = {
  SPY: {
    label: "S&P 500 proxy SPY",
    keywords: ["s&p 500", "s&p500", "spy"],
  },
  QQQ: {
    label: "Nasdaq 100 proxy QQQ",
    keywords: ["nasdaq 100", "nasdaq-100", "qqq"],
  },
  DIA: {
    label: "Dow Jones Industrial Average proxy DIA",
    keywords: ["dow jones", "dow industrials", "dia"],
  },
  IWM: {
    label: "Russell 2000 proxy IWM",
    keywords: ["russell", "iwm", "small cap", "small-cap"],
  },
};

function blankDivergence(): Divergence {
  return {
    score: 0,
    level: "consensus",
    spread: 0,
    mostBullish: null,
    mostBearish: null,
  };
}

function parsePercent(changePercent: string): number {
  const n = Number(changePercent.replace("%", "").replace("+", ""));
  return Number.isFinite(n) ? n : 0;
}

function quoteSource(symbol: string): Source {
  return {
    title: `${symbol} market quote`,
    publisher: "Yahoo Finance",
    url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function movementPhrase(q: Quote): string {
  const pct = parsePercent(q.changePercent);
  const magnitude = q.changePercent || `${pct.toFixed(2)}%`;
  if (Math.abs(pct) < 0.05) return `closed nearly unchanged at ${q.price}`;
  return `closed ${pct > 0 ? "up" : "down"} ${magnitude.replace("-", "")} at ${q.price}`;
}

function summaryForQuote(q: Quote): string {
  const meta = INDEX_META[q.symbol];
  const label = meta?.label ?? `${q.symbol} market proxy`;
  return `The ${label} ${movementPhrase(q)}.`;
}

function scoreNewsForQuote(item: NewsItem, q: Quote): number {
  const meta = INDEX_META[q.symbol];
  const haystack = `${item.title} ${item.summary} ${item.tickers.join(" ")}`
    .toLowerCase()
    .replace(/\s+/g, " ");
  let score = 0;

  const symbolPattern = new RegExp(`\\b${escapeRegExp(q.symbol.toLowerCase())}\\b`);
  if (symbolPattern.test(haystack)) score += 8;
  for (const keyword of meta?.keywords ?? []) {
    if (haystack.includes(keyword)) score += 3;
  }
  if (/\b(buy|sell|hold|401\(k\)|retirees?|trap)\b/i.test(haystack)) {
    score -= 4;
  }

  return score;
}

function findRelevantNews(
  q: Quote,
  news: NewsItem[],
  usedTitles: Set<string>,
): NewsItem | null {
  let best: { item: NewsItem; score: number } | null = null;
  for (const item of news) {
    if (!item.source?.url || usedTitles.has(item.title)) continue;
    const score = scoreNewsForQuote(item, q);
    if (score < 8) continue;
    if (!best || score > best.score) best = { item, score };
  }
  return best?.item ?? null;
}

function detailForQuote(q: Quote, item: NewsItem | null): string {
  const sentences = [
    `${q.symbol} finished the session at ${q.price}, ${q.changePercent} versus the prior close.`,
  ];
  if (item) {
    const when = item.publishedAt
      ? `, published ${item.publishedAt.slice(0, 10)}`
      : "";
    sentences.push(
      `The attached ${item.source.publisher} source${when} was included as market context for the session.`,
    );
    if (item.summary && item.summary !== item.title) {
      sentences.push(item.summary);
    }
  } else {
    sentences.push("The attached quote source provides the market price used for this key point.");
  }
  return sentences.join(" ");
}

function keyPointFromQuote(
  q: Quote,
  i: number,
  news: NewsItem[],
  usedTitles: Set<string>,
): KeyPoint {
  const item = findRelevantNews(q, news, usedTitles);
  if (item) usedTitles.add(item.title);

  return {
    id: `kp${i + 1}`,
    summary: summaryForQuote(q),
    detail: detailForQuote(q, item),
    magnitude: q.changePercent,
    sources: [quoteSource(q.symbol), ...(item ? [item.source] : [])],
    divergence: blankDivergence(),
  };
}

function keyPointFromNews(item: NewsItem, i: number): KeyPoint {
  return {
    id: `kp${i + 1}`,
    summary: `${item.source.publisher} published a market-related item for the session.`,
    detail:
      item.summary && item.summary !== item.title
        ? item.summary
        : `The item was titled "${item.title}".`,
    magnitude: "",
    sources: [item.source],
    divergence: blankDivergence(),
  };
}

function keyPointFromMover(q: Quote, i: number): KeyPoint {
  return {
    id: `kp${i + 1}`,
    summary: `${q.symbol} was listed in the market movers feed with a ${q.changePercent} move.`,
    detail: `${q.symbol} was reported at ${q.price}, with a session move of ${q.changePercent}.`,
    magnitude: q.changePercent,
    sources: [quoteSource(q.symbol)],
    divergence: blankDivergence(),
  };
}

export function generateNeutralBriefing(snapshot: MarketSnapshot): KeyPoint[] {
  const usedTitles = new Set<string>();
  const points: KeyPoint[] = [];
  const rankedQuotes = [...snapshot.indexQuotes].sort(
    (a, b) => Math.abs(parsePercent(b.changePercent)) - Math.abs(parsePercent(a.changePercent)),
  );

  for (const q of rankedQuotes.slice(0, TARGET_KEY_POINTS)) {
    points.push(keyPointFromQuote(q, points.length, snapshot.news, usedTitles));
  }

  for (const q of [...snapshot.topGainers, ...snapshot.topLosers]) {
    if (points.length >= MIN_KEY_POINTS) break;
    points.push(keyPointFromMover(q, points.length));
  }

  for (const item of snapshot.news) {
    if (points.length >= MIN_KEY_POINTS) break;
    if (!item.source?.url || usedTitles.has(item.title)) continue;
    points.push(keyPointFromNews(item, points.length));
  }

  if (points.length < MIN_KEY_POINTS) {
    throw new Error(
      `Market feed only produced ${points.length} deterministic key points`,
    );
  }

  return points.slice(0, 6).map((kp, i) => ({ ...kp, id: `kp${i + 1}` }));
}
