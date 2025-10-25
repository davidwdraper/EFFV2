// path: scripts/mirror-one-shot.ts
// (You can run it from anywhere; it does not modify app code.)

// @ts-nocheck  // keep this simple; it's a one-off script

/**
 * Purpose:
 *  - Load parent ServiceConfig docs + enabled RoutePolicies from Mongo.
 *  - Build MirrorJSON in memory.
 *  - Validate against shared Zod wire schema (contract-first).
 *  - Optionally write an FS LKG JSON file.
 *
 * Usage:
 *   tsx scripts/mirror-one-shot.ts \
 *     --mongoUri="$SVCCONFIG_MONGO_URI" \
 *     --db="$SVCCONFIG_MONGO_DB" \
 *     --out="/absolute/path/to/mirror.lkg.json"
 *
 * Flags:
 *   --mongoUri (required)
 *   --db       (required)
 *   --out      (optional) file path to write the validated snapshot
 *   --parents  (optional) collection name, default service_configs
 *   --policies (optional) collection name, default route_policies
 */

import { MongoClient, ObjectId } from "mongodb";
// CHANGE THIS IMPORT PATH IF NEEDED:
import { MirrorJSONSchema } from "../backend/services/shared/src/contracts/serviceConfig.wire";
import { z } from "zod";

type ParentRaw = {
  _id: string | { $oid: string } | ObjectId;
  slug: string;
  version: number;
  enabled: boolean;
  internalOnly: boolean;
  baseUrl: string;
  outboundApiPrefix: string;
  exposeHealth: boolean;
  changedByUserId?: string;
  updatedAt: string | Date;
};

type PolicyRaw = {
  _id?: string | { $oid: string } | ObjectId;
  svcconfigId: string | { $oid: string } | ObjectId;
  type: "Edge" | "S2S";
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE";
  path: string;
  bearerRequired?: boolean;
  enabled: boolean;
  updatedAt: string | Date;
  notes?: string;
  minAccessLevel?: number;
};

function arg(name: string, def?: string) {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}

function asId(x: any): string {
  if (!x) throw new Error("missing _id");
  if (typeof x === "string") return x;
  if (x instanceof ObjectId) return x.toHexString();
  if (typeof x === "object" && typeof x.$oid === "string") return x.$oid;
  throw new Error(`unsupported id shape: ${JSON.stringify(x)}`);
}

function asIso(x: any): string {
  if (!x) throw new Error("missing updatedAt");
  if (typeof x === "string") return new Date(x).toISOString();
  if (x instanceof Date) return x.toISOString();
  throw new Error(`unsupported date shape: ${JSON.stringify(x)}`);
}

async function main() {
  const mongoUri = arg("mongoUri");
  const dbName = arg("db");
  const outPath = arg("out");
  const parentsCol = arg("parents", "service_configs");
  const policiesCol = arg("policies", "route_policies");

  if (!mongoUri || !dbName) {
    console.error(
      "Usage: --mongoUri MONGO --db DB [--out FILE] [--parents NAME] [--policies NAME]"
    );
    process.exit(2);
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);

  const filter = { enabled: true, internalOnly: false };
  const projection = {
    _id: 1,
    slug: 1,
    version: 1,
    enabled: 1,
    internalOnly: 1,
    baseUrl: 1,
    outboundApiPrefix: 1,
    exposeHealth: 1,
    changedByUserId: 1,
    updatedAt: 1,
  };

  const parents = await db
    .collection<ParentRaw>(parentsCol)
    .find(filter, { projection })
    .toArray();

  const matched = await db.collection(parentsCol).countDocuments(filter);
  const est = await db.collection(parentsCol).estimatedDocumentCount();

  console.log(
    JSON.stringify(
      {
        event: "svcconfig_parent_scan",
        db: dbName,
        collection: parentsCol,
        matchedCount: matched,
        estimatedTotal: est,
        returned: parents.length,
      },
      null,
      2
    )
  );

  // Join policies
  const result: Record<string, any> = {};
  for (const p of parents) {
    const parentId = asId(p._id);
    const [edge, s2s] = await Promise.all([
      db
        .collection<PolicyRaw>(policiesCol)
        .find({ svcconfigId: p._id, enabled: true, type: "Edge" })
        .toArray(),
      db
        .collection<PolicyRaw>(policiesCol)
        .find({ svcconfigId: p._id, enabled: true, type: "S2S" })
        .toArray(),
    ]);

    const serviceConfig = {
      _id: parentId,
      slug: p.slug,
      version: p.version,
      enabled: true,
      internalOnly: p.internalOnly,
      baseUrl: p.baseUrl,
      outboundApiPrefix: p.outboundApiPrefix,
      exposeHealth: p.exposeHealth,
      changedByUserId: p.changedByUserId,
      updatedAt: asIso(p.updatedAt),
      policies: {
        edge: edge.map((e) => ({
          ...e,
          _id: e._id ? asId(e._id) : undefined,
          svcconfigId: parentId,
          updatedAt: asIso(e.updatedAt),
        })),
        s2s: s2s.map((e) => ({
          ...e,
          _id: e._id ? asId(e._id) : undefined,
          svcconfigId: parentId,
          updatedAt: asIso(e.updatedAt),
        })),
      },
    };

    const key = `${serviceConfig.slug}@${serviceConfig.version}`;
    result[key] = serviceConfig;
  }

  // Validate against the shared wire schema (contract-first)
  const parse = MirrorJSONSchema.safeParse(result);
  if (!parse.success) {
    console.error("MirrorJSON validation failed. Issues:");
    console.error(JSON.stringify(parse.error.format(), null, 2));
    process.exit(3);
  }

  console.log(
    JSON.stringify(
      {
        event: "mirror_built",
        count: Object.keys(result).length,
        keys: Object.keys(result).sort().slice(0, 10),
      },
      null,
      2
    )
  );

  // Optionally write LKG
  if (outPath) {
    const fs = await import("node:fs/promises");
    await fs.mkdir(require("node:path").dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
    console.log(
      JSON.stringify({ event: "lkg_written", path: outPath }, null, 2)
    );
  }

  await client.close();
}

main().catch((err) => {
  console.error("one-shot-loader error:", err?.message || err);
  process.exit(1);
});
