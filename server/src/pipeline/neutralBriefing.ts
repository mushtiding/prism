import type { Divergence, KeyPoint, Source } from "@prism/shared";
import type { MarketSnapshot, NewsItem, Quote } from "../providers/marketData.js";

const TARGET_KEY_POINTS = 4;
const MIN_KEY_POINTS = 3;
const PRIMARY_ARTICLE_SCORE = 8;
const SECONDARY_ARTICLE_SCORE = 5;

const INDEX_META: Record<string, { label: string; keywords: string[] }> = {
  SPY: {
    label: "S&P 500 proxy SPY",
    keywords: ["s&p 500", "s&p500", "spy", "stocks", "equities"],
  },
  QQQ: {
    label: "Nasdaq 100 proxy QQQ",
    keywords: ["nasdaq 100", "nasdaq-100", "nasdaq composite", "qqq", "technology", "tech"],
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

interface ArticleCandidate {
  item: NewsItem;
  score: number;
  publisherKey: string;
  quote: Quote | null;
}

function blankDivergence(): Divergence {
  return {
    score: 0,
    level: "consensus",
    spread: 0,
    mostBullish: null,
    mostBearish: null,
  };
}

function normalizeSpaces(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeKey(s: string): string {
  return normalizeSpaces(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizePublisher(source: Source): string {
  const publisher = normalizeKey(source.publisher);
  if (publisher) return publisher;
  try {
    return normalizeKey(new URL(source.url).hostname.replace(/^www\./, ""));
  } catch {
    return "unknown";
  }
}

function sentence(text: string): string {
  const cleaned = normalizeSpaces(text);
  if (!cleaned) return "";
  const first = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
  return first.replace(/[.!?]+$/, "");
}

function headline(text: string): string {
  return normalizeSpaces(text)
    .replace(/^(CORRECTION|US STOCKS|GLOBAL MARKETS|LIVE MARKETS|MORNING BID|STOCK MARKET TODAY)\s*[-:]\s*/i, "")
    .replace(/\s*-\s*(Reuters|Bloomberg|CNBC|MarketWatch|Yahoo Finance|AP News)$/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

function neutralizeLoadedLanguage(text: string): string {
  return text
    .replace(/\bsoars?\b/gi, "rises")
    .replace(/\bskyrockets?\b/gi, "rises sharply")
    .replace(/\bplunges?\b/gi, "falls")
    .replace(/\bplummets?\b/gi, "falls")
    .replace(/\btanks?\b/gi, "falls")
    .replace(/\bcrashes?\b/gi, "falls sharply")
    .replace(/\bcraters?\b/gi, "falls sharply")
    .replace(/\bcollapses?\b/gi, "falls sharply")
    .replace(/\bfears\b/gi, "concerns")
    .replace(/\bpanic\b/gi, "volatility")
    .replace(/\beuphoria\b/gi, "optimism");
}

function withPeriod(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
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

function haystackFor(item: NewsItem): string {
  return `${item.title} ${item.summary} ${item.tickers.join(" ")}`
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function scoreNewsForQuote(item: NewsItem, q: Quote): number {
  const meta = INDEX_META[q.symbol];
  const haystack = haystackFor(item);
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

function matchingQuote(item: NewsItem, quotes: Quote[]): Quote | null {
  let best: { quote: Quote; score: number } | null = null;
  for (const quote of quotes) {
    const score = scoreNewsForQuote(item, quote);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { quote, score };
  }
  return best?.score && best.score >= 3 ? best.quote : null;
}

function fallbackQuoteForMarketArticle(item: NewsItem, quotes: Quote[]): Quote | null {
  if (quotes.length === 0) return null;
  const haystack = haystackFor(item);
  if (!/\b(stocks|equities|markets?|wall st|wall street|indexes|indices|futures)\b/.test(haystack)) {
    return null;
  }
  return [...quotes].sort(
    (a, b) => Math.abs(parsePercent(b.changePercent)) - Math.abs(parsePercent(a.changePercent)),
  )[0] ?? null;
}

function sourceQuality(item: NewsItem): number {
  const publisher = normalizePublisher(item.source);
  const url = item.source.url.toLowerCase();

  if (/(reuters|bloomberg|associated press|ap news|cnbc|marketwatch|wall street journal|wsj|financial times|ft|barron|morningstar|investing com|yahoo finance)/.test(publisher)) {
    return 4;
  }
  if (/(247wallst|trefis|marketbeat|zacks|tipranks|benzinga|insider monkey|the motley fool|seeking alpha)/.test(publisher)) {
    return 0;
  }
  if (/(moomoo|stock titan|tradingview|ad hoc news|ad-hoc-news)/.test(publisher)) return -2;
  if (/financials-statistics|price-book|price-to-book|ratios|dividend|insider|unloads-shares/.test(url)) {
    return -4;
  }
  return 1;
}

function recencyScore(item: NewsItem, tradingDay: string): number {
  if (!item.publishedAt || !tradingDay) return 0;
  const published = new Date(item.publishedAt);
  const session = new Date(`${tradingDay}T00:00:00Z`);
  if (Number.isNaN(published.getTime()) || Number.isNaN(session.getTime())) {
    return 0;
  }
  const days = (published.getTime() - session.getTime()) / (24 * 60 * 60 * 1000);
  if (days >= 0 && days <= 2) return 2;
  if (days >= -1 && days < 0) return 1;
  if (days < -3) return -2;
  return 0;
}

function marketRelevanceScore(item: NewsItem, _snapshot: MarketSnapshot): number {
  const haystack = haystackFor(item);
  let score = 0;
  let broadHits = 0;
  let macroHits = 0;
  let sectorHits = 0;
  let indexTickerHits = 0;

  const broadTerms = [
    /\bstocks\b/,
    /\bequities\b/,
    /\bwall st(?:reet)?\b/,
    /\bmarkets?\b/,
    /\bindexes\b/,
    /\bindices\b/,
    /\bfutures\b/,
    /\bs&p 500\b/,
    /\bs&p\b(?!\s+global\b)/,
    /\bnasdaq\b(?!:)/,
    /\bdow jones\b/,
    /\brussell 2000\b/,
  ];
  const macroTerms = [
    /\bfed\b/,
    /\bpowell\b/,
    /\brates?\b/,
    /\byields?\b/,
    /\btreasur(?:y|ies)\b/,
    /\binflation\b/,
    /\bcpi\b/,
    /\bpce\b/,
    /\bjobs?\b/,
    /\bpayrolls?\b/,
    /\bunemployment\b/,
    /\bgdp\b/,
    /\btariffs?\b/,
    /\bdollar\b/,
    /\boil\b/,
  ];
  const sectorTerms = [
    /\bearnings\b/,
    /\bchips?\b/,
    /\bsemiconductors?\b/,
    /\bnvidia\b/,
    /\bai\b/,
    /\btechnology\b/,
    /\btech\b/,
    /\bbanks?\b/,
    /\benergy\b/,
  ];

  for (const re of broadTerms) {
    if (re.test(haystack)) {
      broadHits += 1;
      score += 2;
    }
  }
  for (const re of macroTerms) {
    if (re.test(haystack)) {
      macroHits += 1;
      score += 2;
    }
  }
  for (const re of sectorTerms) {
    if (re.test(haystack)) {
      sectorHits += 1;
      score += 1;
    }
  }

  for (const ticker of item.tickers) {
    const symbol = ticker.toUpperCase();
    if (INDEX_META[symbol]) {
      indexTickerHits += 1;
      score += 3;
    }
  }

  const hasDriverSignal =
    broadHits >= 2 ||
    macroHits >= 1 ||
    indexTickerHits >= 1 ||
    (sectorHits >= 1 && broadHits >= 1);
  if (!hasDriverSignal) return 0;

  return Math.min(score, 10);
}

function penaltyScore(item: NewsItem): number {
  const haystack = haystackFor(item);
  let penalty = 0;

  const weakPatterns = [
    /\bprice to book\b/,
    /\bprice-book\b/,
    /\bforward pe\b/,
    /\bdividend\b/,
    /\bex-dividend\b/,
    /\binsider\b/,
    /\bunloads shares\b/,
    /\brepresentative\b/,
    /\banalyst(?:s)?\b/,
    /\bprice target\b/,
    /\brating\b/,
    /\bupgraded\b/,
    /\bdowngraded\b/,
    /\bform 4\b/,
    /\bstock outperforms competitors\b/,
    /\bstrong trading day\b/,
    /\bwhat you think\b/,
    /\bstrategist thinks\b/,
    /\bcould smash\b/,
    /\bin the near term\b/,
    /\breal drivers behind\b/,
    /\bforget the\b/,
    /\bfund beats\b/,
    /\bmega-caps for just\b/,
    /\bprice forecast\b/,
    /\bstock forecast\b/,
    /\bs&p global\b/,
    /\bshould you buy\b/,
    /\bbuy sell or hold\b/,
    /\bwatchlist\b/,
    /\b401\(k\)\b/,
  ];

  for (const re of weakPatterns) {
    if (re.test(haystack)) penalty += 3;
  }

  return penalty;
}

function isWeakSingleStockFormat(item: NewsItem): boolean {
  const haystack = haystackFor(item);
  return [
    /\bform 4\b/,
    /\bstock (?:outperforms|underperforms) (?:friday )?(?:when )?compared to competitors\b/,
    /\bcompared to competitors\b/,
    /\bunusual options activity\b/,
    /\bmarket bets\b/,
    /\bprice to book\b/,
    /\bprice to earnings\b/,
    /\bforward pe\b/,
    /\bs&p global stock\b/,
    /\bshelf\b/,
    /\batm sales agreement\b/,
  ].some((re) => re.test(haystack));
}

function isSyntheticMarketItem(item: NewsItem): boolean {
  const publisher = normalizePublisher(item.source);
  const title = normalizeKey(item.title);
  return (
    (publisher.includes("alpha vantage") &&
      /\b(closed at|top gainer|top loser|among top)\b/.test(title)) ||
    /finance\.yahoo\.com\/quote\//i.test(item.source.url)
  );
}

function articleCandidate(
  item: NewsItem,
  snapshot: MarketSnapshot,
): ArticleCandidate | null {
  if (!item.title || !item.source?.url) return null;
  if (isSyntheticMarketItem(item)) return null;
  if (isWeakSingleStockFormat(item)) return null;

  const quote =
    matchingQuote(item, snapshot.indexQuotes) ??
    fallbackQuoteForMarketArticle(item, snapshot.indexQuotes);
  const relevance = marketRelevanceScore(item, snapshot);
  const penalty = penaltyScore(item);
  if (relevance < 2 || penalty >= 6) return null;
  const score =
    sourceQuality(item) +
    recencyScore(item, snapshot.tradingDay) +
    relevance -
    penalty +
    (quote ? 1 : 0);

  if (score < SECONDARY_ARTICLE_SCORE) return null;
  return {
    item,
    score,
    publisherKey: normalizePublisher(item.source),
    quote,
  };
}

function rankedArticleCandidates(snapshot: MarketSnapshot): ArticleCandidate[] {
  const seen = new Set<string>();
  const candidates: ArticleCandidate[] = [];

  for (const item of snapshot.news) {
    const key = normalizeKey(item.source.url || item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const candidate = articleCandidate(item, snapshot);
    if (candidate) candidates.push(candidate);
  }

  return candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = a.item.publishedAt ? Date.parse(a.item.publishedAt) : 0;
    const bTime = b.item.publishedAt ? Date.parse(b.item.publishedAt) : 0;
    return bTime - aTime;
  });
}

function selectArticleCandidates(snapshot: MarketSnapshot): ArticleCandidate[] {
  const ranked = rankedArticleCandidates(snapshot);
  const selected: ArticleCandidate[] = [];
  const usedPublishers = new Set<string>();

  for (const candidate of ranked) {
    if (selected.length >= TARGET_KEY_POINTS) break;
    if (candidate.score < PRIMARY_ARTICLE_SCORE) continue;
    if (usedPublishers.has(candidate.publisherKey)) continue;
    selected.push(candidate);
    usedPublishers.add(candidate.publisherKey);
  }

  for (const candidate of ranked) {
    if (selected.length >= TARGET_KEY_POINTS) break;
    if (selected.includes(candidate)) continue;
    if (usedPublishers.has(candidate.publisherKey)) continue;
    selected.push(candidate);
    usedPublishers.add(candidate.publisherKey);
  }

  for (const candidate of ranked) {
    if (selected.length >= TARGET_KEY_POINTS || selected.length >= MIN_KEY_POINTS) break;
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
  }

  return selected;
}

function summaryForArticle(item: NewsItem): string {
  const title = neutralizeLoadedLanguage(headline(item.title));
  if (title) return withPeriod(title);

  const summary = neutralizeLoadedLanguage(sentence(item.summary));
  return withPeriod(summary || `${item.source.publisher} reported a market-related development`);
}

function detailForArticle(item: NewsItem, quote: Quote | null): string {
  const pieces: string[] = [];
  const summary = neutralizeLoadedLanguage(sentence(item.summary));
  if (summary && normalizeKey(summary) !== normalizeKey(item.title)) {
    pieces.push(withPeriod(summary));
  } else {
    pieces.push(withPeriod(`The source headline was "${headline(item.title)}"`));
  }

  if (item.publishedAt) {
    pieces.push(`The article was published ${item.publishedAt.slice(0, 10)}.`);
  }
  if (quote) {
    pieces.push(`${quote.symbol} ${movementPhrase(quote)} for market context.`);
  }

  return pieces.join(" ");
}

function keyPointFromArticle(candidate: ArticleCandidate, i: number): KeyPoint {
  const { item, quote } = candidate;

  return {
    id: `kp${i + 1}`,
    summary: summaryForArticle(item),
    detail: detailForArticle(item, quote),
    magnitude: quote?.changePercent,
    sources: [item.source, ...(quote ? [quoteSource(quote.symbol)] : [])],
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
  const points: KeyPoint[] = [];
  const usedArticleUrls = new Set<string>();
  const articleCandidates = selectArticleCandidates(snapshot);

  for (const candidate of articleCandidates) {
    if (points.length >= TARGET_KEY_POINTS) break;
    points.push(keyPointFromArticle(candidate, points.length));
    usedArticleUrls.add(candidate.item.source.url);
  }

  const rankedQuotes = [...snapshot.indexQuotes].sort(
    (a, b) => Math.abs(parsePercent(b.changePercent)) - Math.abs(parsePercent(a.changePercent)),
  );

  for (const q of rankedQuotes) {
    if (points.length >= MIN_KEY_POINTS) break;
    points.push({
      id: `kp${points.length + 1}`,
      summary: summaryForQuote(q),
      detail: `${q.symbol} finished the session at ${q.price}, ${q.changePercent} versus the prior close. The attached quote source provides the market price used for this fallback key point.`,
      magnitude: q.changePercent,
      sources: [quoteSource(q.symbol)],
      divergence: blankDivergence(),
    });
  }

  for (const q of [...snapshot.topGainers, ...snapshot.topLosers]) {
    if (points.length >= MIN_KEY_POINTS) break;
    points.push(keyPointFromMover(q, points.length));
  }

  for (const item of snapshot.news) {
    if (points.length >= MIN_KEY_POINTS) break;
    if (!item.source?.url || usedArticleUrls.has(item.source.url)) continue;
    points.push(keyPointFromNews(item, points.length));
  }

  if (points.length < MIN_KEY_POINTS) {
    throw new Error(
      `Market feed only produced ${points.length} deterministic key points`,
    );
  }

  return points.slice(0, 6).map((kp, i) => ({ ...kp, id: `kp${i + 1}` }));
}
