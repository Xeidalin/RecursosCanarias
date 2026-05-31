"use strict";

const path = require("node:path");
const { router } = require("../router.js");
const { renderFile } = require("../render.js");
const { send } = require("../http.js");
const { render: renderMarkdown } = require("../markdown.js");
const { escapeHtml } = require("../sanitize.js");

const PUBLIC_DIR = path.join(__dirname, "../../public");

const ISLAND_SLUGS = [
  "tenerife", "gran-canaria", "lanzarote", "fuerteventura",
  "la-palma", "la-gomera", "el-hierro",
];

let _convex = null;
let _api    = null;

function init(convex, api) {
  _convex = convex;
  _api    = api;
}

async function renderPage(res, filePath, data) {
  try {
    const html = await renderFile(filePath, data);
    send(res, 200, html);
  } catch (err) {
    if (err.code === "ENOENT") {
      send(res, 404, "Página no encontrada", "text/plain; charset=utf-8");
      return;
    }
    throw err;
  }
}

function pageData(overrides = {}) {
  const title = overrides.pageTitle || "Recursos Canarias";
  const desc  = overrides.metaDescription || "Recursos educativos para docentes de las Islas Canarias.";
  const url   = overrides.canonicalUrl || "https://recursoscanarias.site";
  return {
    pageTitle:       title,
    metaDescription: desc,
    ogTitle:         overrides.ogTitle || title,
    ogDescription:   overrides.ogDescription || desc,
    ogUrl:           url,
    ogImage:         overrides.ogImage || "https://recursoscanarias.site/og-default.png",
    canonicalUrl:    url,
    year:            String(new Date().getFullYear()),
    ...overrides,
  };
}

// Redirect /index.html → /
router.get("/index.html", (req, res) => {
  res.writeHead(301, { Location: "/" });
  res.end();
}, { public: true });

// Home
router.get("/", async (req, res) => {
  const html = await renderFile(path.join(PUBLIC_DIR, "index.html"), pageData());
  send(res, 200, html);
}, { public: true });

// Buscar redirect: /buscar.html → /buscar
router.get("/buscar.html", (req, res) => {
  const q = new URL(req.url, "http://x").searchParams.get("q") || "";
  res.writeHead(301, { Location: q ? `/buscar?q=${encodeURIComponent(q)}` : "/buscar" });
  res.end();
}, { public: true });

router.get("/buscar", async (req, res) => {
  const html = await renderFile(
    path.join(PUBLIC_DIR, "buscar.html"),
    pageData({ pageTitle: "Buscar — Recursos Canarias" })
  );
  send(res, 200, html);
}, { public: true });

// Todos los recursos
router.get("/recursos", async (req, res) => {
  const html = await renderFile(
    path.join(PUBLIC_DIR, "recursos.html"),
    pageData({ pageTitle: "Todos los recursos — Recursos Canarias" })
  );
  send(res, 200, html);
}, { public: true });

// Descargas
router.get("/descargas", async (req, res) => {
  await renderPage(res, path.join(PUBLIC_DIR, "descargas.html"),
    pageData({ pageTitle: "Descargas — Recursos Canarias" }));
}, { public: true });

// Blog list
router.get("/blog", async (req, res) => {
  const html = await renderFile(
    path.join(PUBLIC_DIR, "blog.html"),
    pageData({ pageTitle: "Blog y novedades — Recursos Canarias" })
  );
  send(res, 200, html);
}, { public: true });

// Blog post — SSR with markdown body
router.get("/blog/:slug", async (req, res) => {
  const { slug } = req.params;
  let post = null;

  if (_convex && _api) {
    try { post = await _convex.query(_api.blog.getBySlug, { slug }); } catch {}
  }

  if (!post) {
    send(res, 404, "Entrada no encontrada", "text/plain; charset=utf-8");
    return;
  }

  const CAT_LABELS = {
    articulo: "Artículo", "recurso-destacado": "Recurso destacado",
    novedad: "Novedad", "noticia-consejeria": "Consejería",
  };

  // Render body: external posts show excerpt + link; own posts render markdown
  let body;
  if (post.externalUrl) {
    body = `<p>${escapeHtml(post.excerpt)}</p>
<a class="blog-post-external-btn" href="${escapeHtml(post.externalUrl)}" target="_blank" rel="noopener noreferrer">
  Leer en la fuente original →
</a>`;
  } else {
    body = renderMarkdown(post.body || post.excerpt || "");
  }

  const coverHtml = post.coverImage
    ? `<div class="blog-post-cover"><img src="${escapeHtml(post.coverImage)}" alt="" loading="lazy"></div>`
    : "";

  const catLabel = CAT_LABELS[post.category] || post.category;
  const dateStr  = post.publishedAt
    ? new Date(post.publishedAt).toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" })
    : "";
  const readingHtml = post.readingMinutes
    ? `<span>${post.readingMinutes} min lectura</span>`
    : "";

  const articleHtml = `<article class="blog-post-layout">
  ${coverHtml}
  <div class="blog-post-header__inner home-section" style="padding-top:32px;padding-bottom:0">
    <span class="badge badge--category">${escapeHtml(catLabel)}</span>
    <h1 class="blog-post-title">${escapeHtml(post.title)}</h1>
    <div class="blog-post-meta">
      <time datetime="${escapeHtml(post.publishedAt || "")}">${escapeHtml(dateStr)}</time>
      ${readingHtml}
    </div>
  </div>
  <div class="blog-post-body home-section" style="padding-top:24px">
    ${body}
  </div>
</article>`;

  const html = await renderFile(
    path.join(PUBLIC_DIR, "blog-post.html"),
    {
      ...pageData({
        pageTitle:       `${post.title} — Recursos Canarias`,
        metaDescription: post.excerpt?.slice(0, 160) || "",
      }),
      __body__: articleHtml,
    }
  );
  send(res, 200, html);
}, { public: true });

// Noticias
router.get("/noticias", async (req, res) => {
  await renderPage(res, path.join(PUBLIC_DIR, "noticias.html"),
    pageData({ pageTitle: "Noticias Consejería — Recursos Canarias" }));
}, { public: true });

// Acerca
router.get("/acerca", async (req, res) => {
  await renderPage(res, path.join(PUBLIC_DIR, "acerca.html"),
    pageData({ pageTitle: "Acerca de — Recursos Canarias" }));
}, { public: true });

// Legal pages
for (const slug of ["privacidad", "aviso-legal", "cookies"]) {
  router.get(`/legal/${slug}`, async (req, res) => {
    await renderPage(res, path.join(PUBLIC_DIR, `legal/${slug}.html`),
      pageData({ pageTitle: `${slug.charAt(0).toUpperCase() + slug.slice(1)} — Recursos Canarias` }));
  }, { public: true });
}

// Admin pages
for (const page of ["login", "index", "recursos", "blog", "suscriptores", "mensajes"]) {
  const urlPath = page === "index" ? "/admin" : `/admin/${page}`;
  const isPublic = page === "login";
  router.get(urlPath, async (req, res) => {
    await renderPage(res, path.join(PUBLIC_DIR, `admin/${page}.html`),
      pageData({ pageTitle: "Admin — Recursos Canarias" }));
  }, { public: isPublic });
}

// Island pages — SSR with Convex data
router.get("/islas/:slug", async (req, res) => {
  const { slug } = req.params;

  if (!ISLAND_SLUGS.includes(slug)) {
    send(res, 404, "Isla no encontrada", "text/plain; charset=utf-8");
    return;
  }

  let island = null;
  if (_convex && _api) {
    try {
      island = await _convex.query(_api.islandPages.getBySlug, { slug });
    } catch {
      // Convex unavailable — use placeholders
    }
  }

  const name    = island?.name    || slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ");
  const intro   = island?.intro   || `Recursos educativos de ${name}.`;
  const nature  = island?.nature  || "";
  const culture = island?.culture || "";

  const html = await renderFile(
    path.join(PUBLIC_DIR, "isla.html"),
    pageData({
      pageTitle:       `${name} — Recursos Canarias`,
      metaDescription: intro.slice(0, 160),
      islandSlug:      slug,
      islandName:      name,
      islandIntro:     intro,
      islandNature:    nature,
      islandCulture:   culture,
    })
  );
  send(res, 200, html);
}, { public: true });

module.exports = { init };
