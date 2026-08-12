# Lightsail stale-deployment cleanup worker

This is a separate container from the lab-management API. Every three minutes it finds `xcspeccore` deployments whose latest ping is more than five minutes old. It deletes the generated Secure Mesh Site v2 (MCN) and registration token, then marks the student payload as cleaned.

Only `xcspeccore` is supported. Other course records are never selected.

## Build

```shell cleanup-worker/README.md
docker build -t f5xc-lab-cleanup-worker ./cleanup-worker
```

## Run

```shell cleanup-worker/README.md
docker run -d \
  --name f5xc-lab-cleanup-worker \
  --restart unless-stopped \
  -e DATABASE_URL='postgresql://user:password@host/database' \
  -e PGSSLMODE=require \
  -e F5XC_DOMAIN='tenant.console.ves.volterra.io' \
  -e F5XC_API_TOKEN='your-api-token' \
  f5xc-lab-cleanup-worker
```

For Lightsail Containers, configure the same environment variables in the service deployment. Set the public endpoint to container port `8080`; it returns a minimal health response. Do not place the database URL or API token in the image.

## Optional settings

- `SCAN_INTERVAL_MS`: database scan interval, default `180000` (3 minutes).
- `STALE_AFTER_MS`: ping age before cleanup, default `300000` (5 minutes).
- `CLAIM_TIMEOUT_MS`: allows another worker to retry an interrupted cleanup, default `900000` (15 minutes).
- `PGPOOL_MAX`: PostgreSQL pool size, default `3`.
- `F5XC_TIMEOUT_MS`: individual F5XC request timeout, default `30000`.
- `PORT`: health endpoint port, default `8080`.

Cleanup claims use row locks, so multiple replicas do not normally process the same row. HTTP 404 responses from deletion are treated as success, making cleanup safe to retry. Successful student records remain in the database with `payload.cleanup.state` set to `cleaned` for audit purposes.
