"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.entryExit = entryExit;
function entryExit() {
    return (req, res, next) => {
        const start = process.hrtime.bigint();
        req.log.info({
            msg: "handler:start",
            method: req.method,
            url: req.originalUrl,
            params: req.params,
            query: req.query,
        }, "request entry");
        res.on("finish", () => {
            const ms = Number(process.hrtime.bigint() - start) / 1e6;
            req.log.info({
                msg: "handler:finish",
                statusCode: res.statusCode,
                durationMs: Math.round(ms),
            }, "request exit");
        });
        next();
    };
}
