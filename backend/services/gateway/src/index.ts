// backend/services/gateway/src/index.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
 *
 * Purpose:
 * - Bootstrap: load envs, warm SvcConfig mirror (DB → .LKG), then start HTTP.
 */

import http from "http";
import { resolve } from "path";
import { config as loadEnv } from "dotenv";
import { GatewayApp } from "./app";
import { requireEnv, requireNumber } from "@nv/shared";
import { getSvcConfig } from "./services/svcconfig";

// Load env files (no CLI helpers)
loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), ".env.dev"), override: true });

class GatewayServer {
  private readonly port: number;

  constructor() {
    const portStr = requireEnv("PORT");
    this.port = requireNumber("PORT", portStr);
  }

  public async start(): Promise<void> {
    // 1️⃣ Warm the service-config mirror before accepting traffic.
    await getSvcConfig().load();

    // 2️⃣ Start HTTP server.
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

// Kick off boot sequence and catch startup errors loudly.
new GatewayServer().start().catch((err) => {
  console.error(
    JSON.stringify({
      level: 50,
      service: "gateway",
      msg: "boot_failed",
      err: String(err),
    })
  );
  process.exit(1);
});
