"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.limitArraySize = limitArraySize;
function limitArraySize(max) {
    return (val) => Array.isArray(val) && val.length <= max;
}
