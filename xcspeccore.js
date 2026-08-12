import Course from './course.js';

class Xcspeccore extends Course {
    constructor({ domain, key, courseId }) {
        super({ domain, key, courseId });
    }

    async newStudent({ email, udfHost, ip, region, log }) {
        const initialized = await super.newStudent({ email, udfHost, ip, region, log });
        if (initialized.status === 'error') return initialized;

        const { hash, makeId, ceOnPrem, createdNames, smsv2Site, namespace } = initialized;
        let err;

        await this.f5xc.updateUserForSpecCore({ email, nsName: namespace }).catch((error) => {
            log.warn({ operation: 'updateUserForSpecCore', ...error });
            err = { operation: 'updateUserForSpecCore', ...error };
        });

        if (!err) {
            await this.f5xc.createSmsv2Site({ name: smsv2Site.siteName }).catch((error) => {
                log.warn({ operation: 'createSmsv2Site', ...error });
                err = { operation: 'createSmsv2Site', ...error };
            });
        }

        if (!err) {
            const token = await this.f5xc.createSmsv2Token({
                name: smsv2Site.tokenName,
                siteName: smsv2Site.siteName
            }).catch((error) => {
                log.warn({ operation: 'createSmsv2Token', ...error });
                err = { operation: 'createSmsv2Token', ...error };
            });
            smsv2Site.token = token;
        }

        if (err) {
            log.warn('Student creation failed');
            return err;
        }

        this.db.data.students[hash] = {
            smsv2Site,
            email,
            state: 'active',
            makeId,
            createdNames,
            udfHost,
            ip,
            region,
            ceRegistration: { state: 'NONE', ...ceOnPrem },
            failedChecks: 0
        };
        await this.db.write();
        log.info('Student created');
        return this.db.data.students[hash];
    }
}

export default Xcspeccore;
