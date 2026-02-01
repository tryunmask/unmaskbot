import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { MoltbotConfig } from "../config/config.js";
import {
  resolveLegacyStateDir,
  resolveNewStateDir,
  resolveOAuthDir,
  resolveHomeStateDir,
  resolveStateDir,
} from "../config/paths.js";
import type { SessionEntry } from "../config/sessions.js";
import type { SessionScope } from "../config/sessions/types.js";
import { saveSessionStore } from "../config/sessions.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  buildAgentMainSessionKey,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_MAIN_KEY,
  normalizeAgentId,
} from "../routing/session-key.js";
import { canonicalizeMainSessionAlias } from "../config/sessions/main-session.js";
import {
  ensureDir,
  existsDir,
  fileExists,
  isLegacyWhatsAppAuthFile,
  readSessionStoreJson5,
  type SessionEntryLike,
  safeReadDir,
} from "./state-migrations.fs.js";

export type LegacyStateDetection = {
  targetAgentId: string;
  targetMainKey: string;
  targetScope?: SessionScope;
  stateDir: string;
  oauthDir: string;
  sessions: {
    legacyDir: string;
    legacyStorePath: string;
    targetDir: string;
    targetStorePath: string;
    hasLegacy: boolean;
    legacyKeys: string[];
  };
  agentDir: {
    legacyDir: string;
    targetDir: string;
    hasLegacy: boolean;
  };
  whatsappAuth: {
    legacyDir: string;
    targetDir: string;
    hasLegacy: boolean;
  };
  preview: string[];
};

type MigrationLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

let autoMigrateChecked = false;
let autoMigrateStateDirChecked = false;
let autoMigrateRepoStateDirChecked = false;

function isSurfaceGroupKey(key: string): boolean {
  return key.includes(":group:") || key.includes(":channel:");
}

function isLegacyGroupKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("group:")) return true;
  const lower = trimmed.toLowerCase();
  if (!lower.includes("@g.us")) return false;
  // Legacy WhatsApp group keys: bare JID or "whatsapp:<jid>" without explicit ":group:" kind.
  if (!trimmed.includes(":")) return true;
  if (lower.startsWith("whatsapp:") && !trimmed.includes(":group:")) return true;
  return false;
}

function canonicalizeSessionKeyForAgent(params: {
  key: string;
  agentId: string;
  mainKey: string;
  scope?: SessionScope;
}): string {
  const agentId = normalizeAgentId(params.agentId);
  const raw = params.key.trim();
  if (!raw) return raw;
  if (raw.toLowerCase() === "global" || raw.toLowerCase() === "unknown") return raw.toLowerCase();

  const canonicalMain = canonicalizeMainSessionAlias({
    cfg: { session: { scope: params.scope, mainKey: params.mainKey } },
    agentId,
    sessionKey: raw,
  });
  if (canonicalMain !== raw) return canonicalMain.toLowerCase();

  if (raw.toLowerCase().startsWith("agent:")) return raw.toLowerCase();
  if (raw.toLowerCase().startsWith("subagent:")) {
    const rest = raw.slice("subagent:".length);
    return `agent:${agentId}:subagent:${rest}`.toLowerCase();
  }
  if (raw.startsWith("group:")) {
    const id = raw.slice("group:".length).trim();
    if (!id) return raw;
    const channel = id.toLowerCase().includes("@g.us") ? "whatsapp" : "unknown";
    return `agent:${agentId}:${channel}:group:${id}`.toLowerCase();
  }
  if (!raw.includes(":") && raw.toLowerCase().includes("@g.us")) {
    return `agent:${agentId}:whatsapp:group:${raw}`.toLowerCase();
  }
  if (raw.toLowerCase().startsWith("whatsapp:") && raw.toLowerCase().includes("@g.us")) {
    const remainder = raw.slice("whatsapp:".length).trim();
    const cleaned = remainder.replace(/^group:/i, "").trim();
    if (cleaned && !isSurfaceGroupKey(raw)) {
      return `agent:${agentId}:whatsapp:group:${cleaned}`.toLowerCase();
    }
  }
  if (isSurfaceGroupKey(raw)) {
    return `agent:${agentId}:${raw}`.toLowerCase();
  }
  return `agent:${agentId}:${raw}`.toLowerCase();
}

function pickLatestLegacyDirectEntry(
  store: Record<string, SessionEntryLike>,
): SessionEntryLike | null {
  let best: SessionEntryLike | null = null;
  let bestUpdated = -1;
  for (const [key, entry] of Object.entries(store)) {
    if (!entry || typeof entry !== "object") continue;
    const normalized = key.trim();
    if (!normalized) continue;
    if (normalized === "global") continue;
    if (normalized.startsWith("agent:")) continue;
    if (normalized.toLowerCase().startsWith("subagent:")) continue;
    if (isLegacyGroupKey(normalized) || isSurfaceGroupKey(normalized)) continue;
    const updatedAt = typeof entry.updatedAt === "number" ? entry.updatedAt : 0;
    if (updatedAt > bestUpdated) {
      bestUpdated = updatedAt;
      best = entry;
    }
  }
  return best;
}

function normalizeSessionEntry(entry: SessionEntryLike): SessionEntry | null {
  const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : null;
  if (!sessionId) return null;
  const updatedAt =
    typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
      ? entry.updatedAt
      : Date.now();
  const normalized = { ...(entry as unknown as SessionEntry), sessionId, updatedAt };
  const rec = normalized as unknown as Record<string, unknown>;
  if (typeof rec.groupChannel !== "string" && typeof rec.room === "string") {
    rec.groupChannel = rec.room;
  }
  delete rec.room;
  return normalized;
}

function resolveUpdatedAt(entry: SessionEntryLike): number {
  return typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
    ? entry.updatedAt
    : 0;
}

function mergeSessionEntry(params: {
  existing: SessionEntryLike | undefined;
  incoming: SessionEntryLike;
  preferIncomingOnTie?: boolean;
}): SessionEntryLike {
  if (!params.existing) return params.incoming;
  const existingUpdated = resolveUpdatedAt(params.existing);
  const incomingUpdated = resolveUpdatedAt(params.incoming);
  if (incomingUpdated > existingUpdated) return params.incoming;
  if (incomingUpdated < existingUpdated) return params.existing;
  return params.preferIncomingOnTie ? params.incoming : params.existing;
}

function canonicalizeSessionStore(params: {
  store: Record<string, SessionEntryLike>;
  agentId: string;
  mainKey: string;
  scope?: SessionScope;
}): { store: Record<string, SessionEntryLike>; legacyKeys: string[] } {
  const canonical: Record<string, SessionEntryLike> = {};
  const meta = new Map<string, { isCanonical: boolean; updatedAt: number }>();
  const legacyKeys: string[] = [];

  for (const [key, entry] of Object.entries(params.store)) {
    if (!entry || typeof entry !== "object") continue;
    const canonicalKey = canonicalizeSessionKeyForAgent({
      key,
      agentId: params.agentId,
      mainKey: params.mainKey,
      scope: params.scope,
    });
    const isCanonical = canonicalKey === key;
    if (!isCanonical) legacyKeys.push(key);
    const existing = canonical[canonicalKey];
    if (!existing) {
      canonical[canonicalKey] = entry;
      meta.set(canonicalKey, { isCanonical, updatedAt: resolveUpdatedAt(entry) });
      continue;
    }

    const existingMeta = meta.get(canonicalKey);
    const incomingUpdated = resolveUpdatedAt(entry);
    const existingUpdated = existingMeta?.updatedAt ?? resolveUpdatedAt(existing);
    if (incomingUpdated > existingUpdated) {
      canonical[canonicalKey] = entry;
      meta.set(canonicalKey, { isCanonical, updatedAt: incomingUpdated });
      continue;
    }
    if (incomingUpdated < existingUpdated) continue;
    if (existingMeta?.isCanonical && !isCanonical) continue;
    if (!existingMeta?.isCanonical && isCanonical) {
      canonical[canonicalKey] = entry;
      meta.set(canonicalKey, { isCanonical, updatedAt: incomingUpdated });
      continue;
    }
  }

  return { store: canonical, legacyKeys };
}

function listLegacySessionKeys(params: {
  store: Record<string, SessionEntryLike>;
  agentId: string;
  mainKey: string;
  scope?: SessionScope;
}): string[] {
  const legacy: string[] = [];
  for (const key of Object.keys(params.store)) {
    const canonical = canonicalizeSessionKeyForAgent({
      key,
      agentId: params.agentId,
      mainKey: params.mainKey,
      scope: params.scope,
    });
    if (canonical !== key) legacy.push(key);
  }
  return legacy;
}

function emptyDirOrMissing(dir: string): boolean {
  if (!existsDir(dir)) return true;
  return safeReadDir(dir).length === 0;
}

function removeDirIfEmpty(dir: string) {
  if (!existsDir(dir)) return;
  if (!emptyDirOrMissing(dir)) return;
  try {
    fs.rmdirSync(dir);
  } catch {
    // ignore
  }
}

export function resetAutoMigrateLegacyStateForTest() {
  autoMigrateChecked = false;
}

export function resetAutoMigrateLegacyAgentDirForTest() {
  resetAutoMigrateLegacyStateForTest();
}

export function resetAutoMigrateLegacyStateDirForTest() {
  autoMigrateStateDirChecked = false;
}

export function resetAutoMigrateRepoStateDirForTest() {
  autoMigrateRepoStateDirChecked = false;
}

type StateDirMigrationResult = {
  migrated: boolean;
  skipped: boolean;
  changes: string[];
  warnings: string[];
};

function isSymlinkPath(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function isEffectivelyEmptyRepoStateDir(dir: string): boolean {
  if (!existsDir(dir)) return true;
  const ignored = new Set([
    "unmask.json",
    "unmask.json5",
    // tolerate backups created by `config set`
    "unmask.json.bak",
    "unmask.json5.bak",
  ]);
  const entries = safeReadDir(dir).filter((e) => !ignored.has(e.name));
  return entries.length === 0;
}

function formatRepoStateMigration(legacyDir: string, targetDir: string): string {
  return "Repo-local state: " + legacyDir + " -> " + targetDir;
}

type MergeCopyResult = {
  ok: boolean;
};

function readDirForMergeCopy(dir: string, warnings: string[]): fs.Dirent[] | null {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    warnings.push(
      "Failed to read legacy state dir during repo-local migration: " + dir + ": " + String(err),
    );
    return null;
  }
}

function cleanupMergeCopyArtifacts(paths: string[], warnings: string[]) {
  if (paths.length === 0) return;
  const unique = Array.from(new Set(paths)).sort((a, b) => b.length - a.length);
  for (const target of unique) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (err) {
      warnings.push("Failed cleaning repo-local migration artifact " + target + ": " + String(err));
    }
  }
}

function mergeCopyDir(params: {
  from: string;
  to: string;
  changes: string[];
  warnings: string[];
  prefix?: string;
  created: string[];
  recordCreation?: boolean;
}): MergeCopyResult {
  const { from, to, changes, warnings, created } = params;
  const recordCreation = params.recordCreation ?? true;
  const hadDir = existsDir(to);
  ensureDir(to);
  if (!hadDir && recordCreation) {
    created.push(to);
  }
  const entries = readDirForMergeCopy(from, warnings);
  if (!entries) return { ok: false };
  let ok = true;
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (fs.existsSync(dst)) continue;
    try {
      if (entry.isDirectory()) {
        const result = mergeCopyDir({
          from: src,
          to: dst,
          changes,
          warnings,
          prefix: params.prefix,
          created,
        });
        if (!result.ok) {
          ok = false;
        }
        continue;
      }
      if (entry.isFile()) {
        fs.copyFileSync(src, dst);
        created.push(dst);
        continue;
      }
      if (entry.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(src);
        fs.symlinkSync(linkTarget, dst);
        created.push(dst);
        continue;
      }
    } catch (err) {
      warnings.push("Failed copying " + src + " -> " + dst + ": " + String(err));
    }
  }
  return { ok };
}

/**
 * Move home state into a repo-local `.unmask/` directory when repo-local state is enabled.
 *
 * This is designed for local development where you want a repo to be self-contained and
 * avoid per-machine home-directory state drift (for example, `~/.unmaskbot/`).
 */
export async function autoMigrateLegacyRepoStateDir(params: {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  cwd?: () => string;
  log?: MigrationLogger;
  now?: () => number;
}): Promise<StateDirMigrationResult> {
  if (autoMigrateRepoStateDirChecked) {
    return { migrated: false, skipped: true, changes: [], warnings: [] };
  }
  autoMigrateRepoStateDirChecked = true;

  const env = params.env ?? process.env;
  const homedir = params.homedir ?? os.homedir;
  const cwd = params.cwd ?? process.cwd;
  const now = params.now ?? (() => Date.now());

  // Only migrate when the active state dir is repo-local `.unmask/`.
  const targetDir = resolveStateDir(env, homedir, cwd);
  const resolvedTargetDir = path.resolve(targetDir);
  if (path.basename(resolvedTargetDir) !== ".unmask") {
    return { migrated: false, skipped: true, changes: [], warnings: [] };
  }

  // If the repo state dir already has data, do not attempt automatic merges.
  if (!isEffectivelyEmptyRepoStateDir(targetDir)) {
    return { migrated: false, skipped: false, changes: [], warnings: [] };
  }

  // Respect explicit home state dir overrides; don't guess what to migrate from.
  if (
    env.UNMASKBOT_STATE_DIR?.trim() ||
    env.MOLTBOT_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim()
  ) {
    return { migrated: false, skipped: true, changes: [], warnings: [] };
  }

  const home = homedir();
  const legacyCandidates = [
    path.join(home, ".unmask"),
    path.join(home, ".unmaskbot"),
    path.join(home, ".moltbot"),
    path.join(home, ".clawdbot"),
    // In case callers use the previous "home state dir" resolution.
    resolveHomeStateDir(env, homedir),
  ]
    .map((p) => path.resolve(p))
    .filter((p, idx, arr) => arr.indexOf(p) === idx);

  const legacyDir = legacyCandidates.find(
    (candidate) =>
      candidate !== resolvedTargetDir && existsDir(candidate) && !isSymlinkPath(candidate),
  );
  if (!legacyDir) {
    return { migrated: false, skipped: false, changes: [], warnings: [] };
  }

  const changes: string[] = [];
  const warnings: string[] = [];

  // Merge-copy into the repo-local directory (best-effort, non-destructive).
  ensureDir(targetDir);
  const created: string[] = [];
  const copyResult = mergeCopyDir({
    from: legacyDir,
    to: targetDir,
    changes,
    warnings,
    created,
    recordCreation: false,
  });
  if (!copyResult.ok) {
    cleanupMergeCopyArtifacts(created, warnings);
    warnings.push(
      "Repo-local state migration skipped; failed to read legacy state dir: " + legacyDir,
    );
  } else {
    changes.push(formatRepoStateMigration(legacyDir, targetDir));

    // Symlink the legacy path to the repo-local path to reduce future split-brain state.
    // This is best-effort and leaves a backup on failure.
    const backupDir = legacyDir + ".legacy-" + String(now());
    try {
      fs.renameSync(legacyDir, backupDir);
      try {
        fs.symlinkSync(targetDir, legacyDir, "dir");
      } catch (err) {
        try {
          if (process.platform === "win32") {
            fs.symlinkSync(targetDir, legacyDir, "junction");
          } else {
            throw err;
          }
        } catch (fallbackErr) {
          warnings.push(
            "Repo-local state migrated, but failed to symlink " +
              legacyDir +
              " -> " +
              targetDir +
              ": " +
              String(fallbackErr),
          );
          warnings.push("Legacy state kept at: " + backupDir);
          return { migrated: true, skipped: false, changes, warnings };
        }
      }
      changes.push("Symlinked legacy state dir: " + legacyDir + " -> " + targetDir);
      warnings.push("Legacy state backup: " + backupDir);
    } catch (err) {
      warnings.push(
        "Repo-local state migrated (copied), but failed to relocate legacy dir: " + String(err),
      );
    }
  }

  const logger = params.log ?? createSubsystemLogger("state-migrations");
  if (changes.length > 0) {
    logger.info("Repo-local state migration:\n" + changes.map((e) => "- " + e).join("\n"));
  }
  if (warnings.length > 0) {
    logger.warn(
      "Repo-local state migration warnings:\n" + warnings.map((e) => "- " + e).join("\n"),
    );
  }

  return { migrated: copyResult.ok, skipped: false, changes, warnings };
}

function resolveSymlinkTarget(linkPath: string): string | null {
  try {
    const target = fs.readlinkSync(linkPath);
    return path.resolve(path.dirname(linkPath), target);
  } catch {
    return null;
  }
}

function formatStateDirMigration(legacyDir: string, targetDir: string): string {
  return "State dir: " + legacyDir + " -> " + targetDir + " (legacy path now symlinked)";
}

function isDirPath(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

export async function autoMigrateLegacyStateDir(params: {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  log?: MigrationLogger;
}): Promise<StateDirMigrationResult> {
  if (autoMigrateStateDirChecked) {
    return { migrated: false, skipped: true, changes: [], warnings: [] };
  }
  autoMigrateStateDirChecked = true;

  const env = params.env ?? process.env;
  if (env.MOLTBOT_STATE_DIR?.trim() || env.CLAWDBOT_STATE_DIR?.trim()) {
    return { migrated: false, skipped: true, changes: [], warnings: [] };
  }

  const homedir = params.homedir ?? os.homedir;
  const legacyDir = resolveLegacyStateDir(homedir);
  const targetDir = resolveNewStateDir(homedir);
  const warnings: string[] = [];
  const changes: string[] = [];

  let legacyStat: fs.Stats | null = null;
  try {
    legacyStat = fs.lstatSync(legacyDir);
  } catch {
    legacyStat = null;
  }
  if (!legacyStat) {
    return { migrated: false, skipped: false, changes, warnings };
  }
  if (!legacyStat.isDirectory() && !legacyStat.isSymbolicLink()) {
    warnings.push(`Legacy state path is not a directory: ${legacyDir}`);
    return { migrated: false, skipped: false, changes, warnings };
  }

  if (legacyStat.isSymbolicLink()) {
    const legacyTarget = resolveSymlinkTarget(legacyDir);
    if (legacyTarget && path.resolve(legacyTarget) === path.resolve(targetDir)) {
      return { migrated: false, skipped: false, changes, warnings };
    }
    warnings.push(
      `Legacy state dir is a symlink (${legacyDir} → ${legacyTarget ?? "unknown"}); skipping auto-migration.`,
    );
    return { migrated: false, skipped: false, changes, warnings };
  }

  if (isDirPath(targetDir)) {
    warnings.push(
      `State dir migration skipped: target already exists (${targetDir}). Remove or merge manually.`,
    );
    return { migrated: false, skipped: false, changes, warnings };
  }

  try {
    fs.renameSync(legacyDir, targetDir);
  } catch (err) {
    warnings.push(`Failed to move legacy state dir (${legacyDir} → ${targetDir}): ${String(err)}`);
    return { migrated: false, skipped: false, changes, warnings };
  }

  try {
    fs.symlinkSync(targetDir, legacyDir, "dir");
    changes.push(formatStateDirMigration(legacyDir, targetDir));
  } catch (err) {
    try {
      if (process.platform === "win32") {
        fs.symlinkSync(targetDir, legacyDir, "junction");
        changes.push(formatStateDirMigration(legacyDir, targetDir));
      } else {
        throw err;
      }
    } catch (fallbackErr) {
      try {
        fs.renameSync(targetDir, legacyDir);
        warnings.push(
          `State dir migration rolled back (failed to link legacy path): ${String(fallbackErr)}`,
        );
        return { migrated: false, skipped: false, changes: [], warnings };
      } catch (rollbackErr) {
        warnings.push(
          `State dir moved but failed to link legacy path (${legacyDir} → ${targetDir}): ${String(fallbackErr)}`,
        );
        warnings.push(
          `Rollback failed; set UNMASKBOT_STATE_DIR=${targetDir} to avoid split state: ${String(rollbackErr)}`,
        );
        changes.push(`State dir: ${legacyDir} → ${targetDir}`);
      }
    }
  }

  return { migrated: changes.length > 0, skipped: false, changes, warnings };
}

export async function detectLegacyStateMigrations(params: {
  cfg: MoltbotConfig;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}): Promise<LegacyStateDetection> {
  const env = params.env ?? process.env;
  const homedir = params.homedir ?? os.homedir;
  const stateDir = resolveStateDir(env, homedir);
  const oauthDir = resolveOAuthDir(env, stateDir);

  const targetAgentId = normalizeAgentId(resolveDefaultAgentId(params.cfg));
  const rawMainKey = params.cfg.session?.mainKey;
  const targetMainKey =
    typeof rawMainKey === "string" && rawMainKey.trim().length > 0
      ? rawMainKey.trim()
      : DEFAULT_MAIN_KEY;
  const targetScope = params.cfg.session?.scope;

  const sessionsLegacyDir = path.join(stateDir, "sessions");
  const sessionsLegacyStorePath = path.join(sessionsLegacyDir, "sessions.json");
  const sessionsTargetDir = path.join(stateDir, "agents", targetAgentId, "sessions");
  const sessionsTargetStorePath = path.join(sessionsTargetDir, "sessions.json");
  const legacySessionEntries = safeReadDir(sessionsLegacyDir);
  const hasLegacySessions =
    fileExists(sessionsLegacyStorePath) ||
    legacySessionEntries.some((e) => e.isFile() && e.name.endsWith(".jsonl"));

  const targetSessionParsed = fileExists(sessionsTargetStorePath)
    ? readSessionStoreJson5(sessionsTargetStorePath)
    : { store: {}, ok: true };
  const legacyKeys = targetSessionParsed.ok
    ? listLegacySessionKeys({
        store: targetSessionParsed.store,
        agentId: targetAgentId,
        mainKey: targetMainKey,
        scope: targetScope,
      })
    : [];

  const legacyAgentDir = path.join(stateDir, "agent");
  const targetAgentDir = path.join(stateDir, "agents", targetAgentId, "agent");
  const hasLegacyAgentDir = existsDir(legacyAgentDir);

  const targetWhatsAppAuthDir = path.join(oauthDir, "whatsapp", DEFAULT_ACCOUNT_ID);
  const hasLegacyWhatsAppAuth =
    fileExists(path.join(oauthDir, "creds.json")) &&
    !fileExists(path.join(targetWhatsAppAuthDir, "creds.json"));

  const preview: string[] = [];
  if (hasLegacySessions) {
    preview.push(`- Sessions: ${sessionsLegacyDir} → ${sessionsTargetDir}`);
  }
  if (legacyKeys.length > 0) {
    preview.push(`- Sessions: canonicalize legacy keys in ${sessionsTargetStorePath}`);
  }
  if (hasLegacyAgentDir) {
    preview.push(`- Agent dir: ${legacyAgentDir} → ${targetAgentDir}`);
  }
  if (hasLegacyWhatsAppAuth) {
    preview.push(`- WhatsApp auth: ${oauthDir} → ${targetWhatsAppAuthDir} (keep oauth.json)`);
  }

  return {
    targetAgentId,
    targetMainKey,
    targetScope,
    stateDir,
    oauthDir,
    sessions: {
      legacyDir: sessionsLegacyDir,
      legacyStorePath: sessionsLegacyStorePath,
      targetDir: sessionsTargetDir,
      targetStorePath: sessionsTargetStorePath,
      hasLegacy: hasLegacySessions || legacyKeys.length > 0,
      legacyKeys,
    },
    agentDir: {
      legacyDir: legacyAgentDir,
      targetDir: targetAgentDir,
      hasLegacy: hasLegacyAgentDir,
    },
    whatsappAuth: {
      legacyDir: oauthDir,
      targetDir: targetWhatsAppAuthDir,
      hasLegacy: hasLegacyWhatsAppAuth,
    },
    preview,
  };
}

async function migrateLegacySessions(
  detected: LegacyStateDetection,
  now: () => number,
): Promise<{ changes: string[]; warnings: string[] }> {
  const changes: string[] = [];
  const warnings: string[] = [];
  if (!detected.sessions.hasLegacy) return { changes, warnings };

  ensureDir(detected.sessions.targetDir);

  const legacyParsed = fileExists(detected.sessions.legacyStorePath)
    ? readSessionStoreJson5(detected.sessions.legacyStorePath)
    : { store: {}, ok: true };
  const targetParsed = fileExists(detected.sessions.targetStorePath)
    ? readSessionStoreJson5(detected.sessions.targetStorePath)
    : { store: {}, ok: true };
  const legacyStore = legacyParsed.store;
  const targetStore = targetParsed.store;

  const canonicalizedTarget = canonicalizeSessionStore({
    store: targetStore,
    agentId: detected.targetAgentId,
    mainKey: detected.targetMainKey,
    scope: detected.targetScope,
  });
  const canonicalizedLegacy = canonicalizeSessionStore({
    store: legacyStore,
    agentId: detected.targetAgentId,
    mainKey: detected.targetMainKey,
    scope: detected.targetScope,
  });

  const merged: Record<string, SessionEntryLike> = { ...canonicalizedTarget.store };
  for (const [key, entry] of Object.entries(canonicalizedLegacy.store)) {
    merged[key] = mergeSessionEntry({
      existing: merged[key],
      incoming: entry,
      preferIncomingOnTie: false,
    });
  }

  const mainKey = buildAgentMainSessionKey({
    agentId: detected.targetAgentId,
    mainKey: detected.targetMainKey,
  });
  if (!merged[mainKey]) {
    const latest = pickLatestLegacyDirectEntry(legacyStore);
    if (latest?.sessionId) {
      merged[mainKey] = latest;
      changes.push(`Migrated latest direct-chat session → ${mainKey}`);
    }
  }

  if (!legacyParsed.ok) {
    warnings.push(
      `Legacy sessions store unreadable; left in place at ${detected.sessions.legacyStorePath}`,
    );
  }

  if (
    (legacyParsed.ok || targetParsed.ok) &&
    (Object.keys(legacyStore).length > 0 || Object.keys(targetStore).length > 0)
  ) {
    const normalized: Record<string, SessionEntry> = {};
    for (const [key, entry] of Object.entries(merged)) {
      const normalizedEntry = normalizeSessionEntry(entry);
      if (!normalizedEntry) continue;
      normalized[key] = normalizedEntry;
    }
    await saveSessionStore(detected.sessions.targetStorePath, normalized);
    changes.push(`Merged sessions store → ${detected.sessions.targetStorePath}`);
    if (canonicalizedTarget.legacyKeys.length > 0) {
      changes.push(`Canonicalized ${canonicalizedTarget.legacyKeys.length} legacy session key(s)`);
    }
  }

  const entries = safeReadDir(detected.sessions.legacyDir);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === "sessions.json") continue;
    const from = path.join(detected.sessions.legacyDir, entry.name);
    const to = path.join(detected.sessions.targetDir, entry.name);
    if (fileExists(to)) continue;
    try {
      fs.renameSync(from, to);
      changes.push(`Moved ${entry.name} → agents/${detected.targetAgentId}/sessions`);
    } catch (err) {
      warnings.push(`Failed moving ${from}: ${String(err)}`);
    }
  }

  if (legacyParsed.ok) {
    try {
      if (fileExists(detected.sessions.legacyStorePath)) {
        fs.rmSync(detected.sessions.legacyStorePath, { force: true });
      }
    } catch {
      // ignore
    }
  }

  removeDirIfEmpty(detected.sessions.legacyDir);
  const legacyLeft = safeReadDir(detected.sessions.legacyDir).filter((e) => e.isFile());
  if (legacyLeft.length > 0) {
    const backupDir = `${detected.sessions.legacyDir}.legacy-${now()}`;
    try {
      fs.renameSync(detected.sessions.legacyDir, backupDir);
      warnings.push(`Left legacy sessions at ${backupDir}`);
    } catch {
      // ignore
    }
  }

  return { changes, warnings };
}

export async function migrateLegacyAgentDir(
  detected: LegacyStateDetection,
  now: () => number,
): Promise<{ changes: string[]; warnings: string[] }> {
  const changes: string[] = [];
  const warnings: string[] = [];
  if (!detected.agentDir.hasLegacy) return { changes, warnings };

  ensureDir(detected.agentDir.targetDir);

  const entries = safeReadDir(detected.agentDir.legacyDir);
  for (const entry of entries) {
    const from = path.join(detected.agentDir.legacyDir, entry.name);
    const to = path.join(detected.agentDir.targetDir, entry.name);
    if (fs.existsSync(to)) continue;
    try {
      fs.renameSync(from, to);
      changes.push(`Moved agent file ${entry.name} → agents/${detected.targetAgentId}/agent`);
    } catch (err) {
      warnings.push(`Failed moving ${from}: ${String(err)}`);
    }
  }

  removeDirIfEmpty(detected.agentDir.legacyDir);
  if (!emptyDirOrMissing(detected.agentDir.legacyDir)) {
    const backupDir = path.join(
      detected.stateDir,
      "agents",
      detected.targetAgentId,
      `agent.legacy-${now()}`,
    );
    try {
      fs.renameSync(detected.agentDir.legacyDir, backupDir);
      warnings.push(`Left legacy agent dir at ${backupDir}`);
    } catch (err) {
      warnings.push(`Failed relocating legacy agent dir: ${String(err)}`);
    }
  }

  return { changes, warnings };
}

async function migrateLegacyWhatsAppAuth(
  detected: LegacyStateDetection,
): Promise<{ changes: string[]; warnings: string[] }> {
  const changes: string[] = [];
  const warnings: string[] = [];
  if (!detected.whatsappAuth.hasLegacy) return { changes, warnings };

  ensureDir(detected.whatsappAuth.targetDir);

  const entries = safeReadDir(detected.whatsappAuth.legacyDir);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === "oauth.json") continue;
    if (!isLegacyWhatsAppAuthFile(entry.name)) continue;
    const from = path.join(detected.whatsappAuth.legacyDir, entry.name);
    const to = path.join(detected.whatsappAuth.targetDir, entry.name);
    if (fileExists(to)) continue;
    try {
      fs.renameSync(from, to);
      changes.push(`Moved WhatsApp auth ${entry.name} → whatsapp/default`);
    } catch (err) {
      warnings.push(`Failed moving ${from}: ${String(err)}`);
    }
  }

  return { changes, warnings };
}

export async function runLegacyStateMigrations(params: {
  detected: LegacyStateDetection;
  now?: () => number;
}): Promise<{ changes: string[]; warnings: string[] }> {
  const now = params.now ?? (() => Date.now());
  const detected = params.detected;
  const sessions = await migrateLegacySessions(detected, now);
  const agentDir = await migrateLegacyAgentDir(detected, now);
  const whatsappAuth = await migrateLegacyWhatsAppAuth(detected);
  return {
    changes: [...sessions.changes, ...agentDir.changes, ...whatsappAuth.changes],
    warnings: [...sessions.warnings, ...agentDir.warnings, ...whatsappAuth.warnings],
  };
}

export async function autoMigrateLegacyAgentDir(params: {
  cfg: MoltbotConfig;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  log?: MigrationLogger;
  now?: () => number;
}): Promise<{
  migrated: boolean;
  skipped: boolean;
  changes: string[];
  warnings: string[];
}> {
  return await autoMigrateLegacyState(params);
}

export async function autoMigrateLegacyState(params: {
  cfg: MoltbotConfig;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  log?: MigrationLogger;
  now?: () => number;
}): Promise<{
  migrated: boolean;
  skipped: boolean;
  changes: string[];
  warnings: string[];
}> {
  if (autoMigrateChecked) {
    return { migrated: false, skipped: true, changes: [], warnings: [] };
  }
  autoMigrateChecked = true;

  const env = params.env ?? process.env;
  const stateDirResult = await autoMigrateLegacyStateDir({
    env,
    homedir: params.homedir,
    log: params.log,
  });
  if (env.CLAWDBOT_AGENT_DIR?.trim() || env.PI_CODING_AGENT_DIR?.trim()) {
    return {
      migrated: stateDirResult.migrated,
      skipped: true,
      changes: stateDirResult.changes,
      warnings: stateDirResult.warnings,
    };
  }

  const detected = await detectLegacyStateMigrations({
    cfg: params.cfg,
    env,
    homedir: params.homedir,
  });
  if (!detected.sessions.hasLegacy && !detected.agentDir.hasLegacy) {
    return {
      migrated: stateDirResult.migrated,
      skipped: false,
      changes: stateDirResult.changes,
      warnings: stateDirResult.warnings,
    };
  }

  const now = params.now ?? (() => Date.now());
  const sessions = await migrateLegacySessions(detected, now);
  const agentDir = await migrateLegacyAgentDir(detected, now);
  const changes = [...stateDirResult.changes, ...sessions.changes, ...agentDir.changes];
  const warnings = [...stateDirResult.warnings, ...sessions.warnings, ...agentDir.warnings];

  const logger = params.log ?? createSubsystemLogger("state-migrations");
  if (changes.length > 0) {
    logger.info(`Auto-migrated legacy state:\n${changes.map((entry) => `- ${entry}`).join("\n")}`);
  }
  if (warnings.length > 0) {
    logger.warn(
      `Legacy state migration warnings:\n${warnings.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }

  return {
    migrated: changes.length > 0,
    skipped: false,
    changes,
    warnings,
  };
}
