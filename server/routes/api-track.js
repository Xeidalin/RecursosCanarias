"use strict";

const { router } = require("../router.js");
const { sendJson, readBody } = require("../http.js");

let _convex = null;
let _api    = null;

function init(convex, api) {
  _convex = convex;
  _api    = api;
}

// POST /api/track — registra una visita de página (beacon desde common.js)
router.post("/api/track", async (req, res) => {
  try {
    const body = await readBody(req, 1024);
    const path = (body.path || "").trim().slice(0, 2000);
    if (!path) { sendJson(res, 400, { error: "Falta path" }); return; }

    // Fire-and-forget: no bloquea la respuesta
    _convex.mutation(_api.tracking.record, { path }).catch(() => {});
    sendJson(res, 202, { ok: true });
  } catch {
    // Nunca fallamos visiblemente — es un beacon
    sendJson(res, 202, { ok: true });
  }
}, { public: true });

module.exports = { init };
