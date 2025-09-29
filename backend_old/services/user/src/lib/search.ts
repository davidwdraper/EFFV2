// backend/services/user/src/lib/search.ts
export const escapeRe = (s: string) =>
  String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Prefix, case-insensitive, built from a user token already trimmed/lowered */
export const prefixRe = (term: string) =>
  new RegExp("^" + escapeRe(String(term).toLowerCase().trim()));
