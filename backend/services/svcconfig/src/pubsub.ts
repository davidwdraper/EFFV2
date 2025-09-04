// backend/services/svcconfig/src/pubsub.ts
import { createClient } from "redis";
import { logger } from "@shared/utils/logger";
import { SERVICE_NAME, config } from "./config";

let client: ReturnType<typeof createClient> | null = null;
let connecting = false;

async function getClient() {
  const disabled =
    String(config.pubsub.redisDisabled ?? "").toLowerCase() === "true";
  if (disabled) return null;
  if (client) return client;
  if (connecting) return client;
  try {
    connecting = true;
    client = createClient({ url: config.pubsub.redisUrl });
    client.on("error", (err) =>
      logger.warn({ err }, `[${SERVICE_NAME}] redis error`)
    );
    await client.connect();
    logger.debug({}, `[${SERVICE_NAME}] redis connected`);
    return client;
  } finally {
    connecting = false;
  }
}

export async function publishChanged(payload: {
  slug: string | null;
  version: number;
}) {
  try {
    const c = await getClient();
    if (!c) return;
    const channel = config.pubsub.channel || "svcconfig:changed";
    await c.publish(channel, JSON.stringify(payload));
  } catch (err: any) {
    // Non-fatal: log and move on
    logger.warn(
      { err: err?.message || String(err) },
      `[${SERVICE_NAME}] publishChanged failed`
    );
  }
}
