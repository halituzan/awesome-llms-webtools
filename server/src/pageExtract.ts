import * as cheerio from "cheerio";
import type { PageRecord } from "./types.js";

function absUrl(base: string, href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).href;
  } catch {
    return undefined;
  }
}

function textFromMain($: cheerio.CheerioAPI): string {
  const main =
    $("main").first().text() ||
    $("article").first().text() ||
    $('[role="main"]').first().text() ||
    $("body").text();
  const cleaned = main.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 120_000);
}

export function extractPage(html: string, pageUrl: string, sitemapLastmod?: string): PageRecord {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || undefined;
  const desc =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim();
  const canonical = $('link[rel="canonical"]').attr("href");
  const language = $("html").attr("lang") || $('meta[http-equiv="content-language"]').attr("content");

  const openGraph: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr("property");
    const content = $(el).attr("content");
    if (prop && content) openGraph[prop] = content;
  });

  const twitter: Record<string, string> = {};
  $('meta[name^="twitter:"]').each((_, el) => {
    const name = $(el).attr("name");
    const content = $(el).attr("content");
    if (name && content) twitter[name] = content;
  });

  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      jsonLd.push(JSON.parse(raw));
    } catch {
      jsonLd.push({ _parseError: true, raw: raw.slice(0, 2000) });
    }
  });

  const images: { src: string; alt?: string }[] = [];
  $("img[src]").each((_, el) => {
    const src = absUrl(pageUrl, $(el).attr("src"));
    if (!src) return;
    images.push({ src, alt: $(el).attr("alt")?.trim() });
  });

  const forms: PageRecord["forms"] = [];
  $("form").each((_, el) => {
    const action = absUrl(pageUrl, $(el).attr("action")) ?? pageUrl;
    const method = ($(el).attr("method") || "get").toUpperCase();
    const fields: { name?: string; type?: string }[] = [];
    $(el)
      .find("input, select, textarea")
      .each((__, field) => {
        const name = $(field).attr("name");
        const type = $(field).attr("type") || field.tagName.toLowerCase();
        fields.push({ name, type });
      });
    forms.push({ action, method, fields });
  });

  const origin = new URL(pageUrl).origin;
  const internalLinks: string[] = [];
  const externalLinks: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const u = absUrl(pageUrl, href);
    if (!u || u.startsWith("javascript:") || u.startsWith("mailto:")) return;
    try {
      const o = new URL(u);
      if (o.origin === origin) internalLinks.push(o.href);
      else externalLinks.push(o.href);
    } catch {
      /* skip */
    }
  });

  return {
    url: pageUrl,
    fetchedAt: new Date().toISOString(),
    statusCode: 200,
    contentType: "text/html",
    title,
    description: desc,
    canonical: canonical ? absUrl(pageUrl, canonical) : undefined,
    language,
    openGraph,
    twitter,
    jsonLd,
    mainText: textFromMain($),
    images: images.slice(0, 200),
    forms,
    internalLinks: [...new Set(internalLinks)].slice(0, 500),
    externalLinks: [...new Set(externalLinks)].slice(0, 300),
    sitemapLastmod,
  };
}
