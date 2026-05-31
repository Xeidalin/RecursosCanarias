"use strict";

/**
 * Filter state manager backed by URLSearchParams.
 *
 * Usage:
 *   const fm = createFilters({
 *     pillsEl: document.getElementById('active-filters'),
 *     onChange: (state, count) => fetchResources(state),
 *     groups: [
 *       { key: 'kind',    label: 'Tipo',   multi: false, options: { pdf: 'PDF', ... } },
 *       { key: 'islands', label: 'Isla',   multi: true,  options: { tenerife: 'Tenerife', ... } },
 *     ],
 *   });
 *   fm.initFromUrl(); // load initial state from current URL
 */
function createFilters({ pillsEl, onChange, groups = [] }) {
  let params = new URLSearchParams(location.search);

  // ── State accessors ────────────────────────────────────────────────────────

  function get(key)       { return params.getAll(key); }
  function getSingle(key) { return params.get(key) || ""; }

  // For single-value filters (kind, q)
  function set(key, value) {
    params.delete(key);
    if (value) params.set(key, value);
    _sync();
  }

  // For multi-value filters (islands, topics, levels)
  function toggle(key, value) {
    const current = params.getAll(key);
    const idx     = current.indexOf(value);
    params.delete(key);
    if (idx === -1) {
      [...current, value].forEach((v) => params.append(key, v));
    } else {
      current.filter((v) => v !== value).forEach((v) => params.append(key, v));
    }
    _sync();
  }

  function clear(key) { params.delete(key); _sync(); }

  function clearAll() { params = new URLSearchParams(); _sync(); }

  function getState() {
    const state = {};
    const seen  = new Set();
    for (const [k] of params) {
      if (seen.has(k)) continue;
      seen.add(k);
      const all = params.getAll(k);
      state[k]  = all.length === 1 ? all[0] : all;
    }
    return state;
  }

  function getCount() {
    let n = 0;
    for (const [k] of params) { if (k !== "q") n++; }
    return n;
  }

  function has(key, value) {
    return value != null ? get(key).includes(value) : params.has(key);
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  function _groupLabel(key) {
    return groups.find((g) => g.key === key)?.label || key;
  }

  function _valueLabel(key, value) {
    return groups.find((g) => g.key === key)?.options?.[value] || value;
  }

  // ── Pills ─────────────────────────────────────────────────────────────────

  function _renderPills() {
    if (!pillsEl) return;
    const pills = [];
    const seen  = new Set();

    for (const [k, v] of params) {
      if (k === "q") continue;
      const id = `${k}::${v}`;
      if (seen.has(id)) continue;
      seen.add(id);

      pills.push(
        `<button class="filter-pill" type="button" data-key="${_esc(k)}" data-value="${_esc(v)}"
          aria-label="Quitar: ${_esc(_groupLabel(k))}: ${_esc(_valueLabel(k, v))}">
          <span>${_esc(_groupLabel(k))}: <strong>${_esc(_valueLabel(k, v))}</strong></span>
          <span class="filter-pill__x" aria-hidden="true">✕</span>
        </button>`
      );
    }

    if (pills.length === 0) {
      pillsEl.innerHTML = "";
      pillsEl.hidden    = true;
    } else {
      pillsEl.innerHTML =
        pills.join("") +
        `<button class="filter-pill filter-pill--clear" type="button" data-action="clear-all">Borrar todo</button>`;
      pillsEl.hidden = false;
    }
  }

  function _bindPillEvents() {
    if (!pillsEl) return;
    pillsEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action='clear-all']");
      if (btn) { clearAll(); return; }

      const pill = e.target.closest(".filter-pill[data-key]");
      if (!pill) return;

      const key   = pill.dataset.key;
      const value = pill.dataset.value;
      const group = groups.find((g) => g.key === key);
      group?.multi ? toggle(key, value) : clear(key);
    });
  }

  function _sync() {
    const qs = params.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
    _renderPills();
    onChange?.(getState(), getCount());
  }

  // ── Public ────────────────────────────────────────────────────────────────

  function initFromUrl() {
    params = new URLSearchParams(location.search);
    _renderPills();
    onChange?.(getState(), getCount());
  }

  function refresh() {
    params = new URLSearchParams(location.search);
    _renderPills();
  }

  _bindPillEvents();

  return { get, getSingle, set, toggle, clear, clearAll, getState, getCount, has, initFromUrl, refresh };
}

function _esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

window.createFilters = createFilters;
