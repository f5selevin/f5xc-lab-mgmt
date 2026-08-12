#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  print -u2 "Environment file not found: $ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

: "${AWS_REGION:?AWS_REGION must be set in $ENV_FILE}"
: "${SERVICE_NAME:?SERVICE_NAME must be set in $ENV_FILE}"
: "${CONTAINER_NAME:?CONTAINER_NAME must be set in $ENV_FILE}"
: "${LOCAL_IMAGE:?LOCAL_IMAGE must be set in $ENV_FILE}"
: "${F5XC_URL:?F5XC_URL must be set in $ENV_FILE}"
: "${F5XC_KEY:?F5XC_KEY must be set in $ENV_FILE}"

: "${DB_HOST:?DB_HOST must be set in $ENV_FILE}"
: "${DB_PORT:?DB_PORT must be set in $ENV_FILE}"
: "${DB_NAME:?DB_NAME must be set in $ENV_FILE}"
: "${DB_USER:?DB_USER must be set in $ENV_FILE}"
: "${DB_PASSWORD:?DB_PASSWORD must be set in $ENV_FILE}"

PGSSLMODE="${PGSSLMODE:-require}"
NODE_ENV="${NODE_ENV:-production}"
DOCKER_CONTEXT="${DOCKER_CONTEXT:-rancher-desktop}"

# Lightsail replaces the complete container definition on every deployment.
# If the credential map is not local, preserve it from the active deployment.
if [[ -z "${F5XC_CREDENTIALS_BASE64:-}" ]]; then
  F5XC_CREDENTIALS_BASE64="$(
    aws lightsail get-container-services \
      --region "$AWS_REGION" \
      --service-name "$SERVICE_NAME" \
      --output json |
      jq -r --arg container "$CONTAINER_NAME" \
        '.containerServices[0].currentDeployment.containers[$container].environment.F5XC_CREDENTIALS_BASE64 // empty'
  )"
fi

if [[ -z "$F5XC_CREDENTIALS_BASE64" ]]; then
  print -u2 "F5XC_CREDENTIALS_BASE64 is not set locally or in the active Lightsail deployment"
  exit 1
fi
export F5XC_CREDENTIALS_BASE64

export F5XC_DOMAIN="${F5XC_URL#https://}"
F5XC_DOMAIN="${F5XC_DOMAIN%/}"
export F5XC_DOMAIN

node -e '
  const encoded = process.env.F5XC_CREDENTIALS_BASE64;
  let credentials;
  try {
    credentials = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    console.error("F5XC_CREDENTIALS_BASE64 must be base64-encoded valid JSON");
    process.exit(1);
  }

  const credential = credentials.xcspeccore;
  if (!credential) {
    console.error("F5XC_CREDENTIALS_BASE64 must contain xcspeccore");
    process.exit(1);
  }

  const key = typeof credential === "string"
    ? credential
    : credential.key || credential.apiKey || credential.apikey;
  const domain = typeof credential === "string"
    ? process.env.F5XC_DOMAIN
    : credential.domain || credential.address || process.env.F5XC_DOMAIN;
  if (!key || !domain) {
    console.error("The xcspeccore credential requires both an XC domain and API key");
    process.exit(1);
  }
'

if ! docker context inspect "$DOCKER_CONTEXT" >/dev/null 2>&1; then
  print -u2 "Docker context does not exist: $DOCKER_CONTEXT"
  exit 1
fi

# lightsailctl talks to the Docker API directly and may ignore Docker's active
# context. Export its endpoint so both Docker and lightsailctl use Rancher.
export DOCKER_HOST="$(docker context inspect "$DOCKER_CONTEXT" --format '{{ .Endpoints.docker.Host }}')"
if [[ -z "$DOCKER_HOST" ]]; then
  print -u2 "Docker context $DOCKER_CONTEXT has no Docker endpoint"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  print -u2 "Cannot connect to Rancher Desktop at $DOCKER_HOST. Ensure Rancher Desktop is running with the dockerd (moby) engine."
  exit 1
fi

CONTAINERS_FILE="$(mktemp)"
PUBLIC_ENDPOINT_FILE="$(mktemp)"
cleanup() {
  rm -f "$CONTAINERS_FILE" "$PUBLIC_ENDPOINT_FILE"
  unset DB_PASSWORD DATABASE_URL F5XC_KEY F5XC_CREDENTIALS_BASE64 F5XC_DOMAIN
}
trap cleanup EXIT

# URL-encode credentials so punctuation in the password remains valid in the URI.
export DATABASE_URL="$(
  node -e '
    const user = encodeURIComponent(process.env.DB_USER);
    const password = encodeURIComponent(process.env.DB_PASSWORD);
    console.log(`postgresql://${user}:${password}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  '
)"

# Fail early if the target Lightsail container service does not already exist.
aws lightsail get-container-services \
  --region "$AWS_REGION" \
  --service-name "$SERVICE_NAME" >/dev/null

docker buildx build \
  --platform linux/amd64 \
  --load \
  --tag "$LOCAL_IMAGE" \
  .

IMAGE_LABEL="${IMAGE_LABEL:-app}"

# This customized AWS CLI command cannot reliably serialize --query/--output
# results in every CLI version, so query the uploaded image separately.
aws lightsail push-container-image \
  --region "$AWS_REGION" \
  --service-name "$SERVICE_NAME" \
  --label "$IMAGE_LABEL" \
  --image "$LOCAL_IMAGE"

LIGHTSAIL_IMAGE="$(
  aws lightsail get-container-images \
    --region "$AWS_REGION" \
    --service-name "$SERVICE_NAME" \
    --query "containerImages[?starts_with(image, ':${SERVICE_NAME}.${IMAGE_LABEL}.')]|[0].image" \
    --output text
)"

if [[ -z "$LIGHTSAIL_IMAGE" || "$LIGHTSAIL_IMAGE" == "None" ]]; then
  print -u2 "Could not find the uploaded Lightsail image for label $IMAGE_LABEL"
  exit 1
fi

export LIGHTSAIL_IMAGE

jq -n \
  --arg name "$CONTAINER_NAME" \
  --arg image "$LIGHTSAIL_IMAGE" \
  --arg databaseUrl "$DATABASE_URL" \
  --arg f5xcHost "$F5XC_DOMAIN" \
  --arg f5xcKey "$F5XC_KEY" \
  --arg f5xcCredentialsBase64 "$F5XC_CREDENTIALS_BASE64" \
  --arg pgSslMode "$PGSSLMODE" \
  --arg nodeEnvironment "$NODE_ENV" \
  '{
    ($name): {
      image: $image,
      command: ["node", "index.js", $f5xcHost, $f5xcKey],
      environment: {
        DATABASE_URL: $databaseUrl,
        F5XC_DOMAIN: $f5xcHost,
        F5XC_CREDENTIALS_BASE64: $f5xcCredentialsBase64,
        PGSSLMODE: $pgSslMode,
        NODE_ENV: $nodeEnvironment
      },
      ports: {
        "8080": "HTTP"
      }
    }
  }' > "$CONTAINERS_FILE"

jq -n \
  --arg name "$CONTAINER_NAME" \
  '{
    containerName: $name,
    containerPort: 8080
  }' > "$PUBLIC_ENDPOINT_FILE"

aws lightsail create-container-service-deployment \
  --region "$AWS_REGION" \
  --service-name "$SERVICE_NAME" \
  --containers "file://$CONTAINERS_FILE" \
  --public-endpoint "file://$PUBLIC_ENDPOINT_FILE"

aws lightsail wait container-service-is-active \
  --region "$AWS_REGION" \
  --service-name "$SERVICE_NAME"

aws lightsail get-container-services \
  --region "$AWS_REGION" \
  --service-name "$SERVICE_NAME" \
  --query 'containerServices[0].{state:state,url:url,currentDeployment:currentDeployment.state}' \
  --output table
