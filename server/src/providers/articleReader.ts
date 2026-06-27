import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parse } from "node-html-parser";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_DOWNLOAD_BYTES = 512_000;
const MAX_REDIRECTS = 3;

export interface ReadArticle {
  title: string;
  text: string;
  url: string;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPrivateIpv4(
      `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
    );
  }
  return false;
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs are supported");
  }
  if (url.username || url.password) throw new Error("URLs with credentials are not supported");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local")) {
    throw new Error("Local URLs are not supported");
  }

  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Private-network URLs are not supported");
  }
}

async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (total < MAX_DOWNLOAD_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = MAX_DOWNLOAD_BYTES - total;
    const chunk = Buffer.from(value.subarray(0, remaining));
    chunks.push(chunk);
    total += chunk.length;
    if (value.length > remaining) {
      await reader.cancel();
      break;
    }
  }

  if (total >= MAX_DOWNLOAD_BYTES) await reader.cancel().catch(() => undefined);

  return Buffer.concat(chunks, total).toString("utf8");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractHtml(html: string, fallbackTitle: string): { title: string; text: string } {
  const root = parse(html);
  for (const node of root.querySelectorAll(
    "script, style, noscript, svg, nav, footer, header, form, aside",
  )) {
    node.remove();
  }

  const title = normalizeText(
    root.querySelector('meta[property="og:title"]')?.getAttribute("content") ??
      root.querySelector("title")?.textContent ??
      fallbackTitle,
  );
  const content =
    root.querySelector("article") ??
    root.querySelector("main") ??
    root.querySelector("body") ??
    root;
  return { title, text: normalizeText(content.textContent) };
}

export async function readArticleUrl(input: string): Promise<ReadArticle> {
  let current = new URL(input);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      headers: {
        Accept: "text/html, text/plain;q=0.9",
        "User-Agent": "PrismArticleReader/0.1",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("Too many redirects");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Article URL returned HTTP ${response.status}`);

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("text/plain")
    ) {
      throw new Error("URL did not return a readable article");
    }

    const body = await readLimitedBody(response);
    const fallbackTitle = current.hostname.replace(/^www\./, "");
    const extracted = !contentType || contentType.includes("text/html")
      ? extractHtml(body, fallbackTitle)
      : { title: fallbackTitle, text: normalizeText(body) };
    return { ...extracted, url: current.toString() };
  }

  throw new Error("Could not read article URL");
}
