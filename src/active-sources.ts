import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { ConsoleConfig, Source } from "./config.js";

const COOKIE_NAME = "sc_sources";

/**
 * Resolve which sources are currently active, in order of precedence:
 *   1. In demo mode, only sources flagged demo:true.
 *   2. Query param ?sources=a,b (for shareable URLs), if any names match.
 *   3. Cookie sc_sources=a,b, if any names match.
 *   4. Sources with default_active: true.
 *   5. Fall back to all non-demo sources (first-run, nothing configured).
 */
export function activeSources(c: Context, config: ConsoleConfig): Source[] {
  if (config.demoMode) {
    return config.sources.filter((s) => s.demo === true);
  }

  const queryValue = c.req.query("sources");
  if (queryValue !== undefined) {
    const names = queryValue.split(",").filter(Boolean);
    const resolved = resolveNames(config.sources, names);
    if (resolved.length > 0) return resolved;
  }

  const cookieValue = getCookie(c, COOKIE_NAME);
  if (cookieValue) {
    const names = cookieValue.split(",").filter(Boolean);
    const resolved = resolveNames(config.sources, names);
    if (resolved.length > 0) return resolved;
  }

  const defaults = config.sources.filter((s) => s.default_active === true);
  if (defaults.length > 0) return defaults;

  const nonDemo = config.sources.filter((s) => !s.demo);
  return nonDemo.length > 0 ? nonDemo : config.sources;
}

function resolveNames(sources: Source[], names: string[]): Source[] {
  const out: Source[] = [];
  for (const name of names) {
    const s = sources.find((x) => x.name === name);
    if (s) out.push(s);
  }
  return out;
}

export function activeSourceNames(c: Context, config: ConsoleConfig): string[] {
  return activeSources(c, config).map((s) => s.name);
}

export { COOKIE_NAME as SOURCES_COOKIE };
