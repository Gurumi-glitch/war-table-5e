/* Runtime API polyfills for old embedded browsers (the TTS in-game tablet).
 * The es2015 build target (vite.config.ts) only transpiles SYNTAX — missing
 * built-in APIs still throw at runtime. react-markdown's render path calls:
 * - Object.hasOwn (Chrome 93+) — UNGUARDED, was black-screening the app when
 *   a card with 職業特殊規則 text opened (Markdown preview renders on open)
 * - structuredClone (Chrome 98+) — guarded in at least one call site, but
 *   polyfilled anyway so no other usage can bite
 * MUST be the first import in main.tsx so it runs before any module that
 * might call these at module scope. */

if (typeof (Object as any).hasOwn !== "function") {
  (Object as any).hasOwn = (o: object, k: PropertyKey) =>
    Object.prototype.hasOwnProperty.call(o, k);
}

if (typeof (globalThis as any).structuredClone !== "function") {
  // Covers what an mdast/hast tree needs: plain objects, arrays, Date/RegExp/
  // Map/Set, primitives, and cycles. Not the full spec (no transferables) —
  // fine for the markdown chain this exists for.
  const clone = (v: unknown, seen: Map<object, unknown>): unknown => {
    if (v === null || typeof v !== "object") return v;
    const hit = seen.get(v as object);
    if (hit !== undefined) return hit;
    if (v instanceof Date) return new Date(v.getTime());
    if (v instanceof RegExp) return new RegExp(v.source, v.flags);
    if (v instanceof Map) {
      const m = new Map();
      seen.set(v, m);
      v.forEach((val, key) => m.set(clone(key, seen), clone(val, seen)));
      return m;
    }
    if (v instanceof Set) {
      const s = new Set();
      seen.set(v, s);
      v.forEach((val) => s.add(clone(val, seen)));
      return s;
    }
    if (Array.isArray(v)) {
      const a: unknown[] = [];
      seen.set(v, a);
      for (const item of v) a.push(clone(item, seen));
      return a;
    }
    const o: Record<string, unknown> = {};
    seen.set(v as object, o);
    for (const key of Object.keys(v as object)) {
      o[key] = clone((v as Record<string, unknown>)[key], seen);
    }
    return o;
  };
  (globalThis as any).structuredClone = (v: unknown) => clone(v, new Map());
}

export {};
