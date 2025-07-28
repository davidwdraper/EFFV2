// ⚠️ THIS FILE MUST STAY IN SYNC WITH:
// Backend: /eff/backend/shared/interfaces/User.ts
// Frontend: /eff/frontend/shared/interfaces/User.ts

export interface IUser {
  _id: string;
  dateCreated: string;
  dateLastUpdated: string;
  userStatus: number;
  userType: number; // 1: member, 2: subscribed, >=3: admin
  userCreateId: string;
  userOwnerId: string;
  lastname: string;
  middlename?: string;
  firstname: string;
  eMailAddr: string;
  homeLat: number;
  homeLng: number;
  imageIds: string[]; // up to 10
}
