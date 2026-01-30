import type { MoltbotPluginApi } from "../../src/plugins/types.js";

import { createUnmaskTools } from "./src/tools.js";

export default function register(api: MoltbotPluginApi) {
  api.registerTool((ctx) => createUnmaskTools(api, ctx), { optional: true });
}
