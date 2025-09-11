// backend/services/shared/utils/normalizeActName.ts
import { remove as removeDiacritics } from "diacritics";

/**
 * Normalize an Act's name for uniqueness and de-duping.
 *
 * Steps:
 *  1. Lowercase and strip diacritics (Beyoncé → beyonce).
 *  2. Remove punctuation (keep letters/numbers/spaces).
 *  3. Collapse whitespace.
 *  4. Remove common filler words: "the", "a", "an", "band", etc.
 *  5. Return normalized string (used for DB uniqueness).
 */

// Default stopwords for act names
const DEFAULT_STOPWORDS = [
  "the",
  "a",
  "an",
  "band",
  "duo",
  "trio",
  "troupe",
  "quartet",
  "quintet",
  "group",
  "project",
  "music",
  "musical",
  "and",
  "&",
];

function loadStopwords(): Set<string> {
  const extra = (process.env.ACT_NAME_STOPWORDS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_STOPWORDS, ...extra]);
}

const STOPWORDS = loadStopwords();

export function normalizeActName(input: string): string {
  if (!input) return "";

  // 1) lowercase + remove diacritics
  let s = removeDiacritics(input.toLowerCase());

  // 2) strip punctuation except spaces/digits/letters
  s = s.replace(/[^a-z0-9\s]/g, " ");

  // 3) collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  if (!s) return "";

  // 4) remove stopwords
  const tokens = s.split(" ").filter((tok) => tok && !STOPWORDS.has(tok));

  // fallback if everything got stripped
  if (tokens.length === 0) return s;

  return tokens.join(" ");
}
