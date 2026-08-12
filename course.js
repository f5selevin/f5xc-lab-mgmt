import { createStudentRepository } from './database.js';
import F5xc from './f5xc.js';
import axios from 'axios';
import https from 'https';
import { log as fastifyLog } from './api.js'
import crypto from 'crypto';
import { validateUdfRequest } from './udf-validation.js';

const generateHash = (arr) => {
    let hash = crypto.createHash('md5');
    hash.update(arr.join(''));
    return hash.digest('hex');
}

const makeid = (length) => {
    let result = '';
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}


const createNames = (email) => {
    const makeId = makeid(8);
    const lowerEmail = email.toLowerCase();
    const randomPart = (new Date()).toISOString().split('T')[0].replace(/-/g, '').slice(4) + '-' + makeId;
    const id = randomPart;
    //const namespace = 'ns-' + id;
    const ccName = 'cc-' + id;
    const awsSiteName = 'as-' + id;
    const ceOnPrem = {
        clusterName: 'ceop-' + id,
        hostname: 'ceophost' + id
    }
    const vk8sName = 'vk8s-' + id;

    const kubeconfig = 'kubeconfig-' + id

    const cek8s = 'cek8s' + id;

    const smsv2Site = {
        siteName: "smsv2-" + id,
        tokenName: "smsv2-token-" + id
    }

    return { lowerEmail, ccName, awsSiteName, makeId, ceOnPrem, vk8sName, kubeconfig, cek8s, smsv2Site };
}





class Course {
    constructor({ domain, key, courseId }) {
        this.f5xc = new F5xc(domain, key);
        this.db = createStudentRepository(courseId);
        this.log = {};
        this.ready = this.db.read().then(() => this.deleteInactiveStudents());
    }


    async getStudentDetails({ email }) {
        await this.ready;
        const hash = generateHash([email.toLowerCase()]);
        const { createdNames, hostArcadia, ceArcadia, ollama } = this.db.data.students[hash]
        return { ...createdNames, hostArcadia, ceArcadia, ollama };
    }

    async newStudent({ email, namespace: requestedNamespace, deploymentId, dep_id: depId, hostArcadia, ceArcadia, udfHost, ip, region, awsAccountId, awsApiKey, awsApiSecret, awsRegion, awsAz, vpcId, subnetId, log, recreateExisting = false }) {
        await this.ready;
        const createdNames = createNames(email);
        const { lowerEmail, ccName, awsSiteName, makeId, ceOnPrem, vk8sName, smsv2Site } = createdNames;
        const udfDeploymentId = deploymentId || depId;
        let userAvailable = false;
        let hash = generateHash([lowerEmail]);

        const studentValidity = await validateUdfRequest({ udfHost, ip }).catch((e) => log.warn({ operation: 'validateStudent', e })).catch((e) => {
            log.warn({ operation: 'studentValidity', ...e });
        });



        if (studentValidity) {
            if (!requestedNamespace || !udfDeploymentId) {
                return { status: 'error', operation: 'validateMetadata', error: 'namespace and deploymentId are required' };
            }

            for (let attempt = 1; attempt <= 10 && !userAvailable; attempt++) {
                try {
                    const users = await this.f5xc.getUsersNs();
                    const user = users.items.find(
                        (item) => item.email?.toLowerCase() === lowerEmail
                    );
                    userAvailable = user?.namespace_roles?.some(
                        (item) => item.namespace === requestedNamespace &&
                            ['ves-io-admin-role', 'ves-io-power-developer-role'].includes(item.role)
                    ) || false;
                } catch (error) {
                    log.warn({ operation: 'getUsersNs', attempt, error });
                }

                if (!userAvailable && attempt < 10) {
                    await new Promise((resolve) => setTimeout(resolve, 10000));
                }
            }

            if (!userAvailable) {
                const error = `Could not find user ${email} with an admin or power-developer role in namespace ${requestedNamespace}`;
                log.warn({ operation: 'getUsersNs', error });
                return { status: 'error', operation: 'getUsersNs', error };
            }

            let recreated = false;
            if (recreateExisting) {
                const existingEntry = Object.entries(this.db.data.students).find(([, student]) => {
                    const studentDeploymentId = student.deploymentId || student.createdNames?.deploymentId;
                    return student.email?.toLowerCase() === lowerEmail && studentDeploymentId === udfDeploymentId;
                });
                recreated = Boolean(existingEntry);
                hash = existingEntry?.[0] || generateHash([lowerEmail, udfDeploymentId]);
            }
            this.log[hash] = log;

            createdNames.namespace = requestedNamespace;
            createdNames.deploymentId = udfDeploymentId;
            smsv2Site.siteName = `smsv2-${requestedNamespace}`;
            smsv2Site.tokenName = `smsv2-token-${requestedNamespace}`;
            return { hash, namespace: requestedNamespace, deploymentId: udfDeploymentId, lowerEmail, ccName, awsSiteName, makeId, ceOnPrem, vk8sName, createdNames, smsv2Site, recreated };

        } else {
            log.warn('Student creation failed');
            return {
                status: 'error',
                msg: 'Validity failed'
            }
        }

    }


    deleteInactiveStudents() {
        setInterval((x) => {
            for (const [hash, student] of Object.entries(this.db.data.students)) {
                const log = this.log[hash] || fastifyLog;
                const { udfHost } = student;

                axios.head(`https://${udfHost}`, {
                    validateStatus: status => status == 401, timeout: 2000, httpsAgent: new https.Agent({
                        rejectUnauthorized: false
                    })
                })
                    .then(() => {
                        this.db.data.students[hash].failedChecks = 0;
                    })
                    .catch((e) => {
                        this.db.data.students[hash].failedChecks++;
                        if (this.db.data.students[hash].failedChecks >= 5 && this.db.data.students[hash].state != 'deleting') {
                            this.db.data.students[hash].state = 'deleting';
                            this.deleteStudent({ hash, log }).catch((e) => {
                                log.warn({ operation: 'deleteInactiveStudents', ...e });
                            });


                        }
                    });
            }
        }, 20000);
    }
}


export default Course;