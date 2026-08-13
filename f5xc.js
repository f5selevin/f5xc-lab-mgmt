import axios from 'axios';
import axiosRetry from 'axios-retry';

class F5xc {
    constructor(domain, key) {
        this.axios = axios.create({
            baseURL: `https://${domain}`,
            headers: {
                Authorization: `APIToken ${key}`,
                'Content-Type': 'application/json'
            }
        });

        axiosRetry(this.axios, {
            retries: 5,
            retryDelay: (retryCount) => retryCount * 10000,
            retryCondition: (error) => (error.response?.status || 0) >= 400
        });
    }

    async getUsersNs() {
        const { data } = await this.axios.get('/api/web/custom/namespaces/system/user_roles', {
            'axios-retry': { retries: 0 }
        });
        return data;
    }

    async mergeNamespaceRoles(email, requestedRoles) {
        const users = await this.getUsersNs();
        const user = users.items.find((item) => item.email?.toLowerCase() === email.toLowerCase());
        if (!user) throw new Error(`Could not find user ${email} while adding namespace roles`);

        const roles = new Map();
        for (const role of [...(user.namespace_roles || []), ...requestedRoles]) {
            roles.set(`${role.namespace}:${role.role}`, role);
        }
        return [...roles.values()];
    }

    async updateUserForSpecCore({ email, nsName }) {
        const data = {
            email: email.toLowerCase(),
            first_name: 'lab',
            last_name: 'user',
            name: email.toLowerCase(),
            idm_type: 'VOLTERRA_MANAGED',
            namespace: 'system',
            namespace_roles: [
                { namespace: 'system', role: 'spec-workshop-role' },
                { namespace: 'shared', role: 'spec-workshop-role' },
                { namespace: nsName, role: 'ves-io-power-developer-role' },
                { namespace: 'shared', role: 'f5xc-multi-cloud-network-connect-monitor' },
                { namespace: 'system', role: 'f5xc-multi-cloud-network-connect-monitor' }
            ],
            type: 'USER'
        };

        data.namespace_roles = await this.mergeNamespaceRoles(email, data.namespace_roles);
        await this.axios.put('/api/web/custom/namespaces/system/user_roles', data, {
            'axios-retry': { retries: 0 }
        });
    }

    async createSmsv2Site({ name }) {
        await this.axios.post('/api/config/namespaces/system/securemesh_site_v2s', {
            metadata: { name, namespace: 'system' },
            spec: { kvm: { not_managed: {} } }
        });
    }

    async createSmsv2Token({ name, siteName }) {
        const { data } = await this.axios.post('/api/register/namespaces/system/tokens', {
            metadata: { name },
            spec: { type: 'JWT', site_name: siteName }
        });
        return data.spec.content;
    }
}

export default F5xc;
