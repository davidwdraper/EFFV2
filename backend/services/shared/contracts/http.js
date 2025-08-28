"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.respond = respond;
exports.zodBadRequest = zodBadRequest;
/**
 * Canonical JSON responder. Always use this so responses are uniform & testable.
 */
function respond(res, status, body) {
    res.status(status).json(body);
}
/**
 * Zod → 400 Problem response.
 * - Uses ZodError.issues (correct property) and flatten() for deterministic tests.
 */
function zodBadRequest(res, err, requestId) {
    const p = {
        code: "BAD_REQUEST",
        message: "Invalid request body or parameters.",
        status: 400,
        requestId,
        details: {
            issues: err.issues, // <-- correct for Zod v3
            flatten: err.flatten?.(), // { fieldErrors, formErrors }
        },
    };
    respond(res, 400, p);
}
