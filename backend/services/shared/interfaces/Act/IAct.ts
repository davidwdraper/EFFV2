// shared/interfaces/Act/IAct.ts

export interface IAct {
  _id: string; // MongoDB ID
  dateCreated: string; // ISO
  dateLastUpdated: string; // ISO

  actStatus: number; // default 0
  actType: number[]; // required

  userCreateId: string;
  userOwnerId: string;

  name: string;
  eMailAddr?: string;
  homeTown: string;

  homeTownLat?: number; // Lat/Lng used for spatial searches within homeTown radius
  homeTownLng?: number;

  imageIds?: string[]; // max 10
}
