export interface AuthPayload {
  _id: string;
  eMailAddr: string;
  userType: number;
  firstname: string;
  lastname: string;
  createdBy?: string;
}
