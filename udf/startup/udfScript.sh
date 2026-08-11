#!/bin/bash


#exec 3>&1 4>&2
#trap 'exec 2>&4 1>&3' 0 1 2 3
#exec 1>/home/ubuntu/terraform/startup.log 2>&1


CLOUDACCOUNTS=$(curl -s http://metadata.udf/cloudAccounts)

AWS_ACCOUNT_ID=$(echo $CLOUDACCOUNTS | jq -r .cloudAccounts[0].accountId)
AWS_API_KEY=$(echo $CLOUDACCOUNTS | jq -r .cloudAccounts[0].apiKey)
AWS_API_SECRET=$(echo $CLOUDACCOUNTS | jq -r .cloudAccounts[0].apiSecret)
aws configure set aws_access_key_id $AWS_API_KEY
aws configure set aws_secret_access_key $AWS_API_SECRET



terraform apply --auto-approve
TFOUTPUT=$(terraform output -json)


DEPLOYMENT=$(curl -s http://metadata.udf/deployment)
LAB_ID=$(echo $DEPLOYMENT | jq -r '.deployment.labId // .deployment.lab_id // .deployment.labid // .deployment.deploymentId // .deployment.deployment_id // .deployment.id // .labId // .lab_id // .labid // .deploymentId // .deployment_id // .id // empty')


template='{"email": "%s", "udfHost": "%s", "region": "%s", "awsAccountId": "%s", "awsApiKey": "%s", "awsApiSecret": "%s", "awsAz": "%s", "awsRegion": "%s", "subnetId": "%s", "vpcId": "%s", "labId": "%s" }'
printf -v data "$template" \
        "$(echo $DEPLOYMENT | jq -r .deployment.deployer)" \
        "$(echo $DEPLOYMENT | jq -r .deployment.host)" \
        "$(echo $DEPLOYMENT | jq -r .deployment.region)" \
        "$AWS_ACCOUNT_ID" \
        "$AWS_API_KEY" \
        "$AWS_API_SECRET"\
        "$(echo $TFOUTPUT | jq -r .az.value)" \
        "$(echo $TFOUTPUT | jq -r .region.value)" \
        "$(echo $TFOUTPUT | jq -r .subnet_id.value)" \
        "$(echo $TFOUTPUT | jq -r .vpc_id.value)" \
        "$LAB_ID" \


#curl -X POST -H "Content-Type: application/json" -d $data http://localhost:8080/v1/student


echo "AWS_ACCOUNT_ID    = $AWS_ACCOUNT_ID"
echo "AWS_API_KEY       = $AWS_API_KEY"
echo "AWS_API_SECRET    = $AWS_API_SECRET"
echo $data
