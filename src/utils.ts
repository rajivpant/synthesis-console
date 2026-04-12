import { basename } from "path";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitize a URL path segment to prevent directory traversal.
 * Returns null if the input contains path separators or is a special directory name.
 */
export function sanitizePathSegment(segment: string): string | null {
  const clean = basename(segment);
  if (clean !== segment || clean === ".." || clean === "." || clean === "") {
    return null;
  }
  return clean;
}
