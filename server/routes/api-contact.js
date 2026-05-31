"use strict";

const { router } = require("../router.js");
const { sendJson, readBody } = require("../http.js");
const { limiters, clientIp } = require("../rateLimit.js");

const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_TYPES = new Set(["colaboracion", "sugerencia", "error", "otro"]);

let _convex = null;
let _api    = null;

function init(convex, api) {
  _convex = convex;
  _api    = api;
}

// POST /api/contact
router.post("/api/contact", async (req, res) => {
  const ip = clientIp(req);

  try {
    if (!limiters.contact.consume(req, res, ip)) return;

    const body = await readBody(req, 16384);

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 200) {
      sendJson(res, 400, { error: "El nombre es obligatorio (máx. 200 caracteres)." });
      return;
    }

    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email || !EMAIL_RE.test(email)) {
      sendJson(res, 400, { error: "Email inválido." });
      return;
    }

    if (!VALID_TYPES.has(body.type)) {
      sendJson(res, 400, { error: "Motivo inválido." });
      return;
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length < 10) {
      sendJson(res, 400, { error: "El mensaje debe tener al menos 10 caracteres." });
      return;
    }
    if (message.length > 5000) {
      sendJson(res, 400, { error: "El mensaje es demasiado largo (máx. 5000 caracteres)." });
      return;
    }

    const result = await _convex.mutation(_api.contact.submit, {
      name,
      email: email.toLowerCase(),
      message,
      type: body.type,
      deployKey: process.env.CONVEX_DEPLOY_KEY || "",
    });
    sendJson(res, 201, result);
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "Error al enviar el mensaje." });
  }
}, { public: true });

function deployKey() {
  return process.env.CONVEX_DEPLOY_KEY || "";
}

// GET /api/admin/messages
router.get("/api/admin/messages", async (req, res) => {
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const cursor = q.get("cursor") || null;
    const pageSize = Math.min(Math.max(parseInt(q.get("limit"), 10) || 50, 1), 200);

    const result = await _convex.query(_api.contact.listAdmin, {
      paginationOpts: { numItems: pageSize, cursor },
      deployKey: deployKey(),
    });
    sendJson(res, 200, {
      items:      result.items,
      nextCursor: result.continueCursor,
      hasMore:    !result.isDone,
    });
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "Error al obtener mensajes." });
  }
});

// POST /api/admin/messages/:id/mark-handled
router.post("/api/admin/messages/:id/mark-handled", async (req, res) => {
  try {
    await _convex.mutation(_api.contact.markHandled, {
      id:        req.params.id,
      deployKey: deployKey(),
    });
    sendJson(res, 200, { ok: true });
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "Error al marcar como atendido." });
  }
});

module.exports = { init };
