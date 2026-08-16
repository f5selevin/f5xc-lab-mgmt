#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="f5xc-lab-startup.service"
SERVICE_USER="${SERVICE_USER:-ubuntu}"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_PATH="${SCRIPT_DIR}/startup.sh"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root (for example: sudo $0)" >&2
  exit 1
fi

if [[ ! -f "${SOURCE_PATH}" ]]; then
  echo "Startup script not found: ${SOURCE_PATH}" >&2
  exit 1
fi

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  echo "Service user does not exist: ${SERVICE_USER}" >&2
  exit 1
fi

SERVICE_HOME="$(getent passwd "${SERVICE_USER}" | cut -d: -f6)"
STARTUP_DIR="${SERVICE_HOME}/startup"
TARGET_PATH="${STARTUP_DIR}/startup.sh"

if [[ -z "${SERVICE_HOME}" || ! -d "${SERVICE_HOME}" ]]; then
  echo "Home directory for ${SERVICE_USER} does not exist: ${SERVICE_HOME}" >&2
  exit 1
fi

SERVICE_GROUP="$(id -gn "${SERVICE_USER}")"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0755 "${STARTUP_DIR}"
if [[ "$(realpath "${SOURCE_PATH}")" != "$(realpath -m "${TARGET_PATH}")" ]]; then
  install -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0755 "${SOURCE_PATH}" "${TARGET_PATH}"
else
  chown "${SERVICE_USER}:${SERVICE_GROUP}" "${TARGET_PATH}"
  chmod 0755 "${TARGET_PATH}"
fi

cat >"${UNIT_PATH}" <<EOF
[Unit]
Description=F5XC UDF lab startup
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
Environment=HOME=${SERVICE_HOME}
WorkingDirectory=${STARTUP_DIR}
ExecStart=/bin/bash ${TARGET_PATH}
TimeoutStartSec=infinity
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

chmod 0644 "${UNIT_PATH}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"

echo "Installed and enabled ${SERVICE_NAME}."
echo "Start it now with: sudo systemctl start ${SERVICE_NAME}"
echo "View its status with: systemctl status ${SERVICE_NAME}"
