// /backend/tests/e2e/helpers/http.ts
import axios, { AxiosError } from "axios";
import { z } from "zod";
import { zProblem } from "@shared/contracts/common";

export function makeClient(baseURL: string) {
  const client = axios.create({ baseURL, validateStatus: () => true });
  return client;
}

export function parseProblem(errLike: unknown) {
  if (typeof errLike === "object" && errLike && "response" in errLike) {
    const ax = errLike as AxiosError;
    return zProblem.safeParse(ax.response?.data);
  }
  return { success: false as const, error: new Error("Not an AxiosError") };
}

export function expectProblemPayload(
  data: any,
  code?: string,
  status?: number
) {
  const prob = zProblem.parse(data);
  if (code) expect(prob.code).toBe(code);
  if (status) expect(prob.status).toBe(status);
}
