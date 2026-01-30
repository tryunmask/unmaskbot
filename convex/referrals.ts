import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server.js";

export const findByPhoneAndScout = internalQuery({
  args: {
    phone: v.string(),
    scoutPhone: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("referrals")
      .withIndex("by_phone_scout", (q) =>
        q.eq("phone", args.phone).eq("scoutPhone", args.scoutPhone),
      )
      .first();
  },
});

export const create = internalMutation({
  args: {
    phone: v.string(),
    name: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    notes: v.optional(v.string()),
    scoutPhone: v.string(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("referrals", {
      phone: args.phone,
      name: args.name,
      linkedin: args.linkedin,
      notes: args.notes,
      scoutPhone: args.scoutPhone,
      source: args.source,
      status: "created",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = internalMutation({
  args: {
    id: v.id("referrals"),
    name: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    notes: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const patch: Record<string, unknown> = { updatedAt: now };
    let updated = false;

    const existing = await ctx.db.get(args.id);
    if (!existing) return { updated: false };

    if (args.name && args.name !== existing.name) {
      patch.name = args.name;
      updated = true;
    }
    if (args.linkedin && args.linkedin !== existing.linkedin) {
      patch.linkedin = args.linkedin;
      updated = true;
    }
    if (args.notes && args.notes !== existing.notes) {
      patch.notes = args.notes;
      updated = true;
    }
    if (args.source && args.source !== existing.source) {
      patch.source = args.source;
      updated = true;
    }

    if (updated) {
      patch.status = "updated";
    }
    await ctx.db.patch(args.id, patch);
    return { updated };
  },
});
