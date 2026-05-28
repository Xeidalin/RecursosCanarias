"use strict";

const { requireAdmin, requireCsrf } = require("./auth.js");

const routes = [];

/**
 * Compiles a URL pattern like "/api/resources/:id" into a regex and param keys.
 * Pattern segments split by `:param` placeholders.
 * The compiled regex matches the full pathname (ignoring query string / fragment).
 */
function compilePattern(pattern) {
  if (pattern instanceof RegExp) return { re: pattern, keys: [] };

  const keys     = [];
  const segments = pattern.split(/(:([a-z_][a-z0-9_]*))/i);
  let   reStr    = "^";

  for (let i = 0; i < segments.length; i++) {
    if (i % 3 === 0) {
      // Literal segment — escape regex metacharacters
      reStr += segments[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (i % 3 === 2) {
      // Param name
      keys.push(segments[i]);
      reStr += "([^/?#]+)";
    }
    // i%3===1 is the full ":param" token — skip
  }

  reStr += "(?:[?#].*)?$";
  return { re: new RegExp(reStr), keys };
}

function addRoute(method, pattern, handler, opts = {}) {
  const { re, keys } = compilePattern(pattern);
  // Fail-closed: routes without { public: true } require admin session
  routes.push({ method, re, keys, handler, isPublic: opts.public === true });
}

const router = {
  get:    (p, h, o) => addRoute("GET",    p, h, o),
  post:   (p, h, o) => addRoute("POST",   p, h, o),
  put:    (p, h, o) => addRoute("PUT",    p, h, o),
  patch:  (p, h, o) => addRoute("PATCH",  p, h, o),
  delete: (p, h, o) => addRoute("DELETE", p, h, o),
};

/**
 * Tries to match req against registered routes.
 * Returns true if a route handled the request, false if no match.
 */
async function dispatch(req, res) {
  const urlPath = req.url.split("?")[0];
  const method  = req.method.toUpperCase();

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = urlPath.match(route.re);
    if (!match) continue;

    // Extract named params
    req.params = {};
    for (let i = 0; i < route.keys.length; i++) {
      try   { req.params[route.keys[i]] = decodeURIComponent(match[i + 1]); }
      catch { req.params[route.keys[i]] = match[i + 1]; }
    }

    if (!route.isPublic) {
      if (!requireAdmin(req, res)) return true;  // 401 already sent
      if (method !== "GET" && method !== "HEAD") {
        if (!requireCsrf(req, res)) return true; // 403 already sent
      }
    }

    await route.handler(req, res);
    return true;
  }

  return false;
}

module.exports = { router, dispatch, compilePattern };
