"use strict";

const http  = require("node:http");
const https = require("node:https");
const dns   = require("node:dns");
const net   = require("node:net");

const MAX_BODY_BYTES    = 512 * 1024; // 512 KB
const MAX_REDIRECTS     = 3;
const TIMEOUT_MS        = 8000;
const USER_AGENT        = "RecursosCanariasBot/1.0";
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_CT        = ["text/html", "application/xhtml+xml"];

// ---------------------------------------------------------------------------
// IP range helpers
// ---------------------------------------------------------------------------

function ipv4ToInt(ip) {
  const p = ip.split(".").map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function inCidr4(ip, base, bits) {
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/**
 * Returns true if the address must not be contacted.
 * family: 4 | 6 | "IPv4" | "IPv6"
 */
function isPrivateIp(address, family) {
  const f = typeof family === "number" ? family : (family === "IPv6" ? 6 : 4);

  if (f === 4) {
    return [
      ["0.0.0.0",        32],  // Unspecified
      ["127.0.0.0",       8],  // Loopback
      ["10.0.0.0",        8],  // RFC1918 Class A
      ["172.16.0.0",     12],  // RFC1918 Class B
      ["192.168.0.0",    16],  // RFC1918 Class C
      ["169.254.0.0",    16],  // Link-local
      ["100.64.0.0",     10],  // CGNAT (RFC6598)
      ["192.0.0.0",      24],  // IETF Protocol Assignments
      ["192.0.2.0",      24],  // Documentation TEST-NET-1
      ["198.18.0.0",     15],  // Benchmarking (RFC2544)
      ["198.51.100.0",   24],  // Documentation TEST-NET-2
      ["203.0.113.0",    24],  // Documentation TEST-NET-3
      ["224.0.0.0",       4],  // Multicast
      ["240.0.0.0",       4],  // Reserved / future use
      ["255.255.255.255", 32], // Broadcast
    ].some(([base, bits]) => inCidr4(address, base, bits));
  }

  if (f === 6) {
    const addr = address.toLowerCase();
    if (addr === "::1")                              return true;  // Loopback
    if (addr === "::" || addr === "0:0:0:0:0:0:0:0") return true; // Unspecified
    if (/^fe[89ab]/i.test(addr))                    return true;  // Link-local fe80::/10
    if (/^f[cd]/i.test(addr))                       return true;  // Unique local fc00::/7
    if (addr.startsWith("ff"))                      return true;  // Multicast ff00::/8
    // Documentation 2001:db8::/32 (RFC 3849) — consistente con bloqueo IPv4 TEST-NETs
    if (addr.startsWith("2001:db8:") || addr.startsWith("2001:0db8:")) return true;

    // IPv4-mapped IPv6: ::ffff:d.d.d.d (dotted-decimal) and ::ffff:xxxx:xxxx (hex)
    let v4m = addr.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4m) return isPrivateIp(`${v4m[1]}.${v4m[2]}.${v4m[3]}.${v4m[4]}`, 4);
    // Expanded form: 0:0:0:0:0:ffff:x.x.x.x or 0:0:0:0:0:ffff:xxxx:xxxx
    v4m = addr.match(/^(?:0:){4}0:ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4m) return isPrivateIp(`${v4m[1]}.${v4m[2]}.${v4m[3]}.${v4m[4]}`, 4);
    // Hex IPv4-mapped: ::ffff:xxxx:xxxx (last 32 bits = IPv4)
    const hexM = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexM) {
      const lo = parseInt(hexM[2], 16);
      const hi = parseInt(hexM[1], 16);
      const ip4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateIp(ip4, 4);
    }

    return false;
  }

  return true; // Unknown family → block
}

// ---------------------------------------------------------------------------
// Factory — separates concerns so tests can inject a custom dns/request
// ---------------------------------------------------------------------------

/**
 * Creates a safeFetch instance.
 * @param {{ dnsLookup?, requestFn? }} deps
 *   dnsLookup(hostname, {all:true}) → [{address, family}] — defaults to dns.promises.lookup
 *   requestFn(url, resolved, signal) → {statusCode, headers, body}  — defaults to requestOnce
 */
function createSafeFetch({ dnsLookup = null, requestFn = null } = {}) {
  const _lookup  = dnsLookup  ?? ((h, o) => dns.promises.lookup(h, o));
  const _request = requestFn  ?? requestOnce;

  async function resolveSafe(hostname) {
    if (net.isIPv4(hostname)) {
      if (isPrivateIp(hostname, 4)) throw ssrfErr(hostname, hostname);
      return { address: hostname, family: 4 };
    }
    if (net.isIPv6(hostname)) {
      if (isPrivateIp(hostname, 6)) throw ssrfErr(hostname, hostname);
      return { address: hostname, family: 6 };
    }

    let addresses;
    try {
      addresses = await _lookup(hostname, { all: true });
    } catch {
      throw new Error(`DNS lookup failed for: ${hostname}`);
    }

    if (!addresses?.length) throw new Error(`No DNS records for: ${hostname}`);

    for (const { address, family } of addresses) {
      if (isPrivateIp(address, family)) throw ssrfErr(hostname, address);
    }

    return addresses[0];
  }

  return async function safeFetch(rawUrl) {
    const signal      = AbortSignal.timeout(TIMEOUT_MS);
    let currentUrl    = rawUrl;
    let redirectsLeft = MAX_REDIRECTS;

    while (true) {
      let parsed;
      try { parsed = new URL(currentUrl); }
      catch { throw new Error(`Invalid URL: ${currentUrl}`); }

      if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
        throw new Error(`Protocol not allowed: ${parsed.protocol}`);
      }

      const resolved = await resolveSafe(parsed.hostname);
      const { statusCode, headers, body } = await _request(currentUrl, resolved, signal);

      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        if (redirectsLeft <= 0) throw new Error("Too many redirects");
        const loc = headers["location"];
        if (!loc) throw new Error("Redirect with no Location header");
        currentUrl = new URL(loc, currentUrl).toString();
        redirectsLeft--;
        continue;
      }

      // Belt-and-suspenders: requestOnce already rejects early (before body) for invalid CT.
      // This fallback covers custom requestFn implementations that skip the early check.
      const ct = (headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!ALLOWED_CT.some((a) => ct === a || ct.startsWith(a))) {
        throw new Error(`Content-Type not allowed: "${ct}"`);
      }

      return { body, url: currentUrl, statusCode };
    }
  };
}

function ssrfErr(hostname, ip) {
  return new Error(`SSRF blocked: ${hostname} → ${ip} is a private/reserved address`);
}

// ---------------------------------------------------------------------------
// Low-level HTTP(S) request — connects to the pre-resolved IP
// ---------------------------------------------------------------------------

function requestOnce(url, resolved, signal) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const mod     = isHttps ? https : http;
    const port    = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);

    const opts = {
      hostname: resolved.address,  // Pre-resolved IP → no DNS rebinding
      port,
      path: (parsed.pathname || "/") + parsed.search,
      method: "GET",
      headers: {
        "Host":            parsed.hostname,
        "User-Agent":      USER_AGENT,
        "Accept":          "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
        "Connection":      "close",
      },
      rejectUnauthorized: true,
    };
    if (isHttps) opts.servername = parsed.hostname; // TLS SNI

    const req = mod.request(opts, (res) => {
      // Validate Content-Type as soon as response headers arrive — before reading body.
      // Skip 3xx redirects (no body expected; Location header is what matters).
      if (![301, 302, 303, 307, 308].includes(res.statusCode)) {
        const ct = (res.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        if (!ALLOWED_CT.some((a) => ct === a || ct.startsWith(a))) {
          res.destroy();
          reject(new Error(`Content-Type not allowed: "${ct}"`));
          return;
        }
      }

      const chunks = [];
      let size     = 0;
      let aborted  = false;

      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          aborted = true;
          req.destroy(new Error("Response body exceeds 512 KB limit"));
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", () => {
        if (!aborted) resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
      });

      res.on("error", (e) => { if (!aborted) reject(e); });
    });

    req.on("error", reject);

    if (signal) {
      const abort = () => req.destroy(new Error("Request timed out (8 s)"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches a URL with SSRF defenses:
 *  - Protocol allowlist (http/https)
 *  - DNS pre-resolution + private-IP block (loopback, RFC1918, link-local, CGNAT…)
 *  - Socket connected to pre-resolved IP (no DNS rebinding)
 *  - Manual redirect following (≤3 hops), each hop re-checked
 *  - Content-Type allowlist (text/html, application/xhtml+xml)
 *  - Body limit 512 KB
 *  - Hard timeout 8 s
 *
 * @returns {{ body: string, url: string, statusCode: number }}
 */
const safeFetch = createSafeFetch();

module.exports = { safeFetch, isPrivateIp, createSafeFetch, requestOnce };
