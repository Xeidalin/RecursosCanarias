"use strict";

const { router } = require("../router.js");
const { sendJson, readBody } = require("../http.js");
const { render: renderMarkdown } = require("../markdown.js");
const { safeUrl } = require("../sanitize.js");

const VALID_CATEGORIES = new Set([
  "articulo", "recurso-destacado", "novedad", "noticia-consejeria",
]);

const MAX_BODY_CHARS = 100 * 1024; // 100KB markdown source

let _convex = null;
let _api    = null;

function init(convex, api) {
  _convex = convex;
  _api    = api;
}

// Cuenta palabras del cuerpo (≥1) — espejo de convex/blog.js:computeReadingMinutes
function computeReadingMinutes(body) {
  const words = String(body || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// Resuelve un fileStorageId (Convex storage) a una URL pública si viene en el body.
// Devuelve el body mutado in-place; conserva coverImage explícito si no hay storageId.
async function resolveCoverStorage(body) {
  if (!body || typeof body !== "object") return body;
  const sid = body.coverStorageId;
  if (typeof sid !== "string" || !sid) return body;
  const url = await _convex.query(_api.storage.getStorageUrl, { storageId: sid });
  if (typeof url === "string" && url) body.coverImage = url;
  delete body.coverStorageId;
  return body;
}

// ─── Rutas públicas ────────────────────────────────────────────────────────

// GET /api/blog
router.get("/api/blog", async (req, res) => {
  const params   = new URL(req.url, "http://x").searchParams;
  const limit    = Math.min(Math.max(1, parseInt(params.get("limit") || "20", 10)), 100);
  const category = params.get("category") || undefined;

  const posts = await _convex.query(_api.blog.list, { limit, category });
  sendJson(res, 200, posts);
}, { public: true });

// GET /api/blog/:slug
router.get("/api/blog/:slug", async (req, res) => {
  const post = await _convex.query(_api.blog.getBySlug, { slug: req.params.slug });
  if (!post) { sendJson(res, 404, { error: "No encontrado." }); return; }
  sendJson(res, 200, post);
}, { public: true });

// ─── Admin CRUD ────────────────────────────────────────────────────────────
// Todas las rutas /api/admin/blog* pasan por requireAdmin + requireCsrf (sin public:true).

function validateCreate(body) {
  const required = ["title", "slug", "category", "excerpt", "islands"];
  const missing = required.filter((k) => {
    const v = body[k];
    return v === undefined || v === null || (typeof v === "string" && !v.trim()) ||
           (Array.isArray(v) && v.length === 0);
  });
  if (missing.length) return `Faltan campos obligatorios: ${missing.join(", ")}`;
  if (!VALID_CATEGORIES.has(body.category)) return "category inválida";
  if (typeof body.externalUrl === "string" && body.externalUrl.trim()) {
    if (!safeUrl(body.externalUrl.trim())) return "externalUrl no es una URL segura";
  }
  if (typeof body.body === "string" && body.body.length > MAX_BODY_CHARS) {
    return `body excede el límite (${MAX_BODY_CHARS} chars)`;
  }
  return null;
}

// GET /api/admin/blog — listado paginado con q+category
router.get("/api/admin/blog", async (req, res) => {
  try {
    const p = new URL(req.url, "http://x").searchParams;
    const rawCategory = p.get("category");
    if (rawCategory !== null && !VALID_CATEGORIES.has(rawCategory)) {
      sendJson(res, 400, { error: "category inválida" });
      return;
    }
    const args = {
      paginationOpts: {
        numItems: Math.min(Math.max(1, parseInt(p.get("limit") || "20", 10)), 100),
        cursor:   p.get("cursor") || null,
      },
      q:        p.get("q")      || undefined,
      category: rawCategory     || undefined,
    };
    const result = await _convex.query(_api.blog.listAdmin, args);
    sendJson(res, 200, {
      items: result.items,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    });
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "Error al listar." });
  }
});

// POST /api/admin/blog — crear post
router.post("/api/admin/blog", async (req, res) => {
  try {
    const body = await readBody(req, MAX_BODY_CHARS + 4096);
    await resolveCoverStorage(body);
    const err = validateCreate(body);
    if (err) { sendJson(res, 400, { error: err }); return; }
    body.deployKey = process.env.CONVEX_DEPLOY_KEY || "";
    const post = await _convex.mutation(_api.blog.create, body);
    sendJson(res, 201, post);
  } catch (err) {
    const status = err.status || 400;
    sendJson(res, status, { error: err.message || "No se pudo guardar el post." });
  }
});

// PATCH /api/admin/blog/:id — actualizar parcial
router.patch("/api/admin/blog/:id", async (req, res) => {
  const id = req.params?.id;
  if (!id) { sendJson(res, 400, { error: "Falta id" }); return; }
  try {
    const body = await readBody(req, MAX_BODY_CHARS + 4096);
    await resolveCoverStorage(body);
    // Defensa contra id-spoofing: el id de la URL manda; ignoramos cualquier id en el body.
    delete body.id;
    if (body.category !== undefined && !VALID_CATEGORIES.has(body.category)) {
      sendJson(res, 400, { error: "category inválida" });
      return;
    }
    if (typeof body.externalUrl === "string" && body.externalUrl.trim()) {
      if (!safeUrl(body.externalUrl.trim())) {
        sendJson(res, 400, { error: "externalUrl no es una URL segura" });
        return;
      }
    }
    if (typeof body.body === "string" && body.body.length > MAX_BODY_CHARS) {
      sendJson(res, 400, { error: `body excede el límite (${MAX_BODY_CHARS} chars)` });
      return;
    }
    const prev = await _convex.query(_api.blog.getById, { id });
    if (!prev) { sendJson(res, 404, { error: "Post no encontrado" }); return; }

    // Rechazar campos obligatorios que se intenten vaciar
    if (body.title !== undefined && (!body.title || !body.title.trim())) {
      sendJson(res, 400, { error: "title no puede estar vacío" }); return;
    }
    if (body.slug !== undefined && (!body.slug || !body.slug.trim())) {
      sendJson(res, 400, { error: "slug no puede estar vacío" }); return;
    }
    if (body.excerpt !== undefined && (!body.excerpt || !body.excerpt.trim())) {
      sendJson(res, 400, { error: "excerpt no puede estar vacío" }); return;
    }
    if (body.islands !== undefined && (!Array.isArray(body.islands) || body.islands.length === 0)) {
      sendJson(res, 400, { error: "islands no puede estar vacío" }); return;
    }

    const post = await _convex.mutation(_api.blog.update, {
      id, ...body, deployKey: process.env.CONVEX_DEPLOY_KEY || "",
    });
    sendJson(res, 200, post);
  } catch (err) {
    const status = err.status || 400;
    sendJson(res, status, { error: err.message || "No se pudo actualizar el post." });
  }
});

// DELETE /api/admin/blog/:id
router.delete("/api/admin/blog/:id", async (req, res) => {
  const id = req.params?.id;
  if (!id) { sendJson(res, 400, { error: "Falta id" }); return; }
  try {
    const result = await _convex.mutation(_api.blog.remove, {
      id, deployKey: process.env.CONVEX_DEPLOY_KEY || "",
    });
    sendJson(res, 200, result);
  } catch (err) {
    const status = err.status || 400;
    sendJson(res, status, { error: err.message || "No se pudo eliminar el post." });
  }
});

// POST /api/admin/blog/preview-markdown
// Renderiza el markdown con la misma función SSR pública para que el preview
// coincida bit a bit con el output de /blog/:slug.
router.post("/api/admin/blog/preview-markdown", async (req, res) => {
  try {
    const body = await readBody(req, MAX_BODY_CHARS + 4096);
    const src  = typeof body.markdown === "string" ? body.markdown : "";
    if (src.length > MAX_BODY_CHARS) {
      sendJson(res, 400, { error: `markdown excede el límite (${MAX_BODY_CHARS} chars)` });
      return;
    }
    const html = renderMarkdown(src);
    sendJson(res, 200, { html, readingMinutes: computeReadingMinutes(src) });
  } catch (err) {
    const status = err.status || 400;
    sendJson(res, status, { error: err.message || "Error al generar el preview." });
  }
});

// POST /api/admin/blog/upload-cover — genera URL de subida para portadas
router.post("/api/admin/blog/upload-cover", async (req, res) => {
  try {
    const uploadUrl = await _convex.mutation(_api.storage.generateUploadUrl, {
      deployKey: process.env.CONVEX_DEPLOY_KEY || "",
    });
    sendJson(res, 200, { uploadUrl });
  } catch (err) {
    sendJson(res, 500, { error: "No se pudo generar URL de subida." });
  }
});

module.exports = { init };
