import type { Source } from "@prism/shared";
import { logEvent, trackExternal } from "../logger.js";
import type {
  MarketDataProvider,
  MarketSnapshot,
  NewsItem,
  Quote,
} from "./marketData.js";

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_RSS = "https://feeds.finance.yahoo.com/rss/2.0/headline";
const INDEX_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"];

interface YahooChartMeta {
  symbol: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketTime?: number;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: YahooChartMeta;
    }>;
  };
}

interface QuoteFetch {
  quote: Quote;
  marketTime?: number;
}

interface YahooHeadlineOptions {
  since?: Date;
  limit?: number;
}

function formatChangePercent(price: number, previous: number): string {
  if (!previous) return "0.00%";
  const pct = ((price - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function tradingDayFromUnix(seconds?: number): string {
  if (!seconds) return "";
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

async function fetchQuote(symbol: string): Promise<QuoteFetch | null> {
  const track = trackExternal("Yahoo Finance", `chart ${symbol}`);
  try {
    const url = `${YAHOO_CHART}/${symbol}?interval=1d&range=2d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 Prism/0.1" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as YahooChartResponse;
    const meta = json.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const previous = meta?.chartPreviousClose ?? meta?.previousClose;
    if (!meta?.symbol || price == null || previous == null) {
      throw new Error("missing quote fields");
    }
    track.done();
    return {
      quote: {
        symbol: meta.symbol,
        price,
        changePercent: formatChangePercent(price, previous),
      },
      marketTime: meta.regularMarketTime,
    };
  } catch (err) {
    track.fail(String(err));
    return null;
  }
}

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function readXmlTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function parsePublishedAt(raw: string): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function parseRssItems(xml: string, symbol: string, since?: Date): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

  for (const block of blocks) {
    const title = readXmlTag(block, "title");
    const summary = readXmlTag(block, "description");
    const url = readXmlTag(block, "link");
    const publishedAt = parsePublishedAt(readXmlTag(block, "pubDate"));
    if (!title || !url) continue;
    if (since && publishedAt && new Date(publishedAt) < since) continue;

    const publisher = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, "");
      } catch {
        return "Yahoo Finance";
      }
    })();

    const source: Source = { title, publisher, url };
    items.push({
      title,
      summary: summary || title,
      source,
      tickers: [symbol],
      publishedAt,
    });
    if (items.length >= 12) break;
  }

  return items;
}

async function fetchHeadlines(
  symbol: string,
  since?: Date,
): Promise<NewsItem[]> {
  const track = trackExternal("Yahoo Finance", `RSS ${symbol}`);
  try {
    const url = `${YAHOO_RSS}?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 Prism/0.1" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseRssItems(xml, symbol, since);
    if (items.length === 0) throw new Error("no RSS items");
    track.done(`${items.length} headlines`);
    return items;
  } catch (err) {
    track.fail(String(err));
    return [];
  }
}

/** Real recent headlines from Yahoo RSS, shared by Alpha's news fallback. */
export async function fetchYahooHeadlines(
  symbols: string[] = INDEX_SYMBOLS,
  options: YahooHeadlineOptions = {},
): Promise<NewsItem[]> {
  const limit = options.limit ?? 12;
  const news: NewsItem[] = [];

  for (const symbol of symbols) {
    const batch = await fetchHeadlines(symbol, options.since);
    for (const item of batch) {
      if (!news.some((n) => n.title === item.title)) news.push(item);
      if (news.length >= limit) break;
    }
    if (news.length >= limit) break;
  }

  return news.slice(0, limit);
}

/** Keyless US market snapshot via Yahoo Finance chart + RSS headlines. */
export class YahooFinanceProvider implements MarketDataProvider {
  async fetchSnapshot(): Promise<MarketSnapshot> {
    const fetched = (
      await Promise.all(INDEX_SYMBOLS.map((symbol) => fetchQuote(symbol)))
    ).filter((q): q is QuoteFetch => q !== null);

    const indexQuotes = fetched.map((f) => f.quote);
    if (indexQuotes.length === 0) {
      throw new Error("Yahoo Finance returned no index quotes");
    }

    const tradingDay =
      tradingDayFromUnix(fetched.find((f) => f.marketTime)?.marketTime) ||
      new Date().toISOString().slice(0, 10);

    const since = new Date(`${tradingDay}T00:00:00Z`);
    const news = await fetchYahooHeadlines(INDEX_SYMBOLS, {
      since: Number.isNaN(since.getTime()) ? undefined : since,
      limit: 12,
    });

    if (news.length === 0) {
      logEvent("Yahoo RSS empty — synthesizing headlines from quotes");
      for (const q of indexQuotes) {
        news.push({
          title: `${q.symbol} at ${q.price} (${q.changePercent})`,
          summary: `${q.symbol} last traded at ${q.price}, ${q.changePercent} vs the prior close.`,
          source: {
            title: `${q.symbol} quote`,
            publisher: "Yahoo Finance",
            url: `https://finance.yahoo.com/quote/${q.symbol}`,
          },
          tickers: [q.symbol],
        });
      }
    }

    return {
      tradingDay,
      indexQuotes,
      topGainers: [],
      topLosers: [],
      news: news.slice(0, 12),
    };
  }
}
