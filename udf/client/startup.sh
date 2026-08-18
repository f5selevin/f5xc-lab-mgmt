#!/usr/bin/env bash

set -o pipefail

STARTUP_HOME="${HOME:-/home/ubuntu}"
STARTUP_DIR="${STARTUP_HOME}/startup"
LAB_DIR="${STARTUP_HOME}/lab"
NETWORK_CHECK_URL="${NETWORK_CHECK_URL:-https://xs.partner-spec.f5demos.com/}"
NETWORK_CHECK_INTERVAL_SECONDS="${NETWORK_CHECK_INTERVAL_SECONDS:-10}"

exec 9>"${STARTUP_DIR}/startup.lock"
if ! flock -n 9; then
  echo "Another startup process is already running; exiting"
  exit 0
fi

exec 3>&1 4>&2
trap 'exec 2>&4 1>&3' 0 1 2 3
exec 1>"${STARTUP_DIR}/startup.log" 2>&1

if ! command -v curl >/dev/null 2>&1; then
  echo "Required command not found: curl" >&2
  exit 1
fi

wait_for_network() {
  local status

  echo "Waiting for network access: ${NETWORK_CHECK_URL}"
  while true; do
    status="$(curl --location --silent --output /dev/null --write-out '%{http_code}' \
      --connect-timeout 5 --max-time 15 "${NETWORK_CHECK_URL}" || true)"
    if [ "${status}" = "200" ]; then
      echo "Network is available (${NETWORK_CHECK_URL} returned 200)"
      return 0
    fi

    echo "Network is not ready (${NETWORK_CHECK_URL} returned ${status:-no response}); retrying in ${NETWORK_CHECK_INTERVAL_SECONDS}s"
    sleep "${NETWORK_CHECK_INTERVAL_SECONDS}"
  done
}

setup_node_runtime() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    echo "Using Node $(node --version) and npm $(npm --version)"
    return 0
  fi

  export NVM_DIR="${NVM_DIR:-${STARTUP_HOME}/.nvm}"
  if [ -s "${NVM_DIR}/nvm.sh" ]; then
    # systemd does not load the user's shell profile, so load NVM explicitly.
    # shellcheck disable=SC1090
    source "${NVM_DIR}/nvm.sh"

    nvm use --lts >/dev/null 2>&1 \
      || nvm use default >/dev/null 2>&1 \
      || {
        local latest_node_dir
        latest_node_dir=$(find "${NVM_DIR}/versions/node" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
          | sort -V | tail -n 1)
        if [ -n "${latest_node_dir}" ]; then
          export PATH="${latest_node_dir}/bin:${PATH}"
        fi
      }
  fi

  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "Node.js and npm were not found. Install them system-wide or under ${NVM_DIR}." >&2
    return 1
  fi

  echo "Using Node $(node --version) and npm $(npm --version)"
}

install_ping_client() {
  local client_dir="${LAB_DIR}/udf/client"
  local image="f5xc-udf-deployment-client"
  local container="f5xc-udf-deployment-client"

  if [ ! -d "$client_dir" ]; then
    echo "Ping client source was not found at $client_dir"
    return 1
  fi

  wait_for_network || return 1
  echo "Building and starting the deployment ping client from $client_dir"
  docker build --no-cache --pull -t "$image" "$client_dir" || return 1
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker run -d \
    --name "$container" \
    --restart unless-stopped \
    --network host \
    -e API_URL=https://xs.partner-spec.f5demos.com \
    "$image"
}

if test -f "${STARTUP_DIR}/deployed"; then
  echo "Deployment already ran; ensuring the ping client is running"
  install_ping_client
  exit $?
fi

sleep 60
wait_for_network

rm -rf "${LAB_DIR}"

i=0
result="nothing"

while [[ $result != "bad path" ]]; do
  result=$(curl -s http://metadata.udf/deployment/components/$i/osName)

  if [[ $result == *"template"* ]]; then
    break
  fi

  i=$((i+1))
done


if [[ $result == *"template"* ]]; then
  echo "This is only a template"
else
  setup_node_runtime || exit 1

  echo "Installing lab"
  git clone https://github.com/f5selevin/f5xc-lab-mgmt "${LAB_DIR}" || exit 1
  cd "${LAB_DIR}/udf/startup" || exit 1
  npm install || exit 1

  node startup.mjs xcspeccore || exit 1
  echo "startup.mjs completed successfully"
  install_ping_client || exit 1
fi

touch "${STARTUP_DIR}/deployed"