export interface AuthPayload {
  _id: string;
  email: string;
  userType: number;
  firstname: string;
  lastname: string;
  createdBy?: string;
}
