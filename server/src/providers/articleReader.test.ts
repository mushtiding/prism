import { describe, expect, it } from "vitest";
import { extractArticleHtml, isPrivateIp } from "./articleReader.js";

describe("article URL safety", () => {
  it("blocks local and private addresses", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.0.0.4")).toBe(true);
    expect(isPrivateIp("172.16.8.2")).toBe(true);
    expect(isPrivateIp("192.168.1.5")).toBe(true);
    expect(isPrivateIp("100.64.0.1")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fd00::1")).toBe(true);
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("article HTML extraction", () => {
  it("preserves publisher-provided summary bullets", () => {
    const article = extractArticleHtml(
      `
        <html>
          <head><meta property="og:title" content="Markets end week lower"></head>
          <body>
            <nav>Navigation noise</nav>
            <div class="NewsArticle_body__abc">
              <ul class="summary-bullets">
                <li>The S&amp;P 500 fell 0.1% while the Nasdaq 100 lost 1.1%.</li>
                <li>OpenAI is considering delaying its IPO until next year.</li>
                <li>The VanEck Semiconductor ETF dropped 7.3% this week.</li>
              </ul>
              <p>The broader article continues here.</p>
            </div>
          </body>
        </html>
      `,
      "example.com",
    );

    expect(article.title).toBe("Markets end week lower");
    expect(article.highlights).toEqual([
      "The S&P 500 fell 0.1% while the Nasdaq 100 lost 1.1%.",
      "OpenAI is considering delaying its IPO until next year.",
      "The VanEck Semiconductor ETF dropped 7.3% this week.",
    ]);
    expect(article.text).toContain("The broader article continues here.");
    expect(article.text).not.toContain("Navigation noise");
  });
});
