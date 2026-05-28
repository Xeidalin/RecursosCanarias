"use strict";
// CJS wrapper para convex/_generated/api.js (que es ESM).
// server.js usa require(), incompatible con ESM en Node 20.
const { anyApi, componentsGeneric } = require("convex/server");
module.exports = {
  api:        anyApi,
  internal:   anyApi,
  components: componentsGeneric(),
};
