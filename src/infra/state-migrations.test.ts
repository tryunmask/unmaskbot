import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  autoMigrateLegacyRepoStateDir,
  resetAutoMigrateRepoStateDirForTest,
} from "./state-migrations.js";

let tempRoot: string | null = null;

async function makeTempRoot() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "moltbot-state-migrate-"));
  tempRoot = root;
  return root;
}

afterEach(async () => {
  resetAutoMigrateRepoStateDirForTest();
  if (!tempRoot) return;
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("autoMigrateLegacyRepoStateDir", () => {
  it("skips when legacy candidate equals repo-local state dir", async () => {
    const root = await makeTempRoot();
    fs.mkdirSync(path.join(root, ".git"));
    const repoStateDir = path.join(root, ".unmask");
    fs.mkdirSync(repoStateDir, { recursive: true });

    const result = await autoMigrateLegacyRepoStateDir({
      env: {} as NodeJS.ProcessEnv,
      homedir: () => root,
      cwd: () => root,
      now: () => 123,
    });

    const stat = fs.lstatSync(repoStateDir);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(fs.existsSync(`${repoStateDir}.legacy-123`)).toBe(false);
    expect(result.migrated).toBe(false);
  });
});
