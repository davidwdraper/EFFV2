// backend/services/shared/http/pagination.ts
export function makeList<T>(
  items: T[],
  limit: number,
  offset: number,
  total: number
) {
  return { total, limit, offset, items };
}
