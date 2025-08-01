// shared/interfaces/IUserAct.ts
export interface IUserAct {
  _id: string;
  userId: string;
  createUserId: string;
  dateCreated: string;     // ISO string
  userRole: number[];      // at least one
}
