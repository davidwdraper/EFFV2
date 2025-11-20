# LDD‑29 — Error Semantics & Operator Guidance (Problem+JSON Discipline)

---

## 1. Purpose

This chapter formalizes NV’s **error semantics**, **Problem+JSON rules**,  
and **operator guidance expectations** across all services.

Errors are part of the product.  
They must be consistent, predictable, and information‑rich — without exposing internal details.

This document defines:
- allowed error structures,
- how controllers and handlers set errors,
- how duplicate keys are normalized,
- how env/config errors manifest,
- how operator guidance is delivered,
- what should *never* leak to the client.

---

## 2. Universal Error Envelope

All NV services return errors in **RFC 7807 Problem+JSON** format:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "detail": "Missing required field: txtfield1",
  "status": 400,
  "code": "VALIDATION",
  "issues": [ ... ],
  "requestId": "xxx-1-abcd"
}
```

### 2.1 Required Fields
- `type`  
- `title`  
- `detail`  
- `status`  
- `code`  
- `requestId`

### 2.2 Optional
- `issues[]` (field-level validation info)
- domain-specific metadata (never secrets)

Controllers are responsible for producing compliant envelopes  
(via ControllerBase.finalize).

---

## 3. Error Categories (Canonical Codes)

### 3.1 Client Errors (4xx)

| Code | Meaning | Example |
|------|---------|---------|
| `BAD_REQUEST` | malformed input | invalid JSON body |
| `VALIDATION` | DTO validation failed | zod issues[] |
| `NOT_FOUND` | id not found | read-by-id miss |
| `DUPLICATE_ID` | `_id` conflict | create w/existing id |
| `DUPLICATE_CONTENT` | UX/business conflict | same “business key” |
| `DUPLICATE_KEY` | other duplicate index | mixed-case fields |
| `UNKNOWN_DTO_TYPE` | dtoType not in registry | route misuse |
| `NOT_IMPLEMENTED` | dtoType op missing | pipeline absent |
| `UNAUTHORIZED` | missing/invalid auth | missing access token |
| `FORBIDDEN` | valid auth, bad role | act editing venue |

### 3.2 Server Errors (5xx)

| Code | Meaning | Example |
|------|---------|---------|
| `ENV_DTO_MISSING` | AppBase missing envDto | bootstrap drift |
| `REGISTRY_MISSING` | no DTO registry | service miswire |
| `DB_UNAVAILABLE` | Mongo unreachable | network partition |
| `SVCCONFIG_UNREACHABLE` | cannot read topology | svcconfig offline |
| `UPSTREAM_UNREACHABLE` | service call failure | gateway proxy miss |
| `INTERNAL` | unexpected exception | null deref |
| `WAL_FAILURE` | WAL emit/flush failed | disk or writer error |

---

## 4. Duplicate Key Normalization

ControllerBase.finalize uses `parseDuplicateKey()` to map raw Mongo errors:

| Mongo Index | Mapped Code |
|-------------|-------------|
| `_id_` | `DUPLICATE_ID` |
| `ux_<slug>_business` | `DUPLICATE_CONTENT` |
| anything else | `DUPLICATE_KEY` |

Clients should never see raw Mongo index names or messages.

---

## 5. Validation Errors (DTO Level)

All DTOs use Zod for structural and semantic validation.

Handlers surface validation failures as:

```json
{
  "code": "VALIDATION",
  "issues": [
    { "path": ["txtfield1"], "code": "too_small", "message": "min 1 character" }
  ]
}
```

### Principles
- **Never** leak internal DTO constructor fields.
- **Always** include `requestId`.
- **Never** include the offending inbound JSON in full; surface only per-field messages.

---

## 6. Controller-Level Error Rules

### 6.1 Preflight Failures
Missing registry/env in context → `500` server errors with:

```
code: "REGISTRY_MISSING"
code: "ENV_DTO_MISSING"
```

### 6.2 Pipeline Selection Failures
Missing dtoType mapping:

```
code: "NOT_IMPLEMENTED"
status: 501
```

### 6.3 Handler Errors
Handlers set:

```
ctx.set("handlerStatus", "error")
ctx.set("response.status", ...)
ctx.set("response.body", {...})
```

ControllerBase.finalize does the rest.

---

## 7. System-Level Guidance

Every 5xx error includes **operator guidance** in logs, not in client responses.

Examples:

### 7.1 Env Failure
Log:
```
ENV_CONFIG_INVALID — NV_HTTP_PORT must be numeric. Check env-service values.
```

### 7.2 Registry Failure
```
REGISTRY_MISSING — AppBase.getDtoRegistry() returned undefined. Fix service wiring.
```

### 7.3 DB Failure
```
DB_UNAVAILABLE — check network, Mongo status, credentials from env-service.
```

Client receives safe, generic Problem+JSON only.

---

## 8. Gateway-Specific Errors

Gateway wraps SvcClient failures into:

```
502 Bad Gateway
{
  "code": "UPSTREAM_UNREACHABLE",
  "title": "Upstream Unreachable",
  "detail": "Failed to contact xxx@1.",
  "status": 502,
  "requestId": "<same>"
}
```

Gateway *never* masks downstream 4xx/5xx — passes through verbatim.

---

## 9. SvcClient Error Semantics

SvcClient throws typed failure strings, which Gateway and services catch and format.

### Examples
- malformed slugKey → `SVC_CLIENT_INVALID_SLUGKEY`
- network error → mapped to `UPSTREAM_UNREACHABLE`
- JSON parse error → mapped to `INTERNAL` (with operator logs)

---

## 10. HandlerContext Error Discipline

Handlers must:

- never throw; use context keys,
- set both `handlerStatus="error"` and `response.status`,
- set `response.body.code` and `.title`,
- allow finalize() to construct Problem+JSON.

Throwing is reserved only for **fatal** bugs inside framework rails.

---

## 11. Error Testing Matrix

| Category | Test |
|---------|------|
| DTO validation | create/update bad fields |
| duplicate id | create same ID twice |
| duplicate content | conflict index |
| read miss | GET read/:id nonexistent |
| delete miss | DELETE nonexistent |
| gateway upstream fail | gateway + target offline |
| env bootstrap fail | invalid port in env-service |
| svcconfig miss | slug@version missing |
| WAL failure | mock writer injection |
| audit failure | audit writer drop |

Every service must pass this matrix before promotion.

---

## 12. Future Enhancements

### v2
- multi-lingual error messages
- correlation chaining across S2S calls
- advice links (`type` → docs URL)
- first-party operator CLI to decode complex errors

### v3
- adaptive retry hints
- soft-fail modes for specific CRUD operations
- cross-service root‑cause annotations

---

End of LDD‑29.
