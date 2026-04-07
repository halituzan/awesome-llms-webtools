import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { crawlSite } from "./crawl.js";
import { generateBundleFiles } from "./generateBundle.js";
import { zipBundleFiles } from "./zipBundle.js";

const app = express();
const explicitPort = process.env.PORT;
const basePort = explicitPort ? Number(explicitPort) : 3001;
const maxPortAttempts = explicitPort ? 1 : 10;

app.use(cors({ origin: true }));
app.use(express.json({ limit: "32kb" }));

app.post("/api/bundle", async (req, res) => {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!url) {
    res.status(400).json({ error: "Missing or invalid `url` in JSON body." });
    return;
  }
  try {
    const crawl = await crawlSite(url, {
      maxPages: 100,
      maxDepth: 4,
      maxSitemapNesting: 12,
      timeoutMs: 20_000,
    });
    const files = await generateBundleFiles(crawl);
    const zip = await zipBundleFiles(files);
    const host = new URL(crawl.origin).hostname.replace(/[^a-z0-9._-]/gi, "_");
    const filename = `llms-bundle-${host}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(zip);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../../client/dist");
app.use(express.static(clientDist, { fallthrough: true }));

app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const server = http.createServer(app);

function listenWithFallback(port: number, attemptsLeft: number): void {
  const onError = (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && attemptsLeft > 1) {
      const next = port + 1;
      console.warn(`Port ${port} is in use, trying ${next}…`);
      server.close(() => {
        listenWithFallback(next, attemptsLeft - 1);
      });
    } else {
      if (explicitPort && err.code === "EADDRINUSE") {
        console.error(
          `Port ${port} is already in use. Stop the other process or set PORT to a free port.`
        );
      } else {
        console.error(err);
      }
      process.exit(1);
    }
  };

  server.once("error", onError);
  server.listen(port, "127.0.0.1", () => {
    server.removeListener("error", onError);
    console.log(`SiteToLLMBundle server listening on http://127.0.0.1:${port}`);
  });
}

listenWithFallback(basePort, maxPortAttempts);
