// backend/services/auth/src/models/User.ts
// Business-tier DTO for data fetched from the User service.
// No schemas, no DB — Auth does not persist users here.

export interface UserDTO {
  id: string; // canonical id from user service
  email: string; // canonical email (lowercased)
  password?: string; // hashed, only present on private lookups
  firstname: string;
  middlename?: string;
  lastname: string;
  userStatus: number;
  userType: number;
}
