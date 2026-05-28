import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Genera una URL de subida POST-only de Convex Storage.
// Llamada desde el admin via /api/admin/resources/upload-url.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Traduce un storageId devuelto por la subida en URL pública servida por Convex.
// Devuelve null si el storageId no existe.
export const getStorageUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId);
  },
});
