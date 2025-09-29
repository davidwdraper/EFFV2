// backend/types/supertest-bridge.d.ts
declare module "supertest" {
  // Re-export the package’s bundled types if TS fails to locate them.
  // Adjust the relative path if your repo layout differs.
  export * from "../../../node_modules/supertest/types/index";
  const def: typeof import("../../../node_modules/supertest/types/index").default;
  export default def;
}
