import type { CrawlResult } from "./types.js";
import { collectGithubUrls, tryGithubRepoStars } from "./github.js";

const BUNDLE_VERSION = "1.0.0";

function json(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + "\n";
}

function buildLlmsTxt(crawl: CrawlResult, siteTitle: string): string {
  const lines: string[] = [];
  lines.push(`# ${siteTitle}`);
  lines.push("");
  lines.push(`> Auto-generated LLM index. Origin: ${crawl.origin}`);
  lines.push(`> Seed: ${crawl.seedUrl}`);
  lines.push("");
  lines.push("## Important pages");
  for (const p of crawl.pages.slice(0, 40)) {
    lines.push(`- [${p.title ?? p.url}](${p.url})`);
  }
  lines.push("");
  lines.push("## How to use this bundle");
  lines.push("- Start with `ai-manifest.json` for file roles and suggested ingestion order.");
  lines.push("- Use `llms-full.json` for page-level text and metadata.");
  lines.push("- Use `rag-config.json` for chunking defaults; tune per your embedding model.");
  lines.push("");
  return lines.join("\n");
}

function buildLlmsFull(crawl: CrawlResult, generatedAt: string) {
  return {
    _bundleVersion: BUNDLE_VERSION,
    _generatedAt: generatedAt,
    _schema: "site-to-llm/llms-full#1",
    site: { origin: crawl.origin, seedUrl: crawl.seedUrl, seedWasSitemap: crawl.seedWasSitemap },
    pages: crawl.pages.map((p) => ({
      url: p.url,
      title: p.title,
      description: p.description,
      canonical: p.canonical,
      language: p.language,
      fetchedAt: p.fetchedAt,
      sitemapLastmod: p.sitemapLastmod,
      mainTextPreview: p.mainText.slice(0, 4000),
      openGraph: p.openGraph,
      twitter: p.twitter,
      jsonLd: p.jsonLd,
      imageCount: p.images.length,
      formCount: p.forms.length,
    })),
    warnings: crawl.warnings,
  };
}

function buildKnowledgeGraph(crawl: CrawlResult, generatedAt: string) {
  const nodes: object[] = [];
  const edges: object[] = [];
  const originHost = new URL(crawl.origin).hostname;
  nodes.push({
    id: "site:root",
    type: "WebSite",
    label: originHost,
    url: crawl.origin,
  });
  for (const p of crawl.pages) {
    const id = `page:${p.url}`;
    nodes.push({
      id,
      type: "WebPage",
      label: p.title ?? p.url,
      url: p.url,
      lastmod: p.sitemapLastmod,
    });
    edges.push({ from: "site:root", to: id, rel: "hasPart" });
    for (const ext of p.externalLinks.slice(0, 20)) {
      edges.push({ from: id, to: ext, rel: "linksTo", external: true });
    }
    for (const inn of p.internalLinks.slice(0, 30)) {
      edges.push({ from: id, to: inn, rel: "linksTo", internal: true });
    }
  }
  return {
    _bundleVersion: BUNDLE_VERSION,
    _generatedAt: generatedAt,
    _schema: "site-to-llm/knowledge-graph#1",
    aiHints: "Use nodes/edges for retrieval expansion; external edges are world-centric hooks.",
    nodes,
    edges,
  };
}

function buildToolsJson(crawl: CrawlResult, generatedAt: string) {
  const endpoints: object[] = [];
  for (const p of crawl.pages) {
    for (const f of p.forms) {
      endpoints.push({
        kind: "form",
        pageUrl: p.url,
        action: f.action,
        method: f.method,
        fields: f.fields.slice(0, 40),
        exampleCurl:
          f.method === "GET" && f.action
            ? `curl -sS ${JSON.stringify(f.action)}`
            : f.action
              ? `curl -sS -X ${f.method} ${JSON.stringify(f.action)} -H 'Content-Type: application/x-www-form-urlencoded' --data ''`
              : undefined,
      });
    }
  }
  const apiLike = new Set<string>();
  for (const p of crawl.pages) {
    for (const link of p.internalLinks) {
      if (/\/api\//i.test(link)) apiLike.add(link);
    }
  }
  for (const u of [...apiLike].slice(0, 50)) {
    endpoints.push({ kind: "suspected_api_path", url: u, confidence: "heuristic" });
  }
  return {
    _bundleVersion: BUNDLE_VERSION,
    _generatedAt: generatedAt,
    _schema: "site-to-llm/tools#1",
    notes: "Example calls are illustrative; respect robots.txt and site terms.",
    endpoints,
  };
}

function buildAgentsJson(crawl: CrawlResult, generatedAt: string) {
  return {
    _bundleVersion: BUNDLE_VERSION,
    _generatedAt: generatedAt,
    _schema: "site-to-llm/agents#1",
    suggestions: [
      {
        id: "summarize_site",
        description: "Summarize the site using llms.txt + llms-full.json page previews.",
        inputs: ["llms.txt", "llms-full.json"],
      },
      {
        id: "form_fill_assist",
        description: "If forms are public, use tools.json actions with explicit user consent.",
        inputs: ["tools.json"],
      },
    ],
    automationPoints: crawl.pages.flatMap((p) =>
      p.forms.map((f) => ({
        pageUrl: p.url,
        action: f.action,
        method: f.method,
        requiresUserConsent: true,
      }))
    ),
  };
}

function buildRagConfig(crawl: CrawlResult, generatedAt: string) {
  const lang = crawl.pages.find((p) => p.language)?.language ?? "und";
  return {
    _bundleVersion: BUNDLE_VERSION,
    _generatedAt: generatedAt,
    _schema: "site-to-llm/rag-config#1",
    chunking: {
      targetTokens: 512,
      overlapTokens: 64,
      respectHeadings: true,
    },
    retrieval: {
      hybrid: { dense: true, bm25: true },
      language: lang,
    },
    semanticGroups: {
      byUrlPathPrefix: true,
      byJsonLdType: true,
    },
    embeddingHints: {
      recommendedFamily: "multilingual-e5 or text-embedding-3-large class models",
      note: "No API keys in this bundle; configure in your environment.",
    },
  };
}

function buildAiManifest(crawl: CrawlResult, generatedAt: string) {
  const files = [
    "llms.txt",
    "llms-full.json",
    "knowledge-graph.json",
    "tools.json",
    "agents.json",
    "rag-config.json",
    "ai-manifest.json",
    "crawler-signals.json",
    "citation-policy.json",
    "authority-signals.json",
    "README.md",
  ];
  return {
    _bundleVersion: BUNDLE_VERSION,
    _generatedAt: generatedAt,
    _schema: "site-to-llm/ai-manifest#1",
    name: "SiteToLLMBundle export",
    purpose: "LLM and RAG ingestion pack for a crawled public website.",
    suggestedIngestionOrder: ["ai-manifest.json", "llms.txt", "llms-full.json", "knowledge-graph.json", "rag-config.json", "tools.json", "agents.json"],
    files,
    site: { origin: crawl.origin, pagesIndexed: crawl.pages.length },
  };
}

function buildCrawlerSignals(crawl: CrawlResult, generatedAt: string) {
  return {
    _bundleVersion: BUNDLE_VERSION,
    _generatedAt: generatedAt,
    _schema: "site-to-llm/crawler-signals#1",
    seedWasSitemap: crawl.seedWasSitemap,
    strategy: crawl.strategy,
    robots: crawl.robotsSummary,
    discoveredSitemaps: crawl.discoveredSitemaps,
    _hints: {
      preferredDelayMs: 1000,
      respectRobots: true,
      futureProof: "Prefer sitemap lastmod when refreshing stale pages.",
    },
  };
}

function buildCitationPolicy(crawl: CrawlResult, generatedAt: string) {
  return {
    _bundleVersion: BUNDLE_VERSION,
    _generatedAt: generatedAt,
    _schema: "site-to-llm/citation-policy#1",
    preferredFormat: "Title — URL — accessed YYYY-MM-DD",
    anchorText: "Use the page title when available; otherwise hostname + path.",
    examples: crawl.pages.slice(0, 5).map((p) => ({
      url: p.url,
      suggestedAnchor: p.title ?? new URL(p.url).pathname,
    })),
  };
}

async function buildAuthoritySignals(crawl: CrawlResult, generatedAt: string) {
  const ghUrls = collectGithubUrls(crawl.pages);
  const stars = await tryGithubRepoStars(ghUrls);
  return {
    _bundleVersion: BUNDLE_VERSION,
    _generatedAt: generatedAt,
    _schema: "site-to-llm/authority-signals#1",
    github: stars,
    backlinks: {
      status: "not_measured",
      note: "Backlink counts typically require third-party SEO APIs; not included by default.",
    },
    mentions: {
      status: "not_measured",
      note: "Enrich manually or via your analytics pipeline.",
    },
  };
}

function buildReadme(crawl: CrawlResult, generatedAt: string): string {
  return `# LLM bundle

Generated: ${generatedAt}
Origin: ${crawl.origin}
Pages: ${crawl.pages.length}

## Contents

| File | Role |
|------|------|
| llms.txt | Human/LLM index |
| llms-full.json | Page text previews and metadata |
| knowledge-graph.json | Nodes/edges for linking |
| tools.json | Forms and suspected API paths |
| agents.json | Automation suggestions |
| rag-config.json | Chunking/retrieval defaults |
| ai-manifest.json | Ingestion order |
| crawler-signals.json | Crawl strategy and sitemap hints |
| citation-policy.json | Citation guidance |
| authority-signals.json | GitHub signals if found |

## Ingestion

1. Read \`ai-manifest.json\`.
2. Chunk \`llms-full.json\` fields using \`rag-config.json\`.
3. Use \`knowledge-graph.json\` for multi-hop retrieval.

## Limits

Public pages only; client-rendered SPAs may be incomplete. Respect the site's terms and robots.txt.
`;
}

export interface GeneratedBundleFiles {
  "llms.txt": string;
  "llms-full.json": string;
  "knowledge-graph.json": string;
  "tools.json": string;
  "agents.json": string;
  "rag-config.json": string;
  "ai-manifest.json": string;
  "crawler-signals.json": string;
  "citation-policy.json": string;
  "authority-signals.json": string;
  "README.md": string;
}

export async function generateBundleFiles(crawl: CrawlResult): Promise<GeneratedBundleFiles> {
  const generatedAt = new Date().toISOString();
  const siteTitle = crawl.pages[0]?.title ?? new URL(crawl.origin).hostname;

  const authority = await buildAuthoritySignals(crawl, generatedAt);

  return {
    "llms.txt": buildLlmsTxt(crawl, siteTitle),
    "llms-full.json": json(buildLlmsFull(crawl, generatedAt)),
    "knowledge-graph.json": json(buildKnowledgeGraph(crawl, generatedAt)),
    "tools.json": json(buildToolsJson(crawl, generatedAt)),
    "agents.json": json(buildAgentsJson(crawl, generatedAt)),
    "rag-config.json": json(buildRagConfig(crawl, generatedAt)),
    "ai-manifest.json": json(buildAiManifest(crawl, generatedAt)),
    "crawler-signals.json": json(buildCrawlerSignals(crawl, generatedAt)),
    "citation-policy.json": json(buildCitationPolicy(crawl, generatedAt)),
    "authority-signals.json": json(authority),
    "README.md": buildReadme(crawl, generatedAt),
  };
}
