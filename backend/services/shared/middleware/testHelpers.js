"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addTestOnlyHelpers = addTestOnlyHelpers;
function addTestOnlyHelpers(app, basePaths) {
    if (process.env.NODE_ENV !== "test")
        return;
    const triggerNonFinite = (_req, _res, next) => {
        const err = new Error("nonfinite status test");
        err.status = "not-a-number";
        next(err);
    };
    // Base paths and aliases (/, /service, /<entity>)
    app.get("/__err-nonfinite", triggerNonFinite);
    app.get("/__error/nonfinite", triggerNonFinite);
    for (const p of basePaths) {
        app.get(`${p}/__err-nonfinite`, triggerNonFinite);
        app.get(`${p}/__error/nonfinite`, triggerNonFinite);
        const doAuditFlush = (req, res) => {
            req.audit?.push({ type: "TEST_AUDIT", note: "flush" });
            res.status(204).send();
        };
        app.post("/__audit", doAuditFlush);
        app.post("/__audit-flush", doAuditFlush);
        app.post("/__audit/flush", doAuditFlush);
        app.post(`${p}/__audit`, doAuditFlush);
        app.post(`${p}/__audit-flush`, doAuditFlush);
        app.post(`${p}/__audit/flush`, doAuditFlush);
    }
}
