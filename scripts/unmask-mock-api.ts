import http from "node:http";
import { URL } from "node:url";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

const port = Number(process.env.UNMASK_MOCK_PORT ?? 4010);
const requireAuth = process.env.UNMASK_MOCK_REQUIRE_AUTH === "true";
const expectedToken = process.env.UNMASK_API_TOKEN ?? "";

function sendJson(res: http.ServerResponse, status: number, payload: JsonValue) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req: http.IncomingMessage): Promise<JsonValue> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

function requireBearer(req: http.IncomingMessage): boolean {
  if (!requireAuth) return true;
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice("Bearer ".length).trim();
  if (!expectedToken) return true;
  return token === expectedToken;
}

function nowId(prefix: string) {
  return `${prefix}_${Date.now()}`;
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }
  if (!requireBearer(req)) {
    return sendJson(res, 401, { ok: false, error: "Unauthorized" });
  }

  const body = await readJson(req);
  const path = url.pathname;

  switch (path) {
    case "/v1/agents/should-respond":
      return sendJson(res, 200, {
        shouldRespond: true,
        reason: "mock default allow",
        source: "mock",
        received: body,
      });
    case "/v1/scout/referrals":
      return sendJson(res, 200, { id: nowId("referral"), status: "created", received: body });
    case "/v1/talent/onboard":
      return sendJson(res, 200, { id: nowId("talent"), status: "ok", received: body });
    case "/v1/talent/intro-request":
      return sendJson(res, 200, { id: nowId("intro"), status: "requested", received: body });
    case "/v1/company/intro-accept":
      return sendJson(res, 200, { status: "accepted", received: body });
    case "/v1/company/intro-decline":
      return sendJson(res, 200, { status: "declined", received: body });
    default:
      return sendJson(res, 404, { ok: false, error: "Not found", path });
  }
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Unmask mock API listening on http://localhost:${port}`);
});
