"use strict";

// Must be set before requiring any module that touches auth
process.env.SESSION_SECRET     = "test-secret-que-tiene-mas-de-32-caracteres!!";
process.env.INTERNAL_CRON_TOKEN = "cron-token-fijo-para-tests";
process.env.NODE_ENV           = "test";

const { test } = require("node:test");
const assert   = require("node:assert/strict");

const { parseOg } = require("../server/og.js");
const ogQueue    = require("../server/ogQueue.js");

const { dispatch } = require("../server/router.js");
const {
  signSession, csrfFor, COOKIE_SESSION, COOKIE_CSRF,
} = require("../server/auth.js");

// Register routes (side-effects) — only api-admin and api-resources are needed.
require("../server/routes/api-admin.js");
require("../server/routes/api-resources.js");

// ── Helpers ────────────────────────────────────────────────────────────────

function mockRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.writeHead = (s, h) => { res._status = s; Object.assign(res._headers, h || {}); };
  res.setHeader = (k, v) => { res._headers[k] = v; };
  res.end       = (b) => { res._body = b; };
  return res;
}

function mockReq(method, url, headers = {}) {
  return { method, url, headers: { cookie: "", ...headers }, params: {} };
}

function adminReq(method, url, extraHeaders = {}) {
  const session = signSession("admin-1");
  const csrf    = csrfFor(session);
  return mockReq(method, url, {
    "x-csrf-token": csrf,
    "cookie":       `${COOKIE_SESSION}=${session}; ${COOKIE_CSRF}=${csrf}`,
    ...extraHeaders,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// parseOg
// ──────────────────────────────────────────────────────────────────────────

test("parseOg: extrae og:title/description/image y resuelve favicon relativo", () => {
  const html = `
    <html><head>
      <title>Título HTML</title>
      <meta property="og:title" content="Título OG"/>
      <meta property="og:description" content="Descripción OG"/>
      <meta property="og:image" content="https://cdn.example.com/img.jpg"/>
      <link rel="icon" href="/favicon.ico"/>
    </head><body>x</body></html>
  `;
  const og = parseOg(html, "https://ejemplo.test/articulo");
  assert.equal(og.failed, false);
  assert.equal(og.title, "Título OG");
  assert.equal(og.description, "Descripción OG");
  assert.equal(og.image, "https://cdn.example.com/img.jpg");
  assert.equal(og.favicon, "https://ejemplo.test/favicon.ico");
  assert.equal(og.domain, "ejemplo.test");
  assert.ok(og.fetchedAt && new Date(og.fetchedAt).toString() !== "Invalid Date");
});

test("parseOg: fallback a <title> y <meta name=description>", () => {
  const html = `<head><title>Solo title</title><meta name="description" content="Solo desc"></head>`;
  const og = parseOg(html, "https://x.test/");
  assert.equal(og.title, "Solo title");
  assert.equal(og.description, "Solo desc");
  assert.equal(og.failed, false);
});

test("parseOg: strip de tags y truncado a 300 chars en title/description", () => {
  const longText = "A".repeat(500);
  const html = `<head><meta property="og:title" content="<script>x</script>${longText}"></head>`;
  const og = parseOg(html, "https://x.test/");
  assert.ok(!og.title.includes("<script>"));
  assert.equal(og.title.length, 300);
});

test("parseOg: og:image con javascript: → string vacío", () => {
  const html = `<head><meta property="og:image" content="javascript:alert(1)"></head>`;
  const og = parseOg(html, "https://x.test/");
  assert.equal(og.image, "");
});

test("parseOg: og:image relativo se resuelve contra la URL final", () => {
  const html = `<head><meta property="og:image" content="/static/cover.png"></head>`;
  const og = parseOg(html, "https://ejemplo.test/seccion/articulo");
  assert.equal(og.image, "https://ejemplo.test/static/cover.png");
});

test("parseOg: HTML vacío → failed=false con strings vacíos (no rompe)", () => {
  const og = parseOg("", "https://x.test/");
  assert.equal(og.failed, false);
  assert.equal(og.title, "");
  assert.equal(og.image, "");
  // favicon resuelve a /favicon.ico del dominio aunque no haya <link>
  assert.equal(og.favicon, "https://x.test/favicon.ico");
});

test("parseOg: URL final inválida → failed=true sin lanzar", () => {
  const og = parseOg("<head></head>", "no-es-una-url");
  assert.equal(og.failed, true);
  assert.equal(og.domain, "");
});

test("parseOg: og:image con entidades HTML en URL no escapa al validador", () => {
  // "&amp;" debe normalizarse a "&" y la URL resultante validarse normalmente.
  const html = `<head><meta property="og:image" content="https://x.test/img?a=1&amp;b=2"></head>`;
  const og = parseOg(html, "https://x.test/");
  assert.ok(og.image.startsWith("https://x.test/img"));
  assert.ok(og.image.includes("a=1") && og.image.includes("b=2"));
});

// ──────────────────────────────────────────────────────────────────────────
// ogQueue
// ──────────────────────────────────────────────────────────────────────────

function makeConvexStub({ resources = {}, throwOnSetOg = false } = {}) {
  const calls = { setOg: [], getById: [], listStaleOg: [] };
  const convex = {
    async query(fn, args) {
      if (fn === "resources.getById") {
        calls.getById.push(args);
        return resources[args.id] ?? null;
      }
      if (fn === "resources.listStaleOg") {
        calls.listStaleOg.push(args);
        return Object.values(resources)
          .filter((r) => r.isExternal && r.sourceUrl)
          .map((r) => ({ id: r.id, sourceUrl: r.sourceUrl }));
      }
      throw new Error(`stub query no implementada: ${fn}`);
    },
    async mutation(fn, args) {
      if (fn === "resources.setOg") {
        if (throwOnSetOg) throw new Error("setOg falla");
        calls.setOg.push(args);
        return { updated: args.id };
      }
      throw new Error(`stub mutation no implementada: ${fn}`);
    },
  };
  const api = {
    resources: {
      getById:     "resources.getById",
      listStaleOg: "resources.listStaleOg",
      setOg:       "resources.setOg",
    },
  };
  return { convex, api, calls };
}

function waitFor(cond, { timeoutMs = 1500, intervalMs = 20 } = {}) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error("timeout waitFor"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

const silentLogger = { info() {}, warn() {}, error() {} };

test("ogQueue: enqueue procesa el recurso y llama setOg con og.failed=false", async () => {
  ogQueue._reset();
  const stub = makeConvexStub({
    resources: { "res-1": { id: "res-1", isExternal: true, sourceUrl: "https://x.test/a" } },
  });
  const fakeFetch = async (url) => ({
    body: `<head><meta property="og:title" content="Hola"></head>`,
    url,
    statusCode: 200,
  });
  ogQueue.init(stub.convex, stub.api, { safeFetch: fakeFetch, logger: silentLogger });
  assert.equal(ogQueue.enqueue("res-1"), true);
  await waitFor(() => stub.calls.setOg.length === 1);
  assert.equal(stub.calls.setOg[0].id, "res-1");
  assert.equal(stub.calls.setOg[0].og.failed, false);
  assert.equal(stub.calls.setOg[0].og.title, "Hola");
});

test("ogQueue: enqueue duplicado no encola dos veces", async () => {
  ogQueue._reset();
  const stub = makeConvexStub({
    resources: { "res-1": { id: "res-1", isExternal: true, sourceUrl: "https://x.test/a" } },
  });
  const fakeFetch = async (url) => ({ body: "", url, statusCode: 200 });
  ogQueue.init(stub.convex, stub.api, { safeFetch: fakeFetch, logger: silentLogger });
  assert.equal(ogQueue.enqueue("res-1"), true);
  assert.equal(ogQueue.enqueue("res-1"), false);
  await waitFor(() => stub.calls.setOg.length === 1);
  // Tras procesar puede volver a encolarse (entrada nueva)
  assert.equal(ogQueue.enqueue("res-1"), true);
  await waitFor(() => stub.calls.setOg.length === 2);
});

test("ogQueue: safeFetch que lanza → setOg con og.failed=true (sin propagar)", async () => {
  ogQueue._reset();
  const stub = makeConvexStub({
    resources: { "res-1": { id: "res-1", isExternal: true, sourceUrl: "https://x.test/a" } },
  });
  const fakeFetch = async () => { throw new Error("SSRF blocked"); };
  ogQueue.init(stub.convex, stub.api, { safeFetch: fakeFetch, logger: silentLogger });
  ogQueue.enqueue("res-1");
  await waitFor(() => stub.calls.setOg.length === 1);
  assert.equal(stub.calls.setOg[0].og.failed, true);
  // No filtra el error en el og
  assert.equal(stub.calls.setOg[0].og.title, "");
});

test("ogQueue: throttle ≥500 ms entre arranques (2/s)", async () => {
  ogQueue._reset();
  const stub = makeConvexStub({
    resources: {
      "a": { id: "a", isExternal: true, sourceUrl: "https://x.test/a" },
      "b": { id: "b", isExternal: true, sourceUrl: "https://x.test/b" },
    },
  });
  const startTimes = [];
  const fakeFetch = async (url) => {
    startTimes.push(Date.now());
    return { body: "", url, statusCode: 200 };
  };
  ogQueue.init(stub.convex, stub.api, { safeFetch: fakeFetch, logger: silentLogger });
  ogQueue.enqueue("a");
  ogQueue.enqueue("b");
  await waitFor(() => startTimes.length === 2, { timeoutMs: 2000 });
  const delta = startTimes[1] - startTimes[0];
  assert.ok(delta >= 480, `delta entre arranques debería ser ≥500 ms, fue ${delta}`);
});

test("ogQueue: recurso sin isExternal → no llama setOg", async () => {
  ogQueue._reset();
  const stub = makeConvexStub({
    resources: { "res-1": { id: "res-1", isExternal: false, sourceUrl: "https://x.test/a" } },
  });
  const fakeFetch = async (url) => ({ body: "", url, statusCode: 200 });
  ogQueue.init(stub.convex, stub.api, { safeFetch: fakeFetch, logger: silentLogger });
  ogQueue.enqueue("res-1");
  // Esperamos un tick razonable
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(stub.calls.setOg.length, 0);
});

// ──────────────────────────────────────────────────────────────────────────
// Endpoints
// ──────────────────────────────────────────────────────────────────────────

test("POST /api/admin/refresh-stale-og sin Authorization → 401", async () => {
  const req = mockReq("POST", "/api/admin/refresh-stale-og");
  const res = mockRes();
  const handled = await dispatch(req, res);
  assert.equal(handled, true);
  assert.equal(res._status, 401);
});

test("POST /api/admin/refresh-stale-og con token incorrecto → 401", async () => {
  const req = mockReq("POST", "/api/admin/refresh-stale-og", {
    "authorization": "Bearer token-incorrecto",
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("POST /api/admin/refresh-stale-og sin INTERNAL_CRON_TOKEN configurado → 401 (no filtra estado)", async () => {
  const saved = process.env.INTERNAL_CRON_TOKEN;
  delete process.env.INTERNAL_CRON_TOKEN;
  // Silencia el console.error que emite requireCronToken al detectar la variable ausente
  const savedErr = console.error;
  console.error = () => {};
  try {
    const req = mockReq("POST", "/api/admin/refresh-stale-og", {
      "authorization": "Bearer cualquier-cosa",
    });
    const res = mockRes();
    await dispatch(req, res);
    assert.equal(res._status, 401);
    const body = JSON.parse(res._body);
    assert.equal(body.error, "No autorizado");
    // No filtra nombre de variable ni razón
    assert.ok(!String(res._body).includes("INTERNAL_CRON_TOKEN"));
    assert.ok(!String(res._body).includes("configurado"));
  } finally {
    process.env.INTERNAL_CRON_TOKEN = saved;
    console.error = savedErr;
  }
});

test("POST /api/admin/refresh-stale-og con token correcto → 200 y encola", async () => {
  ogQueue._reset();
  const stub = makeConvexStub({
    resources: {
      "r1": { id: "r1", isExternal: true, sourceUrl: "https://x.test/1" },
      "r2": { id: "r2", isExternal: true, sourceUrl: "https://x.test/2" },
    },
  });
  // Hook in stub into the admin route via init (re-imported)
  const adminRoute = require("../server/routes/api-admin.js");
  adminRoute.init(stub.convex, stub.api);
  // Worker no debe efectuar fetch real: stub safeFetch
  ogQueue.init(stub.convex, stub.api, {
    safeFetch: async (url) => ({ body: "", url, statusCode: 200 }),
    logger: silentLogger,
  });

  const req = mockReq("POST", "/api/admin/refresh-stale-og", {
    "authorization": `Bearer ${process.env.INTERNAL_CRON_TOKEN}`,
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const body = JSON.parse(res._body);
  assert.equal(body.found, 2);
  assert.equal(body.queued, 2);
});

test("POST /api/admin/resources/:id/refresh-og sin sesión → 401", async () => {
  const req = mockReq("POST", "/api/admin/resources/res-1/refresh-og");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("POST /api/admin/resources/:id/refresh-og con sesión+CSRF → 202", async () => {
  ogQueue._reset();
  const stub = makeConvexStub({
    resources: { "res-7": { id: "res-7", isExternal: true, sourceUrl: "https://x.test/a" } },
  });
  const resourcesRoute = require("../server/routes/api-resources.js");
  resourcesRoute.init(stub.convex, stub.api);
  ogQueue.init(stub.convex, stub.api, {
    safeFetch: async (url) => ({ body: "", url, statusCode: 200 }),
    logger: silentLogger,
  });

  const req = adminReq("POST", "/api/admin/resources/res-7/refresh-og");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 202);
  const body = JSON.parse(res._body);
  assert.equal(body.queued, true);
});
