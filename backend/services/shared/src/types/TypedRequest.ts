// backend/services/shared/types/TypedRequest.ts

import { Request } from "express";
import { AuthPayload } from "../types/AuthPayload"; // adjust if needed

export type TypedRequest = Request & {
  user?: AuthPayload;
};
