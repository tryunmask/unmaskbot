import { httpRouter } from "convex/server";

import { httpAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { Id } from "./_generated/dataModel.js";
import { requireBearerAuth } from "./auth.js";
import { jsonError, jsonResponse, readJson } from "./httpHelpers.js";

const http = httpRouter();

type ShouldRespondPayload = {
  eventType?: string;
  message?: string;
  phase?: string;
  lastOutboundType?: string;
  lastAction?: string;
  silent?: boolean;
  doNotRespond?: boolean;
  flags?: { silent?: boolean; doNotRespond?: boolean; canProceed?: boolean };
};

type ReferralPayload = {
  phone?: string;
  name?: string;
  linkedin?: string;
  notes?: string;
  scoutPhone?: string;
  source?: string;
};

type TalentPayload = {
  phone?: string;
  fullName?: string;
  role?: string;
  location?: string;
  linkedin?: string;
  notes?: string;
  scoutPhone?: string;
};

type CompanyPayload = {
  phone?: string;
  name?: string;
  domain?: string;
  website?: string;
  summary?: string;
  notes?: string;
};

type IntroRequestPayload = {
  talentPhone?: string;
  companyId?: string;
  companyName?: string;
  reason?: string;
  notes?: string;
};

type IntroDecisionPayload = {
  introId?: string;
  companyPhone?: string;
  notes?: string;
  reason?: string;
};

type OutboundEnqueuePayload = {
  toPhone?: string;
  message?: string;
  agentId?: string;
  channel?: string;
  accountId?: string;
  addToAllowlist?: boolean;
};

type OutboundClaimPayload = {
  limit?: number;
};

type OutboundMarkPayload = {
  id?: string;
  status?: string;
  error?: string;
};

type ContextLookupPayload = {
  talentPhone?: string;
  companyPhone?: string;
  includeIntro?: boolean;
};

function normalizePhone(value?: string): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[^\d+]/g, "");
  return normalized || null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

http.route({
  path: "/v1/agents/should-respond",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const auth = requireBearerAuth(request);
    if (auth) return auth;
    const payload = await readJson<ShouldRespondPayload>(request);
    if (!payload) return jsonError(400, "invalid_json");

    const flags = payload.flags ?? {};
    const silent = Boolean(payload.silent ?? flags.silent);
    const doNotRespond = Boolean(payload.doNotRespond ?? flags.doNotRespond);
    const shouldRespond = !(silent || doNotRespond);

    return jsonResponse({
      shouldRespond,
      reason: shouldRespond ? "default allow" : "silent/doNotRespond flag set",
      source: "backend",
    });
  }),
});

http.route({
  path: "/v1/scout/referrals",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBearerAuth(request);
    if (auth) return auth;
    const payload = await readJson<ReferralPayload>(request);
    if (!payload) return jsonError(400, "invalid_json");

    const phone = normalizePhone(payload.phone);
    if (!phone) return jsonError(400, "phone is required");
    const scoutPhone = normalizePhone(payload.scoutPhone) ?? "";
    const name = readOptionalString(payload.name);
    const linkedin = readOptionalString(payload.linkedin);
    const notes = readOptionalString(payload.notes);
    const source = readOptionalString(payload.source);

    const existing = await ctx.runQuery(internal.referrals.findByPhoneAndScout, {
      phone,
      scoutPhone,
    });

    const enqueueTalentInvite = async () => {
      const scoutRecord =
        scoutPhone && scoutPhone.trim()
          ? await ctx.runQuery(internal.scouts.findByPhone, { phone: scoutPhone })
          : null;
      const scoutName = readOptionalString(scoutRecord?.name);
      const inviteName = scoutName ?? "A scout";
      const inviteMessage =
        `${inviteName} invited you to Unmask. ` +
        (name ? `Hi ${name} — ` : "") +
        "I'm your Unmask contact — I can get you warm intros to the right teams.";

      await ctx.runMutation(internal.outbound.enqueue, {
        toPhone: phone,
        message: inviteMessage,
        agentId: "talent",
        channel: "whatsapp",
        accountId: "talent",
        addToAllowlist: true,
      });
    };

    if (existing) {
      const result = await ctx.runMutation(internal.referrals.update, {
        id: existing._id,
        name,
        linkedin,
        notes,
        source,
      });
      if (scoutPhone) {
        await ctx.runMutation(internal.talent.upsert, {
          phone,
          fullName: name ?? undefined,
          role: undefined,
          location: undefined,
          linkedin: linkedin ?? undefined,
          notes: notes ?? undefined,
          scoutPhone,
        });
      }
      await enqueueTalentInvite();
      return jsonResponse({
        id: existing._id,
        status: result.updated ? "updated" : "exists",
      });
    }

    const id = await ctx.runMutation(internal.referrals.create, {
      phone,
      name,
      linkedin,
      notes,
      scoutPhone,
      source,
    });

    if (scoutPhone) {
      await ctx.runMutation(internal.talent.upsert, {
        phone,
        fullName: name ?? undefined,
        role: undefined,
        location: undefined,
        linkedin: linkedin ?? undefined,
        notes: notes ?? undefined,
        scoutPhone,
      });
    }

    await enqueueTalentInvite();

    return jsonResponse({ id, status: "created" });
  }),
});

http.route({
  path: "/v1/talent/onboard",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBearerAuth(request);
    if (auth) return auth;
    const payload = await readJson<TalentPayload>(request);
    if (!payload) return jsonError(400, "invalid_json");

    const phone = normalizePhone(payload.phone);
    if (!phone) return jsonError(400, "phone is required");
    const scoutPhone = normalizePhone(payload.scoutPhone) ?? "";

    const result = await ctx.runMutation(internal.talent.upsert, {
      phone,
      fullName: readOptionalString(payload.fullName),
      role: readOptionalString(payload.role),
      location: readOptionalString(payload.location),
      linkedin: readOptionalString(payload.linkedin),
      notes: readOptionalString(payload.notes),
      scoutPhone,
    });

    return jsonResponse(result);
  }),
});

http.route({
  path: "/v1/company/onboard",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBearerAuth(request);
    if (auth) return auth;
    const payload = await readJson<CompanyPayload>(request);
    if (!payload) return jsonError(400, "invalid_json");

    const phone = normalizePhone(payload.phone);
    if (!phone) return jsonError(400, "phone is required");

    const result = await ctx.runMutation(internal.companies.upsert, {
      phone,
      name: readOptionalString(payload.name),
      domain: readOptionalString(payload.domain),
      website: readOptionalString(payload.website),
      summary: readOptionalString(payload.summary),
      notes: readOptionalString(payload.notes),
    });

    return jsonResponse(result);
  }),
});

http.route({
  path: "/v1/talent/intro-request",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBearerAuth(request);
    if (auth) return auth;
    const payload = await readJson<IntroRequestPayload>(request);
    if (!payload) return jsonError(400, "invalid_json");

    const talentPhone = normalizePhone(payload.talentPhone);
    if (!talentPhone) return jsonError(400, "talentPhone is required");
    const reason = readOptionalString(payload.reason);
    if (!reason) return jsonError(400, "reason is required");

    const companyName = readOptionalString(payload.companyName);
    const companyRecord = companyName
      ? await ctx.runQuery(internal.companies.findByNameLower, {
          nameLower: companyName.trim().toLowerCase(),
        })
      : null;
    const companyPhone = readOptionalString(companyRecord?.phone);

    const result = await ctx.runMutation(internal.intros.create, {
      talentPhone,
      companyId: readOptionalString(payload.companyId),
      companyName,
      companyPhone,
      reason,
      notes: readOptionalString(payload.notes),
    });

    const talentRecord = await ctx.runQuery(internal.talent.findByPhone, {
      phone: talentPhone,
    });
    const talentName = readOptionalString(talentRecord?.fullName) ?? "A candidate";

    if (companyPhone) {
      const introMessage =
        `Intro request for ${talentName}. ` +
        `Company: ${companyName ?? "Unknown"}. ` +
        `Reason: ${reason}. ` +
        `Intro ID: ${result.id}. ` +
        `Talent phone: ${talentPhone}. ` +
        (readOptionalString(talentRecord?.linkedin)
          ? `LinkedIn: ${readOptionalString(talentRecord?.linkedin)}. `
          : "") +
        "Accept or decline?";
      await ctx.runMutation(internal.outbound.enqueue, {
        toPhone: companyPhone,
        message: introMessage,
        agentId: "company",
        channel: "whatsapp",
        accountId: "company",
        addToAllowlist: true,
      });
    }

    return jsonResponse(result);
  }),
});

http.route({
  path: "/v1/context/lookup",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBearerAuth(request);
    if (auth) return auth;
    const payload = await readJson<ContextLookupPayload>(request);
    if (!payload) return jsonError(400, "invalid_json");

    const talentPhone = normalizePhone(payload.talentPhone);
    const companyPhone = normalizePhone(payload.companyPhone);
    if (!talentPhone && !companyPhone) {
      return jsonError(400, "talentPhone or companyPhone is required");
    }

    const [talent, company] = await Promise.all([
      talentPhone
        ? ctx.runQuery(internal.talent.findByPhone, { phone: talentPhone })
        : Promise.resolve(null),
      companyPhone
        ? ctx.runQuery(internal.companies.findByPhone, { phone: companyPhone })
        : Promise.resolve(null),
    ]);

    let intro = null;
    const includeIntro = payload.includeIntro !== false;
    if (includeIntro) {
      if (talentPhone) {
        intro = await ctx.runQuery(internal.intros.findLatestByTalentPhone, { talentPhone });
      }
      if (!intro && companyPhone) {
        intro = await ctx.runQuery(internal.intros.findLatestByCompanyPhone, { companyPhone });
      }
    }

    return jsonResponse({
      talent,
      company,
      intro,
    });
  }),
});

http.route({
  path: "/v1/company/intro-accept",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBearerAuth(request);
    if (auth) return auth;
    const payload = await readJson<IntroDecisionPayload>(request);
    if (!payload) return jsonError(400, "invalid_json");

    const introId = readOptionalString(payload.introId);
    if (!introId) return jsonError(400, "introId is required");

    let record = null;
    try {
      record = await ctx.runQuery(internal.intros.getById, {
        id: introId as Id<"introRequests">,
      });
    } catch {
      return jsonError(400, "introId is invalid");
    }
    if (!record) return jsonError(404, "intro not found");

    const result = await ctx.runMutation(internal.intros.accept, {
      id: introId as Id<"introRequests">,
      notes: readOptionalString(payload.notes),
      companyPhone: normalizePhone(payload.companyPhone) ?? undefined,
    });

    return jsonResponse({ status: result.ok ? "accepted" : "failed" });
  }),
});

http.route({
  path: "/v1/company/intro-decline",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBearerAuth(request);
    if (auth) return auth;
    const payload = await readJson<IntroDecisionPayload>(request);
    if (!payload) return jsonError(400, "invalid_json");

    const introId = readOptionalString(payload.introId);
    if (!introId) return jsonError(400, "introId is required");
    const reason = readOptionalString(payload.reason);
    if (!reason) return jsonError(400, "reason is required");

    let record = null;
    try {
      record = await ctx.runQuery(internal.intros.getById, {
        id: introId as Id<"introRequests">,
      });
    } catch {
      return jsonError(400, "introId is invalid");
    }
    if (!record) return jsonError(404, "intro not found");

    const result = await ctx.runMutation(internal.intros.decline, {
      id: introId as Id<"introRequests">,
      reason,
      companyPhone: normalizePhone(payload.companyPhone) ?? undefined,
    });

    return jsonResponse({ status: result.ok ? "declined" : "failed" });
  }),
});

http.route({
  path: "/v1/outbound/enqueue",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBearerAuth(request);
    if (auth) return auth;
    const payload = await readJson<OutboundEnqueuePayload>(request);
    if (!payload) return jsonError(400, "invalid_json");

    const toPhone = normalizePhone(payload.toPhone);
    if (!toPhone) return jsonError(400, "toPhone is required");
    const message = readOptionalString(payload.message);
    if (!message) return jsonError(400, "message is required");

    const id = await ctx.runMutation(internal.outbound.enqueue, {
      toPhone,
      message,
      agentId: readOptionalString(payload.agentId),
      channel: readOptionalString(payload.channel),
      accountId: readOptionalString(payload.accountId),
      addToAllowlist:
        typeof payload.addToAllowlist === "boolean" ? payload.addToAllowlist : undefined,
    });

    return jsonResponse({ id, status: "pending" });
  }),
});

http.route({
  path: "/v1/outbound/claim",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBearerAuth(request);
    if (auth) return auth;
    const payload = await readJson<OutboundClaimPayload>(request);
    if (!payload) return jsonError(400, "invalid_json");

    const limitRaw = typeof payload.limit === "number" ? payload.limit : 5;
    const claimed = await ctx.runMutation(internal.outbound.claimPending, {
      limit: limitRaw,
    });

    return jsonResponse({ items: claimed });
  }),
});

http.route({
  path: "/v1/outbound/mark",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = requireBearerAuth(request);
    if (auth) return auth;
    const payload = await readJson<OutboundMarkPayload>(request);
    if (!payload) return jsonError(400, "invalid_json");

    const id = readOptionalString(payload.id);
    if (!id) return jsonError(400, "id is required");
    const status = readOptionalString(payload.status);
    if (!status || (status !== "sent" && status !== "failed")) {
      return jsonError(400, "status must be sent or failed");
    }

    let record = null;
    try {
      record = await ctx.runQuery(internal.outbound.getById, {
        id: id as Id<"outboundMessages">,
      });
    } catch {
      return jsonError(400, "id is invalid");
    }
    if (!record) return jsonError(404, "message not found");

    const result = await ctx.runMutation(internal.outbound.markStatus, {
      id: id as Id<"outboundMessages">,
      status: status as "sent" | "failed",
      error: readOptionalString(payload.error),
    });

    return jsonResponse({ status: result.ok ? status : "failed" });
  }),
});

export default http;
