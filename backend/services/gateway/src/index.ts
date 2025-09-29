// backend/services/gateway/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
 *
 * Purpose:
 * - Process bootstrap: read env (.env then .env.dev), build app, start HTTP listener (fail-fast).
 */

import http from "http";
import { resolve } from "path";
import { config as loadEnv } from "dotenv";
import { GatewayApp } from "./app";

// Load env files without relying on CLI helpers.
// 1) Base .env (if present)
// 2) .env.dev overrides (if present)
loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), ".env.dev"), override: true });

class GatewayServer {
  private readonly port: number;

  constructor() {
    const raw = process.env.PORT;
    if (!raw || !/^\d+$/.test(raw)) {
      throw new Error("Missing or invalid PORT env var");
    }
    this.port = Number(raw);
  }

  public start(): void {
    const app = new GatewayApp().instance;
    const server = http.createServer(app);

    server.listen(this.port, "0.0.0.0", () => {
      console.log(
        JSON.stringify({
          level: 30,
          service: "gateway",
          msg: "listening",
          port: this.port,
        })
      );
    });

    server.on("error", (err) => {
      console.error(
        JSON.stringify({
          level: 50,
          service: "gateway",
          msg: "server_error",
          err: String(err),
        })
      );
      process.exitCode = 1;
    });
  }
}

new GatewayServer().start();
