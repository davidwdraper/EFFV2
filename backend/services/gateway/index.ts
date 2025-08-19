// backend/services/gateway/index.ts

import { app } from "./src/app";
import { PORT, SERVICE_NAME } from "./src/config";

async function start() {
  try {
    const server = app.listen(PORT, () => {
      console.log(`[${SERVICE_NAME}] listening on port ${PORT}`);
    });

    server.on("error", (err) => {
      console.error(`[${SERVICE_NAME}] server error:`, err);
      process.exit(1);
    });
  } catch (err) {
    console.error(`[${SERVICE_NAME}] failed to start:`, err);
    process.exit(1);
  }
}

start();
