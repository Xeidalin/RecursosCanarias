"use strict";

(async function loadNoticias() {
  const grid    = document.getElementById("noticias-grid");
  const loading = document.getElementById("noticias-loading");
  if (!grid) return;

  try {
    const r  = await fetch("/api/blog?category=noticia-consejeria&limit=20");
    const data = await r.json();
    const posts = Array.isArray(data.items) ? data.items : [];
    loading?.remove();

    if (posts.length === 0) {
      grid.innerHTML = "<p>No hay noticias de la Consejería en este momento.</p>";
      return;
    }

    grid.innerHTML = posts.map((p) => {
      const date = p.publishedAt
        ? new Date(p.publishedAt).toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" })
        : "";
      const cover = p.coverImage
        ? `<img src="${escapeHtml(p.coverImage)}" alt="" loading="lazy" class="noticias-card__img">`
        : "";
      const sourceTag = p.externalUrl
        ? `<span class="badge badge--external">Fuente externa</span>`
        : "";
      return `<article class="noticias-card">
        ${cover}
        <div class="noticias-card__body">
          <div class="noticias-card__meta">
            <time datetime="${escapeHtml(p.publishedAt || "")}">${escapeHtml(date)}</time>
            ${sourceTag}
          </div>
          <h2 class="noticias-card__title">
            <a href="/blog/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a>
          </h2>
          <p class="noticias-card__excerpt">${escapeHtml(p.excerpt || "")}</p>
          ${p.externalUrl ? `<a class="noticias-card__link" href="${escapeHtml(p.externalUrl)}" target="_blank" rel="noopener noreferrer">Leer en la fuente original →</a>` : ""}
        </div>
      </article>`;
    }).join("");
  } catch {
    if (loading) loading.textContent = "Error al cargar noticias. Inténtalo de nuevo más tarde.";
  }
})();

function escapeHtml(str) {
  const m = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(str).replace(/[&<>"']/g, (c) => m[c]);
}
