import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    return await ctx.db
      .query("admins")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
  },
});

export const create = mutation({
  args: {
    username:     v.string(),
    passwordHash: v.string(),
    salt:         v.string(),
  },
  handler: async (ctx, { username, passwordHash, salt }) => {
    const existing = await ctx.db
      .query("admins")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    if (existing) throw new Error(`El usuario '${username}' ya existe.`);

    return await ctx.db.insert("admins", {
      username,
      passwordHash,
      salt,
      createdAt: new Date().toISOString(),
    });
  },
});
