# LDD-36 — DB_STATE, getDbVar(), getVar() Guardrail, and `_infra` Database Architecture

## Purpose

This LDD defines the architectural rules for:

- DB_STATE (multi-state isolation)
- Domain vs. infrastructure database classification
- getDbVar() — the only API allowed for DB-sensitive configuration
- getVar() — the guardrail preventing accidental DB misuse
- `_infra` suffix — state-invariant database identification

This document unifies the runtime environment model with persistence rules so that NowVibin services can safely run multiple states (dev, smoke, staging, prod) without ever cross-contaminating data.

## Domain vs Infrastructure DB Classification

### Domain Databases  
Represent user-facing / business data.  
These **must vary** by DB_STATE.

Rule:
DOMAIN_DB = `${NV_MONGO_DB}_${DB_STATE}`

### Infrastructure Databases  
Used for system-level functions, not tied to user state.  
These **must NOT vary** by DB_STATE.

Rule:
INFRA_DB = `${NV_MONGO_DB}_infra`

## Accessor Rules

### getVar() — Forbidden for DB Variables
Throws if called with DB-related keys and instructs to use getDbVar().

### getDbVar() — Required for All DB Configuration
Applies DB_STATE or `_infra` suffixing based on the database class.

## Boot Integration

Index builder and persistence layers derive all DB names and collection values strictly via getDbVar().  
Boot fails immediately if DB vars or DB_STATE are missing.

## Template Integration

- CRUD templates updated to use getDbVar()
- env-service DTOs store DB_STATE and DB vars
- Smoke test environment uses isolated DBs

## Summary of Invariants

1. Domain DBs suffix with `_STATE`
2. Infra DBs suffix with `_infra`
3. getVar() cannot return DB vars
4. getDbVar() is required for DB vars
5. Env-service is the single authority
6. Boot fails-fast on errors
7. Persistence only uses getDbVar() results

## References

- ADR-0074  
- LDD-00, LDD-02, LDD-29  
