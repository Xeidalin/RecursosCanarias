"use strict";

const CAT_LABELS = {
  articulo:             "Artículo",
  "recurso-destacado":  "Recurso destacado",
  novedad:              "Novedad",
  "noticia-consejeria": "Consejería",
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch { return iso.slice(0, 10); }
}

function blogCardHtml(p) {
  const href     = p.externalUrl || `/blog/${esc(p.slug)}`;
  const external = !!p.externalUrl;
  const target   = external ? ' target="_blank" rel="noopener noreferrer"' : "";
  const catLabel = CAT_LABELS[p.category] || p.category;

  return `<article class="blog-card">
  ${p.coverImage
    ? `<div class="blog-card__img"><img src="${esc(p.coverImage)}" alt="" loading="lazy"></div>`
    : `<div class="blog-card__img blog-card__img--empty" aria-hidden="true">📰</div>`}
  <div class="blog-card__body">
    <span class="badge badge--category">${esc(catLabel)}</span>
    <h2 class="blog-card__title">${esc(p.title)}</h2>
    ${p.excerpt ? `<p class="blog-card__excerpt">${esc(p.excerpt)}</p>` : ""}
    <div class="blog-card__meta">
      <time datetime="${esc(p.publishedAt)}">${formatDate(p.publishedAt)}</time>
      ${p.readingMinutes ? `<span>${p.readingMinutes} min lectura</span>` : ""}
    </div>
    <a class="blog-card__link" href="${esc(href)}"${target}>Leer →</a>
  </div>
</article>`;
}

// ─── Blog list page ────────────────────────────────────────────────────────────

const listEl      = document.getElementById("blog-list");
const loadMoreBtn = document.getElementById("blog-load-more");

if (listEl) {
  let cursor  = null;
  let loading = false;
  let isDone  = false;

  async function loadPosts(append = false) {
    if (loading || (append && isDone)) return;
    loading = true;
    const params = new URLSearchParams({ limit: "12" });
    if (cursor) params.set("cursor", cursor);

    // Category filter from URL
    const cat = new URLSearchParams(location.search).get("category");
    if (cat) params.set("category", cat);

    try {
      const r      = await fetch(`/api/blog?${params}`);
      const data   = await r.json();
      const posts  = Array.isArray(data.items) ? data.items : [];

      if (!append) listEl.innerHTML = "";

      if (posts.length === 0 && !append) {
        listEl.innerHTML = '<p class="home-empty">No hay entradas publicadas todavía.</p>';
      } else {
        listEl.insertAdjacentHTML("beforeend", posts.map(blogCardHtml).join(""));
      }

      if (loadMoreBtn) {
        cursor             = data.nextCursor || null;
        isDone             = data.isDone === true;
        loadMoreBtn.hidden = !cursor || isDone;
      }
    } catch {
      if (!append) {
        listEl.innerHTML = '<p class="home-empty">No se pudieron cargar las entradas.</p>';
      }
    }

    listEl.removeAttribute("aria-busy");
    loading = false;
  }

  loadMoreBtn?.addEventListener("click", () => loadPosts(true));
  loadPosts();
}

// ─── Blog post page ────────────────────────────────────────────────────────────

const postEl = document.getElementById("blog-post-content");

if (postEl && !listEl) {
  const slug = location.pathname.replace(/^\/blog\//, "").split("/")[0];

  async function loadPost() {
    try {
      const r    = await fetch(`/api/blog/${encodeURIComponent(slug)}`);
      if (!r.ok) {
        postEl.innerHTML = `<div class="home-section"><p class="home-empty">Entrada no encontrada. <a href="/blog">Volver al blog →</a></p></div>`;
        return;
      }
      const p        = await r.json();
      const catLabel = CAT_LABELS[p.category] || p.category;
      const external = !!p.externalUrl;

      // Update page title
      document.title = `${p.title} — Recursos Canarias`;

      postEl.innerHTML = `
<header class="blog-post-header">
  ${p.coverImage ? `<div class="blog-post-cover"><img src="${esc(p.coverImage)}" alt="" loading="lazy"></div>` : ""}
  <div class="blog-post-header__inner home-section" style="padding-top:32px;padding-bottom:0">
    <span class="badge badge--category">${esc(catLabel)}</span>
    <h1 class="blog-post-title">${esc(p.title)}</h1>
    <div class="blog-post-meta">
      <time datetime="${esc(p.publishedAt)}">${formatDate(p.publishedAt)}</time>
      ${p.readingMinutes ? `<span>${p.readingMinutes} min lectura</span>` : ""}
    </div>
  </div>
</header>
<div class="blog-post-body home-section" style="padding-top:0">
  ${external
    ? `<p>${esc(p.excerpt)}</p>
       <a class="blog-post-external-btn" href="${esc(p.externalUrl)}" target="_blank" rel="noopener noreferrer">
         Leer en la fuente original →
       </a>`
    : (p.body || `<p>${esc(p.excerpt)}</p>`)
  }
</div>`;
    } catch {
      postEl.innerHTML = `<div class="home-section"><p class="home-empty">No se pudo cargar la entrada.</p></div>`;
    }

    postEl.removeAttribute("aria-busy");
  }

  loadPost();
}
