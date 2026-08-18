#!/usr/bin/env bash
set -euo pipefail

FRAMEWORK_REPOSITORY="https://github.com/f5selevin/partner-spec-guide-view"
DOCS_REPOSITORY="https://github.com/f5selevin/partner-spec-xC-core"

LABGUIDE_HOME="${LABGUIDE_HOME:-${HOME}/labguide-server}"
BUILD_DIR="${LABGUIDE_HOME}/build"
SRC_DIR="${BUILD_DIR}/src"
DOCS_DIR="${BUILD_DIR}/docs"
IMAGE_NAME="${LABGUIDE_IMAGE:-f5xc-labguide-server}"
CONTAINER_NAME="${LABGUIDE_CONTAINER:-f5xc-labguide-server}"
HOST_PORT="${LABGUIDE_PORT:-3500}"

METADATA_IP="${LABGUIDE_METADATA_IP:-10.1.1.4}"
METADATA_PORT="${LABGUIDE_METADATA_PORT:-5123}"

DEPLOYMENT_HOST="${LABGUIDE_DEPLOYMENT_HOST:-metadata.udf}"
DEPLOYMENT_IP="${LABGUIDE_DEPLOYMENT_IP:-10.1.1.1}"

METADATA_URL="${LABGUIDE_METADATA_URL:-http://${METADATA_IP}:${METADATA_PORT}/metadata}"
DEPLOYMENT_URL="${LABGUIDE_DEPLOYMENT_URL:-http://${DEPLOYMENT_HOST}/deployment}"

NETWORK_CHECK_URL="${NETWORK_CHECK_URL:-https://xs.partner-spec.f5demos.com/}"
NETWORK_CHECK_INTERVAL_SECONDS="${NETWORK_CHECK_INTERVAL_SECONDS:-10}"

for command in curl git docker; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command not found: ${command}" >&2
    exit 1
  fi
done

wait_for_network() {
  local status

  echo "Waiting for network access: ${NETWORK_CHECK_URL}"
  while true; do
    status="$(curl --location --silent --output /dev/null --write-out '%{http_code}' \
      --connect-timeout 5 --max-time 15 "${NETWORK_CHECK_URL}" || true)"
    if [[ "${status}" == "200" ]]; then
      echo "Network is available (${NETWORK_CHECK_URL} returned 200)"
      return 0
    fi

    echo "Network is not ready (${NETWORK_CHECK_URL} returned ${status:-no response}); retrying in ${NETWORK_CHECK_INTERVAL_SECONDS}s"
    sleep "${NETWORK_CHECK_INTERVAL_SECONDS}"
  done
}

wait_for_network
mkdir -p "${BUILD_DIR}"

clone_or_update() {
  local repository="$1"
  local destination="$2"

  if [[ -d "${destination}/.git" ]]; then
    echo "Updating ${destination}"
    git -C "${destination}" fetch --depth 1 origin
    git -C "${destination}" reset --hard origin/HEAD
    git -C "${destination}" clean -fdx
  else
    echo "Cloning ${repository} into ${destination}"
    rm -rf "${destination}"
    git clone --depth 1 "${repository}" "${destination}"
  fi
}

clone_or_update "${FRAMEWORK_REPOSITORY}" "${SRC_DIR}"
clone_or_update "${DOCS_REPOSITORY}" "${DOCS_DIR}"

cat >"${BUILD_DIR}/Dockerfile" <<'EOF'
FROM node:22-alpine AS dependencies
WORKDIR /app/src
COPY src/package.json src/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
ENV NODE_ENV=production
WORKDIR /app/src
COPY --from=dependencies /app/src/node_modules ./node_modules
COPY src/ ./
COPY docs/ /app/docs/
RUN node -e 'const fs = require("fs"); const path = "components/rst-widgets.tsx"; const source = fs.readFileSync(path, "utf8"); const original = `const deploymentUrl = process.env.NODE_ENV === "development"\n  ? "http://localhost:5123/deployment"\n  : "http://metadata.udf/deployment";`; const replacement = `const deploymentUrl = process.env.DEPLOYMENT_URL || (process.env.NODE_ENV === "development"\n  ? "http://localhost:5123/deployment"\n  : "http://metadata.udf/deployment");`; if (!source.includes(original)) throw new Error("Unable to add DEPLOYMENT_URL support"); fs.writeFileSync(path, source.replace(original, replacement));'
RUN npm run build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV PORT=3500
ENV HOSTNAME=0.0.0.0
WORKDIR /app/src
COPY --from=builder /app/src ./
COPY --from=builder /app/docs /app/docs
EXPOSE 3500
CMD ["npm", "run", "start", "--", "-p", "3500", "-H", "0.0.0.0"]
EOF

cat >"${BUILD_DIR}/.dockerignore" <<'EOF'
src/.git
src/node_modules
src/.next
docs/.git
EOF

echo "Framework commit: $(git -C "${SRC_DIR}" rev-parse HEAD)"
echo "Documentation commit: $(git -C "${DOCS_DIR}" rev-parse HEAD)"
echo "Building ${IMAGE_NAME} without cached layers"
docker build --no-cache --pull -t "${IMAGE_NAME}" "${BUILD_DIR}"
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "${IMAGE_NAME}")"

echo "Removing any existing ${CONTAINER_NAME} container"
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

echo "Using metadata endpoint ${METADATA_URL}"
echo "Using deployment endpoint ${DEPLOYMENT_URL}"
echo "Starting a new ${CONTAINER_NAME} container on port ${HOST_PORT}"
CONTAINER_ID="$(docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  --add-host "${DEPLOYMENT_HOST}:${DEPLOYMENT_IP}" \
  -e METADATA_URL="${METADATA_URL}" \
  -e DEPLOYMENT_URL="${DEPLOYMENT_URL}" \
  -p "${HOST_PORT}:3500" \
  "${IMAGE_NAME}")"

echo "Built image: ${IMAGE_ID}"
echo "Started container: ${CONTAINER_ID}"
docker ps --filter "id=${CONTAINER_ID}" --format 'Container {{.ID}} is {{.Status}} on {{.Ports}}'
echo "Labguide server is available on port ${HOST_PORT}."
