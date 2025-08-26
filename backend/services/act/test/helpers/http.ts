// backend/services/act/test/helpers/http.ts
import type { Response } from "supertest";

function dumpIfProblem(res: Response) {
  const ct = res.headers["content-type"] || "";
  const looksProblem =
    ct.includes("application/problem+json") ||
    (res.body && res.body.type && res.body.title);
  if (looksProblem) {
    // eslint-disable-next-line no-console
    console.error("[Problem+JSON]", JSON.stringify(res.body, null, 2));
  }
}

export async function expectOK(p: Promise<Response>): Promise<Response> {
  const res = await p;
  if (res.status !== 200) dumpIfProblem(res);
  if (res.status !== 200) throw new Error(`Expected 200 OK, got ${res.status}`);
  return res;
}

export async function expectCreated(p: Promise<Response>): Promise<Response> {
  const res = await p;
  if (res.status !== 201) dumpIfProblem(res);
  if (res.status !== 201)
    throw new Error(`Expected 201 Created, got ${res.status}`);
  return res;
}

export async function expectNoContent(p: Promise<Response>): Promise<Response> {
  const res = await p;
  if (res.status !== 204) dumpIfProblem(res);
  if (res.status !== 204)
    throw new Error(`Expected 204 No Content, got ${res.status}`);
  return res;
}

export async function expectStatus(
  p: Promise<Response>,
  status: number
): Promise<Response> {
  const res = await p;
  if (res.status !== status) dumpIfProblem(res);
  if (res.status !== status)
    throw new Error(`Expected ${status}, got ${res.status}`);
  return res;
}

export default { expectOK, expectCreated, expectNoContent, expectStatus };
