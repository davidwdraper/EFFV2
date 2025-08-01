// shared/interfaces/Event.ts
export interface IEvent {
  _id: string;
  dateCreated: string;           // ISO string
  dateLastUpdated: string;       // ISO string

  status: number;                // 0 = default

  type: number[];                // must include at least one

  userCreateId: string;
  userOwnerId: string;

  name: string;
  comments?: string;

  startDateTime: string;         // ISO string
  endDateTime: string;           // ISO string

  repeatDay: number[];           // e.g., [0] = no repeat, [1,3,5] = Sun/Tue/Thu

  imageIds?: string[];           // max 10
}
