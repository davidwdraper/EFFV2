if (!process.env.JWT_SECRET) {
  throw new Error(`[orchestratorService] JWT_SECRET not found in environment`);
}

export const JWT_SECRET = process.env.JWT_SECRET!;
