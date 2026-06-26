import { logEvent } from "../logger.js";
import type { MarketDataProvider, MarketSnapshot } from "./marketData.js";
import { AlphaVantageProvider } from "./marketData.js";
import { YahooFinanceProvider } from "./yahooFinance.js";

function isAvQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /25 requests per day|rate limit|spread out|calls per/i.test(msg);
}

/**
 * Prefer Alpha Vantage when quota allows; fall back to Yahoo Finance so live
 * generation still works after the free-tier daily cap is exhausted.
 */
export class ResilientMarketDataProvider implements MarketDataProvider {
  private yahoo = new YahooFinanceProvider();

  constructor(private alphaVantage: AlphaVantageProvider) {}

  async fetchSnapshot(): Promise<MarketSnapshot> {
    try {
      return await this.alphaVantage.fetchSnapshot();
    } catch (err) {
      if (!isAvQuotaError(err)) throw err;
      logEvent(
        `Alpha Vantage quota/rate limit hit — falling back to Yahoo Finance (${String(err)})`,
      );
      return this.yahoo.fetchSnapshot();
    }
  }
}
