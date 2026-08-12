# f5xc-lab-mgmt

## PostgreSQL

The service requires a Lightsail PostgreSQL connection string in `DATABASE_URL`.
Schema migrations in `migrations/` are applied automatically before the HTTP server starts. Existing course and student rows are preserved across restarts.

Lightsail normally requires TLS, which is enabled by default. Set `PGSSLMODE=verify-full` to verify the server certificate, or `PGSSLMODE=disable` only for a local PostgreSQL instance.

## Per-workshop F5XC credentials


Production requires `F5XC_CREDENTIALS_BASE64`. Its value is a base64-encoded JSON document containing the XC domain and API key for each workshop.

Create `credentials.json` with this structure:

```json README.md

{
  "xcspeccore": {
    "domain": "msp1.console.ves.volterra.io",
    "key": "123123"
  },
  "xcspecsecurity": {
    "domain": "msp2.console.ves.volterra.io",
    "key": "123123"
  },
  "xcspecaut": {
    "domain": "msp3.console.ves.volterra.io",
    "key": "123123"
  }
}
```


Validate that the file is valid JSON and that all required entries contain non-empty `domain` and `key` strings:

```shell README.md

jq -e '
  . as $root |
  type == "object" and
  (["xcspeccore", "xcspecsecurity", "xcspecaut"] | all(
    . as $name |
    ($root[$name] | type == "object") and
    ($root[$name].domain | type == "string" and length > 0) and
    ($root[$name].key | type == "string" and length > 0)
  ))
' credentials.json >/dev/null
```


Validate and base64-encode it as a single line. The output file is written only when validation succeeds:



```shell README.md
jq -e '
  . as $root |
  type == "object" and
  (["xcspeccore", "xcspecsecurity", "xcspecaut"] | all(
    . as $name |
    ($root[$name] | type == "object") and
    ($root[$name].domain | type == "string" and length > 0) and
    ($root[$name].key | type == "string" and length > 0)
  ))
' credentials.json >/dev/null \
  && base64 < credentials.json | tr -d '\n' > credentials.json.b64
```


Add the encoded value to `.env`:

```shell README.md
printf 'F5XC_CREDENTIALS_BASE64=%s\n' "$(cat credentials.json.b64)" >> .env
```

`deploy-lightsail.sh` validates the encoded JSON and its `xcspeccore` entry before building. It injects `F5XC_CREDENTIALS_BASE64` into the Lightsail container as a runtime environment variable. The application selects the object matching the requested workshop and uses that object's `domain` and `key` to connect to XC.

The credential is intentionally not baked into the Docker image or stored in an image layer. `F5XC_DOMAIN`, derived from the legacy `F5XC_URL`, is also injected as a backwards-compatible fallback but does not override an object-level `domain`.
