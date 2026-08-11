# f5xc-lab-mgmt

## PostgreSQL

The service requires a Lightsail PostgreSQL connection string in `DATABASE_URL`.
Schema migrations in `migrations/` are applied automatically before the HTTP server starts. Existing course and student rows are preserved across restarts.

Lightsail normally requires TLS, which is enabled by default. Set `PGSSLMODE=verify-full` to verify the server certificate, or `PGSSLMODE=disable` only for a local PostgreSQL instance.
