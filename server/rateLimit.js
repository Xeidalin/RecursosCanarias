"use strict";

/**
 * Token bucket rate limiter — en memoria.
 *
 * Las IPs solo se usan como clave durante la ventana de rate limiting.
 * No se persisten en disco, logs ni Convex (política RGPD).
 *
 * Uso:
 *   const loginLimiter = createLimiter({ max: 5, windowMs: 5 * 60 * 1000 });
 *   if (!loginLimiter.consume(req, res, key)) return; // ya respondió con 429
 */

/**
 * Crea un limitador de tasa independiente.
 *
 * @param {{ max: number, windowMs: number }} opts
 *   max       — intentos permitidos en la ventana
 *   windowMs  — duración de la ventana en ms
 */
function createLimiter({ max, windowMs }) {
  // Map: key → { count, resetAt }
  const store = new Map();

  // Limpieza periódica para no acumular entradas expiradas
  const purgeInterval = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now > v.resetAt) store.delete(k);
    }
  }, windowMs).unref(); // .unref() para no bloquear el proceso al salir

  /**
   * Intenta consumir un token.
   * @param {string} key  — normalmente IP, o IP+username para login
   * @returns {boolean}  true si se puede continuar, false si ya respondió 429
   */
  function consume(req, res, key) {
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.writeHead(429, {
        "Content-Type":  "application/json; charset=utf-8",
        "Retry-After":   String(retryAfter),
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error: "Demasiadas solicitudes. Intenta de nuevo más tarde." }));
      return false;
    }

    return true;
  }

  function destroy() {
    clearInterval(purgeInterval);
    store.clear();
  }

  return { consume, destroy };
}

// ---------------------------------------------------------------------------
// Instancias predefinidas (ver matriz en docs/decisions/auth.md)
// ---------------------------------------------------------------------------

const limiters = {
  login:       createLimiter({ max:  5, windowMs:  5 * 60 * 1000 }), // 5/5min
  subscribers: createLimiter({ max:  3, windowMs:      60 * 1000 }), // 3/1min
  contact:     createLimiter({ max:  3, windowMs:      60 * 1000 }), // 3/1min
  track:       createLimiter({ max: 30, windowMs:      60 * 1000 }), // 30/1min
  unsubscribe: createLimiter({ max:  5, windowMs:      60 * 1000 }), // 5/1min
};

/**
 * Extrae la IP del cliente de forma segura.
 * En producción detrás de proxy, usar X-Forwarded-For con cuidado.
 * Por defecto, usa solo la IP de la conexión TCP (más segura contra spoofing).
 */
function clientIp(req) {
  // Solo usamos la IP de la conexión directa.
  // Si hay un proxy confiable configurado, descomentar:
  // const forwarded = req.headers["x-forwarded-for"];
  // if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

module.exports = { createLimiter, limiters, clientIp };
