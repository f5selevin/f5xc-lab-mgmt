import axios from 'axios';

import axiosRetry from 'axios-retry';
// Source code has been edited to return reject as Promise.reject({ status: error.response.status, statusText: error.response.statusText, ...error.response.data });
// In file /node_modules/axios-retry/lib/esm/index.js


const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
class F5xc {
    constructor(domain, key) {
        this.axios = axios.create({
            baseURL: `https://${domain}`,
            headers: {
                'Authorization': `APIToken ${key}`,
                'Content-Type': 'application/json'
            }
        });

        axiosRetry(this.axios, {
            retries: 5,
            retryDelay: (retryCount) => {
                return retryCount * 10000;
            },
            retryCondition: (error) => {
                return error.response.status >= 400;
            },
        })

        /*
        this.axios.interceptors.request.use(function (config) {                        
            return config;
            }, function (error) {            
                return Promise.reject(error.request);
            });
                
        this.axios.interceptors.response.use(function (response) {            
                return response;
            }, function (error) {                   
                return Promise.reject({ status: error.response.status, statusText: error.response.statusText, ...error.response.data });
        });    
        */
    }

    async createNS(nsName) {
        const endPoint = '/api/web/namespaces';
        const data = {
            'metadata':
            {
                'annotations': {},
                'description': '',
                'disable': false,
                'labels': {},
                'name': nsName,
                'namespace': ''
            },
            'spec': {}
        }
        await this.axios.post(endPoint, data);
    }


    async assignNs(email, nsName) {
        const endPoint = '/api/web/custom/namespaces/system/role_users';
        const data = {
            "namespace": "system",
            "namespaces_role": {
                "namespaces": [nsName],
                "role": "ves-io-admin-role"
            },
            "username": [email]
        }

        await this.axios.post(endPoint, data);
    }



    async deleteNS(nsName) {
        const endPoint = `/api/web/namespaces/${nsName}/cascade_delete`;

        const data = {
            "name": nsName
        }

        await this.axios.post(endPoint, data);
    }


    async createUser(email, nsName) {
        const endPoint = '/api/web/custom/namespaces/system/user_roles';
        const data = {
            'email': email.toLowerCase(),
            'first_name': 'lab',
            'last_name': 'user',
            'name': email.toLowerCase(),
            'idm_type': 'VOLTERRA_MANAGED',
            'namespace': 'system',
            'namespace_roles': [
                {
                    'namespace': nsName,
                    'role': 'ves-io-admin-role'
                }

            ],
            'type': 'USER'
        }

        await this.axios.post(endPoint, data, {
            'axios-retry': {
                retries: 0
            }
        });
    }

    async updateUserForK8s({ email, nsName }) {
        const endPoint = '/api/web/custom/namespaces/system/user_roles';
        const data = {
            'email': email.toLowerCase(),
            'first_name': 'lab',
            'last_name': 'user',
            'name': email.toLowerCase(),
            'idm_type': 'VOLTERRA_MANAGED',
            'namespace': 'system',
            "namespace_roles": [
                {
                    "namespace": "system",
                    "role": "spec-workshop-role"
                },
                {
                    "namespace": "system",
                    "role": "spec-workshop-k8s-role"
                },
                {
                    "namespace": "shared",
                    "role": "spec-workshop-role"
                },
                {
                    "namespace": "shared",
                    "role": "spec-workshop-k8s-role"
                },
                {
                    "namespace": nsName,
                    "role": "ves-io-power-developer-role"
                }
            ],
            'type': 'USER'
        }

        await this.axios.put(endPoint, data, {
            'axios-retry': {
                retries: 0
            }
        });
    }

    async updateUserForSpecCore({ email, nsName }) {
        const endPoint = '/api/web/custom/namespaces/system/user_roles';
        const data = {
            email: email.toLowerCase(),
            first_name: 'lab',
            last_name: 'user',
            name: email.toLowerCase(),
            idm_type: 'VOLTERRA_MANAGED',
            namespace: 'system',
            namespace_roles: [
                {
                    namespace: 'system',
                    role: 'spec-workshop-role'
                },
                {
                    namespace: 'shared',
                    role: 'spec-workshop-role'
                },
                {
                    namespace: nsName,
                    role: 'ves-io-power-developer-role'
                },
                {
                    "namespace": "shared",
                    "role": "f5xc-multi-cloud-network-connect-monitor"
                },
                {
                    "namespace": "system",
                    "role": "f5xc-multi-cloud-network-connect-monitor"
                }
            ],
            type: 'USER'
        };

        await this.axios.put(endPoint, data, {
            'axios-retry': {
                retries: 0
            }
        });
    }

    async updateUserForApiSec({ email, nsName }) {
        const endPoint = '/api/web/custom/namespaces/system/user_roles';
        const data = {
            'email': email.toLowerCase(),
            'first_name': 'lab',
            'last_name': 'user',
            'name': email.toLowerCase(),
            'idm_type': 'VOLTERRA_MANAGED',
            'namespace': 'system',
            "namespace_roles": [
                {
                    "namespace": "system",
                    "role": "spec-workshop-role"
                },
                {
                    "namespace": "system",
                    "role": "f5xc-multi-cloud-network-connect-monitor"
                },
                {
                    "namespace": "shared",
                    "role": "spec-workshop-role"
                },
                {
                    "namespace": "shared",
                    "role": "f5xc-multi-cloud-network-connect-monitor"
                },
                {
                    "namespace": nsName,
                    "role": "ves-io-power-developer-role"
                }
            ],
            'type': 'USER'
        }

        await this.axios.put(endPoint, data, {
            'axios-retry': {
                retries: 0
            }
        });
    }

    async updateUserForWas({ email, nsName }) {
        const endPoint = '/api/web/custom/namespaces/system/user_roles';
        const data = {
            'email': email.toLowerCase(),
            'first_name': 'lab',
            'last_name': 'user',
            'name': email.toLowerCase(),
            'idm_type': 'VOLTERRA_MANAGED',
            'namespace': 'system',
            "namespace_roles": [
                {
                    "namespace": "system",
                    "role": "spec-workshop-role"
                },
                {
                    "namespace": "system",
                    "role": "f5xc-web-app-scanning-user"
                },
                {
                    "namespace": "shared",
                    "role": "spec-workshop-role"
                },
                {
                    "namespace": nsName,
                    "role": "ves-io-power-developer-role"
                }
            ],
            'type': 'USER'
        }

        await this.axios.put(endPoint, data, {
            'axios-retry': {
                retries: 0
            }
        });
    }

    async getUsersNs() {
        const endPoint = '/api/web/custom/namespaces/system/user_roles';
        const { data } = await this.axios.get(endPoint, {
            'axios-retry': {
                retries: 0
            }
        })
        return data;
    }

    async deleteUser(email) {
        const endPoint = '/api/web/custom/namespaces/system/users/cascade_delete';
        const data = {
            "email": email.toLowerCase(),
            "namespace": "system"
        }
        await this.axios.post(endPoint, data);
    }

    async createCloudCredentials({ name, awsApiKey, awsApiSecret }) {
        const endPoint = `/api/config/namespaces/system/cloud_credentialss`
        const data = {
            'metadata': {
                'annotations': {},
                'description': '',
                'disable': false,
                'labels': {},
                'name': name,
                'namespace': 'system'
            },
            'spec': {
                'aws_secret_key': {
                    'access_key': awsApiKey,
                    'secret_key': {
                        'clear_secret_info': {
                            'url': `string:///${Buffer.from(awsApiSecret).toString('base64')}`
                        }
                    }
                }
            }
        }

        await this.axios.post(endPoint, data);
    }

    async deleteCloudCredentials({ name }) {
        const endPoint = `/api/config/namespaces/system/cloud_credentialss/${name}`
        const data = {
            name,
            namespace: 'system'
        }

        await this.axios.delete(endPoint, data);
    }

    async createAwsVpcSite({ name, namespace, cloudCredentials, awsRegion, awsAz, vpcId, subnetId }) {
        const endPoint = `/api/config/namespaces/system/aws_vpc_sites`
        const data = {
            'metadata': {
                'annotations': {},
                'description': '',
                'disable': false,
                'labels': {},
                'name': name,
                'namespace': 'system'
            },
            'spec': {
                aws_cred: {
                    name: cloudCredentials,
                    namespace: 'system',
                    //tenant: 'f5-sales-public-qdpwiibg'

                },
                aws_region: awsRegion,
                vpc: {
                    vpc_id: vpcId
                },
                ingress_gw: {
                    az_nodes: [
                        {
                            aws_az_name: awsAz,
                            local_subnet: {
                                existing_subnet_id: subnetId
                            },
                        }
                    ],
                    aws_certified_hw: "aws-byol-voltmesh",
                    "allowed_vip_port": {
                        "use_http_https_port": {}
                    }
                },
                instance_type: 't3.xlarge',
                ssh_key: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC9a7yEEW1doV3T6RQQ7HqSc5zKqVsmE8+ANE0o6mNH0W/255M35TYKUao5Iz4QYA3ZqyBF3BBviW96XUibZ0XAMuxNU7uiySLCiOgm+aYyymRTqTgtebZJCQ3nPJbCIuqfZow4e98jImyEDn0MIuMBXAAD72hsaZjRGg+u42I/S+sMlm5s0xRihsLn/Su8ntr3tI2prA4W3h2oBEzNIRbg4/HtY3zv3cPwfXlH1xKSJDkUOHAWC9AzBsJ5q/b0MA7DjsDBa11b/McAAmaX4H17ed6N+h6QT8PWTJkxMew6OP8COERWi9tPyr8RTK9DuBa18g6V2VSGJBMpCzk72pdz sorin@TLV-L-00040841'
            }
        }

        await this.axios.post(endPoint, data);



        // This does tf apply. We wait 5 sec, sometimes the tf paramters are not available        
        await delay(5000);
        await this.awsVpcSiteTF({ name, action: 'APPLY' });
    }

    async awsVpcSiteTF({ name, action }) {
        await this.axios.post(`/api/terraform/namespaces/system/terraform/aws_vpc_site/${name}/run`, { action });
    }

    async deleteAwsVpcSite({ name }) {
        const endPoint = `/api/config/namespaces/system/aws_vpc_sites/${name}`

        await this.axios.delete(endPoint);
    }

    async getAwsVpcSite({ name }) {

        const endPoint = `/api/config/namespaces/system/terraform_parameters/aws_vpc_site/${name}/status`
        const { data } = await this.axios.get(endPoint, {
            'axios-retry': {
                retries: 0
            }
        });
        return data;
    }

    async listRegistrationsByState({ state }) {
        const endPoint = `/api/register/namespaces/system/listregistrationsbystate`
        const { data } = await this.axios.post(endPoint, { state });
        return data;
    }

    async listRegistrationsBySite({ name }) {
        const endPoint = `/api/register/namespaces/system/registrations_by_site/${name}`
        const { data } = await this.axios.get(endPoint);
        return data;
    }

    async registrationApprove({ name, passport }) {
        const endPoint = `/api/register/namespaces/system/registration/${name}/approve`
        const { data } = await this.axios.post(endPoint, {
            name,
            passport,
            state: 'APPROVED'
        });
        return data;
    }

    async deleteSite({ name }) {
        const endPoint = `/api/register/namespaces/system/site/${name}/state`
        const { data } = await this.axios.post(endPoint, {
            namespace: 'system',
            name,
            state: 7
        });
        return data;
    }

    async deleteAppStackSite({ name }) {

        try {
            const endPoint = `/api/config/namespaces/system/voltstack_sites/${name}`;
            const { data } = await this.axios.delete(endPoint, {
                namespace: 'system',
                name,
                "fail_if_referred": true
            });
            return data;
        } catch (error) {
            throw error;
        }
    }


    async createvK8s({ name, namespace }) {
        const endPoint = `/api/config/namespaces/${namespace}/virtual_k8ss`;
        const data = {
            metadata: {
                name,
                namespace
            },
            spec: {}
        }

        await this.axios.post(endPoint, data);
    }

    async deleteKubeconfig({ kubeconfig }) {
        const endPoint = `/api/config/namespaces/system/discoverys/${kubeconfig}`
        const { data } = await this.axios.delete(endPoint, {
            "fail_if_referred": true,
            "name": kubeconfig,
            "namespace": "system"
        });
        return data;
    }

    async createSmsv2Site({ name }) {
        const endPoint = `/api/config/namespaces/system/securemesh_site_v2s`;
        const data = {
            metadata: {
                name,
                namespace: "system"
            },
            spec: {
                "kvm": {
                    "not_managed": {}
                }
            }
        }

        await this.axios.post(endPoint, data);
    }

    async createSmsv2Token({ name, siteName }) {
        const endPoint = `/api/register/namespaces/system/tokens`;
        const data = {
            metadata: {
                name,

            },
            spec: {
                type: "JWT",
                site_name: siteName
            }
        }

        const result = await this.axios.post(endPoint, data);
        return result.data.spec.content;
    }
}

export default F5xc;