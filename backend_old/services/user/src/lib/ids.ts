// backend/services/user/src/lib/ids.ts
import { isValidId } from "../repo/userRepo";

/** Split comma list, trim, dedupe */
export function parseIdList(raw: string): string[] {
  const uniq = Array.from(
    new Set(
      String(raw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
  return uniq;
}

/** Filter only valid Mongo ObjectIds (string form) */
export function filterValidObjectIds(ids: string[]): string[] {
  return ids.filter((id) => isValidId(id));
}
