// backend/services/user/src/dto/userDto.ts
import { Types } from "mongoose";
import { clean } from "@shared/contracts";

const isOid = (v: unknown): v is Types.ObjectId =>
  !!v && typeof v === "object" && v instanceof Types.ObjectId;
const isDate = (v: unknown): v is Date =>
  Object.prototype.toString.call(v) === "[object Date]";

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

/** Public-facing user DTO (no password) */
export function toUserDto(doc: any) {
  const w = toWire(doc) || {};
  // sanitize: strip password, __v, etc., ensure "id" field present
  const { password, __v, _id, ...rest } = doc?.toObject
    ? doc.toObject()
    : doc || {};
  return clean({ id: String(doc?._id ?? _id), ...rest });
}

/** Internal auth DTO (includes password hash) */
export function toUserWithPasswordDto(doc: any) {
  const w = doc?.toObject ? doc.toObject() : doc || {};
  return clean({
    id: String(doc?._id),
    email: w.email,
    password: w.password,
    firstname: w.firstname,
    middlename: w.middlename,
    lastname: w.lastname,
    userStatus: w.userStatus,
    userType: w.userType,
  });
}
