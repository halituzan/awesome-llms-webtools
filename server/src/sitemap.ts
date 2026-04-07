import { XMLParser } from "fast-xml-parser";
import type { SitemapUrlEntry } from "./types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
  isArray: (name) => name === "url" || name === "sitemap",
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export type ParsedSitemap =
  | { kind: "urlset"; entries: SitemapUrlEntry[] }
  | { kind: "index"; childSitemaps: { loc: string; lastmod?: string }[] }
  | { kind: "unknown" };

export function parseSitemapXml(xml: string): ParsedSitemap {
  let data: unknown;
  try {
    data = parser.parse(xml);
  } catch {
    return { kind: "unknown" };
  }
  if (!data || typeof data !== "object") return { kind: "unknown" };
  const o = data as Record<string, unknown>;

  if (o.urlset) {
    const urlset = o.urlset as Record<string, unknown>;
    const urls = asArray(urlset.url as Record<string, unknown> | Record<string, unknown>[]);
    const entries: SitemapUrlEntry[] = [];
    for (const u of urls) {
      const loc = typeof u.loc === "string" ? u.loc : undefined;
      if (!loc) continue;
      entries.push({
        loc,
        lastmod: typeof u.lastmod === "string" ? u.lastmod : undefined,
        changefreq: typeof u.changefreq === "string" ? u.changefreq : undefined,
        priority: typeof u.priority === "string" ? u.priority : undefined,
      });
    }
    return { kind: "urlset", entries };
  }

  if (o.sitemapindex) {
    const idx = o.sitemapindex as Record<string, unknown>;
    const sm = asArray(idx.sitemap as Record<string, unknown> | Record<string, unknown>[]);
    const childSitemaps: { loc: string; lastmod?: string }[] = [];
    for (const s of sm) {
      const loc = typeof s.loc === "string" ? s.loc : undefined;
      if (!loc) continue;
      childSitemaps.push({
        loc,
        lastmod: typeof s.lastmod === "string" ? s.lastmod : undefined,
      });
    }
    return { kind: "index", childSitemaps };
  }

  return { kind: "unknown" };
}

export function looksLikeSitemapContent(text: string, contentType: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes("xml")) return true;
  const t = text.trimStart().slice(0, 500).toLowerCase();
  return (
    t.startsWith("<?xml") ||
    t.includes("<urlset") ||
    t.includes("<sitemapindex")
  );
}
