import { v } from "convex/values";

import { internalQuery } from "./_generated/server.js";

export const findByPhone = internalQuery({
  args: {
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scouts")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();
  },
});
