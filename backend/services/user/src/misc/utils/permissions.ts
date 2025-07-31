import { AuthPayload } from '../types/express';

export function canEdit(currentUser: AuthPayload, entityOwnerId: string): boolean {
  return currentUser.userType >= 3 || currentUser._id === entityOwnerId;
}