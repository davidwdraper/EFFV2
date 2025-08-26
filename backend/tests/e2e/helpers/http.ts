// /backend/tests/e2e/helpers/http.ts
import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
  AxiosRequestHeaders,
} from "axios";
import { z } from "zod";
import { expect } from "vitest";
import { zProblem } from "@shared/contracts/common";

const E2E_BEARER = process.env.E2E_BEARER || "";
const E2E_AUTH_DEBUG = process.env.E2E_AUTH_DEBUG === "1";
const E2E_AUTH_RAW = process.env.E2E_AUTH_RAW === "1";

// ---------- helpers ----------
function bearerHeader(): string {
  if (!E2E_BEARER) return "";
  return E2E_BEARER.startsWith("Bearer ") ? E2E_BEARER : `Bearer ${E2E_BEARER}`;
}

function buildAuthHeaders(): {
  headers: Record<string, string>;
  cookie?: string;
} {
  const Authorization = bearerHeader();
  const raw = E2E_BEARER;

  const headers: Record<string, string> = {};
  if (Authorization) headers["authorization"] = Authorization;

  // Legacy fallbacks (harmless for gateway, helpful for permissive services)
  if (raw) {
    headers["x-access-token"] = raw;
    headers["x-auth-token"] = raw;
    headers["x-authorization"] = raw;
  }

  const cookie = raw ? `auth=${raw}; token=${raw}; jwt=${raw}` : undefined;
  return { headers, cookie };
}

function maskAuth(val?: string) {
  if (!val) return "(none)";
  const token = val.replace(/^Bearer\s+/, "");
  const parts = token.split(".");
  if (parts.length >= 3) return "Bearer ****.****.****";
  return "(present)";
}

function readAuthHeader(h: any): string | undefined {
  // Axios v1 may use AxiosHeaders with .get()
  if (h && typeof h.get === "function") {
    return h.get("authorization") ?? h.get("Authorization");
  }
  return h?.authorization ?? h?.Authorization;
}

// ---------- client ----------
export function makeClient(baseURL: string) {
  const client: AxiosInstance = axios.create({
    baseURL,
    validateStatus: () => true,
  });

  client.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
    const { headers: authHeaders, cookie } = buildAuthHeaders();

    // Ensure headers object exists and is assignable
    const merged: AxiosRequestHeaders = {
      ...(cfg.headers as any),
      ...authHeaders,
    } as AxiosRequestHeaders;

    if (cookie && !("cookie" in merged)) {
      (merged as any).cookie = cookie;
    }

    cfg.headers = merged;

    if (E2E_AUTH_DEBUG) {
      const authVal = readAuthHeader(cfg.headers);
      const dbg = {
        baseURL: cfg.baseURL,
        url: cfg.url,
        method: (cfg.method || "get").toLowerCase(),
        headers: E2E_AUTH_RAW
          ? cfg.headers
          : { ...cfg.headers, authorization: maskAuth(authVal) },
        authHeaderMasked: maskAuth(authVal),
      };
      // eslint-disable-next-line no-console
      console.log("[E2E][AUTH][REQUEST]", JSON.stringify(dbg));
    }

    return cfg;
  });

  if (E2E_AUTH_DEBUG) {
    client.interceptors.response.use((res) => {
      const preview =
        typeof res.data === "string"
          ? res.data.slice(0, 200)
          : JSON.stringify(res.data).slice(0, 200);
      // eslint-disable-next-line no-console
      console.log(
        "[E2E][AUTH][RESPONSE]",
        JSON.stringify({
          url: res.config?.url,
          status: res.status,
          dataType: typeof res.data,
          dataPreview: preview,
        })
      );
      return res;
    });
  }

  return client;
}

// ---------- Problem+JSON helpers ----------
export function parseProblem(errLike: unknown) {
  if (typeof errLike === "object" && errLike && "response" in errLike) {
    const ax = errLike as AxiosError;
    return zProblem.safeParse(ax.response?.data);
  }
  return { success: false as const, error: new Error("Not an AxiosError") };
}

export function expectProblemPayload(
  data: unknown,
  code?: string,
  status?: number
) {
  const prob = zProblem.parse(data);
  if (code) expect((prob as any).code).toBe(code);
  if (status) expect(prob.status).toBe(status);
}
