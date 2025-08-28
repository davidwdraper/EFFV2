"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zValidationError = exports.badRequest = exports.notFound = void 0;
const clean_1 = require("../contracts/clean"); // ← concrete module, no barrels
const notFound = (res) => res
    .status(404)
    .type("application/problem+json")
    .json((0, clean_1.clean)({
    type: "about:blank",
    title: "Not Found",
    status: 404,
    code: "NOT_FOUND",
    detail: "Resource not found",
}));
exports.notFound = notFound;
const badRequest = (res, detail, extra) => res
    .status(400)
    .type("application/problem+json")
    .json((0, clean_1.clean)({
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    detail,
    ...extra,
}));
exports.badRequest = badRequest;
const zValidationError = (res, issues) => res
    .status(400)
    .type("application/problem+json")
    .json((0, clean_1.clean)({
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    code: "VALIDATION_ERROR",
    detail: "Validation failed",
    errors: issues,
}));
exports.zValidationError = zValidationError;
