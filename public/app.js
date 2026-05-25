const state = {
  resources: [],
  query: "",
  subject: "",
  island: "",
  sort: "recent"
};

const els = {
  grid: document.querySelector("#resourceGrid"),
  empty: document.querySelector("#emptyState"),
  search: document.querySelector("#searchInput"),
  sort: document.querySelector("#sortSelect"),
  subject: document.querySelector("#subjectFilter"),
  island: document.querySelector("#islandFilter"),
  totalCount: document.querySelector("#totalCount"),
  imageCount: document.querySelector("#imageCount"),
  stageCount: document.querySelector("#stageCount"),
  resetButton: document.querySelector("#resetButton"),
  dialog: document.querySelector("#resourceDialog"),
  openCreateButton: document.querySelector("#openCreateButton"),
  closeDialogButton: document.querySelector("#closeDialogButton"),
  form: document.querySelector("#resourceForm"),
  formMessage: document.querySelector("#formMessage")
};

const collator = new Intl.Collator("es", { sensitivity: "base" });
const initialParams = new URLSearchParams(window.location.search);

function text(value) {
  return String(value || "").toLowerCase();
}

function selectedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function uniqueValues(key) {
  return [...new Set(state.resources.map((resource) => resource[key]).filter(Boolean))]
    .sort((a, b) => collator.compare(a, b));
}

function updateSelect(select, values, currentValue) {
  const first = select.querySelector("option");
  select.replaceChildren(first);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  select.value = values.includes(currentValue) ? currentValue : "";
}

function updateCounts() {
  document.querySelectorAll("[data-count]").forEach((node) => {
    const [key, value] = node.dataset.count.split(":");
    node.textContent = state.resources.filter((resource) => resource[key] === value).length;
  });
}

function matchesResource(resource) {
  const activeTypes = selectedValues("type");
  const activeStages = selectedValues("stage");
  const haystack = [
    resource.title,
    resource.type,
    resource.stage,
    resource.level,
    resource.subject,
    resource.island,
    resource.description,
    ...(resource.tags || [])
  ].map(text).join(" ");

  return activeTypes.includes(resource.type)
    && activeStages.includes(resource.stage)
    && (!state.subject || resource.subject === state.subject)
    && (!state.island || resource.island === state.island)
    && (!state.query || haystack.includes(text(state.query)));
}

function sortResources(resources) {
  return [...resources].sort((a, b) => {
    if (state.sort === "title") return collator.compare(a.title, b.title);
    if (state.sort === "type") return collator.compare(a.type, b.type) || collator.compare(a.title, b.title);
    if (state.sort === "level") return collator.compare(a.level, b.level) || collator.compare(a.title, b.title);
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

function fallbackLabel(type) {
  const labels = {
    Imagen: "IMG",
    Video: "VID",
    Ficha: "FIC",
    PDF: "PDF",
    Tarea: "TAR"
  };
  return labels[type] || "REC";
}

function createCard(resource) {
  const article = document.createElement("article");
  article.className = "resource-card";

  const tags = [resource.type, resource.level, resource.subject].filter(Boolean);
  const image = resource.imageUrl
    ? `<img alt="${resource.title}" src="${resource.imageUrl}" loading="lazy">`
    : `<div class="thumb-fallback">${fallbackLabel(resource.type)}</div>`;

  article.innerHTML = `
    <div class="thumb">${image}</div>
    <div class="card-body">
      <div class="meta">${tags.map((tag) => `<span class="pill">${tag}</span>`).join("")}</div>
      <h2>${resource.title}</h2>
      <p>${resource.description || "Recurso preparado para uso educativo en el aula."}</p>
      <div class="card-footer">
        <span>${resource.stage} · ${resource.island || "Canarias"}</span>
        <a class="download-link" href="${resource.fileUrl || "#"}">Descargar</a>
      </div>
    </div>
  `;

  return article;
}

function render() {
  const filtered = sortResources(state.resources.filter(matchesResource));
  els.grid.replaceChildren(...filtered.map(createCard));
  els.empty.hidden = filtered.length > 0;

  els.totalCount.textContent = filtered.length;
  els.imageCount.textContent = filtered.filter((resource) => resource.type === "Imagen").length;
  els.stageCount.textContent = new Set(selectedValues("stage")).size;
}

function refreshFilters() {
  updateSelect(els.subject, uniqueValues("subject"), state.subject);
  updateSelect(els.island, uniqueValues("island"), state.island);
  updateCounts();
}

function applyInitialParams() {
  const query = initialParams.get("q") || "";
  const type = initialParams.get("tipo") || "";

  if (query) {
    state.query = query;
    els.search.value = query;
  }

  if (type) {
    document.querySelectorAll('input[name="type"]').forEach((input) => {
      input.checked = input.value === type;
    });
  }
}

async function loadResources() {
  const response = await fetch("/api/resources");
  if (!response.ok) throw new Error("No se pudieron cargar los recursos");
  state.resources = await response.json();
  applyInitialParams();
  refreshFilters();
  render();
}

async function createResource(formData) {
  const payload = Object.fromEntries(formData.entries());
  const response = await fetch("/api/resources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No se pudo guardar el recurso");
  state.resources.unshift(data);
  refreshFilters();
  render();
}

document.querySelectorAll('input[name="type"], input[name="stage"]').forEach((input) => {
  input.addEventListener("change", render);
});

els.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

els.sort.addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});

els.subject.addEventListener("change", (event) => {
  state.subject = event.target.value;
  render();
});

els.island.addEventListener("change", (event) => {
  state.island = event.target.value;
  render();
});

els.resetButton.addEventListener("click", () => {
  document.querySelectorAll('input[name="type"], input[name="stage"]').forEach((input) => {
    input.checked = true;
  });
  els.search.value = "";
  els.subject.value = "";
  els.island.value = "";
  els.sort.value = "recent";
  state.query = "";
  state.subject = "";
  state.island = "";
  state.sort = "recent";
  render();
});

els.openCreateButton.addEventListener("click", () => {
  els.formMessage.textContent = "";
  els.dialog.showModal();
});

els.closeDialogButton.addEventListener("click", () => {
  els.dialog.close();
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.formMessage.textContent = "Guardando...";

  try {
    await createResource(new FormData(els.form));
    els.form.reset();
    els.dialog.close();
  } catch (error) {
    els.formMessage.textContent = error.message;
  }
});

loadResources().catch((error) => {
  els.empty.hidden = false;
  els.empty.textContent = error.message;
});
