"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newId = newId;
const uuid_1 = require("uuid");
function newId() {
    return (0, uuid_1.v4)();
}
