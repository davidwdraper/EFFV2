// shared/interfaces/Act/INewAct.ts

export interface INewAct {
  actType: number[];           // required
  name: string;                // required
  homeTown: string;            // required

  eMailAddr?: string;
}
