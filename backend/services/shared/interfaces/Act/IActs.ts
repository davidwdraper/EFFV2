// shared/interfaces/IAct.ts
export interface IAct {
  _id: string;
  dateCreated: string;           // ISO string
  dateLastUpdated: string;       // ISO string

  actStatus: number;             // default 0
  actType: number[];             // at least one required

  userCreateId: string;
  userOwnerId: string;

  name: string;
  eMailAddr?: string;

  imageIds?: string[];           // max 10
}
