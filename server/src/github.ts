import { assertSafeUrl } from "./ssrf.js";
import { safeFetchText } from "./http.js";

const REPO_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/i;

export async function tryGithubRepoStars(
  urls: string[]
): Promise<{ repo: string; stars: number; forks?: number } | null> {
  for (const u of urls) {
    const m = u.match(REPO_RE);
    if (!m) continue;
    const owner = m[1];
    const repo = m[2];
    if (owner === "sponsors" || owner === "settings") continue;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
    try {
      await assertSafeUrl(apiUrl);
      const r = await safeFetchText(apiUrl, { timeoutMs: 12_000, headers: { accept: "application/vnd.github+json" } });
      if (!r.ok) continue;
      const data = JSON.parse(r.text) as { stargazers_count?: number; forks_count?: number };
      if (typeof data.stargazers_count === "number") {
        return {
          repo: `${owner}/${repo}`,
          stars: data.stargazers_count,
          forks: typeof data.forks_count === "number" ? data.forks_count : undefined,
        };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

export function collectGithubUrls(fromPages: { externalLinks: string[]; jsonLd: unknown[] }[]): string[] {
  const out: string[] = [];
  for (const p of fromPages) {
    out.push(...p.externalLinks.filter((l) => /github\.com\//i.test(l)));
    for (const block of p.jsonLd) {
      const str = JSON.stringify(block);
      const matches = str.match(/https?:\/\/github\.com\/[^"'\s)]+/gi);
      if (matches) out.push(...matches);
    }
  }
  return [...new Set(out)];
}
