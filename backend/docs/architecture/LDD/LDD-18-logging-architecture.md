# LDD-18 — Logging Architecture (RequestId, pino-http, Audit Separation, Error Sinks)

## 1. Purpose
Define NowVibin’s unified logging discipline:
- Deterministic request-scoped logs
- Consistent `requestId` propagation
- Separation of application logs, security logs, audit logs, and WAL logs
- Zero noise, zero drift

## 2. Logging Stack Overview
- **pino-http** for request logging at the gateway & service edge.
- **IBoundLogger** used across controllers, handlers, and shared utilities.
- **Audit logs** pushed through audit middleware → WAL → writer.
- **Security logs** isolated for auth failures, S2S violations, and replay attempts.

## 3. RequestId Propagation
### 3.1 Generation
- At gateway entry: generate if missing from client.
- For S2S calls: SvcClient always includes the current requestId.
- Within services: ControllerBase seeds requestId in HandlerContext.

### 3.2 Invariants
- Every log line must include:
  - `requestId`
  - `service`
  - `version`
  - `component`

### 3.3 Failure Modes
- Missing requestId = bug. Controllers throw if it cannot be established.

## 4. Log Levels
- `info`: major lifecycle events, mount, boot, index ensures.
- `debug`: pipeline selection, handler execution, hydrate events.
- `warn`: user/data-controlled errors (validation, 400s, 404s).
- `error`: internal failures, persistence failures, WAL failures.

## 5. Logging Domains
### 5.1 Application Logs
General operational logs:
- Route mount
- Boot complete
- Index ensure

### 5.2 Security Logs
Strict domain:
- Missing/invalid S2S headers
- Invalid JWT (future)
- Unexpected callerSlug/version

### 5.3 Audit Logs
Produced exclusively by:
- Bag→WAL writers
- Audit middleware
- Replay events

### 5.4 Error Sink Logs
For 500-errors inside Controller.finalize.

## 6. Handler Logging Requirements
Every handler must log:
```
onEnter:  debug
onSuccess: debug
onWarn: warn
onError: error
```

## 7. Logger Binding
Each component binds:
```
log.bind({ component: "<name>" })
```
Controllers do this in ctor. Handlers do this per instance.

## 8. Operator Guidance
- Excess debug can be toggled via NV_LOG_LEVEL.
- Requests can be traced end-to-end through the requestId.
- Boot failures always log to both console and file.
- WAL failures must be fixed immediately; they indicate data loss risk.

## 9. Future Evolution
- S3 log shipping
- Multi-region trace stitching
- Structured error fingerprints
- S2S JWT-based caller identity logs
