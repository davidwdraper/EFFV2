// backend/services/act/src/controllers/act/handlers/schemas.ts
/**
 * Localized schema imports for handlers.
 * Handlers can import from this file or directly from validators/act.dto.
 * (No export *; explicit named exports only.)
 */
export {
  createActDto,
  updateActDto,
  searchByRadiusDto,
  findByIdDto,
} from "../../../validators/act.dto";
