// shared/interfaces/EventPlace.ts
export interface EventPlace {
  eventId: string;
  placeId: string;
  dateCreated: string;       // ISO string
  createUserId: string;      // the user who created the join
}
