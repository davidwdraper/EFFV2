# LDD Compression (Structural Overview of All LDD Files)

Each LDD is represented by its primary headings only.
This is the canonical “compressed form” for architectural grounding.

---

## LDD-00 — Shared CRUD Rails

- 1. Purpose
- 2. CRUD Guarantees
- 3. Routing Rails
- 4. Pipeline & Controller Contracts
- 5. DTO Rules
- 6. Bag Semantics
- 7. Duplicate-Key and Problem+JSON

## LDD-01 — DTO-First Principles

- Purpose
- High-Level Flow
- Rules
- Contract Structure

## LDD-02 — Handler & Pipeline Architecture

- Purpose
- HandlerContext Rules
- Pipeline Assembly
- Error/Success Flow

## LDD-03 — Repo Architecture

- Purpose
- Writer Rules
- Reader Rules
- Query & List Determinism

## LDD-04 — Health System

- Purpose
- Health Route Behavior
- Boot Interaction

## LDD-05 — Mongo Persistence Model

- Collections
- Index Rules
- Deterministic Naming

## LDD-06 — SvcEnvClient & Env Loading

- Purpose
- Boot Sequence
- Required Variables
- Failure Modes

## LDD-07 — Routing Model

- Path Structure
- Versioning Rules
- DTO Type Segment

## LDD-08 — Request Lifecycle

- Meta
- Audit
- Validation
- Error Strategy

## LDD-09 — Validation Architecture

- Zod Contracts
- Patch Rules
- Reject Conditions

## LDD-10 — Create Flow

- Request Shape
- Bag Semantics
- Duplicate Behavior

## LDD-11 — Read Flow

- By-ID
- Error Cases
- Deterministic Output

## LDD-12 — Patch Flow

- Merge Rules
- Conflict Behavior
- DTO Mutation Validations

## LDD-13 — Delete Flow

- Idempotency
- Response Norms

## LDD-14 — List Flow

- Cursor Rules
- Sort Rules
- Last-Page Behavior

## LDD-15 — Query Flow

- Filter Rules
- Optional Operator Set

## LDD-16 — Service Boot Architecture

- Boot Order
- Environment Requirements
- Index Bootstrap

## LDD-17 — Error Architecture & Problem+JSON

- Purpose
- Error Classes
- DTO/Validation Errors
- Persistence Errors
- Error Flow
- Problem+JSON Mapping
- finalize() Rules
- HandlerContext Error Semantics

## LDD-18 — Duplicate-Key Behavior

- UUID Provided
- UUID Missing
- Duplicate-by-Content Definition

## LDD-19 — Cursor Architecture

- Cursor Encoding
- Deterministic Sorting
- Last-Page Guarantees

## LDD-20 — Audit & WAL Integration

- WAL Overview
- Audit Service Expectations
- Mutation Logging Rules

## LDD-21 — DTO Round-Trip Model

- toJson()
- fromJson()
- Contract Binding

## LDD-22 — Type/DTO Registry

- Registry Structure
- Lookup Rules
- Error Modes

## LDD-23 — Handler & Pipeline (Extended)

- Validate → DTO → Repo → Response
- Pipeline Safety Rails

## LDD-24 — Repo Rules (Extended)

- Reader/Writer Safety
- Deterministic Behavior

## LDD-25 — CRUD Summary

- Combined CRUD Lifecycle
- Required Guarantees

## LDD-26 — Index Rails

- Index Hints
- Runtime Enforcement
- Boot Validation

## LDD-27 — Bag Semantics & Multi-Write Behavior

- Bag Structure
- Multi-Create Semantics
- Ordering Guarantees

## LDD-28 — Auth Service Architecture

- Token Minting
- Token Verification
- Password Rules
- Credential Store
- S2S Rules
- Threat Model

## LDD-29 — Collection Naming Architecture

- Env-Service Driven
- DTO-to-Collection Mapping

## LDD-30 — SvcConfig Architecture

- Purpose
- Routing
- Env Versioning

## LDD-31 — Route Policy Gates

- Request Filtering
- ADR-31/32/29 Integration

## LDD-32 — DtoBag & Multi-DTO Behavior

- Bag Lifecycle
- DTO Merging Rules

## LDD-33 — Logging Architecture

- Request-Level Logging
- Pipeline Logging
- Error Logging
- Boot Logging

## LDD-34 — Shared S2S Gate & Authorization Flow

- S2S Token Rules
- Required Headers
- verifyS2S Placement
- Worker Behavior
- Error Modes
