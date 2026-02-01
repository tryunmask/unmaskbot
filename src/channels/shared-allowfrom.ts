export function filterAllowFromByPrefixes(params: {
  allowFrom?: Array<string | number>;
  prefixes: string[];
}): string[] {
  const raw = params.allowFrom ?? [];
  if (raw.length === 0) return [];
  const prefixes = params.prefixes.map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (prefixes.length === 0) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const text = String(entry).trim();
    if (!text) continue;
    if (text === "*") {
      out.push("*");
      continue;
    }
    const lower = text.toLowerCase();
    if (prefixes.some((p) => lower.startsWith(p))) {
      out.push(text);
    }
  }
  return out;
}
