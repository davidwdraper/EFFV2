// backend/services/shared/types/TypedRequest.ts

import { Request } from "express";
import { AuthPayload } from "@eff/shared/src/types/AuthPayload"; // adjust if needed

export type TypedRequest = Request & {
  user?: AuthPayload;
};
