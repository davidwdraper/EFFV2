// backend/services/user/src/lib/name.ts
/** Join name parts into a single display string (skips blanks). */
export function toFullName(
  first?: string,
  middle?: string,
  last?: string
): string {
  return [first, middle, last]
    .filter((p) => !!p && String(p).trim().length > 0)
    .join(" ");
}
