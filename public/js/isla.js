"use strict";

(async function () {
  const slug      = window.__ISLAND_SLUG__;
  const container = document.getElementById("island-resource-cards");
  if (!slug || !container) return;

  const KIND_LABELS = {
    pdf: "PDF", image: "Imagen", song: "Canción", audio: "Audio",
    video: "Vídeo", presentation: "Presentación", activity: "Ficha",
  };

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function cardHtml(r) {
    const img  = r.og?.image || r.imageUrl || "";
    const href = r.isExternal ? (r.sourceUrl || "#") : `/recursos/${esc(r.slug)}`;
    const ext  = r.isExternal ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<article class="resource-card">
  ${img ? `<div class="resource-card__img"><img src="${esc(img)}" alt="" loading="lazy"></div>` : `<div class="resource-card__img resource-card__img--empty" aria-hidden="true"></div>`}
  <div class="resource-card__body">
    <div class="resource-card__badges">
      <span class="badge badge--kind">${esc(KIND_LABELS[r.kind] || r.kind)}</span>
    </div>
    <h3 class="resource-card__title">${esc(r.title)}</h3>
    ${r.description ? `<p class="resource-card__desc">${esc(r.description)}</p>` : ""}
    <a class="resource-card__link" href="${esc(href)}"${ext}>Ver recurso</a>
  </div>
</article>`;
  }

  try {
    const url = `/api/resources/filtered?islands=${encodeURIComponent(slug)}&limit=12`;
    const r   = await fetch(url);
    const data = r.ok ? await r.json() : { items: [] };
    const items = data.items || [];

    if (items.length === 0) {
      container.innerHTML = `<p class="home-empty">Aún no hay recursos específicos de esta isla. <a href="/recursos">Ver todos los recursos →</a></p>`;
    } else {
      container.innerHTML = items.map(cardHtml).join("");
    }
  } catch {
    container.innerHTML = `<p class="home-empty">No se pudieron cargar los recursos.</p>`;
  }

  container.removeAttribute("aria-busy");
})();
