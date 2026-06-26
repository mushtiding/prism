import type { Source } from "@prism/shared";
import { logEvent, trackExternal } from "../logger.js";
import { fetchYahooHeadlines } from "./yahooFinance.js";

/** A single index/equity move with magnitude. */
export interface Quote {
  symbol: string;
  price: number;
  changePercent: string;
}

/** A headline plausibly driving moves, with a citable source. */
export interface NewsItem {
  title: string;
  summary: string;
  source: Source;
  tickers: string[];
  /** ISO timestamp when the provider exposes one. Used to prefer recent items. */
  publishedAt?: string;
}

/** Normalized market snapshot — the raw input to the neutral briefing. */
export interface MarketSnapshot {
  tradingDay: string;
  indexQuotes: Quote[];
  topGainers: Quote[];
  topLosers: Quote[];
  news: NewsItem[];
}

export interface MarketDataProvider {
  fetchSnapshot(): Promise<MarketSnapshot>;
}

const AV_BASE = "https://www.alphavantage.co/query";
const AV_SOURCE_URL = "https://www.alphavantage.co/";

// Free Alpha Vantage keys: 1 request / second. Space calls out sequentially.
const AV_MIN_GAP_MS = 1_100;

// US-equity index proxies (Alpha Vantage GLOBAL_QUOTE works on liquid ETFs).
const INDEX_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"];

interface AvGlobalQuote {
  "Global Quote"?: {
    "01. symbol": string;
    "05. price": string;
    "07. latest trading day": string;
    "10. change percent": string;
  };
}

interface AvMover {
  ticker: string;
  price: string;
  change_percentage: string;
}

interface AvTopMovers {
  top_gainers?: AvMover[];
  top_losers?: AvMover[];
}

interface AvNewsItem {
  title: string;
  url: string;
  summary: string;
  source: string;
  time_published?: string;
  ticker_sentiment?: { ticker: string }[];
}

interface AvNewsResponse {
  feed?: AvNewsItem[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function avApiError(json: Record<string, unknown>): string | null {
  for (const key of ["Error Message", "Information", "Note"]) {
    const value = json[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function classifyAvError(message: string): string {
  const redacted = message
    .replace(/api key as [A-Za-z0-9._-]+/gi, "API key as [redacted]")
    .replace(/apikey=[^&\s]+/gi, "apikey=[redacted]");
  if (/spread out|rate limit|calls per|per second|25 requests per day/i.test(redacted)) {
    return `Alpha Vantage rate limit — ${redacted}`;
  }
  if (/invalid api key|apikey|api key/i.test(redacted)) {
    return `Alpha Vantage auth error — check ALPHAVANTAGE_API_KEY: ${redacted}`;
  }
  if (/invalid inputs/i.test(redacted)) {
    return `Alpha Vantage invalid request — ${redacted}`;
  }
  return redacted;
}

async function avGet<T>(
  params: Record<string, string>,
  apiKey: string,
  label: string,
): Promise<T> {
  const track = trackExternal("Alpha Vantage", label);
  try {
    const url = new URL(AV_BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("apikey", apiKey);
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    const err = avApiError(json);
    if (err) throw new Error(classifyAvError(err));
    track.done();
    return json as T;
  } catch (err) {
    track.fail(String(err));
    throw err;
  }
}

function mover(m: AvMover): Quote {
  return {
    symbol: m.ticker,
    price: Number(m.price),
    changePercent: m.change_percentage,
  };
}

function mapNewsFeed(feed: AvNewsItem[]): NewsItem[] {
  return feed.slice(0, 12).map((n) => ({
    title: n.title,
    summary: n.summary,
    source: { title: n.title, publisher: n.source, url: n.url },
    tickers: (n.ticker_sentiment ?? []).map((t) => t.ticker),
    publishedAt: parseAlphaTime(n.time_published),
  }));
}

function parseAlphaTime(raw: string | undefined): string | undefined {
  const m = raw?.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/,
  );
  if (!m) return undefined;
  const [, yyyy, mm, dd, hh, min, ss = "00"] = m;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}Z`;
}

/** Citable headlines synthesized from quotes/movers when NEWS_SENTIMENT is unavailable. */
function fallbackNewsFromMarket(
  indexQuotes: Quote[],
  topGainers: Quote[],
  topLosers: Quote[],
): NewsItem[] {
  const items: NewsItem[] = indexQuotes.map((q) => ({
    title: `${q.symbol} closed at ${q.price} (${q.changePercent})`,
    summary: `The ${q.symbol} proxy finished at ${q.price}, ${q.changePercent} on the session.`,
    source: {
      title: `${q.symbol} market quote`,
      publisher: "Alpha Vantage",
      url: AV_SOURCE_URL,
    },
    tickers: [q.symbol],
  }));

  for (const q of topGainers.slice(0, 3)) {
    items.push({
      title: `${q.symbol} among top gainers (${q.changePercent})`,
      summary: `${q.symbol} was a top gainer, moving ${q.changePercent}.`,
      source: {
        title: `${q.symbol} top gainer`,
        publisher: "Alpha Vantage",
        url: AV_SOURCE_URL,
      },
      tickers: [q.symbol],
    });
  }

  for (const q of topLosers.slice(0, 3)) {
    items.push({
      title: `${q.symbol} among top losers (${q.changePercent})`,
      summary: `${q.symbol} was a top loser, moving ${q.changePercent}.`,
      source: {
        title: `${q.symbol} top loser`,
        publisher: "Alpha Vantage",
        url: AV_SOURCE_URL,
      },
      tickers: [q.symbol],
    });
  }

  return items.slice(0, 12);
}

function newsWindowStart(tradingDay: string | undefined): Date {
  const fromTradingDay = tradingDay
    ? new Date(`${tradingDay}T00:00:00Z`)
    : null;
  if (fromTradingDay && !Number.isNaN(fromTradingDay.getTime())) {
    return fromTradingDay;
  }
  return new Date(Date.now() - 72 * 60 * 60 * 1000);
}

function avNewsTimeFrom(tradingDay: string | undefined): string {
  const d = newsWindowStart(tradingDay);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T0000`;
}

async function fetchNews(
  apiKey: string,
  indexQuotes: Quote[],
  topGainers: Quote[],
  topLosers: Quote[],
  tradingDay: string | undefined,
): Promise<NewsItem[]> {
  const since = newsWindowStart(tradingDay);
  const timeFrom = avNewsTimeFrom(tradingDay);
  const attempts: Array<{ label: string; params: Record<string, string> }> = [
    {
      label: "NEWS_SENTIMENT tickers",
      params: {
        function: "NEWS_SENTIMENT",
        tickers: INDEX_SYMBOLS.join(","),
        topics: "financial_markets",
        time_from: timeFrom,
        sort: "LATEST",
        limit: "50",
      },
    },
    {
      label: "NEWS_SENTIMENT topic",
      params: {
        function: "NEWS_SENTIMENT",
        topics: "financial_markets",
        time_from: timeFrom,
        sort: "LATEST",
        limit: "50",
      },
    },
  ];

  for (const attempt of attempts) {
    try {
      const news = await avGet<AvNewsResponse>(
        attempt.params,
        apiKey,
        attempt.label,
      );
      const mapped = mapNewsFeed(news.feed ?? []);
      if (mapped.length > 0) return mapped;
      logEvent(`${attempt.label} returned no articles, trying next…`);
    } catch (err) {
      logEvent(`${attempt.label} failed: ${err}`);
    }
    await sleep(AV_MIN_GAP_MS);
  }

  const yahoo = await fetchYahooHeadlines(INDEX_SYMBOLS, {
    since,
    limit: 12,
  });
  if (yahoo.length > 0) {
    logEvent(
      `using Yahoo Finance headlines as news fallback (${yahoo.length} items)`,
    );
    return yahoo;
  }

  const fallback = fallbackNewsFromMarket(indexQuotes, topGainers, topLosers);
  logEvent(
    `using quote/mover headlines as last-resort news fallback (${fallback.length} items) — external news feeds were unavailable`,
  );
  return fallback;
}

export class AlphaVantageProvider implements MarketDataProvider {
  constructor(private apiKey: string) {}

  async fetchSnapshot(): Promise<MarketSnapshot> {
    const quotes: AvGlobalQuote[] = [];
    let quotaHit = false;
    for (const symbol of INDEX_SYMBOLS) {
      try {
        quotes.push(
          await avGet<AvGlobalQuote>(
            { function: "GLOBAL_QUOTE", symbol },
            this.apiKey,
            `GLOBAL_QUOTE ${symbol}`,
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/25 requests per day|rate limit|spread out|calls per/i.test(msg)) {
          quotaHit = true;
          break;
        }
        logEvent(`GLOBAL_QUOTE ${symbol} failed: ${msg}`);
      }
      await sleep(AV_MIN_GAP_MS);
    }

    if (quotaHit && quotes.length === 0) {
      throw new Error(
        "Alpha Vantage rate limit — 25 requests per day on the free tier",
      );
    }

    const indexQuotes: Quote[] = quotes
      .map((q) => q["Global Quote"])
      .filter((q): q is NonNullable<typeof q> => Boolean(q?.["01. symbol"]))
      .map((q) => ({
        symbol: q["01. symbol"],
        price: Number(q["05. price"]),
        changePercent: q["10. change percent"],
      }));

    if (indexQuotes.length === 0) {
      throw new Error(
        "Alpha Vantage returned no index quotes — likely rate-limited; wait a minute and retry",
      );
    }

    const tradingDay =
      quotes[0]?.["Global Quote"]?.["07. latest trading day"] ?? "";

    const movers = await avGet<AvTopMovers>(
      { function: "TOP_GAINERS_LOSERS" },
      this.apiKey,
      "TOP_GAINERS_LOSERS",
    );
    await sleep(AV_MIN_GAP_MS);

    const topGainers = (movers.top_gainers ?? []).slice(0, 5).map(mover);
    const topLosers = (movers.top_losers ?? []).slice(0, 5).map(mover);
    const news = await fetchNews(
      this.apiKey,
      indexQuotes,
      topGainers,
      topLosers,
      tradingDay,
    );

    return {
      tradingDay,
      indexQuotes,
      topGainers,
      topLosers,
      news,
    };
  }
}
