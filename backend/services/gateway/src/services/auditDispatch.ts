// backend/services/gateway/src/services/auditDispatch.ts
import type { AuditEvent, DispatchResult } from "../types/audit";
import { logger as sharedLogger } from "@shared/utils/logger";
import { putInternalJson } from "../utils/s2sClient"; // the ONLY place gateway does HTTP
import { getServiceBaseUrl } from "../utils/serviceResolver"; // must exist in your gateway

const logger = sharedLogger.child({ svc: "gateway", mod: "auditDispatch" });

const TARGET_SLUG = process.env.AUDIT_TARGET_SLUG || "event";
const TARGET_COLLECTION = process.env.AUDIT_TARGET_COLLECTION || "events"; // /api/event/events

export async function sendBatch(events: AuditEvent[]): Promise<DispatchResult> {
  if (!events.length) return { ok: true, delivered: 0, retriable: false };

  try {
    const baseUrl = await getServiceBaseUrl(TARGET_SLUG);
    const url = `${baseUrl}/api/${TARGET_SLUG}/${TARGET_COLLECTION}`;
    const { status } = await putInternalJson(url, events, {
      "x-request-id": events[0]?.requestId || "",
      "x-s2s-caller": "gateway",
    });

    const ok = status >= 200 && status < 300;
    if (ok) {
      logger.debug({ delivered: events.length }, "audit batch delivered");
      return { ok: true, delivered: events.length, retriable: false, status };
    }
    const retriable = status >= 500 || status === 429;
    return {
      ok: false,
      delivered: 0,
      retriable,
      status,
      error: `status ${status}`,
    };
  } catch (error: any) {
    return { ok: false, delivered: 0, retriable: true, error };
  }
}
