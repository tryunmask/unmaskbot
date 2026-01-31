import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MoltbotConfig } from "./types.js";

/**
 * Nix mode detection: When UNMASKBOT_NIX_MODE=1, the gateway is running under Nix.
 * In this mode:
 * - No auto-install flows should be attempted
 * - Missing dependencies should produce actionable Nix-specific error messages
 * - Config is managed externally (read-only from Nix perspective)
 */
export function resolveIsNixMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.UNMASKBOT_NIX_MODE === "1" || env.CLAWDBOT_NIX_MODE === "1";
}

export const isNixMode = resolveIsNixMode();

const NEW_STATE_DIRNAME = ".unmask";
const NEW_CONFIG_FILENAME = "unmask.json";
const LEGACY_STATE_DIRNAMES = [".clawdbot", ".moltbot", ".unmaskbot"] as const;
const LEGACY_CONFIG_FILENAMES = ["moltbot.json", "clawdbot.json", "unmaskbot.json"] as const;
const REPO_CONFIG_DIRNAME = ".unmask";

function legacyStateDirs(homedir: () => string = os.homedir): string[] {
  return LEGACY_STATE_DIRNAMES.map((name) => path.join(homedir(), name));
}

function newStateDir(homedir: () => string = os.homedir): string {
  return path.join(homedir(), NEW_STATE_DIRNAME);
}

function resolveRepoConfigCandidates(cwd: () => string = process.cwd): string[] {
  const root = cwd();
  const repoDir = path.join(root, REPO_CONFIG_DIRNAME);
  return [
    path.join(repoDir, NEW_CONFIG_FILENAME),
    ...LEGACY_CONFIG_FILENAMES.map((name) => path.join(repoDir, name)),
  ];
}

function firstExistingPath(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore invalid paths
    }
  }
  return undefined;
}

export function resolveLegacyStateDir(homedir: () => string = os.homedir): string {
  const candidates = legacyStateDirs(homedir);
  return firstExistingPath(candidates) ?? candidates[0];
}

export function resolveNewStateDir(homedir: () => string = os.homedir): string {
  return newStateDir(homedir);
}

/**
 * State directory for mutable data (sessions, logs, caches).
 * Can be overridden via UNMASKBOT_STATE_DIR (preferred) or MOLTBOT_STATE_DIR / CLAWDBOT_STATE_DIR (legacy).
 * Default: ~/.unmask (new default for Unmask)
 * If legacy dirs exist, prefer them to avoid splitting state.
 */
export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const override =
    env.UNMASKBOT_STATE_DIR?.trim() ||
    env.MOLTBOT_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  const newDir = newStateDir(homedir);
  const legacyDirs = legacyStateDirs(homedir);
  const hasLegacy = legacyDirs.some((dir) => fs.existsSync(dir));
  const hasNew = fs.existsSync(newDir);
  if (!hasLegacy && hasNew) return newDir;
  if (hasLegacy) return firstExistingPath(legacyDirs) ?? legacyDirs[0];
  return newDir;
}

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

export const STATE_DIR = resolveStateDir();

/**
 * Config file path (JSON5).
 * Can be overridden via UNMASKBOT_CONFIG_PATH (preferred) or MOLTBOT_CONFIG_PATH / CLAWDBOT_CONFIG_PATH (legacy).
 * Default: ~/.unmask/unmask.json (or $*_STATE_DIR/unmask.json)
 */
export function resolveCanonicalConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  const override =
    env.UNMASKBOT_CONFIG_PATH?.trim() ||
    env.MOLTBOT_CONFIG_PATH?.trim() ||
    env.CLAWDBOT_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  return path.join(stateDir, NEW_CONFIG_FILENAME);
}

/**
 * Resolve the active config path by preferring existing config candidates
 * (new/legacy filenames) before falling back to the canonical path.
 */
export function resolveConfigPathCandidate(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const candidates = resolveDefaultConfigCandidates(env, homedir);
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (existing) return existing;
  return resolveCanonicalConfigPath(env, resolveStateDir(env, homedir));
}

/**
 * Active config path (prefers existing legacy/new config files).
 */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
  homedir: () => string = os.homedir,
): string {
  const override =
    env.UNMASKBOT_CONFIG_PATH?.trim() ||
    env.MOLTBOT_CONFIG_PATH?.trim() ||
    env.CLAWDBOT_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  const stateOverride =
    env.UNMASKBOT_STATE_DIR?.trim() ||
    env.MOLTBOT_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim();
  const candidates = [
    path.join(stateDir, NEW_CONFIG_FILENAME),
    ...LEGACY_CONFIG_FILENAMES.map((name) => path.join(stateDir, name)),
  ];
  const existing = firstExistingPath(candidates);
  if (existing) return existing;
  if (stateOverride) return path.join(stateDir, NEW_CONFIG_FILENAME);
  const defaultStateDir = resolveStateDir(env, homedir);
  if (path.resolve(stateDir) === path.resolve(defaultStateDir)) {
    return resolveConfigPathCandidate(env, homedir);
  }
  return path.join(stateDir, NEW_CONFIG_FILENAME);
}

export const CONFIG_PATH = resolveConfigPathCandidate();

/**
 * Resolve default config path candidates across new + legacy locations.
 * Order: explicit config path → repo-local config → state-dir-derived paths → new default → legacy default.
 */
export function resolveDefaultConfigCandidates(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string[] {
  const explicit =
    env.UNMASKBOT_CONFIG_PATH?.trim() ||
    env.MOLTBOT_CONFIG_PATH?.trim() ||
    env.CLAWDBOT_CONFIG_PATH?.trim();
  if (explicit) return [resolveUserPath(explicit)];

  const candidates: string[] = [];
  candidates.push(...resolveRepoConfigCandidates());
  const unmaskStateDir = env.UNMASKBOT_STATE_DIR?.trim();
  if (unmaskStateDir) {
    candidates.push(path.join(resolveUserPath(unmaskStateDir), NEW_CONFIG_FILENAME));
    for (const name of LEGACY_CONFIG_FILENAMES) {
      candidates.push(path.join(resolveUserPath(unmaskStateDir), name));
    }
  }
  const legacyStateDirOverride = env.MOLTBOT_STATE_DIR?.trim() || env.CLAWDBOT_STATE_DIR?.trim();
  if (legacyStateDirOverride) {
    candidates.push(path.join(resolveUserPath(legacyStateDirOverride), NEW_CONFIG_FILENAME));
    for (const name of LEGACY_CONFIG_FILENAMES) {
      candidates.push(path.join(resolveUserPath(legacyStateDirOverride), name));
    }
  }

  const newDir = newStateDir(homedir);
  candidates.push(path.join(newDir, NEW_CONFIG_FILENAME));
  for (const name of LEGACY_CONFIG_FILENAMES) {
    candidates.push(path.join(newDir, name));
  }
  for (const legacyDir of legacyStateDirs(homedir)) {
    candidates.push(path.join(legacyDir, NEW_CONFIG_FILENAME));
    for (const name of LEGACY_CONFIG_FILENAMES) {
      candidates.push(path.join(legacyDir, name));
    }
  }
  return candidates;
}

export const DEFAULT_GATEWAY_PORT = 18789;

/**
 * Gateway lock directory (ephemeral).
 * Default: os.tmpdir()/unmaskbot-<uid> (uid suffix when available).
 */
export function resolveGatewayLockDir(tmpdir: () => string = os.tmpdir): string {
  const base = tmpdir();
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const suffix = uid != null ? `unmaskbot-${uid}` : "unmaskbot";
  return path.join(base, suffix);
}

const OAUTH_FILENAME = "oauth.json";

/**
 * OAuth credentials storage directory.
 *
 * Precedence:
 * - `UNMASKBOT_OAUTH_DIR` (explicit override)
 * - `$*_STATE_DIR/credentials` (canonical server/default)
 * - `~/.moltbot/credentials` (legacy default)
 */
export function resolveOAuthDir(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  const override = env.UNMASKBOT_OAUTH_DIR?.trim() || env.CLAWDBOT_OAUTH_DIR?.trim();
  if (override) return resolveUserPath(override);
  return path.join(stateDir, "credentials");
}

export function resolveOAuthPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  return path.join(resolveOAuthDir(env, stateDir), OAUTH_FILENAME);
}

export function resolveGatewayPort(
  cfg?: MoltbotConfig,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const envRaw = env.UNMASKBOT_GATEWAY_PORT?.trim() || env.CLAWDBOT_GATEWAY_PORT?.trim();
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const configPort = cfg?.gateway?.port;
  if (typeof configPort === "number" && Number.isFinite(configPort)) {
    if (configPort > 0) return configPort;
  }
  return DEFAULT_GATEWAY_PORT;
}
