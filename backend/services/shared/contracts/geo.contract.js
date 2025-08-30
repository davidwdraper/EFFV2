"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zGeoResponse = exports.zGeoRequest = void 0;
// backend/services/shared/contracts/geo.contract.ts
const zod_1 = require("zod");
// ── Canonical Geo contract ───────────────────────────────────────────────────
exports.zGeoRequest = zod_1.z.object({
    address: zod_1.z.string().min(3),
});
exports.zGeoResponse = zod_1.z.object({
    lat: zod_1.z.number(),
    lng: zod_1.z.number(),
    provider: zod_1.z.literal("google"),
});
