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
  -e F5XC_CREDENTIALS_BASE64='base64-encoded-course-credentials' \
  -e DASHBOARD_PASSWORD='change-me' \
  -p 8080:8080 \
  f5xc-lab-cleanup-worker
```

For Lightsail Containers, configure the same environment variables in the service deployment. For each stale database row, the worker uses its `course_id` to select the domain and key from `F5XC_CREDENTIALS_BASE64`; string credentials use `F5XC_DOMAIN` as the common domain. Set the public endpoint to container port `8080`. The root path returns health and worker state JSON. The `/dashboard` path provides authenticated start and stop controls using HTTP Basic authentication, with the same password-only behavior as the management dashboard. Stopping pauses future scans; it does not interrupt a cleanup already in progress. Control state is in memory and resets to running when the container restarts. Do not place the database URL or credentials in the image.

## Optional settings

- `SCAN_INTERVAL_MS`: database scan interval, default `180000` (3 minutes).
- `STALE_AFTER_MS`: ping age before cleanup, default `300000` (5 minutes).
- `CLAIM_TIMEOUT_MS`: allows another worker to retry an interrupted cleanup, default `900000` (15 minutes).
- `PGPOOL_MAX`: PostgreSQL pool size, default `3`.
- `F5XC_TIMEOUT_MS`: individual F5XC request timeout, default `30000`.
- `PORT`: health and dashboard endpoint port, default `8080`.
- `DASHBOARD_PASSWORD`: HTTP Basic dashboard password, default `xcspeclabs`; set an explicit secret in production.

Cleanup claims use row locks, so multiple replicas do not normally process the same row. The registration access token is deleted before the SMSv2 site is deactivated and deleted. HTTP 404 responses are treated as success. A failed cleanup is marked with `payload.cleanup.state` set to `failed` and is not retried; only an abandoned `processing` claim can be reclaimed after `CLAIM_TIMEOUT_MS`. Successful records are marked `cleaned`, and the token value is removed from `payload.smsv2Site.token`.
