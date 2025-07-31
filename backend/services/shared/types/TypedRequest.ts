// backend/services/shared/types/TypedRequest.ts

import { Request } from 'express';
import { AuthPayload } from './AuthPayload'; // adjust if needed

export type TypedRequest = Request & {
  user?: AuthPayload;
};
