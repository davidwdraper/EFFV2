# LDD — Shared CRUD Rails (Env‑Backed Services)
## Overview
This Living Design Doc describes the shared rails used by all CRUD‑style services cloned from `t_entity_crud`.

## 1. Boot Sequence
### Indented Flow
Boot:
  Process start →
    envBootstrap →
      SvcClient.call(env-service) →
        DtoBag<EnvServiceDto> →
    createApp →
      AppBase.boot →
        Registry.ensureIndexes →
      mountRoutes →
    app.listen

### ASCII Diagram
process start
    ↓
envBootstrap
    ↓
SvcClient → env-service
    ↓
DtoBag<EnvServiceDto>
    ↓
createApp
    ↓
AppBase.boot → Registry.ensureIndexes
    ↓
mountRoutes
    ↓
app.listen

## 2. Env Bootstrap Rails
- envBootstrap builds SvcClient and SvcEnvClient
- Resolves NV_ENV
- Fetches config bag for (env, slug, version)
- Derives NV_HTTP_HOST and NV_HTTP_PORT
- Returns envBag + envReloader

## 3. AppBase Responsibilities
- Own service identity (slug/version)
- Own envDto and envReloader
- Boot:
  - diagnostics
  - registry.ensureIndexes
  - mountRoutes

## 4. Registry Rails
- Maps dtoType → constructor
- Seeds collection names
- Provides hydrators
- Determines indexHints and delegates creation

## 5. Controllers & Pipelines
- Each route has a controller class
- Controller:
  - builds HandlerContext
  - seeds hydrators
  - selects pipeline
- Pipeline:
  - run handlers in order
  - must produce ctx["result"] or error status

## 6. Bag Semantics
- Wire envelope:
  { items: [...], meta: {...} }
- DTO-only persistence: dto.toJson()
- Bag invariants:
  - immutable
  - ordered
  - singleton when required

## 7. Duplicate-Key and Problem+JSON
- Mongo 11000 mapped through DuplicateKeyError
- Registry type “ux_xxx_business” → DUPLICATE_CONTENT
- _id_ → DUPLICATE_ID
- All other → DUPLICATE_KEY
