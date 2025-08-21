export interface AuthPayload {
  _id: string; // ✅ replace userId with _id to reflect Mongoose doc ID
  userType: number;
  firstname: string;
  lastname: string;
  email: string;
}
