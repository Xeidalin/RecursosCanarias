"use strict";

const { router } = require("../router.js");
const { sendJson, readBody } = require("../http.js");
const {
  verifyPassword,
  signSession,
  setSessionCookies,
  clearSessionCookies,
  requireCronToken,
} = require("../auth.js");
const { limiters, clientIp } = require("../rateLimit.js");
const ogQueue = require("../ogQueue.js");

let _convex = null;
let _api    = null;

function init(convex, api) {
  _convex = convex;
  _api    = api;
}

// POST /api/admin/login
router.post("/api/admin/login", async (req, res) => {
  const ip = clientIp(req);

  try {
    const body = await readBody(req);
    const { username, password } = body;

    if (!username || !password) {
      sendJson(res, 400, { error: "Faltan credenciales." });
      return;
    }

    const rateLimitKey = `${ip}:${String(username).slice(0, 64)}`;
    if (!limiters.login.consume(req, res, rateLimitKey)) return;

    const admin = await _convex.query(_api.admins.getByUsername, {
      username: String(username),
      deployKey: process.env.CONVEX_DEPLOY_KEY || "",
    });

    // Always run scrypt to avoid timing oracle — use dummy values when admin not found
    const dummySalt = "0".repeat(64);
    const dummyHash = "0".repeat(128);
    const hash = admin?.passwordHash ?? dummyHash;
    const salt = admin?.salt         ?? dummySalt;
    const ok   = await verifyPassword(String(password), hash, salt);

    if (!admin || !ok) {
      sendJson(res, 401, { error: "Credenciales incorrectas." });
      return;
    }

    const sessionToken = signSession(String(admin._id));
    setSessionCookies(res, sessionToken);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "Error al iniciar sesión." });
  }
}, { public: true });

// POST /api/admin/logout
router.post("/api/admin/logout", (req, res) => {
  clearSessionCookies(res);
  sendJson(res, 200, { ok: true });
});

// POST /api/admin/refresh-stale-og — token-only (cron interno).
// Marcado { public: true } para saltar requireAdmin; la autenticación la
// realiza requireCronToken con timingSafeEqual sobre INTERNAL_CRON_TOKEN.
router.post("/api/admin/refresh-stale-og", async (req, res) => {
  if (!requireCronToken(req, res)) return;
  try {
    const stale = await _convex.query(_api.resources.listStaleOg, { limit: 50 });
    let queued = 0;
    for (const r of stale) {
      if (ogQueue.enqueue(r.id)) queued++;
    }
    sendJson(res, 200, { found: stale.length, queued });
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "No se pudo procesar." });
  }
}, { public: true });

// GET /api/admin/stats — dashboard metrics (admin session required)
router.get("/api/admin/stats", async (req, res) => {
  try {
    const stats = await _convex.query(_api.tracking.getStats, {});
    sendJson(res, 200, stats);
  } catch (err) {
    sendJson(res, 500, { error: "No se pudieron cargar las estadísticas." });
  }
});

module.exports = { init };
