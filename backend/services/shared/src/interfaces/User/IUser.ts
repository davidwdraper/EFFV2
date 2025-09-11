// backend/services/shared/interfaces/User/IUser.ts
export interface IUser {
  dateCreated: Date;
  dateLastUpdated: Date;
  userStatus: number;
  userType: number;
  userEntryId?: string;
  userOwnerId?: string;
  lastname: string;
  middlename?: string;
  firstname: string;
  email: string; // ✅ canonical field now
  password: string;
  imageIds: string[];
}
