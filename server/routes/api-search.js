"use strict";

const { router } = require("../router.js");
const { sendJson } = require("../http.js");

let _convex = null;
let _api    = null;

function init(convex, api) {
  _convex = convex;
  _api    = api;
}

// GET /api/search?q=...&limit=...
router.get("/api/search", async (req, res) => {
  const p     = new URL(req.url, "http://x").searchParams;
  const q     = (p.get("q") || "").trim();
  const limit = Math.min(Math.max(1, parseInt(p.get("limit") || "20", 10)), 50);

  if (!q) {
    sendJson(res, 200, { results: [] });
    return;
  }

  try {
    const data = await _convex.query(_api.search.unifiedSearch, { q, limit });
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: "Error en la búsqueda." });
  }
}, { public: true });

module.exports = { init };
