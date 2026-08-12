import { createStudentRepository } from './database.js';
import F5xc from './f5xc.js';
import dns from 'node:dns';
import axios from 'axios';
import https from 'https';
import { log as fastifyLog } from './api.js'
import crypto from 'crypto';




const validateStudent = async ({ udfHost, ip }) => {
    let success;
    const options = {
        family: 4,
        hints: dns.ADDRCONFIG | dns.V4MAPPED,
    };
    const result = await dns.promises.lookup(udfHost, options);

    return true || result.address == ip;
}

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

    async newStudent({ email, hostArcadia, ceArcadia, udfHost, ip, region, awsAccountId, awsApiKey, awsApiSecret, awsRegion, awsAz, vpcId, subnetId, log }) {
        await this.ready;
        const createdNames = createNames(email);
        const { lowerEmail, ccName, awsSiteName, makeId, ceOnPrem, vk8sName, smsv2Site } = createdNames;
        let namespace;
        const hash = generateHash([lowerEmail]);
        this.log[hash] = log;

        const studentValidity = await validateStudent({ udfHost, ip }).catch((e) => log.warn({ operation: 'validateStudent', e })).catch((e) => {
            log.warn({ operation: 'studentValidity', ...e });
        });



        if (studentValidity) {
            for (let attempt = 1; attempt <= 10 && !namespace; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 5000));

                try {
                    const users = await this.f5xc.getUsersNs();
                    const user = users.items.find(
                        (item) => item.email?.toLowerCase() === lowerEmail
                    );
                    namespace = user?.namespace_roles?.[0]?.namespace;
                } catch (error) {
                    log.warn({ operation: 'getUsersNs', error });
                }
            }

            if (!namespace) {
                const error = `Could not find user ${email} with a namespace`;
                log.warn({ operation: 'getUsersNs', error });
                return { status: 'error', operation: 'getUsersNs', error };
            }

            createdNames.namespace = namespace;
            smsv2Site.siteName = `smsv2-${namespace}`;
            smsv2Site.tokenName = `smsv2-token-${namespace}`;
            return { hash, namespace, lowerEmail, ccName, awsSiteName, makeId, ceOnPrem, vk8sName, createdNames, smsv2Site };

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