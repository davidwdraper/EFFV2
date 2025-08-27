// backend/services/act/src/controllers/actController.ts
// Barrel that preserves your existing routes import.
// It re-exports the actual handlers from the namespaced Act folder.
export { ping } from "./act/handlers/ping";
export { list } from "./act/handlers/list";
export { getById } from "./act/handlers/getById";
export { search, byHometown } from "./act/handlers/search";
export { create } from "./act/handlers/create";
export { update } from "./act/handlers/update";
export { remove } from "./act/handlers/remove";
