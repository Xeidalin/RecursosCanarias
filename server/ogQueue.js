"use strict";

const { safeFetch } = require("./safeFetch.js");
const { parseOg }   = require("./og.js");

// Throttle de 2 peticiones por segundo → mínimo 500 ms entre arranques.
const MIN_INTERVAL_MS = 500;

/**
 * Cola FIFO single-concurrency con throttle de 2/s.
 *
 * Diseño:
 *  - Una sola tarea activa a la vez.
 *  - Entre el inicio de dos tareas median ≥ 500 ms (independiente de la latencia
 *    de la anterior). Si la tarea anterior tardó >500 ms, la siguiente arranca
 *    sin espera adicional.
 *  - `enqueue(id)` dedupa: si el id ya está pendiente o procesándose, no se
 *    añade dos veces (evita amplificar fallos transitorios).
 *  - Errores no propagan: el worker captura todo y graba og.failed=true.
 *  - Estado en memoria — válido para una sola instancia. Para multi-instancia
 *    habría que mover a un queue externo (Redis, Convex action).
 */

let _convex      = null;
let _api         = null;
let _safeFetch   = safeFetch;   // override en tests
let _parseOg     = parseOg;     // override en tests
let _logger      = console;     // override en tests

const queue        = [];                 // Array<string> de resourceId
const enqueued     = new Set();          // resourceIds pendientes o en curso (dedup)
let   running      = false;              // worker está procesando
let   lastStartAt  = 0;                  // ms del arranque de la última tarea
let   currentTimer = null;               // setTimeout del próximo arranque

function init(convex, api, opts = {}) {
  _convex = convex;
  _api    = api;
  if (opts.safeFetch) _safeFetch = opts.safeFetch;
  if (opts.parseOg)   _parseOg   = opts.parseOg;
  if (opts.logger)    _logger    = opts.logger;
}

function enqueue(resourceId) {
  if (!resourceId || typeof resourceId !== "string") return false;
  if (enqueued.has(resourceId)) return false;
  enqueued.add(resourceId);
  queue.push(resourceId);
  scheduleNext();
  return true;
}

function scheduleNext() {
  if (running || currentTimer || queue.length === 0) return;
  const now     = Date.now();
  const elapsed = now - lastStartAt;
  const delay   = Math.max(0, MIN_INTERVAL_MS - elapsed);
  currentTimer  = setTimeout(() => {
    currentTimer = null;
    runOne().catch((e) => _logger.error("ogQueue worker error:", e));
  }, delay);
  if (typeof currentTimer.unref === "function") currentTimer.unref();
}

async function runOne() {
  if (running || queue.length === 0) return;
  running = true;
  lastStartAt = Date.now();

  const resourceId = queue.shift();

  try {
    await processResource(resourceId);
  } catch (e) {
    // Defensa final: processResource ya escribe og.failed en caso de error;
    // si algo más explota, lo registramos pero no rompemos el worker.
    _logger.error(`ogQueue: error procesando ${resourceId}:`, e?.message || e);
  } finally {
    enqueued.delete(resourceId);
    running = false;
    scheduleNext();
  }
}

function failedOg() {
  return {
    title: "", description: "", image: "", favicon: "", domain: "",
    fetchedAt: new Date().toISOString(),
    failed: true,
  };
}

async function processResource(resourceId) {
  if (!_convex || !_api) {
    _logger.warn(`ogQueue: convex/api no inicializados — saltando ${resourceId}`);
    return;
  }

  let resource;
  try {
    resource = await _convex.query(_api.resources.getById, { id: resourceId });
  } catch (e) {
    _logger.warn(`ogQueue: no se pudo leer ${resourceId}: ${e?.message || e}`);
    return;
  }
  if (!resource) {
    _logger.warn(`ogQueue: recurso ${resourceId} no existe`);
    return;
  }
  if (!resource.isExternal || !resource.sourceUrl) {
    _logger.warn(`ogQueue: ${resourceId} no es externo o sin sourceUrl`);
    return;
  }

  let og;
  try {
    const { body, url } = await _safeFetch(resource.sourceUrl);
    og = _parseOg(body, url);
  } catch (e) {
    // SSRF blocked / timeout / body too large / non-HTML / DNS fail / etc.
    // Nunca filtramos el mensaje al cliente; el ticket pide og.failed=true.
    _logger.info(`ogQueue: fetch falló para ${resource.sourceUrl}: ${e?.message || e}`);
    og = failedOg();
  }

  try {
    await _convex.mutation(_api.resources.setOg, { id: resourceId, og });
  } catch (e) {
    _logger.error(`ogQueue: setOg falló para ${resourceId}: ${e?.message || e}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers solo para tests
// ---------------------------------------------------------------------------

function _state() {
  return {
    pending: queue.length,
    inFlight: running,
    enqueuedSize: enqueued.size,
  };
}

function _reset() {
  queue.length = 0;
  enqueued.clear();
  running = false;
  lastStartAt = 0;
  if (currentTimer) { clearTimeout(currentTimer); currentTimer = null; }
}

module.exports = { init, enqueue, _state, _reset };
