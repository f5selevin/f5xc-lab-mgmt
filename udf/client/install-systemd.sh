#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="f5xc-lab-startup.service"
SERVICE_USER="${SERVICE_USER:-ubuntu}"
INSTALL_DIR="/usr/local/lib/f5xc-lab"
INSTALL_PATH="${INSTALL_DIR}/startup.sh"
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

install -d -m 0755 "${INSTALL_DIR}"
install -m 0755 "${SOURCE_PATH}" "${INSTALL_PATH}"
install -d -o "${SERVICE_USER}" -g "$(id -gn "${SERVICE_USER}")" -m 0755 "/home/${SERVICE_USER}/startup"

cat >"${UNIT_PATH}" <<EOF
[Unit]
Description=F5XC UDF lab startup
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=oneshot
User=${SERVICE_USER}
Group=$(id -gn "${SERVICE_USER}")
Environment=HOME=/home/${SERVICE_USER}
WorkingDirectory=/home/${SERVICE_USER}
ExecStart=/bin/bash ${INSTALL_PATH}
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
