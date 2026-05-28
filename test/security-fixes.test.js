"use strict";

// Must be set before requiring auth.js
process.env.SESSION_SECRET = "test-secret-que-tiene-mas-de-32-caracteres!!";
process.env.NODE_ENV = "test";

const { test } = require("node:test");
const assert   = require("node:assert/strict");

const {
  signSession,
  verifySession,
  csrfFor,
  requireCsrf,
  COOKIE_SESSION,
  COOKIE_CSRF,
} = require("../server/auth.js");

const { dispatch }    = require("../server/router.js");
const { safeDecodeUrl } = require("../server/http.js");

// Register routes (side-effects)
require("../server/routes/api-admin.js");
require("../server/routes/api-resources.js");

// ── Helpers ────────────────────────────────────────────────────────────────

function mockRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.writeHead = (s, h) => { res._status = s; Object.assign(res._headers, h || {}); };
  res.setHeader  = (k, v) => { res._headers[k] = v; };
  res.end        = (b)    => { res._body = b; };
  return res;
}

function mockReq(method, url, headers = {}) {
  return { method, url, headers: { cookie: "", ...headers }, params: {} };
}

// ── XEI-43: verifyPayload — longitud antes de timingSafeEqual ──────────────

test("XEI-43: firma más corta que la esperada → null, no excepción", () => {
  const valid  = signSession("admin-id");
  const dot    = valid.lastIndexOf(".");
  const short  = `${valid.slice(0, dot)}.x`;
  assert.doesNotThrow(() => assert.equal(verifySession(short), null));
});

test("XEI-43: firma más larga que la esperada → null, no excepción", () => {
  const valid = signSession("admin-id");
  const dot   = valid.lastIndexOf(".");
  const long  = `${valid.slice(0, dot)}.${"a".repeat(200)}`;
  assert.doesNotThrow(() => assert.equal(verifySession(long), null));
});

test("XEI-43: token sin punto → null", () => {
  assert.doesNotThrow(() => assert.equal(verifySession("sinpunto"), null));
});

// ── XEI-44: requireCsrf — valida cookie rc_csrf ───────────────────────────

test("XEI-44: sin cookie rc_csrf → 403", () => {
  const session = signSession("admin-1");
  const req = mockReq("POST", "/test");
  req._sessionToken = session;
  req.headers["x-csrf-token"] = csrfFor(session);
  // cookie vacía → sin rc_csrf

  const res = mockRes();
  assert.equal(requireCsrf(req, res), false);
  assert.equal(res._status, 403);
});

test("XEI-44: cookie rc_csrf ≠ header → 403", () => {
  const session = signSession("admin-1");
  const csrf    = csrfFor(session);
  const req = mockReq("POST", "/test");
  req._sessionToken = session;
  req.headers["x-csrf-token"] = csrf;
  req.headers["cookie"]       = `${COOKIE_CSRF}=token-incorrecto`;

  const res = mockRes();
  assert.equal(requireCsrf(req, res), false);
  assert.equal(res._status, 403);
});

test("XEI-44: header == cookie == csrfFor(session) → true", () => {
  const session = signSession("admin-1");
  const csrf    = csrfFor(session);
  const req = mockReq("POST", "/test");
  req._sessionToken = session;
  req.headers["x-csrf-token"] = csrf;
  req.headers["cookie"]       = `${COOKIE_SESSION}=${session}; ${COOKIE_CSRF}=${csrf}`;

  const res = mockRes();
  assert.equal(requireCsrf(req, res), true);
});

// ── XEI-45: POST /api/admin/logout requiere sesión ─────────────────────────

test("XEI-45: logout sin sesión → 401", async () => {
  const req = mockReq("POST", "/api/admin/logout");
  const res = mockRes();
  const handled = await dispatch(req, res);
  assert.equal(handled, true);
  assert.equal(res._status, 401);
});

// ── XEI-46: GET /api/resources/filtered — valida kind ─────────────────────

test("XEI-46: kind desconocido → 400", async () => {
  const req = mockReq("GET", "/api/resources/filtered?kind=foo");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
  assert.deepEqual(JSON.parse(res._body), { error: "kind inválido" });
});

test("XEI-46: kind válido no devuelve 400 de validación", async () => {
  const req = mockReq("GET", "/api/resources/filtered?kind=pdf");
  const res = mockRes();
  // _convex es null → puede lanzar; nos interesa que no sea 400 de kind
  try { await dispatch(req, res); } catch { /* convex no disponible en tests */ }
  if (res._status !== null) {
    assert.notDeepEqual(JSON.parse(res._body || "{}"), { error: "kind inválido" });
  }
});

// ── XEI-47: safeDecodeUrl captura URIError ────────────────────────────────

test("XEI-47: URL malformada → null (no excepción)", () => {
  assert.doesNotThrow(() => assert.equal(safeDecodeUrl("%GG"), null));
  assert.doesNotThrow(() => assert.equal(safeDecodeUrl("/%GG/recurso"), null));
});

test("XEI-47: URL válida → pathname decodificada sin query string", () => {
  assert.equal(safeDecodeUrl("/recursos%20canarias"), "/recursos canarias");
  assert.equal(safeDecodeUrl("/normal?q=foo"), "/normal");
  assert.equal(safeDecodeUrl("/sin-codificar"), "/sin-codificar");
});
