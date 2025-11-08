#!/usr/bin/env node
// backend/tools/route-policy-cli/route-policy-cli.ts

/**
 * NowVibin (NV)
 * Tool: Generic Route Policy CLI (create/update/upsert/batch via facilitator)
 *
 * Purpose:
 * - Generic console tool to manage routePolicy records via HTTP.
 * - No service-specific logic; caller supplies svcconfigId and route info.
 *
 * Env defaults (CLI-only; acceptable for local use):
 *   SVCFACILITATOR_BASE_URL (fallback http://127.0.0.1:4015)
 *   VERSION                  (fallback 1)
 *
 * Commands:
 *   create  --base <url> --svcconfig <oid> --version <n> --method <HTTP> --path </p> --min <n>
 *   update  --base <url> --id <oid> --min <n>
 *   upsert  --base <url> --svcconfig <oid> --version <n> --method <HTTP> --path </p> --min <n>
 *   batch   --base <url> --svcconfig <oid> --version <n> --policy "<METHOD>:<PATH>:<MIN>" [--policy "..."]...
 */

type HttpMethod = "PUT" | "POST" | "PATCH" | "GET" | "DELETE";

type CreateArgs = {
  base: string;
  svcconfig: string;
  version: number;
  method: HttpMethod;
  path: string;
  min: number;
};

type UpdateArgs = {
  base: string;
  id: string;
  min: number;
};

type UpsertArgs = CreateArgs;

type BatchArgs = {
  base: string;
  svcconfig: string;
  version: number;
  policies: Array<{ method: HttpMethod; path: string; min: number }>;
};

const EXIT = {
  InvalidArgs: 2,
  Network: 3,
  Server: 4,
} as const;

/* ────────────────────────────────────────────────────────────────────────────
   Arg parsing (tiny, dependency-free)
   ──────────────────────────────────────────────────────────────────────────── */

function parseArgs(argv: string[]) {
  const [cmd, ...rest] = argv.slice(2);
  const flags: Record<string, string | string[]> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const next = rest[i + 1];
    if (next == null || next.startsWith("--")) {
      flags[k] = "true";
    } else {
      if (k === "policy") {
        if (!Array.isArray(flags[k])) flags[k] = [];
        (flags[k] as string[]).push(next);
      } else {
        flags[k] = next;
      }
      i++;
    }
  }
  return { cmd, flags };
}

/* ────────────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────────────── */

function fail(msg: string, code = EXIT.InvalidArgs): never {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

// CLI-only fallbacks — acceptable defaults for local dev/testing
function getEnv(name: string, required = true): string | undefined {
  const v = process.env[name]?.trim();
  if (!v) {
    if (name === "SVCFACILITATOR_BASE_URL") {
      console.warn(
        `⚠️  ${name} not set — using fallback http://127.0.0.1:4015`
      );
      return "http://127.0.0.1:4015";
    }
    if (name === "VERSION") {
      console.warn(`⚠️  ${name} not set — using fallback 1`);
      return "1";
    }
    if (required) fail(`Missing env: ${name}`);
  }
  return v;
}

function isObjectId(s?: string): boolean {
  return !!s && /^[a-f0-9]{24}$/i.test(s);
}

function normalizeMethod(m: string): HttpMethod {
  const u = (m || "").toUpperCase();
  if (!["PUT", "POST", "PATCH", "GET", "DELETE"].includes(u)) {
    fail(`Invalid --method "${m}". Allowed: PUT|POST|PATCH|GET|DELETE`);
  }
  return u as HttpMethod;
}

function normalizePath(input: string): string {
  let p = (input || "").trim();
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  const h = p.indexOf("#");
  if (h >= 0) p = p.slice(0, h);
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function asInt(s?: string | string[], name?: string): number {
  const raw = Array.isArray(s) ? s[0] : s;
  const n = Number(raw);
  if (!Number.isInteger(n))
    fail(`Invalid integer for ${name ?? "value"}: "${raw}"`);
  return n;
}

/* ────────────────────────────────────────────────────────────────────────────
   HTTP (allows graceful 409 handling)
   ──────────────────────────────────────────────────────────────────────────── */

type HttpResult = { status: number; ok: boolean; json: any };

async function httpJson(
  url: string,
  method: "GET" | "POST" | "PUT",
  body?: unknown,
  contractId?: string,
  allowStatuses: number[] = []
): Promise<HttpResult> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10000);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body != null) headers["content-type"] = "application/json";
    if (contractId) headers["x-contract-id"] = contractId; // ADR-0029 alignment

    const resp = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    } as RequestInit);

    const text = await resp.text();
    let json: any = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // Non-JSON; still return raw as string for diagnostics
        json = { _raw: text };
      }
    }

    if (!resp.ok && !allowStatuses.includes(resp.status)) {
      // surface server error
      console.error(`HTTP ${resp.status} ${resp.statusText}`);
      console.error(JSON.stringify(json, null, 2));
      process.exit(EXIT.Server);
    }

    return { status: resp.status, ok: resp.ok, json };
  } catch (e: any) {
    console.error(e?.name === "AbortError" ? "Request timed out" : String(e));
    process.exit(EXIT.Network);
  } finally {
    clearTimeout(t);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   HTTP calls (contract-aligned)
   ──────────────────────────────────────────────────────────────────────────── */

function baseUrlFrom(flags: Record<string, string | string[]>) {
  return (
    (flags.base as string) ??
    getEnv("SVCFACILITATOR_BASE_URL") ??
    fail("Missing --base or SVCFACILITATOR_BASE_URL")
  );
}

function api(base: string) {
  return `${base.replace(/\/$/, "")}/api/svcfacilitator/v1`;
}

async function createPolicy(
  args: CreateArgs
): Promise<{ policy: any; created: boolean }> {
  const url = `${api(args.base)}/routePolicy`;
  const body = {
    svcconfigId: args.svcconfig,
    version: args.version,
    method: args.method,
    path: args.path,
    minAccessLevel: args.min,
  };
  const { status, ok, json } = await httpJson(
    url,
    "POST",
    body,
    "facilitator/routePolicy.create@v1",
    [409]
  );
  if (ok) {
    const policy = json?.data?.policy;
    if (!policy) {
      console.error("Unexpected response:");
      console.error(JSON.stringify(json, null, 2));
      process.exit(EXIT.Server);
    }
    return { policy, created: true };
  }
  // 409 → exists
  if (status === 409) {
    return { policy: null, created: false };
  }
  // Any other status was already handled in httpJson
  throw new Error("unreachable");
}

async function updatePolicy(args: UpdateArgs) {
  const url = `${api(args.base)}/routePolicy/${args.id}`;
  const body = { id: args.id, minAccessLevel: args.min };
  const { json } = await httpJson(
    url,
    "PUT",
    body,
    "facilitator/routePolicy.update@v1"
  );
  const policy = json?.data?.policy;
  if (!policy) {
    console.error("Unexpected response:");
    console.error(JSON.stringify(json, null, 2));
    process.exit(EXIT.Server);
  }
  return policy;
}

async function getPolicyExact(
  base: string,
  svcconfig: string,
  version: number,
  method: HttpMethod,
  path: string
) {
  const url =
    `${api(base)}/routePolicy` +
    `?svcconfigId=${encodeURIComponent(svcconfig)}` +
    `&version=${encodeURIComponent(String(version))}` +
    `&method=${encodeURIComponent(method)}` +
    `&path=${encodeURIComponent(path)}`;
  const { json } = await httpJson(url, "GET");
  if (!json?.ok) {
    console.error("Unexpected GET response:");
    console.error(JSON.stringify(json, null, 2));
    process.exit(EXIT.Server);
  }
  return json?.data?.policy ?? null;
}

/* ────────────────────────────────────────────────────────────────────────────
   Commands
   ──────────────────────────────────────────────────────────────────────────── */

async function cmdCreate(flags: Record<string, string | string[]>) {
  const base = baseUrlFrom(flags);
  const svcconfig =
    (flags.svcconfig as string) ??
    fail("Missing --svcconfig (service_config _id)");
  const version = asInt(
    flags.version ?? getEnv("VERSION", false) ?? "1",
    "--version"
  );
  const method = normalizeMethod(
    (flags.method as string) ?? fail("Missing --method")
  );
  const path = normalizePath((flags.path as string) ?? fail("Missing --path"));
  const min = asInt(
    flags.min ?? fail("Missing --min (minAccessLevel)"),
    "--min"
  );

  if (!isObjectId(svcconfig))
    fail(`--svcconfig must be a 24-hex ObjectId, got "${svcconfig}"`);

  const { policy, created } = await createPolicy({
    base,
    svcconfig,
    version,
    method,
    path,
    min,
  });
  if (created) {
    console.log("✅ Created routePolicy:");
    console.log(JSON.stringify(policy, null, 2));
    return;
  }
  // Already exists — fetch and possibly update
  const existing = await getPolicyExact(base, svcconfig, version, method, path);
  if (!existing) {
    console.warn(
      "⚠️  Received 409 but subsequent GET returned nothing. Please re-run."
    );
    return;
  }
  if (Number(existing.minAccessLevel) !== min) {
    const updated = await updatePolicy({ base, id: existing._id, min });
    console.log("🔁 Exists (updated):");
    console.log(JSON.stringify(updated, null, 2));
  } else {
    console.log("ℹ️  Exists (no-op):");
    console.log(JSON.stringify(existing, null, 2));
  }
}

async function cmdUpdate(flags: Record<string, string | string[]>) {
  const base = baseUrlFrom(flags);
  const id = (flags.id as string) ?? fail("Missing --id (routePolicy _id)");
  const min = asInt(
    flags.min ?? fail("Missing --min (minAccessLevel)"),
    "--min"
  );

  if (!isObjectId(id)) fail(`--id must be a 24-hex ObjectId, got "${id}"`);

  const policy = await updatePolicy({ base, id, min });
  console.log("✅ Updated routePolicy:");
  console.log(JSON.stringify(policy, null, 2));
}

async function cmdUpsert(flags: Record<string, string | string[]>) {
  const base = baseUrlFrom(flags);
  const svcconfig =
    (flags.svcconfig as string) ??
    fail("Missing --svcconfig (service_config _id)");
  const version = asInt(
    flags.version ?? getEnv("VERSION", false) ?? "1",
    "--version"
  );
  const method = normalizeMethod(
    (flags.method as string) ?? fail("Missing --method")
  );
  const path = normalizePath((flags.path as string) ?? fail("Missing --path"));
  const min = asInt(
    flags.min ?? fail("Missing --min (minAccessLevel)"),
    "--min"
  );

  if (!isObjectId(svcconfig))
    fail(`--svcconfig must be a 24-hex ObjectId, got "${svcconfig}"`);

  const existing = await getPolicyExact(base, svcconfig, version, method, path);
  if (existing) {
    if (Number(existing.minAccessLevel) !== min) {
      const updated = await updatePolicy({ base, id: existing._id, min });
      console.log("🔁 Upsert (updated):");
      console.log(JSON.stringify(updated, null, 2));
    } else {
      console.log("ℹ️  Upsert (no-op; identical):");
      console.log(JSON.stringify(existing, null, 2));
    }
    return;
  }

  // Not found by GET → try to create; if 409, fetch and update as needed
  const { policy, created } = await createPolicy({
    base,
    svcconfig,
    version,
    method,
    path,
    min,
  });
  if (created) {
    console.log("🆕 Upsert (created):");
    console.log(JSON.stringify(policy, null, 2));
    return;
  }
  const after = await getPolicyExact(base, svcconfig, version, method, path);
  if (after) {
    if (Number(after.minAccessLevel) !== min) {
      const updated = await updatePolicy({ base, id: after._id, min });
      console.log("🔁 Upsert (updated after 409):");
      console.log(JSON.stringify(updated, null, 2));
    } else {
      console.log("ℹ️  Upsert (exists after 409; no-op):");
      console.log(JSON.stringify(after, null, 2));
    }
  } else {
    console.warn(
      "⚠️  409 reported existing, but GET still returns nothing. Investigate index/normalization."
    );
  }
}

async function cmdBatch(flags: Record<string, string | string[]>) {
  const base = baseUrlFrom(flags);
  const svcconfig =
    (flags.svcconfig as string) ??
    fail("Missing --svcconfig (service_config _id)");
  const version = asInt(
    flags.version ?? getEnv("VERSION", false) ?? "1",
    "--version"
  );
  const entries = Array.isArray(flags.policy) ? (flags.policy as string[]) : [];

  if (!isObjectId(svcconfig))
    fail(`--svcconfig must be a 24-hex ObjectId, got "${svcconfig}"`);
  if (entries.length === 0)
    fail('Missing at least one --policy "<METHOD>:<PATH>:<MIN>"');

  const policies: BatchArgs["policies"] = entries.map((s) => {
    const parts = s.split(":");
    if (parts.length < 3)
      fail(`Invalid --policy "${s}". Expected "<METHOD>:<PATH>:<MIN>"`);
    const method = normalizeMethod(parts[0]);
    const path = normalizePath(parts[1]);
    const min = asInt(parts[2], "--policy MIN");
    return { method, path, min };
  });

  for (const p of policies) {
    const existing = await getPolicyExact(
      base,
      svcconfig,
      version,
      p.method,
      p.path
    );
    if (existing) {
      if (Number(existing.minAccessLevel) !== p.min) {
        const updated = await updatePolicy({
          base,
          id: existing._id,
          min: p.min,
        });
        console.log(
          `🔁 Upserted (updated): ${p.method} ${p.path} → min=${p.min}`
        );
        console.log(JSON.stringify(updated, null, 2));
      } else {
        console.log(
          `ℹ️  Upserted (no-op): ${p.method} ${p.path} already min=${p.min}`
        );
        console.log(JSON.stringify(existing, null, 2));
      }
      continue;
    }

    // Try create; if 409, fetch then possibly update
    const { policy, created } = await createPolicy({
      base,
      svcconfig,
      version,
      method: p.method,
      path: p.path,
      min: p.min,
    });

    if (created) {
      console.log(
        `🆕 Upserted (created): ${p.method} ${p.path} → min=${p.min}`
      );
      console.log(JSON.stringify(policy, null, 2));
      continue;
    }

    const after = await getPolicyExact(
      base,
      svcconfig,
      version,
      p.method,
      p.path
    );
    if (after) {
      if (Number(after.minAccessLevel) !== p.min) {
        const updated = await updatePolicy({ base, id: after._id, min: p.min });
        console.log(
          `🔁 Upserted (updated after 409): ${p.method} ${p.path} → min=${p.min}`
        );
        console.log(JSON.stringify(updated, null, 2));
      } else {
        console.log(
          `ℹ️  Upserted (exists after 409; no-op): ${p.method} ${p.path}`
        );
        console.log(JSON.stringify(after, null, 2));
      }
    } else {
      console.warn(
        `⚠️  409 for ${p.method} ${p.path} but GET returned nothing — check normalization/index.`
      );
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Main
   ──────────────────────────────────────────────────────────────────────────── */

function usage(): never {
  console.log(`
Generic Route Policy CLI

Commands:
  create      --base <url> --svcconfig <oid> --version <n> --method <HTTP> --path </p> --min <n>
  update      --base <url> --id <oid> --min <n>
  upsert      --base <url> --svcconfig <oid> --version <n> --method <HTTP> --path </p> --min <n>
  batch       --base <url> --svcconfig <oid> --version <n> --policy "<METHOD>:<PATH>:<MIN>" [--policy "..."]...

Env (CLI defaults):
  SVCFACILITATOR_BASE_URL   (fallback http://127.0.0.1:4015)
  VERSION                   (fallback 1)
`);
  process.exit(0);
}

(async () => {
  const { cmd, flags } = parseArgs(process.argv);
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") usage();

  switch (cmd) {
    case "create":
      await cmdCreate(flags);
      break;
    case "update":
      await cmdUpdate(flags);
      break;
    case "upsert":
      await cmdUpsert(flags);
      break;
    case "batch":
      await cmdBatch(flags);
      break;
    default:
      fail(`Unknown command "${cmd}"`);
  }
})().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(EXIT.Server);
});

/*

route-policy-cli batch \
  --base http://127.0.0.1:4015 \
  --svcconfig 68d71758d4004738868cf494 \
  --version 1 \
  --policy "POST:/signon:0" \
  --policy "PUT:/create:0"
  */
