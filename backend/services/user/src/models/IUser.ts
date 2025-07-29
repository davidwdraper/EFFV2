// ⚠️ THIS FILE MUST STAY IN SYNC WITH:
// Backend: /eff/backend/shared/interfaces/User.ts
// Frontend: /eff/frontend/shared/interfaces/User.ts
import { Document } from 'mongoose';

export interface IUser extends Document {
  dateCreated: Date;
  dateLastUpdated: Date;
  userStatus: number;
  userType: number;
  userEntryId: string;
  userOwnerId: string;
  lastname: string;
  middlename?: string;
  firstname: string;
  eMailAddr: string;
  password: string;
  imageIds: string[];
}

