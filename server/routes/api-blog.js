"use strict";

const { router } = require("../router.js");
const { sendJson } = require("../http.js");

let _convex = null;
let _api    = null;

function init(convex, api) {
  _convex = convex;
  _api    = api;
}

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

module.exports = { init };
