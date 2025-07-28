// shared/interfaces/UserAct.ts
export interface UserAct {
  actId: string;
  userId: string;
  createUserId: string;
  dateCreated: string;     // ISO string
  userRole: number[];      // at least one
}
