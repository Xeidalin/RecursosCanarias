"use strict";

process.env.SESSION_SECRET     = "test-secret-que-tiene-mas-de-32-caracteres!!";
process.env.INTERNAL_CRON_TOKEN = "cron-token-fijo-para-tests";
process.env.NODE_ENV           = "test";

const { test } = require("node:test");
const assert   = require("node:assert/strict");

const { dispatch } = require("../server/router.js");
const {
  signSession, csrfFor, COOKIE_SESSION, COOKIE_CSRF,
} = require("../server/auth.js");

const blogRoute = require("../server/routes/api-blog.js");

// ── Mocks ───────────────────────────────────────────────────────────────────

function mockRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.writeHead = (s, h) => { res._status = s; Object.assign(res._headers, h || {}); };
  res.setHeader = (k, v) => { res._headers[k] = v; };
  res.end       = (b) => { res._body = b; };
  return res;
}

function mockReq(method, url, { headers = {}, body = null } = {}) {
  const req = { method, url, headers: { cookie: "", ...headers }, params: {} };
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

function makeStub({ posts = {} } = {}) {
  const calls = { listAdmin: [], create: [], update: [], remove: [], getById: [], getStorageUrl: [], generateUploadUrl: [] };
  const convex = {
    async query(fn, args) {
      if (fn === "blog.listAdmin") {
        calls.listAdmin.push(args);
        return {
          items: Object.values(posts),
          continueCursor: null,
          isDone: true,
        };
      }
      if (fn === "blog.getById") {
        calls.getById.push(args);
        return posts[args.id] ?? null;
      }
      if (fn === "storage.getStorageUrl") {
        calls.getStorageUrl.push(args);
        return `https://convex-storage.test/${args.storageId}`;
      }
      throw new Error(`stub query no implementada: ${fn}`);
    },
    async mutation(fn, args) {
      if (fn === "blog.create") {
        calls.create.push(args);
        const id = `post-${Object.keys(posts).length + 1}`;
        const next = { id, readingMinutes: 1, ...args };
        posts[id] = next;
        return next;
      }
      if (fn === "blog.update") {
        calls.update.push(args);
        const prev = posts[args.id] || {};
        const next = { ...prev, ...args };
        posts[args.id] = next;
        return next;
      }
      if (fn === "blog.remove") {
        calls.remove.push(args);
        delete posts[args.id];
        return { deleted: args.id };
      }
      if (fn === "storage.generateUploadUrl") {
        calls.generateUploadUrl.push(args);
        return "https://convex-storage.test/upload?token=blogcover";
      }
      throw new Error(`stub mutation no implementada: ${fn}`);
    },
  };
  const api = {
    blog: {
      list:      "blog.list",
      listAdmin: "blog.listAdmin",
      getById:   "blog.getById",
      getBySlug: "blog.getBySlug",
      create:    "blog.create",
      update:    "blog.update",
      remove:    "blog.remove",
    },
    storage: {
      generateUploadUrl: "storage.generateUploadUrl",
      getStorageUrl:     "storage.getStorageUrl",
    },
  };
  return { convex, api, calls };
}

// ── Auth gates ──────────────────────────────────────────────────────────────

test("GET /api/admin/blog sin sesión → 401", async () => {
  const req = mockReq("GET", "/api/admin/blog");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("POST /api/admin/blog sin sesión → 401", async () => {
  const req = mockReq("POST", "/api/admin/blog", { body: { title: "x" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("PATCH /api/admin/blog/:id sin sesión → 401", async () => {
  const req = mockReq("PATCH", "/api/admin/blog/p1", { body: { title: "x" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("DELETE /api/admin/blog/:id sin sesión → 401", async () => {
  const req = mockReq("DELETE", "/api/admin/blog/p1");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("POST /api/admin/blog/preview-markdown sin sesión → 401", async () => {
  const req = mockReq("POST", "/api/admin/blog/preview-markdown", { body: { markdown: "**x**" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("POST /api/admin/blog/upload-cover sin sesión → 401", async () => {
  const req = mockReq("POST", "/api/admin/blog/upload-cover");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 401);
});

test("POST /api/admin/blog con sesión pero sin CSRF → 403", async () => {
  const session = signSession("admin-1");
  const req = mockReq("POST", "/api/admin/blog", {
    headers: { "cookie": `${COOKIE_SESSION}=${session}` },
    body: { title: "x" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 403);
});

// ── Validación ─────────────────────────────────────────────────────────────

test("POST /api/admin/blog rechaza si faltan campos → 400", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("POST", "/api/admin/blog", { body: { title: "Solo título" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("POST /api/admin/blog rechaza categoría no permitida → 400", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("POST", "/api/admin/blog", {
    body: {
      title: "x", slug: "x", category: "INVALID", excerpt: "x",
      islands: ["todas"],
    },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
  assert.match(JSON.parse(res._body).error, /categor/i);
});

test("POST /api/admin/blog rechaza body > MAX → 400", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const huge = "a".repeat(100 * 1024 + 1);
  const req = adminReq("POST", "/api/admin/blog", {
    body: {
      title: "x", slug: "x", category: "articulo", excerpt: "x",
      islands: ["todas"], body: huge,
    },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("GET /api/admin/blog con category inválida → 400", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("GET", "/api/admin/blog?category=foo");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

// ── Create / update / delete ──────────────────────────────────────────────

test("POST /api/admin/blog válido → 201", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("POST", "/api/admin/blog", {
    body: {
      title: "Hola", slug: "hola", category: "articulo",
      excerpt: "resumen", islands: ["todas"], body: "**negrita**",
    },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 201);
  assert.equal(stub.calls.create.length, 1);
});

test("POST /api/admin/blog resuelve coverStorageId → coverImage", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("POST", "/api/admin/blog", {
    body: {
      title: "x", slug: "x", category: "articulo", excerpt: "x",
      islands: ["todas"], coverStorageId: "store-cover-1",
    },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 201);
  const sent = stub.calls.create.at(-1);
  assert.equal(sent.coverImage, "https://convex-storage.test/store-cover-1");
  assert.equal(sent.coverStorageId, undefined);
});

test("PATCH /api/admin/blog/:id 404 si no existe", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("PATCH", "/api/admin/blog/inexistente", {
    body: { title: "X" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 404);
});

test("PATCH ignora id del body (no id-spoofing)", async () => {
  const stub = makeStub({
    posts: { "p1": { id: "p1", title: "viejo", category: "articulo" } },
  });
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("PATCH", "/api/admin/blog/p1", {
    body: { id: "p99-malicioso", title: "nuevo" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const sent = stub.calls.update.at(-1);
  assert.equal(sent.id, "p1");
});

test("DELETE /api/admin/blog/:id → 200", async () => {
  const stub = makeStub({ posts: { "p1": { id: "p1", title: "x" } } });
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("DELETE", "/api/admin/blog/p1");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  assert.equal(JSON.parse(res._body).deleted, "p1");
});

// ── Preview markdown ──────────────────────────────────────────────────────

test("preview-markdown renderiza markdown y devuelve readingMinutes", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("POST", "/api/admin/blog/preview-markdown", {
    body: { markdown: "# Título\n\nPárrafo con **negrita**." },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const data = JSON.parse(res._body);
  assert.match(data.html, /<h1>Título<\/h1>/);
  assert.match(data.html, /<strong>negrita<\/strong>/);
  assert.ok(data.readingMinutes >= 1);
});

test("preview-markdown escapa <script> en body (no inyecta HTML crudo)", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("POST", "/api/admin/blog/preview-markdown", {
    body: { markdown: "Esto es <script>alert(1)</script> peligroso." },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const data = JSON.parse(res._body);
  assert.ok(!data.html.includes("<script>"));
  assert.ok(data.html.includes("&lt;script&gt;"));
});

test("preview-markdown rechaza markdown > MAX → 400", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const huge = "a".repeat(100 * 1024 + 1);
  const req = adminReq("POST", "/api/admin/blog/preview-markdown", {
    body: { markdown: huge },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

// ── Validación externalUrl ─────────────────────────────────────────────────

test("POST /api/admin/blog rechaza externalUrl no segura (javascript:) → 400", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("POST", "/api/admin/blog", {
    body: {
      title: "x", slug: "x", category: "articulo", excerpt: "x",
      islands: ["todas"], externalUrl: "javascript:alert(1)",
    },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
  assert.match(JSON.parse(res._body).error, /URL segura/i);
});

test("POST /api/admin/blog rechaza externalUrl no segura (data:) → 400", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("POST", "/api/admin/blog", {
    body: {
      title: "x", slug: "x", category: "articulo", excerpt: "x",
      islands: ["todas"], externalUrl: "data:text/html,<script>alert(1)</script>",
    },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

// ── Validación PATCH no vacía campos obligatorios ──────────────────────────

test("PATCH /api/admin/blog/:id rechaza title vacío → 400", async () => {
  const stub = makeStub({ posts: { "p1": { id: "p1", title: "viejo", slug: "x", category: "articulo", excerpt: "e", islands: ["todas"] } } });
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("PATCH", "/api/admin/blog/p1", { body: { title: "" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("PATCH /api/admin/blog/:id rechaza slug vacío → 400", async () => {
  const stub = makeStub({ posts: { "p1": { id: "p1", title: "x", slug: "x", category: "articulo", excerpt: "e", islands: ["todas"] } } });
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("PATCH", "/api/admin/blog/p1", { body: { slug: "" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("PATCH /api/admin/blog/:id rechaza islands vacío → 400", async () => {
  const stub = makeStub({ posts: { "p1": { id: "p1", title: "x", slug: "x", category: "articulo", excerpt: "e", islands: ["todas"] } } });
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("PATCH", "/api/admin/blog/p1", { body: { islands: [] } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

test("PATCH /api/admin/blog/:id rechaza externalUrl no segura → 400", async () => {
  const stub = makeStub({ posts: { "p1": { id: "p1", title: "x", slug: "x", category: "articulo", excerpt: "e", islands: ["todas"] } } });
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("PATCH", "/api/admin/blog/p1", { body: { externalUrl: "javascript:void(0)" } });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 400);
});

// ── deployKey en mutations admin ──────────────────────────────────────────

test("POST pasa deployKey a la mutation", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  process.env.ADMIN_KEY = "dk-test";
  const req = adminReq("POST", "/api/admin/blog", {
    body: {
      title: "x", slug: "x", category: "articulo", excerpt: "x",
      islands: ["todas"],
    },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 201);
  const sent = stub.calls.create.at(-1);
  assert.equal(sent.deployKey, "dk-test");
  delete process.env.ADMIN_KEY;
});

test("PATCH pasa deployKey y el body no lo sobreescribe", async () => {
  const stub = makeStub({ posts: { "p1": { id: "p1", title: "x", slug: "x", category: "articulo", excerpt: "e", islands: ["todas"] } } });
  blogRoute.init(stub.convex, stub.api);
  process.env.ADMIN_KEY = "dk-real";
  const req = adminReq("PATCH", "/api/admin/blog/p1", {
    body: { title: "nuevo", deployKey: "dk-malicioso" },
  });
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const sent = stub.calls.update.at(-1);
  assert.equal(sent.deployKey, "dk-real");
  delete process.env.ADMIN_KEY;
});

test("DELETE pasa deployKey a la mutation", async () => {
  const stub = makeStub({ posts: { "p1": { id: "p1", title: "x" } } });
  blogRoute.init(stub.convex, stub.api);
  process.env.ADMIN_KEY = "dk-test";
  const req = adminReq("DELETE", "/api/admin/blog/p1");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const sent = stub.calls.remove.at(-1);
  assert.equal(sent.deployKey, "dk-test");
  delete process.env.ADMIN_KEY;
});

// ── Upload cover ──────────────────────────────────────────────────────────

test("POST /api/admin/blog/upload-cover con sesión → 200 + uploadUrl", async () => {
  const stub = makeStub();
  blogRoute.init(stub.convex, stub.api);
  const req = adminReq("POST", "/api/admin/blog/upload-cover");
  const res = mockRes();
  await dispatch(req, res);
  assert.equal(res._status, 200);
  const data = JSON.parse(res._body);
  assert.ok(/^https:\/\//.test(data.uploadUrl));
});
