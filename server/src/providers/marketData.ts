import type { Source } from "@prism/shared";

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
  ticker_sentiment?: { ticker: string }[];
}

interface AvNewsResponse {
  feed?: AvNewsItem[];
}

async function avGet<T>(params: Record<string, string>, apiKey: string): Promise<T> {
  const url = new URL(AV_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", apiKey);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  // Alpha Vantage returns 200 with an "Information"/"Note" field on rate limit.
  if ("Information" in json || "Note" in json) {
    throw new Error(`Alpha Vantage limit: ${json.Information ?? json.Note}`);
  }
  return json as T;
}

function mover(m: AvMover): Quote {
  return {
    symbol: m.ticker,
    price: Number(m.price),
    changePercent: m.change_percentage,
  };
}

export class AlphaVantageProvider implements MarketDataProvider {
  constructor(private apiKey: string) {}

  async fetchSnapshot(): Promise<MarketSnapshot> {
    const quotes = await Promise.all(
      INDEX_SYMBOLS.map((s) =>
        avGet<AvGlobalQuote>({ function: "GLOBAL_QUOTE", symbol: s }, this.apiKey),
      ),
    );
    const indexQuotes: Quote[] = quotes
      .map((q) => q["Global Quote"])
      .filter((q): q is NonNullable<typeof q> => Boolean(q?.["01. symbol"]))
      .map((q) => ({
        symbol: q["01. symbol"],
        price: Number(q["05. price"]),
        changePercent: q["10. change percent"],
      }));

    const tradingDay =
      quotes[0]?.["Global Quote"]?.["07. latest trading day"] ?? "";

    const movers = await avGet<AvTopMovers>(
      { function: "TOP_GAINERS_LOSERS" },
      this.apiKey,
    );

    const news = await avGet<AvNewsResponse>(
      {
        function: "NEWS_SENTIMENT",
        topics: "financial_markets,economy_macro,earnings,technology",
        sort: "RELEVANCE",
        limit: "20",
      },
      this.apiKey,
    );

    return {
      tradingDay,
      indexQuotes,
      topGainers: (movers.top_gainers ?? []).slice(0, 5).map(mover),
      topLosers: (movers.top_losers ?? []).slice(0, 5).map(mover),
      news: (news.feed ?? []).slice(0, 12).map((n) => ({
        title: n.title,
        summary: n.summary,
        source: { title: n.title, publisher: n.source, url: n.url },
        tickers: (n.ticker_sentiment ?? []).map((t) => t.ticker),
      })),
    };
  }
}
