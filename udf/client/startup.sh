#!/bin/bash

exec 9>/home/ubuntu/startup/startup.lock
if ! flock -n 9; then
  echo "Another startup process is already running; exiting"
  exit 0
fi

exec 3>&1 4>&2
trap 'exec 2>&4 1>&3' 0 1 2 3
exec 1>/home/ubuntu/startup/startup.log 2>&1

install_ping_client() {
  local client_dir="/home/ubuntu/lab/udf/client"
  local image="f5xc-udf-deployment-client"
  local container="f5xc-udf-deployment-client"

  if [ ! -d "$client_dir" ]; then
    echo "Ping client source was not found at $client_dir"
    return 1
  fi

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

if test -f "/home/ubuntu/startup/deployed"; then
  echo "Deployment already ran; ensuring the ping client is running"
  install_ping_client
  exit $?
fi

sleep 60

export PATH=/home/ubuntu/.nvm/versions/node/v18.16.0/bin/:$PATH

rm -rf /home/ubuntu/lab

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
  echo "Instaling lab"
  git clone https://github.com/f5selevin/f5xc-lab-mgmt /home/ubuntu/lab
  git checkout feature/cleanup
  cd /home/ubuntu/lab/udf/startup
  npm install || exit 1

  node startup.mjs xcspeccore || exit 1
  echo "startup.mjs completed successfully"
  install_ping_client || exit 1
fi

touch /home/ubuntu/startup/deployed