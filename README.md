# f5xc-lab-mgmt

## PostgreSQL

The service requires a Lightsail PostgreSQL connection string in `DATABASE_URL`.
Schema migrations in `migrations/` are applied automatically before the HTTP server starts. Existing course and student rows are preserved across restarts.

Lightsail normally requires TLS, which is enabled by default. Set `PGSSLMODE=verify-full` to verify the server certificate, or `PGSSLMODE=disable` only for a local PostgreSQL instance.

## Per-workshop F5XC credentials

Production requires `F5XC_CREDENTIALS_BASE64`, containing base64-encoded JSON with an `xcspeccore` API key. String values use the common XC address from `F5XC_URL` during deployment (`F5XC_DOMAIN` inside the container):

```json README.md
{"xcspeccore":"key1","xcspecsecurity":"key2","xcspecautomation":"key3"}
```

Generate the value without introducing a newline:

```shell README.md
printf '%s' '{"xcspeccore":"key1","xcspecsecurity":"key2","xcspecautomation":"key3"}' | base64
```

A workshop can override the common address by using an object:

```json README.md
{"xcspeccore":{"domain":"tenant.console.ves.volterra.io","key":"key1"}}
```

Set the result in `.env` as `F5XC_CREDENTIALS_BASE64`. `deploy-lightsail.sh` validates it before building and injects both `F5XC_CREDENTIALS_BASE64` and `F5XC_DOMAIN` into the Lightsail container environment. The secret is intentionally not stored in the Docker image.
