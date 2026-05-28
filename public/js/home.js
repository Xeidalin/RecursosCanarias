"use strict";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const KIND_LABELS = {
  pdf:          "PDF",
  image:        "Imagen",
  song:         "Canción",
  audio:        "Audio",
  video:        "Vídeo",
  presentation: "Presentación",
  activity:     "Ficha",
};

const CAT_LABELS = {
  articulo:              "Artículo",
  "recurso-destacado":   "Recurso destacado",
  novedad:               "Novedad",
  "noticia-consejeria":  "Consejería",
};

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

// ─── Resource cards ───────────────────────────────────────────────────────────

function resourceCardHtml(r) {
  const img        = r.og?.image || r.imageUrl || "";
  const kindLabel  = KIND_LABELS[r.kind] || r.kind;
  const islandText = (r.islands || []).includes("todas")
    ? "Todas las islas"
    : (r.islands || []).slice(0, 2).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(", ");
  const href       = r.isExternal ? (r.sourceUrl || "#") : `/recursos/${esc(r.slug)}`;
  const target     = r.isExternal ? ' target="_blank" rel="noopener noreferrer"' : "";

  return `<article class="resource-card">
  ${img ? `<div class="resource-card__img"><img src="${esc(img)}" alt="" loading="lazy"></div>` : `<div class="resource-card__img resource-card__img--empty" aria-hidden="true"></div>`}
  <div class="resource-card__body">
    <div class="resource-card__badges">
      <span class="badge badge--kind">${esc(kindLabel)}</span>
      ${islandText ? `<span class="badge badge--island">${esc(islandText)}</span>` : ""}
    </div>
    <h3 class="resource-card__title">${esc(r.title)}</h3>
    ${r.description ? `<p class="resource-card__desc">${esc(r.description)}</p>` : ""}
    <a class="resource-card__link" href="${esc(href)}"${target}>Ver recurso</a>
  </div>
</article>`;
}

// ─── Blog cards ──────────────────────────────────────────────────────────────

function blogCardHtml(p) {
  const href     = p.externalUrl || `/blog/${esc(p.slug)}`;
  const external = !!p.externalUrl;
  const target   = external ? ' target="_blank" rel="noopener noreferrer"' : "";
  const catLabel = CAT_LABELS[p.category] || p.category;

  return `<article class="blog-card">
  ${p.coverImage ? `<div class="blog-card__img"><img src="${esc(p.coverImage)}" alt="" loading="lazy"></div>` : `<div class="blog-card__img blog-card__img--empty" aria-hidden="true"></div>`}
  <div class="blog-card__body">
    <span class="badge badge--category">${esc(catLabel)}</span>
    <h3 class="blog-card__title">${esc(p.title)}</h3>
    ${p.excerpt ? `<p class="blog-card__excerpt">${esc(p.excerpt)}</p>` : ""}
    <div class="blog-card__meta">
      <time datetime="${esc(p.publishedAt)}">${formatDate(p.publishedAt)}</time>
      ${p.readingMinutes ? `<span>${p.readingMinutes} min</span>` : ""}
    </div>
    <a class="blog-card__link" href="${esc(href)}"${target}>Leer →</a>
  </div>
</article>`;
}

// ─── Fetch and render ─────────────────────────────────────────────────────────

async function loadResources() {
  const container = document.getElementById("home-resource-cards");
  if (!container) return;

  try {
    const r     = await fetch("/api/resources?limit=6");
    const items = r.ok ? await r.json() : [];

    if (items.length === 0) {
      container.innerHTML = '<p class="home-empty">Pronto publicaremos los primeros recursos.</p>';
    } else {
      container.innerHTML = items.map(resourceCardHtml).join("");
    }
  } catch {
    container.innerHTML = '<p class="home-empty">No se pudieron cargar los recursos.</p>';
  }

  container.removeAttribute("aria-busy");
}

async function loadBlogPosts() {
  const container = document.getElementById("home-blog-cards");
  if (!container) return;

  try {
    const r     = await fetch("/api/blog?limit=3");
    const posts = r.ok ? await r.json() : [];

    if (posts.length === 0) {
      container.innerHTML = '<p class="home-empty">Próximamente publicaremos novedades.</p>';
    } else {
      container.innerHTML = posts.map(blogCardHtml).join("");
    }
  } catch {
    container.innerHTML = '<p class="home-empty">No se pudieron cargar las entradas del blog.</p>';
  }

  container.removeAttribute("aria-busy");
}

// Run both fetches in parallel
Promise.all([loadResources(), loadBlogPosts()]);
