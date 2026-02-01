export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

export function jsonError(status: number, message: string): Response {
  return jsonResponse({ error: message }, status);
}

export async function readJson<T extends Record<string, unknown>>(
  request: Request,
): Promise<T | null> {
  try {
    const data = await request.json();
    if (!data || typeof data !== "object") return null;
    return data as T;
  } catch {
    return null;
  }
}
