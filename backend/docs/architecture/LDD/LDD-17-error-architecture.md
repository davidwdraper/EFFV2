# LDD-17 — Error Architecture & Problem+JSON Specification

## 1. Purpose
This chapter defines NowVibin’s unified error-architecture: how errors originate, propagate, are normalized, mapped into Problem+JSON, and surfaced to clients and internal testers.

## 2. Design Philosophy
- Deterministic
- DTO-first
- Never leak internals
- Operator-friendly error logs

## 3. Error Classes
### 3.1 Framework Errors
- Boot failures
- Registry errors
- Env failures

### 3.2 DTO / Validation Errors
Raised during:
- Hydration
- Patch
- Create

### 3.3 Persistence Errors
Specifically:
- Duplicate-key (_id)
- Duplicate content index
- Mongo connectivity issues

## 4. Error Flow
```
Controller → Handlers → Persistence Adapter → Controller.finalize → Problem+JSON
```

## 5. Problem+JSON Mapping
### 5.1 Structure
```
{
  "type": "about:blank",
  "title": "<human readable>",
  "detail": "<specific reason>",
  "status": <HTTP>,
  "code": "<NV_CODE>",
  "issues": [...],
  "requestId": "<id>"
}
```

### 5.2 NV Codes
- DUPLICATE_ID
- DUPLICATE_CONTENT
- DUPLICATE_KEY
- BAD_REQUEST
- VALIDATION_FAILED
- INTERNAL_ERROR

## 6. Controller.finalize Rules
- Duplicate detection via `parseDuplicateKey`
- Hydration errors return 400
- Internal errors return 500
- All responses include requestId

## 7. HandlerContext Error Contracts
- `handlerStatus` ∈ { ok, warn, error }
- `response.status` / `response.body` override

## 8. Operator Guidance
- Boot failures always exit(1)
- Persistence errors logged with index hint
- All Problem+JSON include the service slug/version

## 9. Future Extensions
- I18N message mapping
- Error categories for client decisions
- Cluster-wide error telemetry via WAL writers
