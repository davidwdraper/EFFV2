"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startHttpService = startHttpService;
function startHttpService(opts) {
    const { app, port, serviceName, logger } = opts;
    const server = app.listen(port, () => {
        const addr = server.address();
        const boundPort = addr?.port ?? port;
        logger.info({ service: serviceName, port: boundPort }, "service listening");
    });
    server.on("error", (err) => {
        logger.error({ err, service: serviceName }, "http server error");
        process.exit(1);
    });
    const stop = () => new Promise((resolve) => {
        server.close(() => resolve());
    });
    const shutdown = (signal) => {
        logger.info({ signal, service: serviceName }, "shutting down service");
        void stop().then(() => process.exit(0));
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
    const addr = server.address();
    const boundPort = addr?.port ?? port;
    return { server, boundPort, stop };
}
