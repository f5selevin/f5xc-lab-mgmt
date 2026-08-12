import Course from './course.js';



class Apisecurityshiftleft extends Course {
    constructor({ domain, key, courseId }) {
        super({ domain, key, courseId });
        this.periodicChecks();
    }

    async newStudent({ email, namespace: requestedNamespace, deploymentId, hostArcadia, ceArcadia, udfHost, ip, region, awsAccountId, awsApiKey, awsApiSecret, awsRegion, awsAz, vpcId, subnetId, log }) {

        const initNewStudent = await super.newStudent({ email, namespace: requestedNamespace, deploymentId, hostArcadia, ceArcadia, udfHost, ip, region, awsAccountId, awsApiKey, awsApiSecret, awsRegion, awsAz, vpcId, subnetId, log });
        let err;

        if (initNewStudent.status == 'error') {
            err = initNewStudent;
        }

        const { hash, namespace, lowerEmail, ccName, awsSiteName, makeId, ceOnPrem, vk8sName, createdNames } = initNewStudent;


        if (!err) {
            await this.f5xc.updateUserForWas({ email, nsName: namespace }).catch((e) => {
                log.warn({ operation: 'updateUserForWas', ...e });
                err = { operation: 'updateUserForWas', ...e };
            });
        }

        if (!err) {
            this.db.data.students[hash] = { email, hostArcadia, ceArcadia, state: 'active', makeId, createdNames, udfHost, ip, region, awsAccountId, awsApiKey, awsApiSecret, awsRegion, awsAz, vpcId, subnetId, f5xcTf: { awsVpcSite: 'APPLYING' }, ceRegistration: { state: 'NONE', ...ceOnPrem }, failedChecks: 0, log };

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

        const { lowerEmail, namespace, ccName, awsSiteName, ceOnPrem, makeId } = studentCreatedNames || createdNames;
        hash = hash || generateHash([lowerEmail]);

        await this.f5xc.deleteSite({ name: ceOnPrem.clusterName }).catch((e) => {
            log.warn({ operation: 'deleteSite', ...e });
        });

        if (this.db.data.students[hash]) {
            log.info(`${lowerEmail} with ${makeId} is being deleted`);
            setTimeout(() => {
                delete this.db.data.students[hash];
                this.db.write();
                log.info(lowerEmail + ' was deleted');
            }, 240000);
        }
    }

    checkCeReg() {
        setInterval(async (x) => {
            for (const [hash, student] of Object.entries(this.db.data.students)) {
                const log = this.log[hash] || fastifyLog;

                const { state, clusterName } = student.ceRegistration;

                if (state !== 'APPROVED') {
                    const siteData = await this.f5xc.listRegistrationsBySite({ name: clusterName });
                    if (siteData.items[0]) {
                        const regName = siteData.items[0].name;
                        const regPassport = siteData.items[0].object.spec.gc_spec.passport;
                        const approvalState = await this.f5xc.registrationApprove({ name: regName, passport: regPassport })
                        log.info('CE on prem Approved');
                        this.db.data.students[hash].ceRegistration.name = regName;
                        this.db.data.students[hash].ceRegistration.state = 'APPROVED';
                        this.db.write();
                    }

                }
            }
        }, 30000);
    }



    periodicChecks() {

        this.checkCeReg();
    }

}

export default Apisecurityshiftleft;