// backend/services/shared/contracts/index.ts
// Monorepo barrel for shared contracts.

export * from "./common";

// Temporarily disable Act re-exports. The Act service is using its own local contracts
// (backend/services/act/src/contracts/act.ts) to avoid path/tsconfig drift during tests.
// Re-enable this once paths are aligned.
// export * from "./act";

// Keep user if it exists (harmless if absent)
// export * from "./user";
