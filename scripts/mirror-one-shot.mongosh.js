// scripts/mirror-one-shot.mongosh.js
// Usage:
//   mongosh --quiet "$SVCCONFIG_MONGO_URI/$SVCCONFIG_MONGO_DB" \
//     --file scripts/mirror-one-shot.mongosh.js \
//     --eval 'var OUT="/absolute/path/to/mirror.json", PARENTS="service_configs", POLICIES="route_policies"'
// Output: writes Mirror JSON to OUT, and prints a brief summary to stderr.

(function () {
  if (typeof OUT !== "string" || !OUT.length) {
    printjson({
      error:
        "Missing OUT path. Pass via --eval 'var OUT=\"/path/mirror.json\"'",
    });
    quit(2);
  }
  const parentsCol =
    typeof PARENTS === "string" && PARENTS.length ? PARENTS : "service_configs";
  const policiesCol =
    typeof POLICIES === "string" && POLICIES.length
      ? POLICIES
      : "route_policies";

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

  const matched = db.getCollection(parentsCol).countDocuments(filter);
  const est = db.getCollection(parentsCol).estimatedDocumentCount();
  const parents = db
    .getCollection(parentsCol)
    .find(filter, projection)
    .toArray();

  // Build mirror
  function asId(x) {
    if (!x) throw new Error("missing _id");
    if (typeof x === "string") return x;
    if (x.$oid) return x.$oid;
    return x.toString(); // ObjectId
  }
  function asIso(x) {
    if (!x) throw new Error("missing updatedAt");
    return x instanceof Date ? x.toISOString() : new Date(x).toISOString();
  }

  const mirror = {};
  parents.forEach((p) => {
    const pid = p._id;
    const edge = db
      .getCollection(policiesCol)
      .find({ svcconfigId: pid, enabled: true, type: "Edge" })
      .toArray();
    const s2s = db
      .getCollection(policiesCol)
      .find({ svcconfigId: pid, enabled: true, type: "S2S" })
      .toArray();

    const key = `${p.slug}@${p.version}`;
    mirror[key] = {
      _id: asId(p._id),
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
          svcconfigId: asId(p._id),
          updatedAt: asIso(e.updatedAt),
        })),
        s2s: s2s.map((e) => ({
          ...e,
          _id: e._id ? asId(e._id) : undefined,
          svcconfigId: asId(p._id),
          updatedAt: asIso(e.updatedAt),
        })),
      },
    };
  });

  // Minimal shape guard on the two fields that have bitten us
  for (const [k, v] of Object.entries(mirror)) {
    if (
      typeof v.outboundApiPrefix !== "string" ||
      typeof v.exposeHealth !== "boolean"
    ) {
      printjson({
        error: "mirror_shape_invalid",
        key: k,
        outboundApiPrefix: v.outboundApiPrefix,
        exposeHealth: v.exposeHealth,
      });
      quit(3);
    }
  }

  // Write LKG
  // mongosh doesn't have fs write; print to stdout and redirect from shell.
  print(JSON.stringify(mirror));

  // Summary to stderr (so redirect won't capture it)
  // (mongosh prints to stdout with print(); printjson also stdout. We'll just note summary here as comment.)
  // End.
})();
