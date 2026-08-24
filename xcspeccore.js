import Course from './course.js';

const errorDetails = (error) => ({
    name: error?.name,
    message: error?.message,
    code: error?.code,
    status: error?.response?.status,
    statusText: error?.response?.statusText,
    data: error?.response?.data,
    stack: error?.stack
});

class Xcspeccore extends Course {
    constructor({ domain, key, courseId }) {
        super({ domain, key, courseId });
    }

    async newStudent({ email, namespace: requestedNamespace, deploymentId, dep_id: depId, udfHost, ip, region, log }) {
        const resolvedDeploymentId = deploymentId || depId;
        const initialized = await super.newStudent({
            email,
            namespace: requestedNamespace,
            deploymentId: resolvedDeploymentId,
            udfHost,
            ip,
            region,
            log,
            recreateExisting: true
        });
        if (initialized.status === 'error') {
            log.warn({ operation: 'xcspeccore.initialize', initialized });
            return initialized;
        }

        const { hash, createdNames, smsv2Site, namespace, deploymentId: initializedDeploymentId, recreated } = initialized;
        let err;

        log.info({
            operation: 'xcspeccore.initialize',
            hash,
            namespace,
            deploymentId: initializedDeploymentId,
            recreated,
            siteName: smsv2Site.siteName,
            tokenName: smsv2Site.tokenName
        });

        log.info({ operation: 'updateUserForSpecCore.start', email, namespace });
        await this.f5xc.updateUserForSpecCore({ email, nsName: namespace }).then(() => {
            log.info({ operation: 'updateUserForSpecCore.success', email, namespace });
        }).catch((error) => {
            const details = errorDetails(error);
            log.warn({ operation: 'updateUserForSpecCore.failed', email, namespace, error: details });
            err = { status: 'error', operation: 'updateUserForSpecCore', error: details };
        });

        if (!err) {
            log.info({ operation: 'createSmsv2Site.start', siteName: smsv2Site.siteName });
            await this.f5xc.createSmsv2Site({ name: smsv2Site.siteName }).then(() => {
                log.info({ operation: 'createSmsv2Site.success', siteName: smsv2Site.siteName });
            }).catch((error) => {
                const details = errorDetails(error);
                log.warn({ operation: 'createSmsv2Site.failed', siteName: smsv2Site.siteName, error: details });
                err = { status: 'error', operation: 'createSmsv2Site', error: details };
            });
        }

        if (!err) {
            log.info({
                operation: 'createSmsv2Token.start',
                tokenName: smsv2Site.tokenName,
                siteName: smsv2Site.siteName
            });
            const token = await this.f5xc.createSmsv2Token({
                name: smsv2Site.tokenName,
                siteName: smsv2Site.siteName
            }).then((createdToken) => {
                log.info({
                    operation: 'createSmsv2Token.success',
                    tokenName: smsv2Site.tokenName,
                    siteName: smsv2Site.siteName,
                    tokenReceived: Boolean(createdToken),
                    token: createdToken
                });
                return createdToken;
            }).catch((error) => {
                const details = errorDetails(error);
                log.warn({
                    operation: 'createSmsv2Token.failed',
                    tokenName: smsv2Site.tokenName,
                    siteName: smsv2Site.siteName,
                    error: details
                });
                err = { status: 'error', operation: 'createSmsv2Token', error: details };
            });
            smsv2Site.token = token;
        }

        if (err) {
            log.warn({ operation: 'xcspeccore.newStudent.failed', email, namespace, failure: err });
            return err;
        }

        this.db.data.students[hash] = {
            smsv2Site,
            email,
            state: 'active',
            namespace,
            deploymentId: initializedDeploymentId,
            createdNames,
            lastSeen: new Date().toISOString(),
            udfHost,
            ip,
            region
        };
        log.info({ operation: 'studentDatabase.write.start', hash, email, namespace });
        await this.db.write().then(() => {
            log.info({ operation: 'studentDatabase.write.success', hash, email, namespace });
        }).catch((error) => {
            log.error({ operation: 'studentDatabase.write.failed', hash, email, namespace, error: errorDetails(error) });
            throw error;
        });
        log.info({ operation: 'xcspeccore.newStudent.success', email, namespace, recreated });
        return this.db.data.students[hash];
    }
}

export default Xcspeccore;
