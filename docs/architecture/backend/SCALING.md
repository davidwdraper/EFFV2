# Backend Scaling (Audit-focused)

[SHARD] Primary store: MongoDB **sharded**. Proposed shard key: `eventId` (UUID v4) to keep a global unique index for idempotency.

[INDEX] Required indexes:

- unique `{eventId:1}`
- `{ts:-1,_id:-1}` for time scans
- `{billingAccountId:1,ts:-1}` for billing exports
- helpful: `{slug:1,ts:-1}`, `{requestId:1}`, `{userSub:1}`

[RETENTION] OLTP hot window: 30–90 days in Mongo. Warm/cold: S3/GCS Parquet, partitioned by date and billingAccountId; query via Athena/Trino/BigQuery.

[EVOLVE] Optional Kafka later: gateway still batches+WAL; audit consumes. API/contract unchanged.

[WAL] WAL replay occurs on audit boot before live ingestion drain to avoid contention.
