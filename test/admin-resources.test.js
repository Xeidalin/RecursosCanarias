"use strict";

process.env.SESSION_SECRET     = "test-secret-que-tiene-mas-de-32-caracteres!!";
process.env.INTERNAL_CRON_TOKEN = "cron-token-fijo-para-tests";
process.env.NODE_ENV           = "test";

const { test } = require("node:test");
const assert   = require("node:assert/strict");

const ogQueue = require("../server/ogQueue.js");
const { dispatch } = require("../server/router.js");
const {
  signSession, csrfFor, COOKIE_SESSION, COOKIE_CSRF,
} = require("../server/auth.js");

// Side-effect: registra rutas
const resourcesRoute = require("../server/routes/api-resources.js");
require("../server/routes/api-admin.js");

// ── Mocks ───────────────────────────────────────────────────────────────────

function mockRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.writeHead = (s, h) => { res._status = s; Object.assign(res._headers, h || {}); };
  res.setHeader = (k, v) => { res._headers[k] = v; };
  res.end       = (b) => { res._body = b; };
  return res;
}

function mockReq(method, url, { headers = {}, body = null } = {}) {
  const req = {
    method,
    url,
    headers: { cookie: "", ...headers },
    params: {},
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

function makeStub({ resources = {}, throwOnUpdate = null } = {}) {
  const calls = { update: [], create: [], remove: [], getById: [], list: [], generateUploadUrl: [], getStorageUrl: [] };
  const convex = {
    async query(fn, args) {
      if (fn === "resources.getById") {
        calls.getById.push(args);
        return resources[args.id] ?? null;
      }
      if (fn === "resources.listFiltered") {
        calls.list.push(args);
        return { items: Object.values(resources), nextCursor: null, total: Object.keys(resources).length };
      }
      if (fn === "storage.getStorageUrl") {
        calls.getStorageUrl.push(args);
        return `https://convex-storage.test/${args.storageId}`;
      }
      throw new Error(`stub query no implementada: ${fn}`);
    },
    async mutation(fn, args) {
      if (fn === "resources.update") {
        calls.update.push(args);
        if (throwOnUpdate) throw new Error(throwOnUpdate);
        const prev = resources[args.id] || {};
        const next = { ...prev, ...args };
        resources[args.id] = next;
        return next;
      }
      if (fn === "resources.create") {
        calls.create.push(args);
        const id = args.id || `res-${Date.now()}`;
        const next = { id, ...args };
        resources[id] = next;
        return next;
      }
      if (fn === "resources.remove") {
        calls.remove.push(args);
        delete resources[args.id];
        return { deleted: args.id };
      }
      if (fn === "storage.generateUploadUrl") {
        calls.generateUploadUrl.push(args);
        return "https://convex-storage.test/upload?token=xyz";
      }
      throw new Error(`stub mutation no implementada: ${fn}`);
    },
  };
  const api = {
    resources: {
      getById: "resources.getById",
      listFiltered: "resources.listFiltered",
      create: "resources.create",
      update: "resources.update",
      remove: "resources.remove",
    },
    storage: {
      generateUploadUrl: "storage.generateUploadUrl",
      getStorageUrl: "storage.getStorageUrl",
    },
  };
  return { convex, api, calls };
}

const silentLogger = { info() {}, warn() {}, error() {} };

// ── Auth gates ──────────────────────────────────────────────────────────────

test("GET /api/admin/resources sin sesión → 401", async () => {
  const req = mockReq("GET", "/api/admin/resources");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("POST /api/admin/resources sin sesión → 401", async () => {
  const req = mockReq("POST", "/api/admin/resources", { body: { title: "x" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("PATCH /api/admin/resources/:id sin sesión → 401", async () => {
  const req = mockReq("PATCH", "/api/admin/resources/r1", { body: { title: "x" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("DELETE /api/admin/resources/:id sin sesión → 401", async () => {
  const req = mockReq("DELETE", "/api/admin/resources/r1");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("POST /api/admin/resources/upload-url sin sesión → 401", async () => {
  const req = mockReq("POST", "/api/admin/resources/upload-url");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("POST /api/admin/resources con sesión pero sin CSRF → 403", async () => {
  const session = signSession("admin-1");
  const req = mockReq("POST", "/api/admin/resources", {
    headers: { "cookie": `${COOKIE_SESSION}=${session}` },
    body: { title: "x" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 403);
});

// ── Validación ──────────────────────────────────────────────────────────────

test("POST /api/admin/resources rechaza si faltan campos → 400", async () => {
  ogQueue._reset();
  const stub = makeStub();
  resourcesRoute.init(stub.convex, stub.api);
  ogQueue.init(stub.convex, stub.api, { logger: silentLogger });

  const req = adminReq("POST", "/api/admin/resources", {
    body: { title: "Solo título" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
  assert.match(JSON.parse(res._body).error, /campos obligatorios/i);
});

test("POST /api/admin/resources rechaza isExternal no boolean → 400", async () => {
  ogQueue._reset();
  const stub = makeStub();
  resourcesRoute.init(stub.convex, stub.api);
  const req = adminReq("POST", "/api/admin/resources", {
    body: {
      slug: "x", title: "x", kind: "pdf",
      islands: ["todas"], topics: ["lengua"], levels: ["primaria"],
      isExternal: "yes",
    },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

// ── Create con OG queue ─────────────────────────────────────────────────────

test("POST /api/admin/resources con isExternal+sourceUrl encola OG", async () => {
  ogQueue._reset();
  const stub = makeStub();
  resourcesRoute.init(stub.convex, stub.api);
  ogQueue.init(stub.convex, stub.api, {
    safeFetch: async (url) => ({ body: "", url, statusCode: 200 }),
    logger: silentLogger,
  });

  const req = adminReq("POST", "/api/admin/resources", {
    body: {
      slug: "ext", title: "Ext", kind: "pdf",
      islands: ["todas"], topics: ["lengua"], levels: ["primaria"],
      isExternal: true, sourceUrl: "https://x.test/a",
    },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 201);
  const created = JSON.parse(res._body);
  assert.equal(created.isExternal, true);
  assert.equal(ogQueue._state().enqueuedSize > 0, true);
});

// ── Update ──────────────────────────────────────────────────────────────────

test("PATCH /api/admin/resources/:id 404 si no existe", async () => {
  const stub = makeStub();
  resourcesRoute.init(stub.convex, stub.api);
  const req = adminReq("PATCH", "/api/admin/resources/no-existe", {
    body: { title: "X" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 404);
});

test("PATCH /api/admin/resources/:id cambia sourceUrl → encola OG", async () => {
  ogQueue._reset();
  const stub = makeStub({
    resources: {
      "r1": { id: "r1", isExternal: true, sourceUrl: "https://old.test/", title: "old" },
    },
  });
  resourcesRoute.init(stub.convex, stub.api);
  ogQueue.init(stub.convex, stub.api, {
    safeFetch: async (url) => ({ body: "", url, statusCode: 200 }),
    logger: silentLogger,
  });

  const req = adminReq("PATCH", "/api/admin/resources/r1", {
    body: { sourceUrl: "https://new.test/" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  assert.equal(ogQueue._state().enqueuedSize > 0, true);
});

test("PATCH /api/admin/resources/:id sin cambiar sourceUrl no reencola", async () => {
  ogQueue._reset();
  const stub = makeStub({
    resources: {
      "r1": { id: "r1", isExternal: true, sourceUrl: "https://x.test/", title: "old" },
    },
  });
  resourcesRoute.init(stub.convex, stub.api);
  ogQueue.init(stub.convex, stub.api, {
    safeFetch: async (url) => ({ body: "", url, statusCode: 200 }),
    logger: silentLogger,
  });

  const req = adminReq("PATCH", "/api/admin/resources/r1", {
    body: { title: "new", sourceUrl: "https://x.test/" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  assert.equal(ogQueue._state().enqueuedSize, 0);
});

test("PATCH resuelve fileStorageId → fileUrl antes de update", async () => {
  ogQueue._reset();
  const stub = makeStub({
    resources: { "r1": { id: "r1", isExternal: false, title: "old" } },
  });
  resourcesRoute.init(stub.convex, stub.api);

  const req = adminReq("PATCH", "/api/admin/resources/r1", {
    body: { fileStorageId: "store-abc" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  // Comprueba que el update llegó con fileUrl resuelto y SIN fileStorageId
  const patch = stub.calls.update.at(-1);
  assert.equal(patch.fileUrl, "https://convex-storage.test/store-abc");
  assert.equal(patch.fileStorageId, undefined);
});

// ── Delete ──────────────────────────────────────────────────────────────────

test("DELETE /api/admin/resources/:id con sesión → 200", async () => {
  const stub = makeStub({ resources: { "r1": { id: "r1", title: "x" } } });
  resourcesRoute.init(stub.convex, stub.api);
  const req = adminReq("DELETE", "/api/admin/resources/r1");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  assert.equal(JSON.parse(res._body).deleted, "r1");
});

// ── Upload URL ──────────────────────────────────────────────────────────────

test("POST /api/admin/resources/upload-url con sesión → 200 + uploadUrl", async () => {
  const stub = makeStub();
  resourcesRoute.init(stub.convex, stub.api);
  const req = adminReq("POST", "/api/admin/resources/upload-url");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const data = JSON.parse(res._body);
  assert.ok(/^https:\/\//.test(data.uploadUrl));
});

// ── Listing ────────────────────────────────────────────────────────────────

test("GET /api/admin/resources con sesión devuelve listado", async () => {
  const stub = makeStub({
    resources: {
      "r1": { id: "r1", title: "Recurso 1", isExternal: true },
      "r2": { id: "r2", title: "Recurso 2", isExternal: false },
    },
  });
  resourcesRoute.init(stub.convex, stub.api);
  const req = adminReq("GET", "/api/admin/resources?limit=10");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const data = JSON.parse(res._body);
  assert.equal(data.items.length, 2);
});

test("GET /api/admin/resources con kind inválido → 400", async () => {
  const stub = makeStub();
  resourcesRoute.init(stub.convex, stub.api);
  const req = adminReq("GET", "/api/admin/resources?kind=foo");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});
