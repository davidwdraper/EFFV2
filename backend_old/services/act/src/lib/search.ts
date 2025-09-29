// backend/services/act/src/lib/search.ts
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const nameRegex = (q: string) => {
  const tokens = q.trim().split(/\s+/).filter(Boolean).map(escapeRe);
  if (!tokens.length) return null;
  return new RegExp("^" + tokens.join(".*\\s*"), "i");
};

export const milesToRadians = (miles: number) => miles / 3963.2;
