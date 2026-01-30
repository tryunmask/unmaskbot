import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "unmaskbot",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "unmaskbot", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "unmaskbot", "--dev", "gateway"]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "unmaskbot", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "unmaskbot", "--profile", "work", "status"]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "unmaskbot", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "unmaskbot", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "unmaskbot", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "unmaskbot", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join("/home/peter", ".unmaskbot-dev");
    expect(env.UNMASKBOT_PROFILE).toBe("dev");
    expect(env.UNMASKBOT_STATE_DIR).toBe(expectedStateDir);
    expect(env.UNMASKBOT_CONFIG_PATH).toBe(path.join(expectedStateDir, "unmaskbot.json"));
    expect(env.UNMASKBOT_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      UNMASKBOT_STATE_DIR: "/custom",
      UNMASKBOT_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.UNMASKBOT_STATE_DIR).toBe("/custom");
    expect(env.UNMASKBOT_GATEWAY_PORT).toBe("19099");
    expect(env.UNMASKBOT_CONFIG_PATH).toBe(path.join("/custom", "unmaskbot.json"));
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("unmaskbot doctor --fix", {})).toBe("unmaskbot doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("unmaskbot doctor --fix", { UNMASKBOT_PROFILE: "default" })).toBe(
      "unmaskbot doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("unmaskbot doctor --fix", { UNMASKBOT_PROFILE: "Default" })).toBe(
      "unmaskbot doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("unmaskbot doctor --fix", { UNMASKBOT_PROFILE: "bad profile" })).toBe(
      "unmaskbot doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(
      formatCliCommand("unmaskbot --profile work doctor --fix", { UNMASKBOT_PROFILE: "work" }),
    ).toBe("unmaskbot --profile work doctor --fix");
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("unmaskbot --dev doctor", { UNMASKBOT_PROFILE: "dev" })).toBe(
      "unmaskbot --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("unmaskbot doctor --fix", { UNMASKBOT_PROFILE: "work" })).toBe(
      "unmaskbot --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("unmaskbot doctor --fix", { UNMASKBOT_PROFILE: "  jbclawd  " })).toBe(
      "unmaskbot --profile jbclawd doctor --fix",
    );
  });

  it("handles command with no args after unmaskbot", () => {
    expect(formatCliCommand("unmaskbot", { UNMASKBOT_PROFILE: "test" })).toBe(
      "unmaskbot --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm unmaskbot doctor", { UNMASKBOT_PROFILE: "work" })).toBe(
      "pnpm unmaskbot --profile work doctor",
    );
  });
});
