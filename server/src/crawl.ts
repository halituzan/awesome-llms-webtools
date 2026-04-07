import { assertSafeUrl } from "./ssrf.js";
import { safeFetchText } from "./http.js";
import { parseRobotsTxt } from "./robots.js";
import { looksLikeSitemapContent, parseSitemapXml } from "./sitemap.js";
import { extractPage } from "./pageExtract.js";
import type { CrawlResult, CrawlStrategy, PageRecord, SitemapUrlEntry } from "./types.js";

const SKIP_EXT = /\.(pdf|zip|png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|woff2?|ttf|eot|mp4|mp3|wav)$/i;

function normalizeHost(host: string): string {
  const h = host.toLowerCase();
  return h.startsWith("www.") ? h.slice(4) : h;
}

function sameSite(hostA: string, hostB: string): boolean {
  return normalizeHost(hostA) === normalizeHost(hostB);
}

function isProbablyHtmlPath(url: string): boolean {
  try {
    const p = new URL(url).pathname;
    if (SKIP_EXT.test(p)) return false;
    return true;
  } catch {
    return false;
  }
}

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  maxSitemapNesting?: number;
  timeoutMs?: number;
}

const DEFAULTS: Required<CrawlOptions> = {
  maxPages: 100,
  maxDepth: 4,
  maxSitemapNesting: 12,
  timeoutMs: 20_000,
};

async function fetchSitemapRecursive(
  sitemapUrl: string,
  allowedHost: string,
  visited: Set<string>,
  depth: number,
  maxNesting: number,
  timeoutMs: number,
  acc: SitemapUrlEntry[]
): Promise<void> {
  if (depth > maxNesting || visited.has(sitemapUrl)) return;
  visited.add(sitemapUrl);
  let text: string;
  let contentType: string;
  try {
    await assertSafeUrl(sitemapUrl);
    const r = await safeFetchText(sitemapUrl, { timeoutMs });
    if (!r.ok) return;
    text = r.text;
    contentType = r.contentType;
  } catch {
    return;
  }
  if (!looksLikeSitemapContent(text, contentType)) return;

  const parsed = parseSitemapXml(text);
  if (parsed.kind === "urlset") {
    for (const e of parsed.entries) {
      try {
        const u = new URL(e.loc);
        if (!sameSite(u.hostname, allowedHost)) continue;
        acc.push(e);
      } catch {
        /* skip */
      }
    }
    return;
  }
  if (parsed.kind === "index") {
    for (const c of parsed.childSitemaps) {
      await fetchSitemapRecursive(c.loc, allowedHost, visited, depth + 1, maxNesting, timeoutMs, acc);
    }
  }
}

async function discoverSitemapUrlsFromRobotsAndCommon(origin: string, allowedHost: string, timeoutMs: number): Promise<string[]> {
  const urls: string[] = [];
  const robotsUrl = new URL("/robots.txt", origin).href;
  try {
    await assertSafeUrl(robotsUrl);
    const r = await safeFetchText(robotsUrl, { timeoutMs });
    if (r.ok) {
      const { sitemaps } = parseRobotsTxt(r.text);
      urls.push(...sitemaps);
    }
  } catch {
    /* ignore */
  }
  const common = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/wp-sitemap.xml"];
  for (const path of common) {
    urls.push(new URL(path, origin).href);
  }
  return [...new Set(urls)];
}

function sortEntries(entries: SitemapUrlEntry[]): SitemapUrlEntry[] {
  return [...entries].sort((a, b) => {
    const ta = a.lastmod ? Date.parse(a.lastmod) : 0;
    const tb = b.lastmod ? Date.parse(b.lastmod) : 0;
    if (tb !== ta) return tb - ta;
    const pa = parseFloat(a.priority ?? "0.5");
    const pb = parseFloat(b.priority ?? "0.5");
    return pb - pa;
  });
}

async function bfsCollect(
  startUrl: string,
  allowedHost: string,
  maxPages: number,
  maxDepth: number,
  timeoutMs: number,
  existing: Set<string>
): Promise<string[]> {
  const collected: string[] = [];
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
  const seen = new Set<string>(existing);

  while (queue.length > 0 && collected.length + existing.size < maxPages * 2) {
    const { url, depth } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    if (!isProbablyHtmlPath(url)) continue;

    let page: PageRecord | null = null;
    let finalPageUrl = url;
    try {
      await assertSafeUrl(url);
      const r = await safeFetchText(url, { timeoutMs, headers: { accept: "text/html,application/xhtml+xml" } });
      if (!r.ok || !r.contentType.toLowerCase().includes("html")) continue;
      finalPageUrl = r.finalUrl;
      page = extractPage(r.text, finalPageUrl);
    } catch {
      continue;
    }
    collected.push(finalPageUrl);
    if (collected.length >= maxPages) break;
    if (depth >= maxDepth) continue;
    for (const link of page.internalLinks) {
      if (!seen.has(link) && isProbablyHtmlPath(link)) {
        try {
          if (!sameSite(new URL(link).hostname, allowedHost)) continue;
        } catch {
          continue;
        }
        queue.push({ url: link, depth: depth + 1 });
      }
    }
  }
  return collected;
}

export async function crawlSite(seedInput: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const opts = { ...DEFAULTS, ...options };
  const warnings: string[] = [];

  let seedUrl = seedInput.trim();
  if (!/^https?:\/\//i.test(seedUrl)) {
    seedUrl = `https://${seedUrl}`;
  }

  await assertSafeUrl(seedUrl);
  const seedParsed = new URL(seedUrl);
  const allowedHost = seedParsed.hostname;
  const origin = seedParsed.origin;

  let strategy: CrawlStrategy = "sitemap_primary";
  let seedWasSitemap = false;
  const discoveredSitemaps: string[] = [];
  const sitemapEntries: SitemapUrlEntry[] = [];
  const visitedSitemaps = new Set<string>();

  const first = await safeFetchText(seedUrl, { timeoutMs: opts.timeoutMs });
  if (!first.ok) {
    throw new Error(`Failed to fetch seed URL: HTTP ${first.status}`);
  }

  const isSitemap =
    looksLikeSitemapContent(first.text, first.contentType) ||
    /sitemap/i.test(seedParsed.pathname);

  if (isSitemap && parseSitemapXml(first.text).kind !== "unknown") {
    seedWasSitemap = true;
    strategy = "direct_sitemap";
    discoveredSitemaps.push(first.finalUrl);
    await fetchSitemapRecursive(
      first.finalUrl,
      allowedHost,
      visitedSitemaps,
      0,
      opts.maxSitemapNesting,
      opts.timeoutMs,
      sitemapEntries
    );
  } else {
    const toFetch = await discoverSitemapUrlsFromRobotsAndCommon(origin, allowedHost, opts.timeoutMs);
    for (const su of toFetch) {
      discoveredSitemaps.push(su);
      await fetchSitemapRecursive(su, allowedHost, visitedSitemaps, 0, opts.maxSitemapNesting, opts.timeoutMs, sitemapEntries);
    }
  }

  let urlToMeta = new Map<string, SitemapUrlEntry>();
  for (const e of sitemapEntries) {
    try {
      const u = new URL(e.loc).href;
      const prev = urlToMeta.get(u);
      if (!prev || (e.lastmod && (!prev.lastmod || e.lastmod > prev.lastmod))) {
        urlToMeta.set(u, e);
      }
    } catch {
      /* skip */
    }
  }

  const sorted = sortEntries([...urlToMeta.values()]);
  let pageUrls = sorted.map((e) => e.loc).filter(isProbablyHtmlPath).slice(0, opts.maxPages);

  if (pageUrls.length === 0) {
    strategy = "bfs_fallback";
    warnings.push("No URLs found in sitemaps; falling back to link crawl from the homepage.");
  } else if (pageUrls.length < 10 && sorted.length > 0) {
    warnings.push("Sitemap returned few HTML URLs; internal link crawl may add more pages.");
  }

  if (!seedWasSitemap && first.contentType.toLowerCase().includes("html")) {
    try {
      const su = new URL(seedUrl).href;
      if (sameSite(new URL(su).hostname, allowedHost) && isProbablyHtmlPath(su) && !pageUrls.includes(su)) {
        pageUrls.unshift(su);
        if (!urlToMeta.has(su)) urlToMeta.set(su, { loc: su });
        pageUrls = pageUrls.slice(0, opts.maxPages);
      }
    } catch {
      /* skip */
    }
  }

  if (pageUrls.length < opts.maxPages) {
    const start = new URL("/", origin).href;
    const extra = await bfsCollect(start, allowedHost, opts.maxPages, opts.maxDepth, opts.timeoutMs, new Set(pageUrls));
    const merged = new Set(pageUrls);
    for (const u of extra) {
      if (merged.size >= opts.maxPages) break;
      if (!merged.has(u)) {
        merged.add(u);
        if (!urlToMeta.has(u)) urlToMeta.set(u, { loc: u });
      }
    }
    pageUrls = [...merged].filter(isProbablyHtmlPath).slice(0, opts.maxPages);
  }

  if (pageUrls.length === 0) {
    const home = new URL("/", origin).href;
    const extra = await bfsCollect(home, allowedHost, opts.maxPages, opts.maxDepth, opts.timeoutMs, new Set());
    pageUrls = extra.slice(0, opts.maxPages);
    strategy = "bfs_fallback";
    if (pageUrls.length === 0) {
      throw new Error("Could not collect any HTML pages for this site.");
    }
  }

  const pages: PageRecord[] = [];
  for (const u of pageUrls) {
    try {
      await assertSafeUrl(u);
      const r = await safeFetchText(u, { timeoutMs: opts.timeoutMs, headers: { accept: "text/html" } });
      if (!r.ok) {
        warnings.push(`Skipped ${u} (HTTP ${r.status})`);
        continue;
      }
      if (!r.contentType.toLowerCase().includes("html")) {
        warnings.push(`Skipped ${u} (not HTML)`);
        continue;
      }
      const meta = urlToMeta.get(new URL(u).href) ?? urlToMeta.get(u);
      const lastmod = meta?.lastmod;
      pages.push(extractPage(r.text, r.finalUrl, lastmod));
    } catch (e) {
      warnings.push(`Skipped ${u}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let robotsSummary = { fetched: false, disallowedPaths: [] as string[], sitemapLines: [] as string[] };
  try {
    const robotsUrl = new URL("/robots.txt", origin).href;
    await assertSafeUrl(robotsUrl);
    const r = await safeFetchText(robotsUrl, { timeoutMs: opts.timeoutMs });
    if (r.ok) {
      const parsed = parseRobotsTxt(r.text);
      robotsSummary = {
        fetched: true,
        disallowedPaths: parsed.disallowAll ? ["/"] : [],
        sitemapLines: parsed.sitemaps,
      };
    }
  } catch {
    /* ignore */
  }

  return {
    origin,
    seedUrl,
    seedWasSitemap,
    strategy,
    robotsSummary,
    discoveredSitemaps: [...new Set(discoveredSitemaps)],
    pages,
    warnings,
  };
}
