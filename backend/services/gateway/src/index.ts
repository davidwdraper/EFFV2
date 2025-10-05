// backend/services/gateway/src/index.ts
import { ServiceBase } from "@nv/shared/bootstrap/ServiceBase";
import { log } from "@nv/shared/util/Logger";
import { getLogger } from "@nv/shared/util/logger.provider";
import { GatewayApp } from "./app";
import { getSvcConfig } from "./services/svcconfig/SvcConfig"; // ← direct, no barrels

const svcName = (process.env.SVC_NAME || "").trim();
if (!svcName) {
  log
    .bind({ slug: "gateway", version: 1, url: "/startup" })
    .error("fatal_missing_env - SVC_NAME is required but not set");
  process.exit(1);
}

class Main extends ServiceBase {
  protected override async preStart(): Promise<void> {
    await getSvcConfig().load();
  }
  protected override buildApp() {
    return new GatewayApp().instance;
  }
}

new Main(svcName, { logVersion: 1 }).run().catch((err) => {
  const l = getLogger().bind({ slug: svcName, version: 1, url: "/main" });
  l.error(`boot_failed - ${String(err)}`);
  process.exit(1);
});
