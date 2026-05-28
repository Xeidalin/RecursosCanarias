"use strict";

const crypto = require("node:crypto");

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const SESSION_MAX_AGE_S = 8 * 60 * 60;   // 8 horas
const COOKIE_SESSION    = "rc_session";
const COOKIE_CSRF       = "rc_csrf";

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET no configurado o demasiado corto");
  return s;
}

// ---------------------------------------------------------------------------
// Contraseñas con scrypt
// ---------------------------------------------------------------------------

/**
 * Genera un salt aleatorio (32 bytes, hex).
 */
function generateSalt() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Hashea una contraseña con scrypt.
 * @returns {Promise<string>} hash en hex
 */
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived.toString("hex"));
    });
  });
}

/**
 * Verifica una contraseña contra su hash en tiempo constante.
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, hash, salt) {
  const derived = await hashPassword(password, salt);
  const a = Buffer.from(derived, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Firma HMAC de payloads
// ---------------------------------------------------------------------------

function hmac(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

function signPayload(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig     = hmac(secret, encoded);
  return `${encoded}.${sig}`;
}

function verifyPayload(token, secret) {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const encoded  = token.slice(0, dot);
  const sig      = token.slice(dot + 1);
  const expected = hmac(secret, encoded);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

/**
 * Crea un token de sesión firmado.
 * @param {{ adminId: string }} data
 * @returns {string} cookie value
 */
function signSession(adminId) {
  const now     = Date.now();
  const payload = {
    adminId,
    kid: "v1",
    iat: now,
    exp: now + SESSION_MAX_AGE_S * 1000,
  };
  return signPayload(payload, getSecret());
}

/**
 * Verifica y decodifica un token de sesión.
 * @returns {{ adminId: string }|null}
 */
function verifySession(token) {
  const payload = verifyPayload(token, getSecret());
  if (!payload) return null;
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  return payload;
}

// ---------------------------------------------------------------------------
// CSRF — token ligado a sesión
// ---------------------------------------------------------------------------

function csrfFor(sessionToken) {
  return hmac(getSecret(), sessionToken + ":csrf");
}

// ---------------------------------------------------------------------------
// Helpers de cookie
// ---------------------------------------------------------------------------

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function cookieHeader(name, value, extraFlags = "") {
  const secure = isProduction() ? "; Secure" : "";
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_S}${secure}${extraFlags}`;
}

/**
 * Setea las cookies de sesión y CSRF en la respuesta.
 */
function setSessionCookies(res, sessionToken) {
  const csrfToken = csrfFor(sessionToken);
  // rc_session es HttpOnly (no accesible desde JS)
  res.setHeader("Set-Cookie", [
    cookieHeader(COOKIE_SESSION, sessionToken),
    // rc_csrf NO es HttpOnly para que JS del admin pueda leerlo
    `${COOKIE_CSRF}=${csrfToken}; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_S}${isProduction() ? "; Secure" : ""}`,
  ]);
}

/**
 * Borra las cookies de sesión (logout).
 */
function clearSessionCookies(res) {
  res.setHeader("Set-Cookie", [
    `${COOKIE_SESSION}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    `${COOKIE_CSRF}=; SameSite=Lax; Path=/; Max-Age=0`,
  ]);
}

/**
 * Parsea las cookies de la petición en un Map.
 */
function parseCookies(req) {
  const header = req.headers["cookie"] || "";
  const map    = new Map();
  for (const part of header.split(";")) {
    const eq  = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    map.set(key, val);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------

/**
 * Middleware: exige sesión admin válida.
 * Si la sesión es válida, adjunta `req.admin = payload`.
 * @returns {boolean} true si debe continuar, false si ya respondió
 */
function requireAdmin(req, res) {
  const cookies = parseCookies(req);
  const token   = cookies.get(COOKIE_SESSION);
  if (!token) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No autorizado" }));
    return false;
  }
  const payload = verifySession(token);
  if (!payload) {
    clearSessionCookies(res);
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Sesión expirada" }));
    return false;
  }
  req.admin        = payload;
  req._sessionToken = token;
  return true;
}

/**
 * Middleware: exige CSRF token válido para peticiones mutating.
 * Debe llamarse después de requireAdmin.
 */
function requireCsrf(req, res) {
  const headerToken = req.headers["x-csrf-token"];
  const cookies     = parseCookies(req);
  const cookieToken = cookies.get(COOKIE_CSRF);

  if (!headerToken || !cookieToken || !req._sessionToken) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "CSRF inválido" }));
    return false;
  }

  const expected = csrfFor(req._sessionToken);
  try {
    const h = Buffer.from(headerToken);
    const c = Buffer.from(cookieToken);
    const e = Buffer.from(expected);
    const sameLen = h.length === c.length && h.length === e.length;
    if (!sameLen || !crypto.timingSafeEqual(h, c) || !crypto.timingSafeEqual(h, e)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "CSRF inválido" }));
      return false;
    }
  } catch {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "CSRF inválido" }));
    return false;
  }
  return true;
}

/**
 * Verifica el token interno de cron (Authorization: Bearer <token>).
 */
function requireCronToken(req, res) {
  const expected = process.env.INTERNAL_CRON_TOKEN;
  if (!expected) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "INTERNAL_CRON_TOKEN no configurado" }));
    return false;
  }
  const auth = req.headers["authorization"] || "";
  const match = auth.match(/^Bearer (.+)$/);
  if (!match) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No autorizado" }));
    return false;
  }
  const provided = match[1];
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No autorizado" }));
      return false;
    }
  } catch {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No autorizado" }));
    return false;
  }
  return true;
}

module.exports = {
  generateSalt,
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  csrfFor,
  setSessionCookies,
  clearSessionCookies,
  parseCookies,
  requireAdmin,
  requireCsrf,
  requireCronToken,
  COOKIE_SESSION,
  COOKIE_CSRF,
};
