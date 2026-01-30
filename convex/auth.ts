import { jsonError } from "./httpHelpers.js";

export function requireBearerAuth(request: Request): Response | null {
  const expected = process.env.UNMASK_API_TOKEN?.trim();
  if (!expected) {
    return jsonError(500, "UNMASK_API_TOKEN not configured");
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token || token !== expected) {
    return jsonError(401, "unauthorized");
  }
  return null;
}
