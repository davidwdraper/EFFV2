// shared/interfaces/IUserUpdate.ts

export interface IUserUpdate {
  lastname?: string;
  firstname?: string;
  middlename?: string;
  email?: string;
  password?: string;
  userStatus?: number;
  userType?: number;
  userEntryId?: string;
  userOwnerId?: string;
  imageIds?: string[];
}
