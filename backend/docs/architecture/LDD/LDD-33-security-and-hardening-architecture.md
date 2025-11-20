# LDD-33 --- Security and Hardening Architecture

## Overview

This chapter defines NowVibin's security rails across all services.

## Core Principles

-   Zero trust across services.
-   All S2S calls authenticated with JWT (future KMS minting).
-   No shared secrets in code.
-   TLS enforced in staging/prod.

## Components

### 1. Authentication

-   Auth service issues access tokens.
-   Refresh tokens stored in secure DB.

### 2. Authorization

-   Role-based.
-   Enforced at gateway and service level.

### 3. S2S Security

-   Every service validates caller slug/version.
-   Mandatory headers: authorization, x-request-id, x-service-name.

### 4. Input Validation

-   All inbound JSON validated via DTO Zod contracts.

### 5. Audit & WAL

-   All mutations go through WAL → DB.
-   Security logs segregated.

## Future Work

-   KMS‑backed JWT signing.
-   mTLS for internal mesh.
