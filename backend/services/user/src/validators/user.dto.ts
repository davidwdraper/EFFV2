// backend/services/user/src/validators/user.dto.ts
// DTOs derived from the canonical shared contract. No parallel schemas.
import {
  zUser,
  zUserCreate,
  zUserReplace,
  zUserPatch,
  type User,
  type UserCreate,
  type UserReplace,
  type UserPatch,
} from "@shared/src/contracts/user.contract";

export {
  zUser as zUserDTO,
  zUserCreate,
  zUserReplace,
  zUserPatch,
  type User,
  type UserCreate,
  type UserReplace,
  type UserPatch,
};
