export interface IPlace {
  _id: string; // GUID (PK)
  dateCreated: string; // ISO date
  dateLastUpdated: string; // ISO date
  status: number; // e.g., 0 = active
  userCreateId: string;
  userOwnerId: string;
  placeType: number[]; // Must have at least one
  name: string;
  email?: string;
  addr1?: string;
  addr2?: string;
  city?: string;
  state?: string;
  zip?: string;
  countryCode?: string;
  place_id?: string; // Google ID
  lat: number;
  lng: number;
}
