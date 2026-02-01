import { describe, expect, it } from "vitest";

import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "unmaskbot", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "unmaskbot", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "unmaskbot", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "unmaskbot", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "unmaskbot", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "unmaskbot", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "unmaskbot", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "unmaskbot"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "unmaskbot", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "unmaskbot", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "unmaskbot", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "unmaskbot", "status", "--timeout=2500"], "--timeout")).toBe(
      "2500",
    );
    expect(getFlagValue(["node", "unmaskbot", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "unmaskbot", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "unmaskbot", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "unmaskbot", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "unmaskbot", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "unmaskbot", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "unmaskbot", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "unmaskbot", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "unmaskbot", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "unmaskbot", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "unmaskbot",
      rawArgs: ["node", "unmaskbot", "status"],
    });
    expect(nodeArgv).toEqual(["node", "unmaskbot", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "unmaskbot",
      rawArgs: ["node-22", "unmaskbot", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "unmaskbot", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "unmaskbot",
      rawArgs: ["node-22.2.0.exe", "unmaskbot", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "unmaskbot", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "unmaskbot",
      rawArgs: ["node-22.2", "unmaskbot", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "unmaskbot", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "unmaskbot",
      rawArgs: ["node-22.2.exe", "unmaskbot", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "unmaskbot", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "unmaskbot",
      rawArgs: ["/usr/bin/node-22.2.0", "unmaskbot", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "unmaskbot", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "unmaskbot",
      rawArgs: ["nodejs", "unmaskbot", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "unmaskbot", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "unmaskbot",
      rawArgs: ["node-dev", "unmaskbot", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "unmaskbot", "node-dev", "unmaskbot", "status"]);

    const directArgv = buildParseArgv({
      programName: "unmaskbot",
      rawArgs: ["unmaskbot", "status"],
    });
    expect(directArgv).toEqual(["node", "unmaskbot", "status"]);

    const bunArgv = buildParseArgv({
      programName: "unmaskbot",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "unmaskbot",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "unmaskbot", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "unmaskbot", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "unmaskbot", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "unmaskbot", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "unmaskbot", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "unmaskbot", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "unmaskbot", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "unmaskbot", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
