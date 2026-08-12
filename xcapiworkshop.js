import Course from './course.js';


class Xcapiworkshop extends Course {
    constructor({ domain, key, courseId }) {
        super({ domain, key, courseId });
    }

    async newStudent({ email, namespace: requestedNamespace, deploymentId, hostArcadia, ceArcadia, udfHost, ip, region, awsAccountId, awsApiKey, awsApiSecret, awsRegion, awsAz, vpcId, subnetId, log }) {

        const initNewStudent = await super.newStudent({ email, namespace: requestedNamespace, deploymentId, hostArcadia, ceArcadia, udfHost, ip, region, awsAccountId, awsApiKey, awsApiSecret, awsRegion, awsAz, vpcId, subnetId, log });
        let err;

        if (initNewStudent.status == 'error') {
            err = initNewStudent;
        }

        const { hash, kubeconfig, makeId, ceOnPrem, createdNames, smsv2Site, namespace } = initNewStudent;

        if (!err) {
            await this.f5xc.updateUserForApiSec({ email, nsName: namespace }).catch((e) => {
                log.warn({ operation: 'updateUserForApiSec', ...e });
                err = { operation: 'updateUserForApiSec', ...e };
            });
        }

        if (!err) {
            await this.f5xc.createSmsv2Site({ name: smsv2Site.siteName }).catch((e) => {
                log.warn({ operation: 'createSmsv2Site', ...e });
                err = { operation: 'createSmsv2Site', ...e };
            });

        }

        if (!err) {
            const token = await this.f5xc.createSmsv2Token({ name: smsv2Site.tokenName, siteName: smsv2Site.siteName }).catch((e) => {
                log.warn({ operation: 'createSmsv2Token', ...e });
                err = { operation: 'createSmsv2Token', ...e };
            });
            smsv2Site.token = token;
        }




        if (!err) {

            this.db.data.students[hash] = { smsv2Site, email, hostArcadia, ceArcadia, kubeconfig, state: 'active', makeId, createdNames, udfHost, ip, region, awsAccountId, awsApiKey, awsApiSecret, awsRegion, awsAz, vpcId, subnetId, f5xcTf: { awsVpcSite: 'APPLYING' }, ceRegistration: { state: 'NONE', ...ceOnPrem }, failedChecks: 0, log };

            this.db.write();
            log.info('Student created');
            return this.db.data.students[hash];
        } else {
            log.warn('Student creation failed');

            return err;
        }

    }

    async deleteStudent({ hash, createdNames, log }) {
        let studentCreatedNames;
        if (hash) studentCreatedNames = this.db.data.students[hash].createdNames;

        const { lowerEmail, makeId, ceOnPrem, kubeconfig } = studentCreatedNames || createdNames;
        hash = hash || generateHash([lowerEmail]);

        if (this.db.data.students[hash]) {
            log.info(`${lowerEmail} with ${makeId} is being deleted`);
            setTimeout(() => {
                delete this.db.data.students[hash];
                this.db.write();
                log.info(lowerEmail + ' was deleted');
            }, 240000);
        }
    }



}

export default Xcapiworkshop;