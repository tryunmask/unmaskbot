import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  resolveConfigPath,
  resolveDefaultConfigCandidates,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveRepoStateDirCandidate,
  resolveStateDir,
} from "./paths.js";

describe("oauth paths", () => {
  it("prefers CLAWDBOT_OAUTH_DIR over CLAWDBOT_STATE_DIR", () => {
    const env = {
      CLAWDBOT_OAUTH_DIR: "/custom/oauth",
      CLAWDBOT_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from stateDir when unset", () => {
    expect(resolveOAuthDir({} as NodeJS.ProcessEnv, "/custom/state")).toBe(
      path.join("/custom/state", "credentials"),
    );
    expect(resolveOAuthPath({} as NodeJS.ProcessEnv, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("state + config path candidates", () => {
  it("prefers UNMASKBOT_STATE_DIR over MOLTBOT_STATE_DIR", () => {
    const env = {
      UNMASKBOT_STATE_DIR: "/new/state",
      MOLTBOT_STATE_DIR: "/legacy/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("prefers repo-local .unmask/unmask.json when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "unmask-repo-config-"));
    const prev = process.cwd();
    try {
      await fs.mkdir(path.join(root, ".git"), { recursive: true });
      await fs.mkdir(path.join(root, ".unmask"), { recursive: true });
      await fs.writeFile(path.join(root, ".unmask", "unmask.json"), "{}", "utf-8");

      process.chdir(root);
      const candidates = resolveDefaultConfigCandidates(
        {} as NodeJS.ProcessEnv,
        () => "/home/test",
      );
      expect(candidates[0]).toBe(path.join(root, ".unmask", "unmask.json"));
    } finally {
      process.chdir(prev);
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("prefers ~/.unmaskbot when it exists (even with legacy dir)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "unmaskbot-state-"));
    try {
      const newDir = path.join(root, ".unmaskbot");
      const legacyDir = path.join(root, ".moltbot");
      await fs.mkdir(newDir, { recursive: true });
      await fs.mkdir(legacyDir, { recursive: true });
      // Avoid picking up the real repo during tests.
      const resolved = resolveStateDir(
        {} as NodeJS.ProcessEnv,
        () => root,
        () => root,
      );
      expect(resolved).toBe(newDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("CONFIG_PATH prefers existing legacy filename when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "unmask-config-"));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousHomeDrive = process.env.HOMEDRIVE;
    const previousHomePath = process.env.HOMEPATH;
    const previousMoltbotConfig = process.env.MOLTBOT_CONFIG_PATH;
    const previousUnmaskbotConfig = process.env.UNMASKBOT_CONFIG_PATH;
    const previousMoltbotState = process.env.MOLTBOT_STATE_DIR;
    const previousUnmaskbotState = process.env.UNMASKBOT_STATE_DIR;
    try {
      const legacyDir = path.join(root, ".moltbot");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "moltbot.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      process.env.HOME = root;
      if (process.platform === "win32") {
        process.env.USERPROFILE = root;
        const parsed = path.win32.parse(root);
        process.env.HOMEDRIVE = parsed.root.replace(/\\$/, "");
        process.env.HOMEPATH = root.slice(parsed.root.length - 1);
      }
      delete process.env.MOLTBOT_CONFIG_PATH;
      delete process.env.UNMASKBOT_CONFIG_PATH;
      delete process.env.MOLTBOT_STATE_DIR;
      delete process.env.UNMASKBOT_STATE_DIR;

      vi.resetModules();
      const { CONFIG_PATH } = await import("./paths.js");
      expect(CONFIG_PATH).toBe(legacyPath);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      if (previousHomeDrive === undefined) delete process.env.HOMEDRIVE;
      else process.env.HOMEDRIVE = previousHomeDrive;
      if (previousHomePath === undefined) delete process.env.HOMEPATH;
      else process.env.HOMEPATH = previousHomePath;
      if (previousMoltbotConfig === undefined) delete process.env.MOLTBOT_CONFIG_PATH;
      else process.env.MOLTBOT_CONFIG_PATH = previousMoltbotConfig;
      if (previousUnmaskbotConfig === undefined) delete process.env.UNMASKBOT_CONFIG_PATH;
      else process.env.UNMASKBOT_CONFIG_PATH = previousUnmaskbotConfig;
      if (previousMoltbotState === undefined) delete process.env.MOLTBOT_STATE_DIR;
      else process.env.MOLTBOT_STATE_DIR = previousMoltbotState;
      if (previousUnmaskbotState === undefined) delete process.env.UNMASKBOT_STATE_DIR;
      else process.env.UNMASKBOT_STATE_DIR = previousUnmaskbotState;
      await fs.rm(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "unmask-config-override-"));
    try {
      const legacyDir = path.join(root, ".moltbot");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "moltbot.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { MOLTBOT_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "unmaskbot.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("repo-local state dir candidate", () => {
  it("resolves <repo>/.unmask when the repo has opted in", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "unmask-repo-state-"));
    const prev = process.cwd();
    try {
      await fs.mkdir(path.join(root, ".git"), { recursive: true });
      await fs.mkdir(path.join(root, ".unmask"), { recursive: true });
      process.chdir(root);
      const resolved = resolveRepoStateDirCandidate({} as NodeJS.ProcessEnv);
      expect(resolved).toBe(path.join(root, ".unmask"));
    } finally {
      process.chdir(prev);
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
