import { logEvent } from "../logger.js";
import { generateNeutralBriefing } from "../pipeline/neutralBriefing.js";
import { readArticleUrl, type ReadArticle } from "./articleReader.js";
import type {
  MarketDataProvider,
  MarketSnapshot,
  NewsItem,
} from "./marketData.js";

type ArticleReader = (url: string) => Promise<ReadArticle>;

/** Adds publisher-provided takeaway bullets to the articles selected for Today. */
export class ArticleSummaryMarketDataProvider implements MarketDataProvider {
  constructor(
    private readonly inner: MarketDataProvider,
    private readonly reader: ArticleReader = readArticleUrl,
  ) {}

  async fetchSnapshot(): Promise<MarketSnapshot> {
    const snapshot = await this.inner.fetchSnapshot();
    const selectedUrls = new Set(
      generateNeutralBriefing(snapshot).flatMap((keyPoint) => {
        const source = keyPoint.sources.find((candidate) =>
          snapshot.news.some((item) => item.source.url === candidate.url),
        );
        return source ? [source.url] : [];
      }),
    );
    const targets = snapshot.news.filter((item) =>
      selectedUrls.has(item.source.url),
    );

    const enriched = await Promise.all(
      targets.map(async (item): Promise<[string, string[]] | null> => {
        try {
          const article = await this.reader(item.source.url);
          const highlights = article.highlights ?? [];
          return highlights.length >= 2
            ? [item.source.url, highlights.slice(0, 5)]
            : null;
        } catch (err) {
          logEvent(
            `article highlights unavailable · ${item.source.publisher} · ${String(err)}`,
          );
          return null;
        }
      }),
    );
    const highlightsByUrl = new Map(
      enriched.filter((entry): entry is [string, string[]] => entry !== null),
    );

    if (highlightsByUrl.size === 0) return snapshot;
    logEvent(
      `publisher highlights · ${highlightsByUrl.size}/${targets.length} selected articles`,
    );
    const news: NewsItem[] = snapshot.news.map((item) => {
      const highlights = highlightsByUrl.get(item.source.url);
      return highlights ? { ...item, highlights } : item;
    });
    return { ...snapshot, news };
  }
}
