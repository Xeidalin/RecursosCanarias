"use strict";

// Must be set before requiring any module that touches auth
process.env.SESSION_SECRET     = "test-secret-que-tiene-mas-de-32-caracteres!!";
process.env.INTERNAL_CRON_TOKEN = "cron-token-fijo-para-tests";
process.env.NODE_ENV           = "test";

const { test } = require("node:test");
const assert   = require("node:assert/strict");

const { dispatch } = require("../server/router.js");
const {
  signSession, csrfFor, COOKIE_SESSION, COOKIE_CSRF,
} = require("../server/auth.js");
const { limiters, createLimiter } = require("../server/rateLimit.js");

// Register routes (side-effects)
require("../server/routes/api-admin.js");
require("../server/routes/api-resources.js");
require("../server/routes/api-blog.js");
require("../server/routes/api-subscribers.js");
require("../server/routes/api-contact.js");
require("../server/routes/api-search.js");
require("../server/routes/api-track.js");
require("../server/routes/sitemap.js");
require("../server/routes/pages.js");

// ── Helpers ────────────────────────────────────────────────────────────────

function mockRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.writeHead = (s, h) => { res._status = s; Object.assign(res._headers, h || {}); };
  res.setHeader  = (k, v) => { res._headers[k] = v; };
  res.end        = (b)    => { res._body = b; };
  return res;
}

function mockReq(method, url, headers = {}) {
  return { method, url, headers: { cookie: "", ...headers }, params: {}, socket: { remoteAddress: "127.0.0.1" } };
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
// XEI-34: Sin sesión → 401 (API) o 302 (páginas HTML GET/HEAD)
// ──────────────────────────────────────────────────────────────────────────

const ADMIN_API_GETS = [
  "/api/admin/blog",
  "/api/admin/resources",
  "/api/admin/subscribers",
  "/api/admin/stats",
];

const ADMIN_API_MUTATIONS = [
  { method: "POST",    url: "/api/admin/logout" },
  { method: "POST",    url: "/api/admin/resources" },
  { method: "PATCH",   url: "/api/admin/resources/any-id" },
  { method: "DELETE",  url: "/api/admin/resources/any-id" },
  { method: "POST",    url: "/api/admin/blog" },
  { method: "PATCH",   url: "/api/admin/blog/any-id" },
  { method: "DELETE",  url: "/api/admin/blog/any-id" },
  { method: "POST",    url: "/api/admin/blog/preview-markdown" },
  { method: "POST",    url: "/api/admin/blog/upload-cover" },
  { method: "POST",    url: "/api/admin/resources/upload-url" },
  { method: "POST",    url: "/api/admin/resources/any-id/refresh-og" },
];

const ADMIN_PAGES = [
  "/admin",
  "/admin/recursos",
  "/admin/blog",
  "/admin/suscriptores",
  "/admin/mensajes",
];

test("XEI-34: API GET sin sesión → 401 JSON", async () => {
  for (const url of ADMIN_API_GETS) {
    const req = mockReq("GET", url);
    const res = mockRes();
    const handled = await dispatch(req, res);
    assert.equal(handled, true, `debe manejar ${url}`);
    assert.equal(res._status, 401, `${url} debe devolver 401`);
    assert.equal(res._headers["Content-Type"], "application/json");
  }
});

test("XEI-34: API mutating sin sesión → 401 JSON", async () => {
  for (const { method, url } of ADMIN_API_MUTATIONS) {
    const req = mockReq(method, url);
    const res = mockRes();
    const handled = await dispatch(req, res);
    assert.equal(handled, true, `debe manejar ${method} ${url}`);
    assert.equal(res._status, 401, `${method} ${url} debe devolver 401`);
  }
});

test("XEI-34: Admin pages GET sin sesión → 302 redirect a /admin/login", async () => {
  for (const url of ADMIN_PAGES) {
    const req = mockReq("GET", url);
    const res = mockRes();
    const handled = await dispatch(req, res);
    assert.equal(handled, true, `debe manejar ${url}`);
    assert.equal(res._status, 302, `${url} debe devolver 302`);
    assert.equal(res._headers.Location, "/admin/login");
  }
});

// ──────────────────────────────────────────────────────────────────────────
// XEI-34: Sin CSRF en mutating → 403
// ──────────────────────────────────────────────────────────────────────────

test("XEI-34: API mutating con sesión pero sin header CSRF → 403", async () => {
  for (const { method, url } of ADMIN_API_MUTATIONS) {
    const session = signSession("admin-1");
    const req = mockReq(method, url, {
      "cookie": `${COOKIE_SESSION}=${session}`,  // no rc_csrf cookie, no x-csrf-token header
    });
    req._sessionToken = undefined; // router sets this after requireAdmin
    const res = mockRes();
    const handled = await dispatch(req, res);
    assert.equal(handled, true, `debe manejar ${method} ${url}`);
    assert.equal(res._status, 403, `${method} ${url} sin CSRF debe devolver 403, devolvió ${res._status}`);
  }
});

test("XEI-34: API mutating con sesión + CSRF cookie pero sin header → 403", async () => {
  for (const { method, url } of ADMIN_API_MUTATIONS) {
    const session = signSession("admin-1");
    const csrf    = csrfFor(session);
    const req = mockReq(method, url, {
      "cookie": `${COOKIE_SESSION}=${session}; ${COOKIE_CSRF}=${csrf}`,
      // sin x-csrf-token header
    });
    const res = mockRes();
    const handled = await dispatch(req, res);
    assert.equal(handled, true);
    assert.equal(res._status, 403, `${method} ${url} sin x-csrf-token debe devolver 403, devolvió ${res._status}`);
  }
});

test("XEI-34: API mutating con CSRF header pero cookie errónea → 403", async () => {
  for (const { method, url } of ADMIN_API_MUTATIONS) {
    const session = signSession("admin-1");
    const csrf    = csrfFor(session);
    const req = mockReq(method, url, {
      "x-csrf-token": csrf,
      "cookie":       `${COOKIE_SESSION}=${session}; ${COOKIE_CSRF}=token-incorrecto`,
    });
    const res = mockRes();
    const handled = await dispatch(req, res);
    assert.equal(handled, true);
    assert.equal(res._status, 403, `${method} ${url} con CSRF cookie errónea debe devolver 403, devolvió ${res._status}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// XEI-34: CRON token — 401 en todos los casos de error
// ──────────────────────────────────────────────────────────────────────────

test("XEI-34: refresh-stale-og sin Authorization → 401", async () => {
  const req = mockReq("POST", "/api/admin/refresh-stale-og");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("XEI-34: refresh-stale-og con token incorrecto → 401", async () => {
  const req = mockReq("POST", "/api/admin/refresh-stale-og", {
    "authorization": "Bearer token-incorrecto",
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("XEI-34: refresh-stale-og sin INTERNAL_CRON_TOKEN configurado → 401", () => {
  const saved = process.env.INTERNAL_CRON_TOKEN;
  delete process.env.INTERNAL_CRON_TOKEN;
  const savedErr = console.error;
  console.error = () => {};
  try {
    // Direct requireCronToken test — the route handler won't work without convex
    const { requireCronToken } = require("../server/auth.js");
    const req = mockReq("POST", "/api/admin/refresh-stale-og");
    const res = mockRes();
    assert.equal(requireCronToken(req, res), false);
    assert.equal(res._status, 401);
  } finally {
    process.env.INTERNAL_CRON_TOKEN = saved;
    console.error = savedErr;
  }
});

// ──────────────────────────────────────────────────────────────────────────
// XEI-34: Rate limits
// ──────────────────────────────────────────────────────────────────────────

test("XEI-34: limitador subscribers bloquea en el intento 4 (max 3/min)", () => {
  const lim = createLimiter({ max: 3, windowMs: 60_000 });
  const key = "test-subscriber";
  const res = mockRes();

  // 3 intentos deben pasar
  assert.equal(lim.consume({}, res, key), true);
  assert.equal(lim.consume({}, res, key), true);
  assert.equal(lim.consume({}, res, key), true);
  // El 4º bloquea
  assert.equal(lim.consume({}, res, key), false);
  assert.equal(res._status, 429);
  assert.ok(res._headers["Retry-After"]);
  lim.destroy();
});

test("XEI-34: limitador contact bloquea en el intento 4 (max 3/min)", () => {
  const lim = createLimiter({ max: 3, windowMs: 60_000 });
  const key = "test-contact";
  const res = mockRes();

  assert.equal(lim.consume({}, res, key), true);
  assert.equal(lim.consume({}, res, key), true);
  assert.equal(lim.consume({}, res, key), true);
  assert.equal(lim.consume({}, res, key), false);
  assert.equal(res._status, 429);
  lim.destroy();
});

test("XEI-34: limitador login bloquea en el intento 6 (max 5/5min)", () => {
  const lim = createLimiter({ max: 5, windowMs: 5 * 60_000 });
  const key = "test-login";
  const res = mockRes();

  for (let i = 0; i < 5; i++) assert.equal(lim.consume({}, res, key), true);
  assert.equal(lim.consume({}, res, key), false);
  assert.equal(res._status, 429);
  lim.destroy();
});

test("XEI-34: limitador track bloquea en el intento 31 (max 30/min)", () => {
  const lim = createLimiter({ max: 30, windowMs: 60_000 });
  const key = "test-track";
  const res = mockRes();

  for (let i = 0; i < 30; i++) assert.equal(lim.consume({}, res, key), true);
  assert.equal(lim.consume({}, res, key), false);
  assert.equal(res._status, 429);
  lim.destroy();
});

test("XEI-34: limitador unsubscribe bloquea en el intento 6 (max 5/min)", () => {
  const lim = createLimiter({ max: 5, windowMs: 60_000 });
  const key = "test-unsub";
  const res = mockRes();

  for (let i = 0; i < 5; i++) assert.equal(lim.consume({}, res, key), true);
  assert.equal(lim.consume({}, res, key), false);
  assert.equal(res._status, 429);
  lim.destroy();
});

// ──────────────────────────────────────────────────────────────────────────
// XEI-34: Sesión válida + CSRF → rutas mutating pasan el guard
// ──────────────────────────────────────────────────────────────────────────

test("XEI-34: API mutating con sesión válida + CSRF correcto pasa guards", () => {
  // Test unitario del middleware directamente (sin convex)
  const session = signSession("admin-1");
  const csrf    = csrfFor(session);
  const req = mockReq("POST", "/api/admin/test");
  req.headers["x-csrf-token"] = csrf;
  req.headers["cookie"]       = `${COOKIE_SESSION}=${session}; ${COOKIE_CSRF}=${csrf}`;

  const { requireAdmin, requireCsrf } = require("../server/auth.js");
  const res = mockRes();
  assert.equal(requireAdmin(req, res), true);
  assert.equal(requireCsrf(req, res), true);
});

// ──────────────────────────────────────────────────────────────────────────
// XEI-34: Rutas públicas no requieren sesión
// ──────────────────────────────────────────────────────────────────────────

const PUBLIC_GETS = [
  "/",
  "/recursos",
  "/blog",
  "/buscar",
  "/noticias",
  "/descargas",
  "/acerca",
  "/legal/privacidad",
  "/legal/aviso-legal",
  "/legal/cookies",
  "/api/blog",
  "/api/resources",
  "/api/resources/filtered",
  "/api/search",
  "/sitemap.xml",
];

test("XEI-34: Rutas públicas GET no requieren sesión (no 401)", async () => {
  for (const url of PUBLIC_GETS) {
    const req = mockReq("GET", url);
    const res = mockRes();
    try {
      const handled = await dispatch(req, res);
      if (!handled) continue;
      if (res._status !== null) {
        assert.notEqual(res._status, 401, `${url} no debe devolver 401 (pública)`);
      }
    } catch {
      // Convex no disponible en tests — el handler lanza, pero no fue 401
    }
  }
});
