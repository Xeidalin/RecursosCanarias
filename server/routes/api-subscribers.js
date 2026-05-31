"use strict";

const { router } = require("../router.js");
const { sendJson, readBody } = require("../http.js");
const { limiters, clientIp } = require("../rateLimit.js");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Caracteres que convierten una celda CSV en fórmula en Excel/LibreOffice
const CSV_FORMULA_RE = /^[=+\-@]/;

let _convex = null;
let _api    = null;

function init(convex, api) {
  _convex = convex;
  _api    = api;
}

// POST /api/subscribers
router.post("/api/subscribers", async (req, res) => {
  const ip = clientIp(req);

  try {
    if (!limiters.subscribers.consume(req, res, ip)) return;

    const body = await readBody(req, 4096);
    const raw  = typeof body.email === "string" ? body.email.trim() : "";

    if (!raw || !EMAIL_RE.test(raw)) {
      sendJson(res, 400, { error: "Email inválido." });
      return;
    }

    const result = await _convex.mutation(_api.subscribers.subscribe, {
      email:     raw.toLowerCase(),
      deployKey: process.env.ADMIN_KEY || "",
    });
    sendJson(res, 200, result);
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "Error al procesar la suscripción." });
  }
}, { public: true });

function escapeCsvField(val) {
  const s = String(val ?? "");
  const escaped = `"${s.replace(/"/g, "\"\"")}"`;
  // Neutralizar fórmulas: si el valor (sin comillas) empieza con = + - @,
  // anteponer comilla simple dentro de las comillas
  if (CSV_FORMULA_RE.test(s)) return `"'${s.replace(/"/g, "\"\"")}"`;
  return escaped;
}

function deployKey() {
  return process.env.ADMIN_KEY || "";
}

// GET /api/admin/subscribers
router.get("/api/admin/subscribers", async (req, res) => {
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const cursor = q.get("cursor") || null;
    const pageSize = Math.min(Math.max(parseInt(q.get("limit"), 10) || 50, 1), 200);

    const result = await _convex.query(_api.subscribers.listAdmin, {
      paginationOpts: { numItems: pageSize, cursor },
      deployKey: deployKey(),
    });
    sendJson(res, 200, {
      items:          result.items,
      nextCursor:     result.continueCursor,
      hasMore:        !result.isDone,
    });
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "Error al obtener suscriptores." });
  }
});

// GET /api/admin/subscribers/csv
router.get("/api/admin/subscribers/csv", async (req, res) => {
  try {
    const items = await _convex.query(_api.subscribers.listAll, {
      deployKey: deployKey(),
    });
    const header = "email,createdAt,estado,unsubscribedAt";
    const rows = items.map((s) => {
      const estado = s.unsubscribedAt ? "dado de baja" : "activo";
      return [
        escapeCsvField(s.email),
        escapeCsvField(s.createdAt),
        escapeCsvField(estado),
        escapeCsvField(s.unsubscribedAt),
      ].join(",");
    });
    const csv = [header, ...rows].join("\n");
    res.writeHead(200, {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="suscriptores.csv"',
      "Cache-Control":       "no-store",
    });
    res.end(csv);
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "Error al exportar CSV." });
  }
});

// GET /unsubscribe/:token — página de confirmación de baja
router.get("/unsubscribe/:token", async (req, res) => {
  const token = req.params?.token;
  if (!token) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado.");
    return;
  }
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Darse de baja — Recursos Canarias</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fbf6e8;">
  <main style="max-width:480px;margin:32px;padding:32px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);text-align:center;">
    <h1 style="font-size:22px;margin-bottom:12px;">Darse de baja del boletín</h1>
    <p style="color:#63707a;margin-bottom:20px;">Pulsa el botón para confirmar que quieres dejar de recibir nuestro boletín de novedades.</p>
    <form method="post" action="/api/unsubscribe">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <button type="submit" style="padding:10px 24px;border-radius:8px;border:none;background:#b94a48;color:#fff;font:inherit;font-weight:600;cursor:pointer;">Confirmar baja</button>
    </form>
  </main>
</body>
</html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}, { public: true });

// POST /api/unsubscribe — ejecuta la baja
router.post("/api/unsubscribe", async (req, res) => {
  try {
    const body  = await readBody(req, 1024);
    const token = (typeof body.token === "string" ? body.token.trim() : "");
    if (!token) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<p>Token no proporcionado.</p>");
      return;
    }
    const result = await _convex.mutation(_api.subscribers.unsubscribeByToken, { token });
    const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Baja confirmada — Recursos Canarias</title><link rel="stylesheet" href="/styles.css"></head>
<body style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fbf6e8;">
  <main style="max-width:480px;margin:32px;padding:32px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);text-align:center;">
    <h1 style="font-size:22px;margin-bottom:12px;">${result.ok ? "Baja confirmada" : "Error"}</h1>
    <p style="color:#63707a;">${result.ok ? "Ya no recibirás más correos de Recursos Canarias. Gracias por tu interés." : (result.reason || "No se pudo procesar la baja.")}</p>
    <p><a href="/">Volver al inicio</a></p>
  </main>
</body>
</html>`;
    res.writeHead(result.ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<p>Error al procesar la baja.</p>");
  }
}, { public: true });

function escapeHtml(str) {
  const m = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(str).replace(/[&<>"']/g, (c) => m[c]);
}

module.exports = { init };
