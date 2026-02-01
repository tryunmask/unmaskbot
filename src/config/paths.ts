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

const LEGACY_STATE_DIRNAME = ".moltbot";
const NEW_STATE_DIRNAME = ".unmaskbot";
// Repo-local state (preferred for local dev; gitignored by default).
const REPO_STATE_DIRNAME = ".unmask";

// Repo-local config filename (JSON5 parser accepts .json too).
const REPO_CONFIG_FILENAME = "unmask.json";
const REPO_CONFIG_JSON5_FILENAME = "unmask.json5";

const CONFIG_FILENAME = "unmaskbot.json";
const LEGACY_CONFIG_FILENAME = "moltbot.json";

function legacyStateDir(homedir: () => string = os.homedir): string {
  return path.join(homedir(), LEGACY_STATE_DIRNAME);
}

function newStateDir(homedir: () => string = os.homedir): string {
  return path.join(homedir(), NEW_STATE_DIRNAME);
}

export function resolveLegacyStateDir(homedir: () => string = os.homedir): string {
  return legacyStateDir(homedir);
}

export function resolveNewStateDir(homedir: () => string = os.homedir): string {
  return newStateDir(homedir);
}

function isDirOrFile(p: string): boolean {
  try {
    const stat = fs.statSync(p);
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

function resolveRepoRoot(cwd: () => string = process.cwd): string | null {
  // Walk up from CWD until we find a `.git` marker.
  // This supports:
  // - standard repos (`.git/` directory)
  // - worktrees/submodules (`.git` file)
  let current = path.resolve(cwd());
  for (let depth = 0; depth < 50; depth += 1) {
    if (isDirOrFile(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Resolve a repo-local state dir candidate (`<repo>/.unmask`) when the current
 * working directory is inside a git repo and the repo has opted in by creating
 * the `.unmask/` directory (or its config file).
 */
export function resolveRepoStateDirCandidate(
  env: NodeJS.ProcessEnv = process.env,
  cwd: () => string = process.cwd,
): string | null {
  // Respect explicit overrides (these are authoritative).
  if (
    env.UNMASKBOT_STATE_DIR?.trim() ||
    env.MOLTBOT_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim()
  ) {
    return null;
  }
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot) return null;
  const repoStateDir = path.join(repoRoot, REPO_STATE_DIRNAME);
  const configJson = path.join(repoStateDir, REPO_CONFIG_FILENAME);
  const configJson5 = path.join(repoStateDir, REPO_CONFIG_JSON5_FILENAME);
  if (fs.existsSync(repoStateDir) || fs.existsSync(configJson) || fs.existsSync(configJson5)) {
    return repoStateDir;
  }
  return null;
}

/**
 * State directory for mutable data (sessions, logs, caches).
 * Can be overridden via UNMASKBOT_STATE_DIR (preferred) or MOLTBOT_STATE_DIR (legacy).
 * Default: ~/.unmaskbot (new default for Unmask)
 * If ~/.unmaskbot exists and ~/.moltbot does not, prefer ~/.unmaskbot.
 */
export function resolveHomeStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const override =
    env.UNMASKBOT_STATE_DIR?.trim() ||
    env.MOLTBOT_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  const legacyDir = legacyStateDir(homedir);
  const newDir = newStateDir(homedir);
  const hasLegacy = fs.existsSync(legacyDir);
  const hasNew = fs.existsSync(newDir);
  if (!hasLegacy && hasNew) return newDir;
  return legacyDir;
}

/**
 * State directory for mutable data (sessions, logs, caches).
 *
 * Precedence:
 * - `UNMASKBOT_STATE_DIR` / `MOLTBOT_STATE_DIR` (explicit override)
 * - repo-local `<repo>/.unmask` (opt-in: directory or config file exists)
 * - home state dir (`~/.unmaskbot` preferred when it exists; else legacy `~/.moltbot`)
 */
export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  cwd: () => string = process.cwd,
): string {
  const override =
    env.UNMASKBOT_STATE_DIR?.trim() ||
    env.MOLTBOT_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  const repoState = resolveRepoStateDirCandidate(env, cwd);
  if (repoState) return repoState;
  return resolveHomeStateDir(env, homedir);
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
 * Can be overridden via UNMASKBOT_CONFIG_PATH (preferred) or MOLTBOT_CONFIG_PATH (legacy).
 * Default: ~/.unmaskbot/unmaskbot.json (or $*_STATE_DIR/unmaskbot.json)
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
  // When state lives in repo-local `.unmask/`, prefer the repo-local config filename.
  if (path.basename(path.resolve(stateDir)) === REPO_STATE_DIRNAME) {
    return path.join(stateDir, REPO_CONFIG_FILENAME);
  }
  return path.join(stateDir, CONFIG_FILENAME);
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
    // Repo-local preferred names
    path.join(stateDir, REPO_CONFIG_FILENAME),
    path.join(stateDir, REPO_CONFIG_JSON5_FILENAME),
    // Home/default names
    path.join(stateDir, CONFIG_FILENAME),
    path.join(stateDir, LEGACY_CONFIG_FILENAME),
  ];
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (existing) return existing;
  if (stateOverride) return resolveCanonicalConfigPath(env, stateDir);
  const defaultStateDir = resolveStateDir(env, homedir);
  if (path.resolve(stateDir) === path.resolve(defaultStateDir)) {
    return resolveConfigPathCandidate(env, homedir);
  }
  return resolveCanonicalConfigPath(env, stateDir);
}

export const CONFIG_PATH = resolveConfigPathCandidate();

/**
 * Resolve default config path candidates across new + legacy locations.
 * Order: explicit config path → state-dir-derived paths → new default → legacy default.
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

  // Repo-local config (opt-in by creating `.unmask/` or its config file).
  // Note: we include these candidates regardless of existence; selection checks existence later.
  const repoRoot = resolveRepoRoot();
  if (repoRoot) {
    const repoStateDir = path.join(repoRoot, REPO_STATE_DIRNAME);
    candidates.push(path.join(repoStateDir, REPO_CONFIG_FILENAME));
    candidates.push(path.join(repoStateDir, REPO_CONFIG_JSON5_FILENAME));
    // Back-compat names in the repo-local dir.
    candidates.push(path.join(repoStateDir, CONFIG_FILENAME));
    candidates.push(path.join(repoStateDir, LEGACY_CONFIG_FILENAME));
  }

  const unmaskStateDir = env.UNMASKBOT_STATE_DIR?.trim();
  if (unmaskStateDir) {
    candidates.push(path.join(resolveUserPath(unmaskStateDir), REPO_CONFIG_FILENAME));
    candidates.push(path.join(resolveUserPath(unmaskStateDir), REPO_CONFIG_JSON5_FILENAME));
    candidates.push(path.join(resolveUserPath(unmaskStateDir), CONFIG_FILENAME));
    candidates.push(path.join(resolveUserPath(unmaskStateDir), LEGACY_CONFIG_FILENAME));
  }
  const legacyStateDirOverride = env.MOLTBOT_STATE_DIR?.trim();
  if (legacyStateDirOverride) {
    candidates.push(path.join(resolveUserPath(legacyStateDirOverride), REPO_CONFIG_FILENAME));
    candidates.push(path.join(resolveUserPath(legacyStateDirOverride), REPO_CONFIG_JSON5_FILENAME));
    candidates.push(path.join(resolveUserPath(legacyStateDirOverride), CONFIG_FILENAME));
    candidates.push(path.join(resolveUserPath(legacyStateDirOverride), LEGACY_CONFIG_FILENAME));
  }

  const clawdbotStateDirOverride = env.CLAWDBOT_STATE_DIR?.trim();
  if (clawdbotStateDirOverride) {
    candidates.push(path.join(resolveUserPath(clawdbotStateDirOverride), REPO_CONFIG_FILENAME));
    candidates.push(
      path.join(resolveUserPath(clawdbotStateDirOverride), REPO_CONFIG_JSON5_FILENAME),
    );
    candidates.push(path.join(resolveUserPath(clawdbotStateDirOverride), CONFIG_FILENAME));
    candidates.push(path.join(resolveUserPath(clawdbotStateDirOverride), LEGACY_CONFIG_FILENAME));
  }

  candidates.push(path.join(newStateDir(homedir), REPO_CONFIG_FILENAME));
  candidates.push(path.join(newStateDir(homedir), REPO_CONFIG_JSON5_FILENAME));
  candidates.push(path.join(newStateDir(homedir), CONFIG_FILENAME));
  candidates.push(path.join(newStateDir(homedir), LEGACY_CONFIG_FILENAME));
  candidates.push(path.join(legacyStateDir(homedir), REPO_CONFIG_FILENAME));
  candidates.push(path.join(legacyStateDir(homedir), REPO_CONFIG_JSON5_FILENAME));
  candidates.push(path.join(legacyStateDir(homedir), CONFIG_FILENAME));
  candidates.push(path.join(legacyStateDir(homedir), LEGACY_CONFIG_FILENAME));
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
