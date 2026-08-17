# f5xc-lab-mgmt

## PostgreSQL

The service requires a Lightsail PostgreSQL connection string in `DATABASE_URL`.
Schema migrations in `migrations/` are applied automatically before the HTTP server starts. Existing course and student rows are preserved across restarts.

Lightsail normally requires TLS, which is enabled by default. Set `PGSSLMODE=verify-full` to verify the server certificate, or `PGSSLMODE=disable` only for a local PostgreSQL instance.

## Course selection and F5XC credentials

The UDF startup agent receives the course ID as its first command-line argument and sends it in the `courseId` property of each API request. The management API uses that request property to select the course implementation and credentials. The shared cleanup worker processes every course listed in its `supportedCourseIds` array. Production requires `F5XC_CREDENTIALS_BASE64`, containing base64-encoded JSON with an API key for each supported course. String values use the common XC address from `F5XC_URL` during deployment (`F5XC_DOMAIN` inside the container):

```json README.md
{ "xcspeccore": "key1" }
```

Generate the value without introducing a newline:

```shell README.md
printf '%s' '{ "xcspeccore": "key1" }' | base64
```

The course can override the common address by using an object:

```json README.md
{ "xcspeccore": { "domain": "tenant.console.ves.volterra.io", "key": "key1" } }
```

Set the result in `.env` as `F5XC_CREDENTIALS_BASE64`. `deploy-mgmt-lightsail` validates it before building and injects both `F5XC_CREDENTIALS_BASE64` and `F5XC_DOMAIN` into the Lightsail container environment. The secret is intentionally not stored in the Docker image.

## Labguide server

Download and run the labguide systemd installer directly from GitHub:

```shell README.md
INSTALL_DIR="$(mktemp -d)" && \
curl -fsSL https://raw.githubusercontent.com/f5selevin/f5xc-lab-mgmt/main/udf/labguide/register-labguide-server.sh -o "${INSTALL_DIR}/register-labguide-server.sh" && \
curl -fsSL https://raw.githubusercontent.com/f5selevin/f5xc-lab-mgmt/main/udf/labguide/create-labguide-server.sh -o "${INSTALL_DIR}/create-labguide-server.sh" && \
chmod +x "${INSTALL_DIR}"/*.sh && \
sudo "${INSTALL_DIR}/register-labguide-server.sh"; \
rm -rf "${INSTALL_DIR}"
```

The installer registers and starts a systemd service that builds the labguide and exposes it on port `3500`. It uses the `ubuntu` account by default. To use another account, run the `sudo` command with `SERVICE_USER=<account>`.

## Lightsail deployment scripts

- `deploy-mgmt-lightsail` deploys the management API.
- `deploy-cleanup-lightsail` builds and deploys the shared `cleanup-worker`. It requires `CLEANUP_SERVICE_NAME` and credentials for its supported courses in `F5XC_CREDENTIALS_BASE64`. `CLEANUP_CONTAINER_NAME`, `CLEANUP_LOCAL_IMAGE`, and `CLEANUP_IMAGE_LABEL` are optional.
