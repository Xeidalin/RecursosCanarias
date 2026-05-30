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

// ── XEI-42: requireAdmin redirige en GET, devuelve JSON 401 en API ──────────

test("XEI-42: GET admin sin sesión → 302 redirect a /admin/login", async () => {
  const req = mockReq("GET", "/admin");
  const res = mockRes();
  const handled = await dispatch(req, res);
  assert.equal(handled, true);
  assert.equal(res._status, 302);
  assert.equal(res._headers.Location, "/admin/login");
});

test("XEI-42: GET admin sin sesión sin cookie rc_session → redirect", async () => {
  const req = mockReq("GET", "/admin/recursos");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 302);
  assert.equal(res._headers.Location, "/admin/login");
});

test("XEI-42: HEAD sin sesión → redirect (requireAdmin directo)", () => {
  const { requireAdmin } = require("../server/auth.js");
  const req = mockReq("HEAD", "/admin");
  const res = mockRes();
  assert.equal(requireAdmin(req, res), false);
  assert.equal(res._status, 302);
  assert.equal(res._headers.Location, "/admin/login");
});

test("XEI-42: POST admin sin sesión → 401 JSON (no redirect)", async () => {
  const req = mockReq("POST", "/api/admin/logout");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
  assert.equal(res._headers["Content-Type"], "application/json");
});

test("XEI-42: GET admin con sesión expirada → 302 redirect + cookies limpias", async () => {
  const expiredToken = signSession("admin-x");
  // Manipular el token para que parezca expirado — usamos un token con exp en el pasado
  const now = Date.now();
  const expiredPayload = { adminId: "admin-x", kid: "v1", iat: now - 1000, exp: now - 1 };
  const encoded = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");
  const crypto = require("node:crypto");
  const secret = process.env.SESSION_SECRET;
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  const token = `${encoded}.${sig}`;

  const req = mockReq("GET", "/admin/blog");
  req.headers["cookie"] = `rc_session=${token}`;
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 302);
  assert.equal(res._headers.Location, "/admin/login");
  // Debe limpiar cookies
  assert.ok(res._headers["Set-Cookie"], "debe setear cookies limpias");
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

// ── XEI-48: wrapper CJS para convex/_generated/api ────────────────────────

test("XEI-48: api-node.js carga como CJS y expone api/internal/components", () => {
  const mod = require("../convex/_generated/api-node.js");
  assert.ok(mod.api,        "api debe estar definido");
  assert.ok(mod.internal,   "internal debe estar definido");
  assert.ok(mod.components, "components debe estar definido");
  // anyApi es un Proxy; acceder a una propiedad devuelve otro Proxy/objeto
  assert.equal(typeof mod.api.resources, "object");
});

test("XEI-48: scripts/seed.js y scripts/create-admin.js usan api-node.js, no api.js", () => {
  const seedSrc        = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../scripts/seed.js"), "utf8");
  const createAdminSrc = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../scripts/create-admin.js"), "utf8");
  const seedIslandsSrc = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../scripts/seed-islands.js"), "utf8");

  assert.ok(!seedSrc.includes('"../convex/_generated/api"'),
    "seed.js no debe importar el ESM original");
  assert.ok(!createAdminSrc.includes('"../convex/_generated/api"'),
    "create-admin.js no debe importar el ESM original");
  assert.ok(!seedIslandsSrc.includes('"../convex/_generated/api"'),
    "seed-islands.js no debe importar el ESM original");
});

// ── XEI-49: renderPage convierte ENOENT en 404 ───────────────────────────

test("XEI-49: ruta /descargas sin template → 404, no 500", async () => {
  const req = mockReq("GET", "/descargas");
  const res = mockRes();
  const handled = await dispatch(req, res);
  assert.equal(handled, true);
  assert.equal(res._status, 404, "debe devolver 404, no 500");
});

test("XEI-49: ruta /noticias sin template → 404, no 500", async () => {
  const req = mockReq("GET", "/noticias");
  const res = mockRes();
  const handled = await dispatch(req, res);
  assert.equal(handled, true);
  assert.equal(res._status, 404);
});

test("XEI-49: ruta /acerca debe devolver 200 con formulario de contacto", async () => {
  const req = mockReq("GET", "/acerca");
  const res = mockRes();
  const handled = await dispatch(req, res);
  assert.equal(handled, true);
  assert.equal(res._status, 200);
  assert.ok(res._body.includes("contact-form"));
  assert.ok(res._body.includes("/legal/privacidad"));
});
