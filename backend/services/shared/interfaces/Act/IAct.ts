// shared/interfaces/Act/IAct.ts

export interface IAct {
  _id: string;                  // MongoDB ID
  dateCreated: string;         // ISO
  dateLastUpdated: string;     // ISO

  actStatus: number;           // default 0
  actType: number[];           // required

  userCreateId: string;
  userOwnerId: string;

  name: string;
  eMailAddr?: string;
  homeTown: string;

  imageIds?: string[];         // max 10
}
