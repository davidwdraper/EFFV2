// backend/services/act/src/dto/townDto.ts
import type { TownDocument } from "../models/Town";

export function toTownListItem(t: Pick<TownDocument, any>) {
  return {
    id: String((t as any)._id),
    name: t.name,
    state: t.state,
    lat: (t as any).lat ?? null,
    lng: (t as any).lng ?? null,
  };
}

export function toTownTypeaheadItem(t: Pick<TownDocument, any>) {
  const label = `${t.name}, ${t.state}`;
  return {
    label,
    name: t.name,
    state: t.state,
    lat: (t as any).lat ?? null,
    lng: (t as any).lng ?? null,
    townId: String((t as any)._id),
  };
}
