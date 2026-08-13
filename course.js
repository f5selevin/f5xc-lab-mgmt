import { createStudentRepository } from './database.js';
import F5xc from './f5xc.js';
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
    const ceOnPrem = {
        hostname: 'ceophost' + id
    };

    const smsv2Site = {
        siteName: "smsv2-" + id,
        tokenName: "smsv2-token-" + id
    }

    return { lowerEmail, ceOnPrem, smsv2Site };
}





class Course {
    constructor({ domain, key, courseId }) {
        this.f5xc = new F5xc(domain, key);
        this.db = createStudentRepository(courseId);
        this.ready = this.db.read();
    }

    async newStudent({ email, namespace: requestedNamespace, deploymentId, dep_id: depId, udfHost, ip, log, recreateExisting = false }) {
        await this.ready;
        const createdNames = createNames(email);
        const { lowerEmail, smsv2Site } = createdNames;
        const udfDeploymentId = deploymentId || depId;
        let userAvailable = false;
        let hash = generateHash([lowerEmail]);

        log.info({
            operation: 'newStudent.start',
            email: lowerEmail,
            requestedNamespace,
            udfDeploymentId,
            udfHost,
            ip,
            recreateExisting
        });

        // Preserve the original behavior: DNS must resolve, but source IP mismatch
        // does not block student creation (`true || result.address == ip`).
        const studentValidity = await validateUdfRequest({
            udfHost,
            ip,
            log,
            allowIpMismatch: true
        }).catch((error) => {
            log.warn({
                operation: 'validateUdfRequest',
                udfHost,
                ip,
                error: {
                    name: error?.name,
                    code: error?.code,
                    message: error?.message,
                    stack: error?.stack
                }
            });
            return false;
        });

        log.info({ operation: 'newStudent.validationComplete', studentValidity });

        if (studentValidity) {
            if (!requestedNamespace || !udfDeploymentId) {
                const error = 'namespace and deploymentId are required';
                log.warn({
                    operation: 'validateMetadata',
                    error,
                    requestedNamespace,
                    udfDeploymentId,
                    hasNamespace: Boolean(requestedNamespace),
                    hasDeploymentId: Boolean(udfDeploymentId)
                });
                return { status: 'error', operation: 'validateMetadata', error };
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
                    log.info({
                        operation: 'getUsersNs',
                        attempt,
                        totalUsers: users.items?.length,
                        userFound: Boolean(user),
                        userAvailable,
                        requestedNamespace,
                        namespaceRoles: user?.namespace_roles?.map(({ namespace, role }) => ({ namespace, role }))
                    });
                } catch (error) {
                    log.warn({
                        operation: 'getUsersNs',
                        attempt,
                        error: {
                            name: error?.name,
                            message: error?.message,
                            code: error?.code,
                            status: error?.response?.status,
                            data: error?.response?.data,
                            stack: error?.stack
                        }
                    });
                }

                if (!userAvailable && attempt < 10) {
                    log.info({ operation: 'getUsersNs.retry', attempt, delayMs: 10000 });
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
                const studentsForEmail = Object.entries(this.db.data.students).filter(([, student]) =>
                    student.email?.toLowerCase() === lowerEmail
                );
                const deploymentEntry = studentsForEmail.find(([, student]) => {
                    const studentDeploymentId = student.deploymentId || student.createdNames?.deploymentId;
                    return studentDeploymentId === udfDeploymentId;
                });
                const legacyEntries = studentsForEmail.filter(([, student]) =>
                    !(student.deploymentId || student.createdNames?.deploymentId)
                );
                const legacyEntry = legacyEntries.length === 1 ? legacyEntries[0] : undefined;
                const existingEntry = deploymentEntry || legacyEntry;

                recreated = Boolean(existingEntry);
                hash = existingEntry?.[0] || generateHash([lowerEmail, udfDeploymentId]);
                log.info({
                    operation: 'newStudent.existingRecord',
                    recreated,
                    matchedBy: deploymentEntry ? 'deploymentId' : legacyEntry ? 'legacyEmail' : undefined,
                    recordsForEmail: studentsForEmail.length,
                    legacyRecordsForEmail: legacyEntries.length,
                    hash
                });
            }
            createdNames.namespace = requestedNamespace;
            createdNames.deploymentId = udfDeploymentId;
            smsv2Site.siteName = `smsv2-${requestedNamespace}`;
            smsv2Site.tokenName = `smsv2-token-${requestedNamespace}`;
            return { hash, namespace: requestedNamespace, deploymentId: udfDeploymentId, createdNames, smsv2Site, recreated };

        } else {
            log.warn({
                operation: 'newStudent.validationFailed',
                email: lowerEmail,
                udfHost,
                ip,
                requestedNamespace,
                udfDeploymentId,
                msg: 'Student creation failed: UDF validity check failed'
            });
            return {
                status: 'error',
                operation: 'validateUdfRequest',
                msg: 'Validity failed'
            }
        }

    }
}


export default Course;