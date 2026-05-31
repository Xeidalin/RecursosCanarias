"use strict";

const { router } = require("../router.js");

const BASE = "https://recursoscanarias.site";

let _convex = null;
let _api    = null;

function init(convex, api) {
  _convex = convex;
  _api    = api;
}

function urlEntry(loc, { changefreq = "weekly", priority = "0.5" } = {}) {
  return `  <url><loc>${loc}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

router.get("/sitemap.xml", async (req, res) => {
  const urls = [];

  // Static pages
  urls.push(urlEntry(BASE,                                         { priority: "1.0" }));
  urls.push(urlEntry(`${BASE}/recursos`,                           { priority: "0.9" }));
  urls.push(urlEntry(`${BASE}/blog`,                               { priority: "0.8" }));
  urls.push(urlEntry(`${BASE}/descargas`,                          { priority: "0.7" }));
  urls.push(urlEntry(`${BASE}/noticias`,                           { priority: "0.7" }));
  urls.push(urlEntry(`${BASE}/buscar`,                             { priority: "0.3" }));
  urls.push(urlEntry(`${BASE}/acerca`,                             { priority: "0.5" }));

  // Legal
  for (const slug of ["privacidad", "aviso-legal", "cookies"]) {
    urls.push(urlEntry(`${BASE}/legal/${slug}`,                    { priority: "0.2" }));
  }

  // Island pages
  const ISLANDS = [
    "tenerife", "gran-canaria", "lanzarote", "fuerteventura",
    "la-palma", "la-gomera", "el-hierro",
  ];
  for (const slug of ISLANDS) {
    urls.push(urlEntry(`${BASE}/islas/${slug}`,                    { priority: "0.6" }));
  }

  // Dynamic: blog posts
  if (_convex && _api) {
    try {
      const posts = await _convex.query(_api.blog.list, { limit: 200 });
      for (const p of posts) {
        urls.push(urlEntry(`${BASE}/blog/${encodeURI(p.slug)}`,    { priority: "0.7" }));
      }
    } catch { /* Convex unavailable */ }
  }

  // Dynamic: resources
  if (_convex && _api) {
    try {
      const resources = await _convex.query(_api.resources.list, {});
      for (const r of resources) {
        urls.push(urlEntry(`${BASE}/recursos?q=${encodeURI(r.slug)}`, { priority: "0.6" }));
      }
    } catch { /* Convex unavailable */ }
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
  ].join("\n");

  res.writeHead(200, {
    "Content-Type":  "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
  res.end(xml);
}, { public: true });

module.exports = { init };
