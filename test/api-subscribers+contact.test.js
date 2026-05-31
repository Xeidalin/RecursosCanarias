"use strict";

process.env.SESSION_SECRET     = "test-secret-que-tiene-mas-de-32-caracteres!!";
process.env.INTERNAL_CRON_TOKEN = "cron-token-fijo-para-tests";
process.env.CONVEX_DEPLOY_KEY   = "dk-test-default";
process.env.NODE_ENV            = "test";

const { test } = require("node:test");
const assert   = require("node:assert/strict");

const { dispatch } = require("../server/router.js");
const {
  signSession, csrfFor, COOKIE_SESSION, COOKIE_CSRF,
} = require("../server/auth.js");

const subscribersRoute = require("../server/routes/api-subscribers.js");
const contactRoute     = require("../server/routes/api-contact.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.writeHead = (s, h) => { res._status = s; Object.assign(res._headers, h || {}); };
  res.setHeader = (k, v) => { res._headers[k] = v; };
  res.end       = (b) => { res._body = b; };
  return res;
}

let _ipSeq = 0;
function mockReq(method, url, { headers = {}, body = null, ip = null } = {}) {
  const reqIp = ip || `10.0.0.${++_ipSeq}`;
  const req = {
    method,
    url,
    headers: { cookie: "", ...headers },
    params: {},
    socket: { remoteAddress: reqIp },
  };
  if (body !== null) {
    const json = typeof body === "string" ? body : JSON.stringify(body);
    const chunks = [Buffer.from(json, "utf8")];
    req[Symbol.asyncIterator] = async function*() { for (const c of chunks) yield c; };
  } else {
    req[Symbol.asyncIterator] = async function*() {};
  }
  return req;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_TYPES = new Set(["colaboracion", "sugerencia", "error", "otro"]);

function makeStub() {
  const subscribers = new Map();
  const contactMessages = [];
  const calls = { subscribe: [], submit: [], listAdmin: [], listAll: [], listMessages: [], markHandled: [] };

  const convex = {
    async query(fn, args) {
      if (fn === "subscribers.listAdmin" || fn === "subscribers.listAll") {
        const targetCalls = fn === "subscribers.listAdmin" ? calls.listAdmin : calls.listAll;
        targetCalls.push(args);

        // deployKey required
        const expectedDk = process.env.CONVEX_DEPLOY_KEY || "";
        if (!expectedDk || args.deployKey !== expectedDk) {
          throw new Error("No autorizado");
        }

        const allItems = [];
        for (const s of subscribers.values()) {
          allItems.push({
            _id:            s.email,
            email:          s.email,
            createdAt:      s.createdAt,
            unsubscribedAt: s.unsubscribedAt ?? null,
          });
        }
        allItems.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        if (fn === "subscribers.listAll") return allItems;

        // Paginated: listAdmin
        const cursor = args.paginationOpts?.cursor;
        const limit  = args.paginationOpts?.numItems || 50;
        let startIdx = 0;
        if (cursor) {
          startIdx = allItems.findIndex((it) => it._id === cursor);
          if (startIdx === -1) startIdx = 0;
        }
        const page = allItems.slice(startIdx, startIdx + limit);
        const isDone = startIdx + limit >= allItems.length;
        return {
          items: page,
          continueCursor: isDone ? null : page[page.length - 1]._id,
          isDone,
        };
      }
      if (fn === "contact.listAdmin") {
        calls.listMessages.push(args);

        const expectedDk = process.env.CONVEX_DEPLOY_KEY || "";
        if (!expectedDk || args.deployKey !== expectedDk) {
          throw new Error("No autorizado");
        }

        // Pendientes primero, luego atendidos; cada grupo por createdAt asc (índice)
        const sorted = [...contactMessages].sort((a, b) => {
          if (a.handled !== b.handled) return a.handled ? 1 : -1;
          return a.createdAt.localeCompare(b.createdAt);
        });

        const cursor = args.paginationOpts?.cursor;
        const limit  = args.paginationOpts?.numItems || 50;
        let startIdx = 0;
        if (cursor) {
          startIdx = sorted.findIndex((it) => it._id === cursor);
          if (startIdx === -1) startIdx = 0;
        }
        const page = sorted.slice(startIdx, startIdx + limit);
        const isDone = startIdx + limit >= sorted.length;
        return {
          items: page,
          continueCursor: isDone ? null : page[page.length - 1]._id,
          isDone,
        };
      }
      throw new Error(`stub query no implementada: ${fn}`);
    },
    async mutation(fn, args) {
      if (fn === "subscribers.subscribe") {
        calls.subscribe.push(args);

        // Defense-in-depth: deployKey required
        const expectedDk = process.env.CONVEX_DEPLOY_KEY || "";
        if (!expectedDk || args.deployKey !== expectedDk) {
          throw new Error("No autorizado");
        }

        // Defense-in-depth: validate email
        const normalized = args.email.trim().toLowerCase();
        if (!normalized || !EMAIL_RE.test(normalized)) {
          throw new Error("Email inválido");
        }

        const existing = subscribers.get(normalized);
        if (existing) {
          if (!existing.unsubscribedAt) return { status: "already" };
          existing.unsubscribedAt = undefined;
          return { status: "created" };
        }
        subscribers.set(normalized, { email: normalized, createdAt: new Date().toISOString() });
        return { status: "created" };
      }
      if (fn === "contact.submit") {
        calls.submit.push(args);

        // Defense-in-depth: deployKey required
        const expectedDk = process.env.CONVEX_DEPLOY_KEY || "";
        if (!expectedDk || args.deployKey !== expectedDk) {
          throw new Error("No autorizado");
        }

        // Defense-in-depth: validate fields
        const n = args.name.trim();
        if (!n || n.length > 200) throw new Error("Nombre inválido");
        const e = args.email.trim();
        if (!e || !EMAIL_RE.test(e)) throw new Error("Email inválido");
        if (!VALID_TYPES.has(args.type)) throw new Error("Tipo inválido");
        const m = args.message.trim();
        if (m.length < 10 || m.length > 5000) throw new Error("Mensaje inválido");

        const entry = { _id: `msg-${contactMessages.length + 1}`, ...args };
        contactMessages.push(entry);
        return { ok: true };
      }
      if (fn === "contact.markHandled") {
        calls.markHandled.push(args);

        const expectedDk = process.env.CONVEX_DEPLOY_KEY || "";
        if (!expectedDk || args.deployKey !== expectedDk) {
          throw new Error("No autorizado");
        }

        const msg = contactMessages.find((m) => m._id === args.id);
        if (!msg) throw new Error("No encontrado");
        msg.handled = true;
        return { ok: true };
      }
      throw new Error(`stub mutation no implementada: ${fn}`);
    },
  };

  const api = {
    subscribers: {
      subscribe: "subscribers.subscribe",
      listAdmin: "subscribers.listAdmin",
      listAll:   "subscribers.listAll",
    },
    contact: {
      submit:      "contact.submit",
      listAdmin:   "contact.listAdmin",
      markHandled: "contact.markHandled",
    },
  };

  return { convex, api, calls, subscribers, contactMessages };
}

// ── Wire routes once ───────────────────────────────────────────────────────────

const stub = makeStub();
subscribersRoute.init(stub.convex, stub.api);
contactRoute.init(stub.convex, stub.api);

// ═══════════════════════════════════════════════════════════════════════════════
// Subscribers tests
// ═══════════════════════════════════════════════════════════════════════════════

// ── Auth gates ─────────────────────────────────────────────────────────────────

test("GET /api/subscribers no está registrada (solo POST)", async () => {
  const req = mockReq("GET", "/api/subscribers");
  const res = mockRes();
  const handled = await dispatch(req, res);
  assert.equal(handled, false);
});

// ── Validation ─────────────────────────────────────────────────────────────────

test("POST /api/subscribers sin email → 400", async () => {
  const req = mockReq("POST", "/api/subscribers", { body: {} });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("POST /api/subscribers con email vacío → 400", async () => {
  const req = mockReq("POST", "/api/subscribers", { body: { email: "" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("POST /api/subscribers con email inválido → 400", async () => {
  const req = mockReq("POST", "/api/subscribers", { body: { email: "no-es-email" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("POST /api/subscribers con email sin arroba → 400", async () => {
  const req = mockReq("POST", "/api/subscribers", { body: { email: "userexample.com" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

// ── Success cases ──────────────────────────────────────────────────────────────

test("POST /api/subscribers nuevo email → 200, status created", async () => {
  const req = mockReq("POST", "/api/subscribers", { body: { email: "nueva@test.es" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const data = JSON.parse(res._body);
  assert.equal(data.status, "created");
});

test("POST /api/subscribers email ya suscrito → 200, status already", async () => {
  const req = mockReq("POST", "/api/subscribers", { body: { email: "nueva@test.es" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const data = JSON.parse(res._body);
  assert.equal(data.status, "already");
});

test("POST /api/subscribers normaliza email (trim + lowercase)", async () => {
  const req = mockReq("POST", "/api/subscribers", { body: { email: "  MixCase@TEST.ES  " } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const data = JSON.parse(res._body);
  assert.equal(data.status, "created");
});

// ── Re-subscribe ──────────────────────────────────────────────────────────────

test("POST /api/subscribers re-suscribe a quien se dio de baja", async () => {
  const localStub = makeStub();
  localStub.subscribers.set("vuelta@test.es", {
    email: "vuelta@test.es",
    createdAt: new Date().toISOString(),
    unsubscribedAt: new Date().toISOString(),
  });
  subscribersRoute.init(localStub.convex, localStub.api);

  const req = mockReq("POST", "/api/subscribers", { body: { email: "vuelta@test.es" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  assert.equal(JSON.parse(res._body).status, "created");
});

// ── deployKey ─────────────────────────────────────────────────────────────────

test("POST /api/subscribers pasa deployKey a la mutation", async () => {
  const localStub = makeStub();
  subscribersRoute.init(localStub.convex, localStub.api);
  const prev = process.env.CONVEX_DEPLOY_KEY;
  process.env.CONVEX_DEPLOY_KEY = "dk-test";

  const req = mockReq("POST", "/api/subscribers", { body: { email: "dk@test.es" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const sent = localStub.calls.subscribe.at(-1);
  assert.equal(sent.deployKey, "dk-test");

  process.env.CONVEX_DEPLOY_KEY = prev;
});

test("POST /api/subscribers sin CONVEX_DEPLOY_KEY configurada → 500 (Convex rechaza)", async () => {
  const localStub = makeStub();
  subscribersRoute.init(localStub.convex, localStub.api);
  const prev = process.env.CONVEX_DEPLOY_KEY;
  delete process.env.CONVEX_DEPLOY_KEY;

  const req = mockReq("POST", "/api/subscribers", { body: { email: "sin-dk@test.es" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 500);

  process.env.CONVEX_DEPLOY_KEY = prev;
});

// ── Rate limit ────────────────────────────────────────────────────────────────

test("POST /api/subscribers rate limit: 4 peticiones misma IP → 4ª es 429", async () => {
  const localStub = makeStub();
  subscribersRoute.init(localStub.convex, localStub.api);
  contactRoute.init(localStub.convex, localStub.api);
  const ip = "10.255.255.1";

  for (let i = 0; i < 3; i++) {
    const req = mockReq("POST", "/api/subscribers", {
      body: { email: `r${i}@test.es` },
      ip,
    });
    const res = mockRes();
    await dispatch(req, res);
    assert.equal(res._status, 200, `petición ${i + 1} debe ser 200`);
  }

  const req = mockReq("POST", "/api/subscribers", {
    body: { email: "r4@test.es" },
    ip,
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 429);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Contact tests
// ═══════════════════════════════════════════════════════════════════════════════

// ── Auth gates ─────────────────────────────────────────────────────────────────

test("GET /api/contact no está registrada (solo POST)", async () => {
  const req = mockReq("GET", "/api/contact");
  const res = mockRes();
  const handled = await dispatch(req, res);
  assert.equal(handled, false);
});

// ── Validation ─────────────────────────────────────────────────────────────────

test("POST /api/contact sin body → 400 (name obligatorio)", async () => {
  const req = mockReq("POST", "/api/contact", { body: {} });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("POST /api/contact con name vacío → 400", async () => {
  const req = mockReq("POST", "/api/contact", {
    body: { name: "", email: "a@b.c", type: "sugerencia", message: "mensaje de prueba" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("POST /api/contact con email inválido → 400", async () => {
  const req = mockReq("POST", "/api/contact", {
    body: { name: "Ana", email: "no-valido", type: "sugerencia", message: "mensaje de prueba" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("POST /api/contact con type inválido → 400", async () => {
  const req = mockReq("POST", "/api/contact", {
    body: { name: "Ana", email: "ana@test.es", type: "hack", message: "mensaje de prueba" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("POST /api/contact sin type → 400", async () => {
  const req = mockReq("POST", "/api/contact", {
    body: { name: "Ana", email: "ana@test.es", message: "mensaje de prueba" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("POST /api/contact con message corto (<10 chars) → 400", async () => {
  const req = mockReq("POST", "/api/contact", {
    body: { name: "Ana", email: "ana@test.es", type: "otro", message: "corto" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("POST /api/contact con name > 200 chars → 400", async () => {
  const req = mockReq("POST", "/api/contact", {
    body: { name: "A".repeat(201), email: "ana@test.es", type: "otro", message: "mensaje de prueba" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("POST /api/contact con message > 5000 chars → 400", async () => {
  const req = mockReq("POST", "/api/contact", {
    body: { name: "Ana", email: "ana@test.es", type: "otro", message: "x".repeat(5001) },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

// ── Success case ───────────────────────────────────────────────────────────────

test("POST /api/contact válido → 201, ok true", async () => {
  const req = mockReq("POST", "/api/contact", {
    body: { name: "Ana", email: "ana@test.es", type: "colaboracion", message: "Tengo recursos para compartir con el proyecto." },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 201);
  const data = JSON.parse(res._body);
  assert.equal(data.ok, true);
});

test("POST /api/contact válido con type=error → 201", async () => {
  const req = mockReq("POST", "/api/contact", {
    body: { name: "Bea", email: "bea@test.es", type: "error", message: "He encontrado un enlace roto en la página de recursos." },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 201);
});

// ── deployKey ─────────────────────────────────────────────────────────────────

test("POST /api/contact pasa deployKey a la mutation", async () => {
  const localStub = makeStub();
  contactRoute.init(localStub.convex, localStub.api);
  const prev = process.env.CONVEX_DEPLOY_KEY;
  process.env.CONVEX_DEPLOY_KEY = "dk-test-ct";

  const req = mockReq("POST", "/api/contact", {
    body: { name: "Ana", email: "ana@test.es", type: "sugerencia", message: "Mensaje con deployKey de prueba." },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 201);
  const sent = localStub.calls.submit.at(-1);
  assert.equal(sent.deployKey, "dk-test-ct");

  process.env.CONVEX_DEPLOY_KEY = prev;
});

test("POST /api/contact sin CONVEX_DEPLOY_KEY configurada → 500 (Convex rechaza)", async () => {
  const localStub = makeStub();
  contactRoute.init(localStub.convex, localStub.api);
  const prev = process.env.CONVEX_DEPLOY_KEY;
  delete process.env.CONVEX_DEPLOY_KEY;

  const req = mockReq("POST", "/api/contact", {
    body: { name: "Ana", email: "ana@test.es", type: "sugerencia", message: "Sin deployKey configurada." },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 500);

  process.env.CONVEX_DEPLOY_KEY = prev;
});

// ── Rate limit ────────────────────────────────────────────────────────────────

test("POST /api/contact rate limit: 4 peticiones misma IP → 4ª es 429", async () => {
  const ip = "10.255.255.2";

  for (let i = 0; i < 3; i++) {
    const req = mockReq("POST", "/api/contact", {
      body: { name: `T${i}`, email: `r${i}@test.es`, type: "sugerencia", message: "mensaje de prueba larguito" },
      ip,
    });
    const res = mockRes();
    await dispatch(req, res);
    assert.equal(res._status, 201, `petición ${i + 1} debe ser 201`);
  }

  const req = mockReq("POST", "/api/contact", {
    body: { name: "T4", email: "r4@test.es", type: "sugerencia", message: "mensaje de prueba larguito" },
    ip,
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 429);
});

// ── Body size limit ───────────────────────────────────────────────────────────

test("POST /api/subscribers rechaza body > 4 KB → 413", async () => {
  const req = mockReq("POST", "/api/subscribers", {
    body: { email: "a@b.c", junk: "x".repeat(5000) },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 413);
});

test("POST /api/contact rechaza body > 16 KB → 413", async () => {
  const req = mockReq("POST", "/api/contact", {
    body: { name: "A", email: "a@b.c", type: "otro", message: "x".repeat(17000) },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 413);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Admin subscribers tests
// ═══════════════════════════════════════════════════════════════════════════════

function adminReq(method, url, opts = {}) {
  const session = signSession("admin-1");
  const csrf    = csrfFor(session);
  return mockReq(method, url, {
    headers: {
      "x-csrf-token": csrf,
      "cookie":       `${COOKIE_SESSION}=${session}; ${COOKIE_CSRF}=${csrf}`,
      ...(opts.headers || {}),
    },
    body: opts.body ?? null,
  });
}

// ── Auth gates ─────────────────────────────────────────────────────────────────

test("GET /api/admin/subscribers sin sesión → 401", async () => {
  const req = mockReq("GET", "/api/admin/subscribers");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("GET /api/admin/subscribers/csv sin sesión → 401", async () => {
  const req = mockReq("GET", "/api/admin/subscribers/csv");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

// ── List subscribers ───────────────────────────────────────────────────────────

test("GET /api/admin/subscribers con sesión → 200, paginado", async () => {
  const localStub = makeStub();
  subscribersRoute.init(localStub.convex, localStub.api);
  const req = adminReq("GET", "/api/admin/subscribers");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const data = JSON.parse(res._body);
  assert.ok(Array.isArray(data.items));
  assert.equal(data.items.length, 0);
  assert.equal(data.hasMore, false);
  assert.equal(data.nextCursor, null);
});

test("GET /api/admin/subscribers con suscriptores → 200, lista ordenada", async () => {
  const localStub = makeStub();
  localStub.subscribers.set("a@test.es", {
    email: "a@test.es", createdAt: "2026-05-01T10:00:00.000Z",
  });
  localStub.subscribers.set("b@test.es", {
    email: "b@test.es", createdAt: "2026-05-02T10:00:00.000Z", unsubscribedAt: "2026-05-03T10:00:00.000Z",
  });
  subscribersRoute.init(localStub.convex, localStub.api);

  const req = adminReq("GET", "/api/admin/subscribers");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const data = JSON.parse(res._body);
  assert.equal(data.items.length, 2);
  // Más reciente primero
  assert.equal(data.items[0].email, "b@test.es");
  assert.equal(data.items[0].unsubscribedAt, "2026-05-03T10:00:00.000Z");
  assert.equal(data.items[1].email, "a@test.es");
  assert.equal(data.items[1].unsubscribedAt, null);
  assert.equal(data.hasMore, false);
});

test("GET /api/admin/subscribers pasa deployKey al query", async () => {
  const localStub = makeStub();
  subscribersRoute.init(localStub.convex, localStub.api);
  const prev = process.env.CONVEX_DEPLOY_KEY;
  process.env.CONVEX_DEPLOY_KEY = "dk-admin";

  const req = adminReq("GET", "/api/admin/subscribers");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const sent = localStub.calls.listAdmin.at(-1);
  assert.equal(sent.deployKey, "dk-admin");

  process.env.CONVEX_DEPLOY_KEY = prev;
});

// ── CSV export ─────────────────────────────────────────────────────────────────

test("GET /api/admin/subscribers/csv con sesión → 200, text/csv", async () => {
  const localStub = makeStub();
  localStub.subscribers.set("x@test.es", {
    email: "x@test.es", createdAt: "2026-01-15T12:00:00.000Z",
  });
  subscribersRoute.init(localStub.convex, localStub.api);

  const req = adminReq("GET", "/api/admin/subscribers/csv");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  assert.match(res._headers["Content-Type"], /text\/csv/);
  assert.match(res._headers["Content-Disposition"], /suscriptores\.csv/);
  const csv = res._body;
  assert.ok(csv.startsWith("email,createdAt,estado,unsubscribedAt"));
  assert.ok(csv.includes("x@test.es"));
  assert.ok(csv.includes("activo"));
});

test("GET /api/admin/subscribers/csv pasa deployKey al query", async () => {
  const localStub = makeStub();
  subscribersRoute.init(localStub.convex, localStub.api);
  const prev = process.env.CONVEX_DEPLOY_KEY;
  process.env.CONVEX_DEPLOY_KEY = "dk-csv";

  const req = adminReq("GET", "/api/admin/subscribers/csv");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const sent = localStub.calls.listAll.at(-1);
  assert.equal(sent.deployKey, "dk-csv");

  process.env.CONVEX_DEPLOY_KEY = prev;
});

test("GET /api/admin/subscribers/csv neutraliza fórmula CSV en email", async () => {
  const localStub = makeStub();
  localStub.subscribers.set("=SUM(1,2)@test.es", {
    email: "=SUM(1,2)@test.es", createdAt: "2026-03-10T08:00:00.000Z",
  });
  subscribersRoute.init(localStub.convex, localStub.api);

  const req = adminReq("GET", "/api/admin/subscribers/csv");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const csv = res._body;
  // Debe anteponer comilla simple dentro de las comillas
  assert.ok(csv.includes("\"'=SUM(1,2)@test.es\""));
  assert.ok(!csv.includes("\"=SUM(1,2)"));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Admin contact messages tests
// ═══════════════════════════════════════════════════════════════════════════════

// ── Auth gates ─────────────────────────────────────────────────────────────────

test("GET /api/admin/messages sin sesión → 401", async () => {
  const req = mockReq("GET", "/api/admin/messages");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("POST /api/admin/messages/:id/mark-handled sin sesión → 401", async () => {
  const req = mockReq("POST", "/api/admin/messages/msg-1/mark-handled");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

// ── List messages ──────────────────────────────────────────────────────────────

test("GET /api/admin/messages con sesión → 200, paginado", async () => {
  const localStub = makeStub();
  contactRoute.init(localStub.convex, localStub.api);
  const req = adminReq("GET", "/api/admin/messages");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const data = JSON.parse(res._body);
  assert.ok(Array.isArray(data.items));
  assert.equal(data.items.length, 0);
  assert.equal(data.hasMore, false);
});

test("GET /api/admin/messages con mensajes → pendientes primero", async () => {
  const localStub = makeStub();
  // Insert two messages: one handled, one unhandled
  localStub.contactMessages.push(
    { _id: "msg-1", name: "A", email: "a@b.c", type: "sugerencia", message: "Mensaje 1", createdAt: "2026-05-01T10:00:00.000Z", handled: true, deployKey: "dk-test-default" },
    { _id: "msg-2", name: "B", email: "b@b.c", type: "error", message: "Mensaje 2", createdAt: "2026-05-02T10:00:00.000Z", handled: false, deployKey: "dk-test-default" },
  );
  contactRoute.init(localStub.convex, localStub.api);

  const req = adminReq("GET", "/api/admin/messages");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const data = JSON.parse(res._body);
  assert.equal(data.items.length, 2);
  // Pendiente (msg-2) primero
  assert.equal(data.items[0]._id, "msg-2");
  assert.equal(data.items[0].handled, false);
  assert.equal(data.items[1]._id, "msg-1");
  assert.equal(data.items[1].handled, true);
});

test("GET /api/admin/messages pasa deployKey al query", async () => {
  const localStub = makeStub();
  contactRoute.init(localStub.convex, localStub.api);
  const prev = process.env.CONVEX_DEPLOY_KEY;
  process.env.CONVEX_DEPLOY_KEY = "dk-msg";

  const req = adminReq("GET", "/api/admin/messages");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const sent = localStub.calls.listMessages.at(-1);
  assert.equal(sent.deployKey, "dk-msg");

  process.env.CONVEX_DEPLOY_KEY = prev;
});

// ── Mark handled ───────────────────────────────────────────────────────────────

test("POST /api/admin/messages/:id/mark-handled → 200, ok true", async () => {
  const localStub = makeStub();
  localStub.contactMessages.push(
    { _id: "msg-99", name: "X", email: "x@b.c", type: "otro", message: "Test", createdAt: "2026-05-01T10:00:00.000Z", handled: false, deployKey: "dk-test-default" },
  );
  contactRoute.init(localStub.convex, localStub.api);

  const req = adminReq("POST", "/api/admin/messages/msg-99/mark-handled");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  assert.equal(JSON.parse(res._body).ok, true);
  assert.equal(localStub.contactMessages[0].handled, true);
});

test("POST /api/admin/messages/:id/mark-handled pasa deployKey", async () => {
  const localStub = makeStub();
  localStub.contactMessages.push(
    { _id: "msg-98", name: "X", email: "x@b.c", type: "otro", message: "Test", createdAt: "2026-05-01T10:00:00.000Z", handled: false, deployKey: "dk-test-default" },
  );
  contactRoute.init(localStub.convex, localStub.api);
  const prev = process.env.CONVEX_DEPLOY_KEY;
  process.env.CONVEX_DEPLOY_KEY = "dk-mh";

  const req = adminReq("POST", "/api/admin/messages/msg-98/mark-handled");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const sent = localStub.calls.markHandled.at(-1);
  assert.equal(sent.deployKey, "dk-mh");

  process.env.CONVEX_DEPLOY_KEY = prev;
});


