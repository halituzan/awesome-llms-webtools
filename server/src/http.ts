import { assertSafeUrl } from "./ssrf.js";

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  redirectMax?: number;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT = 20_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export async function safeFetchBuffer(
  url: string,
  options: SafeFetchOptions = {}
): Promise<{
  ok: boolean;
  status: number;
  contentType: string;
  body: Buffer;
  finalUrl: string;
}> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const redirectMax = options.redirectMax ?? 5;

  let current = url;
  let redirectCount = 0;

  while (true) {
    await assertSafeUrl(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "SiteToLLMBundle/1.0 (public bundle generator)",
          accept: options.headers?.accept ?? "*/*",
          ...options.headers,
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc || redirectCount >= redirectMax) {
        const buf = Buffer.from(await res.arrayBuffer());
        return {
          ok: res.ok,
          status: res.status,
          contentType: res.headers.get("content-type") ?? "",
          body: buf,
          finalUrl: current,
        };
      }
      redirectCount++;
      current = new URL(loc, current).href;
      continue;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        body: Buffer.alloc(0),
        finalUrl: current,
      };
    }

    const chunks: Buffer[] = [];
    let total = 0;
    const controller2 = new AbortController();
    const timer2 = setTimeout(() => controller2.abort(), timeoutMs);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new Error("Response too large");
          }
          chunks.push(Buffer.from(value));
        }
      }
    } finally {
      clearTimeout(timer2);
    }

    const body = Buffer.concat(chunks);
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body,
      finalUrl: current,
    };
  }
}

export async function safeFetchText(
  url: string,
  options?: SafeFetchOptions
): Promise<{
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
  finalUrl: string;
}> {
  const r = await safeFetchBuffer(url, options);
  return {
    ok: r.ok,
    status: r.status,
    contentType: r.contentType,
    text: r.body.toString("utf8"),
    finalUrl: r.finalUrl,
  };
}
