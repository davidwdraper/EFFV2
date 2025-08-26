// backend/services/act/src/dto/townDto.ts
import { Types } from "mongoose";
import { clean } from "@shared/contracts";

const isOid = (v: unknown): v is Types.ObjectId =>
  !!v && typeof v === "object" && v instanceof Types.ObjectId;
const isDate = (v: unknown): v is Date =>
  Object.prototype.toString.call(v) === "[object Date]";

/** Deep-normalize: ObjectId -> hex, Date -> ISO, arrays/objects recursively */
export function toWire<T>(val: T): any {
  if (val == null) return val;
  if (isOid(val)) return (val as Types.ObjectId).toHexString();
  if (isDate(val)) return (val as Date).toISOString();
  if (Array.isArray(val)) return val.map(toWire);
  if (typeof val === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = toWire(v);
    }
    return out;
  }
  return val;
}

export function toTownListItem(t: any) {
  return clean({
    id: toWire(t?._id),
    name: t?.name,
    state: t?.state,
    lat: t?.lat,
    lng: t?.lng,
  });
}

export function toTownTypeaheadItem(t: any) {
  return clean({
    label: `${t?.name}, ${t?.state}`,
    name: t?.name,
    state: t?.state,
    lat: t?.lat,
    lng: t?.lng,
    townId: toWire(t?._id),
  });
}
