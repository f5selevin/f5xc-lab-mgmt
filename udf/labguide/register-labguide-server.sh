#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="labguide-server.service"
SERVICE_USER="${SERVICE_USER:-ubuntu}"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_PATH="${SCRIPT_DIR}/create-labguide-server.sh"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root (for example: sudo $0)" >&2
  exit 1
fi

if [[ ! -f "${SOURCE_PATH}" ]]; then
  echo "Labguide server script not found: ${SOURCE_PATH}" >&2
  exit 1
fi

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  echo "Service user does not exist: ${SERVICE_USER}" >&2
  exit 1
fi

SERVICE_HOME="$(getent passwd "${SERVICE_USER}" | cut -d: -f6)"
SERVICE_GROUP="$(id -gn "${SERVICE_USER}")"
INSTALL_DIR="${SERVICE_HOME}/labguide-server"
TARGET_PATH="${INSTALL_DIR}/create-labguide-server.sh"

if [[ -z "${SERVICE_HOME}" || ! -d "${SERVICE_HOME}" ]]; then
  echo "Home directory for ${SERVICE_USER} does not exist: ${SERVICE_HOME}" >&2
  exit 1
fi

install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0755 "${INSTALL_DIR}"
install -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0755 \
  "${SOURCE_PATH}" "${TARGET_PATH}"

cat >"${UNIT_PATH}" <<EOF
[Unit]
Description=F5XC labguide server
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
Environment=HOME=${SERVICE_HOME}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/bin/bash ${TARGET_PATH}
TimeoutStartSec=infinity
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

chmod 0644 "${UNIT_PATH}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
echo "Starting ${SERVICE_NAME}; cloning repositories and building the image may take several minutes..."
systemctl restart "${SERVICE_NAME}"

echo "Installed, enabled, and restarted ${SERVICE_NAME}."
echo "View its status with: systemctl status ${SERVICE_NAME}"
