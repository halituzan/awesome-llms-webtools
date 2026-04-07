# SiteToLLMBundle

Turn any **public** website into an **LLM-ready ingestion bundle** (ZIP): `llms.txt`, structured JSON for RAG, and a manifest—**no login**, no accounts.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## One-step usage

```bash
git clone <your-repo-url> && cd awesome-llms-webtools
npm install && npm install --prefix client && npm install --prefix server
npm run build
npm start
```

Open **http://127.0.0.1:3001** — paste a site URL or a direct `sitemap.xml` / sitemap index URL, click **Generate bundle**, and download the ZIP.

### Development

```bash
npm run dev
```

Runs the Vite client on **http://127.0.0.1:5173** (proxies `/api` to the server on port **3001**).

## What’s inside the ZIP

| File | Purpose |
|------|---------|
| `llms.txt` | Human/LLM index |
| `llms-full.json` | Page previews, metadata, JSON-LD snippets |
| `knowledge-graph.json` | Nodes and edges for linking |
| `tools.json` | Forms and suspected `/api/` paths |
| `agents.json` | Automation suggestions |
| `rag-config.json` | Chunking / retrieval defaults |
| `ai-manifest.json` | Suggested ingestion order |
| `crawler-signals.json` | Sitemap strategy and hints |
| `citation-policy.json` | Citation examples |
| `authority-signals.json` | GitHub stars if a public repo is detected |
| `README.md` | Bundle-local documentation |

## API

`POST /api/bundle` with JSON body `{ "url": "https://example.com" }` returns `application/zip`.

## Security & limits

- Crawling runs **on the server** (SSRF protections: scheme/host checks, DNS resolution must be public).
- Respect **robots.txt** and each site’s terms of use.
- **Client-rendered** SPAs may yield incomplete HTML; this tool does not run a headless browser by default.
- **Rate limits**: be kind to third-party sites; defaults cap pages and depth.

## Live demo

Replace with your deployed URL: `https://yourdomain.com/`

## Screenshots

Add screenshots under `docs/screenshots/` (optional) and link them here for a nicer README.

## License

MIT
