"use strict";

const { router } = require("../router.js");
const { sendJson, readBody } = require("../http.js");
const ogQueue = require("../ogQueue.js");

let _convex = null;
let _api    = null;

function init(convex, api) {
  _convex = convex;
  _api    = api;
}

// GET /api/resources — listado público
router.get("/api/resources", async (req, res) => {
  const params    = new URL(req.url, "http://x").searchParams;
  const limit     = parseInt(params.get("limit") || "0", 10);
  let resources   = await _convex.query(_api.resources.list, {});
  if (limit > 0) resources = resources.slice(0, limit);
  sendJson(res, 200, resources);
}, { public: true });

// GET /api/resources/filtered — cursor-based filtered listing (public)
const VALID_KINDS = new Set(["pdf", "image", "song", "audio", "video", "presentation", "activity"]);

router.get("/api/resources/filtered", async (req, res) => {
  const p = new URL(req.url, "http://x").searchParams;

  const rawKind = p.get("kind");
  if (rawKind !== null && !VALID_KINDS.has(rawKind)) {
    sendJson(res, 400, { error: "kind inválido" });
    return;
  }

  const args = {
    limit:  Math.min(Math.max(1, parseInt(p.get("limit") || "24", 10)), 100),
    cursor: p.get("cursor")  || undefined,
    q:      p.get("q")       || undefined,
    kind:   rawKind          || undefined,
  };

  const islands = p.getAll("islands").filter(Boolean);
  const topics  = p.getAll("topics").filter(Boolean);
  const levels  = p.getAll("levels").filter(Boolean);
  if (islands.length) args.islands = islands;
  if (topics.length)  args.topics  = topics;
  if (levels.length)  args.levels  = levels;

  const result = await _convex.query(_api.resources.listFiltered, args);
  sendJson(res, 200, result);
}, { public: true });

// POST /api/resources — creación (admin-only, shape v2)
// Full CRUD admin UI is built in T15.1; this stub validates required v2 fields.
router.post("/api/resources", async (req, res) => {
  try {
    const body     = await readBody(req);
    const required = ["slug", "title", "kind", "islands", "topics", "levels"];
    const missing  = required.filter((k) => {
      const v = body[k];
      return v === undefined || v === null || (typeof v === "string" && !v.trim());
    });
    if (missing.length) {
      sendJson(res, 400, { error: "Faltan campos obligatorios: " + missing.join(", ") });
      return;
    }
    if (typeof body.isExternal !== "boolean") {
      sendJson(res, 400, { error: "isExternal debe ser boolean" });
      return;
    }
    const resource = await _convex.mutation(_api.resources.create, body);
    if (resource && resource.isExternal && resource.sourceUrl) {
      ogQueue.enqueue(resource.id);
    }
    sendJson(res, 201, resource);
  } catch (err) {
    const status = err.status || 400;
    sendJson(res, status, { error: err.message || "No se pudo guardar el recurso." });
  }
});

// POST /api/admin/resources/:id/refresh-og — reencola un recurso externo.
// Protegido por requireAdmin + requireCsrf (no es { public: true }).
router.post("/api/admin/resources/:id/refresh-og", async (req, res) => {
  const id = req.params?.id;
  if (!id) {
    sendJson(res, 400, { error: "Falta id" });
    return;
  }
  try {
    const resource = await _convex.query(_api.resources.getById, { id });
    if (!resource) {
      sendJson(res, 404, { error: "Recurso no encontrado" });
      return;
    }
    if (!resource.isExternal || !resource.sourceUrl) {
      sendJson(res, 400, { error: "El recurso no es externo o no tiene sourceUrl" });
      return;
    }
    const queued = ogQueue.enqueue(id);
    sendJson(res, 202, { queued });
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "No se pudo encolar el refresco." });
  }
});

module.exports = { init };
