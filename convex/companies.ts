import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server.js";

export const findByPhone = internalQuery({
  args: {
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("companies")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();
  },
});

export const upsert = internalMutation({
  args: {
    phone: v.string(),
    name: v.optional(v.string()),
    domain: v.optional(v.string()),
    website: v.optional(v.string()),
    summary: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("companies")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();

    if (existing) {
      const patch: Record<string, unknown> = { updatedAt: now };
      let updated = false;
      const fields = ["name", "domain", "website", "summary", "notes"] as const;
      for (const key of fields) {
        const value = args[key];
        if (value !== undefined && value !== (existing as Record<string, unknown>)[key]) {
          patch[key] = value;
          updated = true;
        }
      }
      patch.status = updated ? "updated" : existing.status;
      await ctx.db.patch(existing._id, patch);
      return { id: existing._id, status: updated ? "updated" : "ok" };
    }

    const id = await ctx.db.insert("companies", {
      phone: args.phone,
      name: args.name,
      domain: args.domain,
      website: args.website,
      summary: args.summary,
      notes: args.notes,
      status: "ok",
      createdAt: now,
      updatedAt: now,
    });

    return { id, status: "ok" };
  },
});
