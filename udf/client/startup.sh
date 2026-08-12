#!/bin/bash

exec 3>&1 4>&2
trap 'exec 2>&4 1>&3' 0 1 2 3
exec 1>/home/ubuntu/startup/startup.log 2>&1

if test  -f "/home/ubuntu/startup/deployed"; then
  echo "Deployment already ran, not doing it again"
  exit 0
fi

sleep 60
touch /home/ubuntu/startup/deployed


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
  cd /home/ubuntu/lab/udf/startup
  npm install && node startup.mjs xcspeccore
  j=0
  while [ -f "/home/ubuntu/startup/error" ] && [ "$j" -lt 10 ]
  do
    echo "There was an error in startup.mjs running again number $j"
    j=$((j+1))
    sleep 60
    node startup.mjs xcspeccore
  done
fi