# LDG — t_entity_crud Template Guide
## Overview
This Living Design Guide describes how the t_entity_crud template implements CRUD services using shared rails.

## 1. Boot Flow (Service Entrypoint)
See LDD for shared diagram; the service does:
  - envBootstrap
  - createApp
  - mount routes
  - listen

## 2. DTO Registry (Registry.ts)
- ctorByType returns:
    { "xxx": XxxDto }
- Seeds DTO collection name
- Provides newXxxDto() and fromJsonXxx()

## 3. Route Surface
All routes under:
  /api/xxx/v1/:dtoType/<op>

### Supported ops:
  PUT    :dtoType/create
  PATCH  :dtoType/update/:id
  GET    :dtoType/read/:id
  DELETE :dtoType/delete/:id
  GET    :dtoType/list

## 4. Controller Pattern
Example: XxxUpdateController
- makeContext
- dtoType selection
- normalizes id
- seeds hydrator
- selects pipeline

## 5. Handler Pipelines (xxx.update)
Indented:
  BagPopulateGetHandler →
  LoadExistingUpdateHandler →
  ApplyPatchUpdateHandler →
  BagToDbUpdateHandler

ASCII:
  BagPopulateGetHandler
        ↓
  LoadExistingUpdateHandler
        ↓
  ApplyPatchUpdateHandler
        ↓
  BagToDbUpdateHandler

## 6. DB Write Semantics
- All writes through DbWriter
- DTOs are canonical: id, fields, timestamps
- WAL-first to be added later

