import { useCallback, useState, type FormEvent } from "react";
import "./App.css";

export function App() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setDownloadName(null);
      setStatus("loading");
      try {
        const res = await fetch("/api/bundle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });
        const ct = res.headers.get("content-type") ?? "";
        if (!res.ok) {
          if (ct.includes("application/json")) {
            const data = (await res.json()) as { error?: string };
            throw new Error(data.error ?? `HTTP ${res.status}`);
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const disp = res.headers.get("content-disposition");
        let name = "llms-bundle.zip";
        if (disp) {
          const m = /filename="([^"]+)"/.exec(disp);
          if (m) name = m[1];
        }
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href;
        a.download = name;
        a.click();
        URL.revokeObjectURL(href);
        setDownloadName(name);
        setStatus("done");
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [url]
  );

  return (
    <div className="layout">
      <header className="header">
        <div className="logo" aria-hidden>
          ◇
        </div>
        <div>
          <h1 className="title">LLM Bundle Generator</h1>
          <p className="subtitle">SiteToLLMBundle — public sites only, no login</p>
        </div>
      </header>

      <main className="main">
        <section className="card" aria-labelledby="form-heading">
          <h2 id="form-heading" className="card-title">
            Generate bundle
          </h2>
          <p className="hint">
            Enter a site homepage or a direct <code>sitemap.xml</code> / sitemap index URL. The server crawls and
            returns a ZIP with <code>llms.txt</code>, JSON knowledge files, and <code>README.md</code>.
          </p>
          <form className="form" onSubmit={onSubmit}>
            <label className="label" htmlFor="url">
              Website URL
            </label>
            <input
              id="url"
              name="url"
              type="url"
              className="input"
              placeholder="https://example.com or https://example.com/sitemap.xml"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="url"
              required
            />
            <button type="submit" className="btn" disabled={status === "loading"}>
              {status === "loading" ? "Generating…" : "Generate bundle"}
            </button>
          </form>

          {status === "loading" && (
            <div className="progress" role="status" aria-live="polite">
              <div className="spinner" aria-hidden />
              <span>Crawling sitemaps and pages… this can take a minute.</span>
            </div>
          )}

          {status === "error" && error && (
            <p className="msg error" role="alert">
              {error}
            </p>
          )}

          {status === "done" && downloadName && (
            <p className="msg success">
              Download started: <strong>{downloadName}</strong>
            </p>
          )}
        </section>

        <section className="card muted-card" aria-labelledby="preview-heading">
          <h2 id="preview-heading" className="card-title">
            What you get
          </h2>
          <pre className="diagram" role="img" aria-label="Bundle file list">
{`llms-bundle.zip
├── llms.txt
├── llms-full.json
├── knowledge-graph.json
├── tools.json
├── agents.json
├── rag-config.json
├── ai-manifest.json
├── crawler-signals.json
├── citation-policy.json
├── authority-signals.json
└── README.md`}
          </pre>
        </section>
      </main>

      <footer className="footer">
        <small>Open source. Use responsibly — respect robots.txt and site terms.</small>
      </footer>
    </div>
  );
}
