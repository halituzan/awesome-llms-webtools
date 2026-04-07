import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "metadata.google.internal",
  "metadata",
]);

function isBlockedIp(ip: string): boolean {
  try {
    const addr = ipaddr.parse(ip);
    const range = addr.range();
    return range !== "unicast";
  } catch {
    return true;
  }
}

export async function assertSafeUrl(urlString: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  if (url.username || url.password) {
    throw new Error("Credentials in URL are not allowed");
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error("Host is not allowed");
  }
  if (host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Host is not allowed");
  }

  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length) {
    throw new Error("Could not resolve host");
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new Error("Resolved address is not a public endpoint");
    }
  }
  return url;
}
