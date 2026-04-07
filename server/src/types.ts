export type CrawlStrategy = "direct_sitemap" | "sitemap_primary" | "bfs_fallback";

export interface SitemapUrlEntry {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

export interface PageRecord {
  url: string;
  fetchedAt: string;
  statusCode: number;
  contentType?: string;
  title?: string;
  description?: string;
  canonical?: string;
  language?: string;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  jsonLd: unknown[];
  mainText: string;
  images: { src: string; alt?: string }[];
  forms: {
    action?: string;
    method?: string;
    fields: { name?: string; type?: string }[];
  }[];
  internalLinks: string[];
  externalLinks: string[];
  sitemapLastmod?: string;
}

export interface CrawlResult {
  origin: string;
  seedUrl: string;
  seedWasSitemap: boolean;
  strategy: CrawlStrategy;
  robotsSummary: { fetched: boolean; disallowedPaths: string[]; sitemapLines: string[] };
  discoveredSitemaps: string[];
  pages: PageRecord[];
  warnings: string[];
}

export interface BundleMeta {
  _bundleVersion: string;
  _generatedAt: string;
  _schema?: string;
}
