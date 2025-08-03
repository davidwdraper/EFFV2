// shared/interfaces/INewUser.ts

export interface INewUser {
  lastname: string;
  firstname: string;
  middlename?: string;
  eMailAddr: string;
  password: string;
  userStatus?: number; // default handled in model
  userType?: number; // default handled in model
  userEntryId?: string;
  userOwnerId?: string;
  imageIds?: string[]; // optional at creation
}
