# adr0030-contractbase-and-idempotent-contract-identification

## Context
Shared S2S (service‑to‑service) contracts have historically exported Zod schemas and optional constants for request/response validation.  
This approach allowed drift: some services referenced mismatched schema names or version strings, and there was no runtime verification that both ends were using the **same shared contract**.  

To eliminate drift, contracts must become **self‑identifying** and **idempotent** — each one declaring its own immutable `CONTRACT_ID`, retrievable and verifiable at runtime.  
This is achieved by introducing a new `ContractBase` class in the shared layer.

## Decision
All shared S2S contracts must **inherit from `ContractBase`**.  
Each subclass declares:
1. A static constant `CONTRACT_ID` (e.g. `"audit/entries@v1"`).  
2. Zod `request` and `response` schemas.  

The base class provides:
- `static getContractId()` — returns the immutable constant and validates its format.  
- `static verify(received: string)` — throws an explicit error if the provided header ID does not match the declared one.

### Example
```ts
// backend/services/shared/src/contracts/audit/audit.entries.v1.contract.ts
import { z } from "zod";
import { ContractBase } from "../_base/ContractBase";

export class AuditEntriesV1Contract extends ContractBase<
  { entries: unknown[] },
  { accepted: number }
> {
  protected static readonly CONTRACT_ID = "audit/entries@v1" as const;

  public readonly request = z.object({
    entries: z.array(z.unknown()).min(1),
  });

  public readonly response = z.object({
    accepted: z.number().int().min(0),
  });
}
```

### Shared Base Class
```ts
// backend/services/shared/src/contracts/_base/ContractBase.ts
export abstract class ContractBase<TReq, TRes> {
  protected static readonly CONTRACT_ID: string;
  public abstract readonly request: z.ZodType<TReq>;
  public abstract readonly response: z.ZodType<TRes>;

  public static getContractId(): string {
    const self = this as typeof ContractBase;
    if (!self.CONTRACT_ID) throw new Error("ContractBase: subclass missing CONTRACT_ID");
    assertContractId(self.CONTRACT_ID, "ContractBase");
    return self.CONTRACT_ID;
  }

  public static verify(received: string): void {
    const expected = this.getContractId();
    if (received !== expected) {
      throw new Error(`Contract ID mismatch: expected "${expected}", got "${received}"`);
    }
  }
}
```

### Enforcement
- Any existing shared contract used for S2S communication **must** be refactored to extend `ContractBase`.
- Contract IDs must follow the naming pattern `<namespace>/<endpoint>@v<major>` (e.g., `auth/user@v1`).
- The value of `CONTRACT_ID` must be a **compile‑time constant** (no concatenation or runtime logic).
- The ID is validated against the regex in `assertContractId()` from `shared/src/svc/s2s/headers.ts`.

### Receiver Behavior
SvcReceiver logic should:
1. Import the contract class.  
2. Call `ContractClass.verify(req.header("X-NV-Contract"))` before any body parsing.  
3. Parse the body with `contract.request.parse(req.body)`.  
4. Build the response with `okEnvelope(serviceSlug, 200, contract.response.parse(result))`.  

### Client Behavior
SvcClient logic should:
1. Call `ContractClass.getContractId()` and set it in the `X-NV-Contract` header.  
2. Send a **flat request body** (no envelope).  
3. Validate the response envelope’s body with the same `contract.response` schema.

## Consequences
- **Eliminates drift:** Both producer and consumer rely on the same compiled contract class.
- **Improves introspection:** Contracts can be enumerated and inspected for IDs and schemas.
- **Runtime assurance:** Any mismatch between expected and received IDs results in a clear `contract_id_mismatch` error.
- **Future‑safe:** Backward compatibility can be added per‑contract via custom `verify()` overrides.

## Migration Plan
1. Introduce `ContractBase` (shared).  
2. Incrementally update all existing shared contracts that participate in S2S communication to extend from `ContractBase`.  
3. Adjust receivers and clients to use `.verify()` and `.getContractId()` respectively.  
4. Add unit tests to confirm that every contract’s `getContractId()` returns a valid ID.

## Acceptance Criteria
- All S2S contracts in `shared/src/contracts/` inherit from `ContractBase`.  
- Every contract defines a static `CONTRACT_ID` constant matching the `<namespace>/<endpoint>@v<major>` pattern.  
- Receivers verify incoming IDs before parsing.  
- Clients always send the declared `CONTRACT_ID` in the header.  
- Mismatched IDs produce a 400 `contract_id_mismatch` error logged with `requestId`.  
