# adr0066-gateway-raw-passthrough-s2s

## ADR-0066 — Gateway Raw-Payload Passthrough for S2S Calls

## Context

The NowVibin backend uses a strict DTO-first, DtoBag-only contract across all worker services.  
Workers accept only canonical NV wire envelopes and emit the same. This ensures:

- DTO-driven validation  
- DTO-only persistence  
- Canonical bag-only wire envelopes  
- Strong boundaries between services  

However, the **gateway is not a worker service**.  
Its job is to:

- Accept public/edge traffic  
- Authenticate & guard  
- Log & audit  
- Forward payloads to internal worker services **without modifying them**  
- Return the worker service response exactly as-produced  

The gateway must not transform client payloads into DTOs.  
We cannot hydrate → instantiate DTOs → serialize → send.  
That approach is unnecessary compute, increases coupling, and defeats the purpose of a proxy.

Therefore, the gateway requires a **raw JSON passthrough mode** when performing S2S calls.

---

## Decision

### 1. Add a new *raw* S2S call API to `SvcClient`

This API bypasses DtoBag machinery entirely and forwards raw JSON:

```ts
callRaw(params: SvcClientRawCallParams): Promise<RawResponse>
```

Where:

```ts
interface SvcClientRawCallParams {
  env: string;
  slug: string;
  version: number;
  method: "GET" | "PUT" | "PATCH" | "POST" | "DELETE";
  pathSuffix: string;
  body?: unknown;  // untouched JSON from the client
  requestId?: string;
  extraHeaders?: Record<string,string>;
  timeoutMs?: number;
}

interface RawResponse {
  status: number;
  headers: Record<string,string>;
  bodyText: string; // not parsed
}
```

### 2. `SvcClient.call()` remains the worker-only DTO path

Worker → worker communication continues to use:

- DtoBag → toJson() → canonical wire envelope  
- DTO-owned validation  
- Schema correctness  
- DTO-first routing conventions  

The gateway **must not** use this path.

### 3. Gateway proxy pipelines use `callRaw()` exclusively

Gateway’s proxy handler becomes straightforward:

- Read `proxy.*` values from ctx  
- Call `svcClient.callRaw()`  
- Set `ctx["response.status"]` and `ctx["response.body"]`  
- Let `ControllerBase.finalize()` send output  

No DTO hydration.  
No schema enforcement.  
No overhead.

### 4. This pattern is **gateway-only**

This ADR explicitly states:

- Raw passthrough is allowed **only** in gateway  
- Worker services may NEVER use raw JSON across S2S boundaries  
- All worker endpoints MUST remain DTO-driven and Bag-driven  

This prevents architectural drift.

---

## Consequences

### Benefits

- The gateway remains fast  
- Avoids unnecessary DTO serialization overhead  
- Keeps worker boundaries strict and clean  
- Fully compatible with svcconfig, future JWT S2S auth, call-graph enforcement  
- Maintains audit and requestId propagation without modification  

### Costs

- Slightly more code inside SvcClient (a parallel raw path)  
- Requires a gateway-specific handler to orchestrate the raw flow  

### Risks

- Workers must continue validating inputs rigorously  
- Gateway must not accidentally leak this capability to other services  

---

## Alternatives Considered

### 1. Hydrate JSON into DTOs and serialize back  
**Rejected:**  
- Expensive  
- Unnecessary  
- Couples gateway to every worker’s DTO set  
- Breaks proxy semantics  

### 2. Add a “raw mode” to `SvcClient.call()`  
**Rejected:**  
- Would complicate existing DTO-only API  
- Harder to ensure workers don’t accidentally use raw mode  
- Loses the clean separation between DTO path and raw path  

### 3. Bypass SvcClient entirely in gateway  
**Rejected:**  
- Would bypass svcconfig  
- Would bypass call-graph authorization  
- Would undermine S2S hardening  
- Recreates logic that already exists in SvcClient  

---

## Implementation Notes

### Required additions

- New interfaces: `SvcClientRawCallParams`, `RawResponse`
- New method: `SvcClient.callRaw()`

### Reuse existing SvcClient internals

- svcconfig resolution  
- URL construction  
- timeout logic  
- header building  
- optional JWT token minting  

### Gateway pipeline

```
ProxyController
  → GatewayProxyS2sHandler
     → SvcClient.callRaw()
        → finalize()
```

Controller sets proxy context.  
Handler performs ONLY the S2S call.  
Finalization sends the worker’s response unchanged.

---

## Status

**Accepted — Implementation scheduled.**

This ADR is binding:  
- Gateway: raw-passthrough proxy  
- Workers: DTO-first, DtoBag-only  
- SvcClient: two paths (DTO and raw), clearly separated  
