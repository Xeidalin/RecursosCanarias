#!/usr/bin/env node
"use strict";

const http = require("node:http");
const path = require("node:path");
const { isPrivateIp, createSafeFetch, requestOnce } = require(path.join(__dirname, "../server/safeFetch.js"));

let passed = 0;
let failed = 0;

function ok(label)           { console.log(`  ✓ ${label}`); passed++; }
function fail(label, reason) { console.error(`  ✗ ${label}\n    ${reason}`); failed++; }

async function shouldReject(label, fn) {
  try {
    await fn();
    fail(label, "No lanzó error (se esperaba rechazo)");
  } catch (e) {
    ok(`${label}  [${String(e.message).slice(0, 70)}]`);
  }
}

async function shouldResolve(label, fn) {
  try {
    await fn();
    ok(label);
  } catch (e) {
    fail(label, `Lanzó error inesperado: ${e.message}`);
  }
}

function assertIp(ip, family, expected, note = "") {
  const result = isPrivateIp(ip, family);
  if (result === expected) ok(`${ip} → ${expected ? "privada" : "pública"}  ${note}`);
  else fail(`isPrivateIp(${ip}, ${family})`, `expected ${expected}, got ${result}`);
}

// ---------------------------------------------------------------------------
// Helper: servidor de prueba
// ---------------------------------------------------------------------------
function startServer() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = new URL(req.url, "http://t");

      if (url.pathname === "/ok") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end("<html><body>OK</body></html>");
      }
      if (url.pathname === "/redir-private") {
        res.writeHead(302, { "Location": "http://192.168.99.1/evil" });
        return res.end();
      }
      if (url.pathname === "/redir-ok") {
        const port = s.address().port;
        res.writeHead(302, { "Location": `http://fake-host.test:${port}/ok` });
        return res.end();
      }
      if (url.pathname === "/redir-loop") {
        const n    = parseInt(url.searchParams.get("n") || "0");
        const port = s.address().port;
        if (n >= 4) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<html>done</html>"); }
        res.writeHead(302, { "Location": `http://fake-host.test:${port}/redir-loop?n=${n + 1}` });
        return res.end();
      }
      if (url.pathname === "/binary") {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        return res.end(Buffer.alloc(64, 0));
      }
      if (url.pathname === "/json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end('{"ok":true}');
      }
      if (url.pathname === "/big-body") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.write("<html><body>");
        for (let i = 0; i < 600; i++) res.write("x".repeat(1024)); // 600 KB
        return res.end("</body></html>");
      }
      if (url.pathname === "/slow") {
        // No responde — dispara timeout
        setTimeout(() => { try { res.end("<html></html>"); } catch {} }, 20_000);
        return;
      }
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html>404</html>");
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

// requestFn que siempre conecta al servidor de prueba real
function makeTestRequest(realPort) {
  return function testRequest(url, _resolved, signal) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const LIMIT  = 512 * 1024;
      const req = http.request({
        hostname: "127.0.0.1",
        port:     realPort,
        path:     (parsed.pathname || "/") + parsed.search,
        method:   "GET",
        headers:  { "Host": parsed.hostname, "User-Agent": "TestBot", "Connection": "close" },
      }, (res) => {
        const chunks = [];
        let size = 0;
        let aborted = false;
        res.on("data", (c) => {
          size += c.length;
          if (size > LIMIT) { aborted = true; req.destroy(new Error("Response body exceeds 512 KB limit")); return; }
          chunks.push(c);
        });
        res.on("end", () => { if (!aborted) resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }); });
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
  };
}

// dnsLookup fake: siempre devuelve una IP pública real (no bloqueada)
// 8.8.8.8 = Google DNS, definitivamente pública y no en ningún rango privado
function fakeDns(ip = "8.8.8.8") {
  return async (_host, opts) => {
    if (opts && opts.all) return [{ address: ip, family: 4 }];
    return { address: ip, family: 4 };
  };
}

// ===========================================================================
async function main() {
  // ─── isPrivateIp — IPv4 ──────────────────────────────────────────────────
  console.log("\n── isPrivateIp — IPv4 ──");
  assertIp("127.0.0.1",        4, true,  "loopback");
  assertIp("127.255.255.255",  4, true,  "loopback last");
  assertIp("0.0.0.0",          4, true,  "unspecified");
  assertIp("10.0.0.1",         4, true,  "10/8");
  assertIp("10.255.255.255",   4, true,  "10/8 last");
  assertIp("172.16.0.1",       4, true,  "172.16/12 first");
  assertIp("172.31.255.255",   4, true,  "172.16/12 last");
  assertIp("172.15.0.1",       4, false, "fuera de 172.16/12");
  assertIp("172.32.0.1",       4, false, "fuera de 172.16/12");
  assertIp("192.168.0.1",      4, true,  "192.168/16");
  assertIp("192.168.255.255",  4, true,  "192.168/16 last");
  assertIp("169.254.0.1",      4, true,  "link-local");
  assertIp("169.254.169.254",  4, true,  "AWS metadata");
  assertIp("100.64.0.1",       4, true,  "CGNAT RFC6598");
  assertIp("100.127.255.255",  4, true,  "CGNAT last");
  assertIp("100.128.0.1",      4, false, "fuera de CGNAT");
  assertIp("198.18.0.1",       4, true,  "benchmarking RFC2544");
  assertIp("198.19.255.255",   4, true,  "benchmarking last");
  assertIp("224.0.0.1",        4, true,  "multicast");
  assertIp("255.255.255.255",  4, true,  "broadcast");
  assertIp("240.0.0.1",        4, true,  "reserved future");
  assertIp("8.8.8.8",          4, false, "Google DNS — pública");
  assertIp("1.1.1.1",          4, false, "Cloudflare — pública");
  assertIp("93.184.216.34",    4, false, "example.com — pública");

  // ─── isPrivateIp — IPv6 ──────────────────────────────────────────────────
  console.log("\n── isPrivateIp — IPv6 ──");
  assertIp("::1",                 6, true,  "loopback");
  assertIp("::",                  6, true,  "unspecified");
  assertIp("fe80::1",             6, true,  "link-local");
  assertIp("fe90::1",             6, true,  "link-local /10");
  assertIp("fc00::1",             6, true,  "unique local fc");
  assertIp("fd12::1",             6, true,  "unique local fd");
  assertIp("ff02::1",             6, true,  "multicast");
  assertIp("2001:db8::1",         6, true,  "2001:db8::/32 documentación RFC3849 — bloqueada");
  assertIp("2001:0db8::1",        6, true,  "2001:0db8::/32 notación alternativa — bloqueada");
  assertIp("2606:4700::1111",     6, false, "Cloudflare — pública");
  assertIp("::ffff:127.0.0.1",   6, true,  "IPv4-mapped loopback");
  assertIp("::ffff:192.168.1.1", 6, true,  "IPv4-mapped RFC1918");
  assertIp("::ffff:8.8.8.8",     6, false, "IPv4-mapped pública");

  // ─── safeFetch — IPs privadas directas ──────────────────────────────────
  console.log("\n── safeFetch — bloqueo por IP privada ──");
  const sf = createSafeFetch();

  await shouldReject("http://127.0.0.1",        () => sf("http://127.0.0.1"));
  await shouldReject("http://127.0.0.1:8080",   () => sf("http://127.0.0.1:8080"));
  await shouldReject("http://0.0.0.0",          () => sf("http://0.0.0.0"));
  await shouldReject("http://10.0.0.1",         () => sf("http://10.0.0.1"));
  await shouldReject("http://172.16.0.1",       () => sf("http://172.16.0.1"));
  await shouldReject("http://192.168.1.1",      () => sf("http://192.168.1.1"));
  await shouldReject("http://169.254.169.254",  () => sf("http://169.254.169.254")); // AWS metadata
  await shouldReject("http://100.64.0.1",       () => sf("http://100.64.0.1"));     // CGNAT
  await shouldReject("file:///etc/passwd",      () => sf("file:///etc/passwd"));
  await shouldReject("ftp://example.com",       () => sf("ftp://example.com/file"));
  await shouldReject("URL inválida",            () => sf("not-a-url"));
  await shouldReject("URL vacía",              () => sf(""));
  await shouldReject("localhost → 127.0.0.1",  () => sf("http://localhost/path"));

  // ─── safeFetch — servidor de prueba ─────────────────────────────────────
  console.log("\n── safeFetch — servidor de prueba ──");
  const server = await startServer();
  const PORT   = server.address().port;

  const sfTest = createSafeFetch({
    dnsLookup: fakeDns(),
    requestFn: makeTestRequest(PORT),
  });

  await shouldResolve("respuesta HTML válida",         () => sfTest("http://fake-host.test/ok"));
  await shouldReject("redirect a 192.168.99.1",        () => sfTest("http://fake-host.test/redir-private"));
  await shouldResolve("redirect legítimo /redir-ok",   () => sfTest("http://fake-host.test/redir-ok"));
  await shouldReject("demasiados redirects (4 saltos)",() => sfTest("http://fake-host.test/redir-loop"));
  await shouldReject("Content-Type octet-stream",      () => sfTest("http://fake-host.test/binary"));
  await shouldReject("Content-Type application/json",  () => sfTest("http://fake-host.test/json"));
  await shouldReject("body > 512 KB",                  () => sfTest("http://fake-host.test/big-body"));

  // Timeout — requestFn con AbortSignal de 300 ms, server /slow nunca responde
  const sfTimeout = createSafeFetch({
    dnsLookup: fakeDns(),
    requestFn: (_url, _resolved, _signal) => {
      // Ignoramos el signal de safeFetch y usamos uno de 300 ms
      return makeTestRequest(PORT)(_url, _resolved, AbortSignal.timeout(300));
    },
  });
  await shouldReject("timeout dispara antes de respuesta", () => sfTimeout("http://fake-host.test/slow"));

  server.close();

  // ─── requestOnce — IP-forcing (defensa DNS rebinding) ────────────────────
  // Verifica que requestOnce conecta al socket usando resolved.address y NO
  // re-resuelve el hostname de la URL. Es la defensa crítica anti-rebinding.
  console.log("\n── requestOnce — IP-forcing real (defensa DNS rebinding) ──");

  const echoServer = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body>host:${req.headers["host"] || ""}</body></html>`);
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  const ECHO_PORT = echoServer.address().port;

  // Llamamos requestOnce con un hostname inventado pero resolved apuntando a
  // nuestro servidor de prueba. Si la conexión llega al servidor, confirma que
  // requestOnce usó la IP pre-resuelta y no hizo DNS lookup del hostname.
  await (async () => {
    try {
      const signal = AbortSignal.timeout(3000);
      const result = await requestOnce(
        `http://should-not-dns-resolve.invalid:${ECHO_PORT}/path`,
        { address: "127.0.0.1", family: 4 },
        signal
      );
      const hostOk = result.body.includes("should-not-dns-resolve.invalid");
      if (result.statusCode === 200 && hostOk) {
        ok("requestOnce usa resolved.address para la conexión TCP (no re-resuelve el hostname)");
        ok("requestOnce pasa el hostname original en el header Host (para virtual hosting / TLS SNI)");
      } else {
        fail("requestOnce IP-forcing", `statusCode=${result.statusCode}, body="${result.body.slice(0, 100)}"`);
      }
    } catch (e) {
      fail("requestOnce IP-forcing", `Lanzó error inesperado: ${e.message}`);
    }
  })();

  echoServer.close();

  // ─── Resumen ─────────────────────────────────────────────────────────────
  console.log(`\n── Resultado: ${passed} ok, ${failed} fallaron ──\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
