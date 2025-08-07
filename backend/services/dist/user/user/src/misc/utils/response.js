"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSuccess = sendSuccess;
exports.sendError = sendError;
function sendSuccess(res, data) {
    return res.status(200).json({ success: true, data });
}
function sendError(res, message = 'Internal server error', status = 500) {
    return res.status(status).json({ success: false, error: message });
}
