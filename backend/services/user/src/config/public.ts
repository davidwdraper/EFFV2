// backend/services/user/src/config/public.ts
// Optional cap; not required in bootstrap.
// Falls back to an internal sane default if missing/invalid.
const INTERNAL_DEFAULT_MAX = 200;

export const NAME_LOOKUP_MAX_IDS = (() => {
  const raw = process.env.USER_NAME_LOOKUP_MAX_IDS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : INTERNAL_DEFAULT_MAX;
})();
