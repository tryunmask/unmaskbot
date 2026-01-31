import { describe, expect, it } from "vitest";

const BASE_URL = process.env.UNMASK_API_BASE_URL?.trim() || "https://good-anteater-63.convex.site";
const API_TOKEN = process.env.UNMASK_API_TOKEN?.trim() || "dev-unmask";

function buildHeaders() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${API_TOKEN}`,
  };
}

async function postJson(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { res, data };
}

function uniquePhone(seed: string) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
  return `+1555${seed}${suffix}`.slice(0, 12);
}

describe("Convex Unmask HTTP endpoints", () => {
  it("should-respond returns shouldRespond", async () => {
    const { res, data } = await postJson("/v1/agents/should-respond", {
      eventType: "user_text",
      message: "hello",
    });
    expect(res.status).toBe(200);
    expect(data?.shouldRespond).toBeTypeOf("boolean");
  });

  it("creates a referral and returns status", async () => {
    const phone = uniquePhone("01");
    const { res, data } = await postJson("/v1/scout/referrals", {
      phone,
      name: "Test Candidate",
      notes: "convex test",
      scoutPhone: "+15551234567",
      source: "test",
    });
    expect(res.status).toBe(200);
    expect(data?.id).toBeTruthy();
    expect(["created", "exists", "updated"]).toContain(data?.status);
  });

  it("onboards talent and returns status", async () => {
    const phone = uniquePhone("02");
    const { res, data } = await postJson("/v1/talent/onboard", {
      phone,
      fullName: "Test Talent",
      role: "Engineer",
      location: "Remote",
      notes: "convex test",
      scoutPhone: "+15551234567",
    });
    expect(res.status).toBe(200);
    expect(data?.id).toBeTruthy();
    expect(["ok", "updated"]).toContain(data?.status);
  });

  it("requests and accepts an intro", async () => {
    const talentPhone = uniquePhone("03");
    const requestRes = await postJson("/v1/talent/intro-request", {
      talentPhone,
      companyName: "Test Co",
      reason: "test",
      notes: "convex test",
    });
    expect(requestRes.res.status).toBe(200);
    expect(requestRes.data?.id).toBeTruthy();
    expect(requestRes.data?.status).toBe("requested");

    const acceptRes = await postJson("/v1/company/intro-accept", {
      introId: requestRes.data.id,
      notes: "ok",
      companyPhone: "+15557654321",
    });
    expect(acceptRes.res.status).toBe(200);
    expect(acceptRes.data?.status).toBe("accepted");
  });

  it("requests and declines an intro", async () => {
    const talentPhone = uniquePhone("04");
    const requestRes = await postJson("/v1/talent/intro-request", {
      talentPhone,
      companyName: "Test Co 2",
      reason: "test",
    });
    expect(requestRes.res.status).toBe(200);
    expect(requestRes.data?.id).toBeTruthy();
    expect(requestRes.data?.status).toBe("requested");

    const declineRes = await postJson("/v1/company/intro-decline", {
      introId: requestRes.data.id,
      reason: "not a fit",
      companyPhone: "+15559876543",
    });
    expect(declineRes.res.status).toBe(200);
    expect(declineRes.data?.status).toBe("declined");
  });
});
