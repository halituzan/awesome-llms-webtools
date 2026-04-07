export function parseRobotsTxt(text: string): {
  sitemaps: string[];
  disallowAll: boolean;
} {
  const lines = text.split(/\r?\n/);
  const sitemaps: string[] = [];
  let disallowAll = false;
  let currentAgent = "*";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      currentAgent = val.toLowerCase();
    }
    if (key === "sitemap") {
      sitemaps.push(val);
    }
    if (currentAgent === "*" && key === "disallow") {
      if (val === "/" || val === "/*") {
        disallowAll = true;
      }
    }
  }

  return { sitemaps, disallowAll };
}
