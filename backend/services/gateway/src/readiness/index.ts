// backend/services/gateway/src/readiness/index.ts
import axios from "axios";
import type { ReadinessFn } from "../../../shared/src/health";
import { requireUpstreamByKey } from "../config";

const ACT_URL = requireUpstreamByKey("ACT_SERVICE_URL");

export const readiness: ReadinessFn = async (_req) => {
  try {
    const r = await axios.get(`${ACT_URL}/healthz`, {
      timeout: 1500,
      validateStatus: () => true,
    });
    return { upstreams: { act: { ok: r.status === 200, url: ACT_URL } } };
  } catch {
    return { upstreams: { act: { ok: false, url: ACT_URL } } };
  }
};
