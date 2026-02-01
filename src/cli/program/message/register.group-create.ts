import type { Command } from "commander";
import { collectOption } from "../helpers.js";
import type { MessageCliHelpers } from "./helpers.js";

export function registerMessageGroupCreateCommand(message: Command, helpers: MessageCliHelpers) {
  helpers
    .withMessageBase(message.command("group-create").description("Create a group chat"))
    .requiredOption("--subject <text>", "Group subject/name")
    .option(
      "--participant <id>",
      "Group participant id (repeatable)",
      collectOption,
      [] as string[],
    )
    .option("--participants <id>", "Alias for --participant", collectOption, [] as string[])
    .action(async (opts) => {
      const participant = [
        ...(Array.isArray(opts.participant) ? opts.participant : []),
        ...(Array.isArray(opts.participants) ? opts.participants : []),
      ];
      await helpers.runMessageAction("group-create", { ...opts, participant });
    });
}
