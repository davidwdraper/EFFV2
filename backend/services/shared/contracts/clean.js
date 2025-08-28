"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clean = clean;
// backend/services/shared/contracts/clean.ts
function clean(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined)
            out[k] = v;
    }
    return out;
}
