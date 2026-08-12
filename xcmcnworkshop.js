import Course from './course.js';


const queue = [];

setInterval(() => {
    const data = queue.shift();
    if (data) {
        const { f5xc, log, lowerEmail, makeId, name, namespace, cloudCredentials, awsRegion, awsAz, vpcId, subnetId } = data;
        log.info(lowerEmail + ' creating site AWS VPC site')
        f5xc.createAwsVpcSite({ makeId, name, namespace, cloudCredentials, awsRegion, awsAz, vpcId, subnetId }).catch((e) => {
            log.warn({ email: lowerEmail, operation: 'createAwsVpcSite', ...e });
        });
    }
}, 60000);


class Xcmcnworkshop extends Course {
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

        // if (!err) {
        //     await this.f5xc.createCloudCredentials({name: ccName, namespace, awsApiKey, awsApiSecret }).catch((e) =>  {                     
        //         log.warn({operation:'createCloudCredentials',...e}); 
        //         err = {operation:'createCloudCredentials',...e};                
        //     });
        // }

        if (!err) {
            queue.push({ f5xc: this.f5xc, log, lowerEmail, makeId, name: awsSiteName, namespace, cloudCredentials: ccName, awsRegion, awsAz, vpcId, subnetId });
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

        // await this.f5xc.deleteAwsVpcSite({ name:awsSiteName }).catch((e) =>  { 
        //     log.warn({operation:'deleteAwsVpcSite',...e});             
        // });

        // await this.f5xc.deleteCloudCredentials({ name:ccName }).catch((e) =>  { 
        //     log.warn({operation:'deleteCloudCredentials',...e});             
        // });

        // THIS PART IS DISABLED UNTIL IT WILL BE PUBLISHED TO EVERYONE        
        // await this.f5xc.deleteSite({name:ceOnPrem.clusterName + '-bgp' }).catch((e) =>  { 
        //     log.warn({operation:'deleteSite',...e});             
        // });
        // 
        // await this.f5xc.deleteSite({name:ceOnPrem.clusterName + '-vrrp' }).catch((e) =>  { 
        //     log.warn({operation:'deleteSite',...e});             
        // });

        if (this.db.data.students[hash]) {
            log.info(`${lowerEmail} with ${makeId} is being deleted`);
            setTimeout(() => {
                delete this.db.data.students[hash];
                this.db.write();
                log.info(lowerEmail + ' was deleted');
            }, 240000);
        }
    }

    // checkCeReg() {
    //     setInterval(async (x) => {
    //         for (const [hash,student] of Object.entries(this.db.data.students)) {                
    //             const log = this.log[hash] || fastifyLog;

    //             const { state, clusterName } = student.ceRegistration;

    //             if (state !== 'APPROVED') {                    
    //                 const siteData = await this.f5xc.listRegistrationsBySite({name: clusterName});

    //                 if (clusterName.includes('-bgp') && siteData.items.length == 3) {
    //                     for (let i = 0; i < siteData.items.length; i++) {
    //                         const regName = siteData.items[i].name;
    //                         const regPassport = siteData.items[i].object.spec.gc_spec.passport;
    //                         regPassport.cluster_size = 3;
    //                         const approvalState = await this.f5xc.registrationApprove({name:regName, passport:regPassport })

    //                     }
    //                     this.db.data.students[hash].ceRegistration.name;
    //                     this.db.data.students[hash].ceRegistration.state = 'APPROVED';
    //                     this.db.write();

    //                 } else if ( siteData.items[0] ) {                    
    //                     const regName = siteData.items[0].name;
    //                     const regPassport = siteData.items[0].object.spec.gc_spec.passport;
    //                     const approvalState = await this.f5xc.registrationApprove({name:regName, passport:regPassport })
    //                     log.info('CE on prem Approved');                    
    //                     this.db.data.students[hash].ceRegistration.name = regName;
    //                     this.db.data.students[hash].ceRegistration.state = 'APPROVED';
    //                     this.db.write();
    //                 }

    //             }                                                                
    //         }
    //     },30000);
    // }

    checkCeReg() {
        setInterval(async (x) => {
            for (const [hash, student] of Object.entries(this.db.data.students)) {
                const log = this.log[hash] || fastifyLog;

                let { state, clusterName } = student.ceRegistration;


                if (state !== 'APPROVED') {
                    const siteDataBgp = await this.f5xc.listRegistrationsBySite({ name: clusterName + '-bgp' });
                    const siteDataVrrp = await this.f5xc.listRegistrationsBySite({ name: clusterName + '-vrrp' });

                    if (siteDataBgp.items.length == 3 && siteDataVrrp.items.length == 3) {
                        for (let i = 0; i < siteDataBgp.items.length; i++) {
                            const regName = siteDataBgp.items[i].name;
                            const regPassport = siteDataBgp.items[i].object.spec.gc_spec.passport;
                            regPassport.cluster_size = 3;
                            const approvalState = await this.f5xc.registrationApprove({ name: regName, passport: regPassport })

                        }

                        for (let i = 0; i < siteDataVrrp.items.length; i++) {
                            const regName = siteDataVrrp.items[i].name;
                            const regPassport = siteDataVrrp.items[i].object.spec.gc_spec.passport;
                            regPassport.cluster_size = 3;
                            const approvalState = await this.f5xc.registrationApprove({ name: regName, passport: regPassport })

                        }

                        this.db.data.students[hash].ceRegistration.name;
                        this.db.data.students[hash].ceRegistration.state = 'APPROVED';
                        this.db.write();

                    }
                }
            }
        }, 30000);
    }

    checkF5xcTf() {
        // Will need to do some refactoring on this later
        setInterval(async (x) => {
            for (const [hash, student] of Object.entries(this.db.data.students)) {
                const log = this.log[hash] || fastifyLog;
                const { f5xcTf, state, email } = student;
                const { awsSiteName } = student.createdNames;

                if (student.f5xcTf.awsVpcSite !== 'APPLIED' || state == 'deleting') {
                    const res = await this.f5xc.getAwsVpcSite({ name: awsSiteName }).catch((e) => {
                        if (state != 'deleting') log.warn({ operation: 'getAwsVpcSite', ...e });
                    });

                    if (!res) return;

                    const { apply_state, error_output } = res.status.apply_status || { apply_state: null, error_output: null };

                    if (apply_state) {
                        this.db.data.students[hash].f5xcTf.awsVpcSite = apply_state;
                        this.db.write();
                    }

                    if (error_output) {
                        log.info(`${email} TF issue . Error ${error_output}`);
                        if (error_output.indexOf('PendingVerification') > -1) await this.f5xc.awsVpcSiteTF({ name: awsSiteName, action: 'APPLY' });
                        if (error_output.indexOf('failed to apply') > -1) await this.f5xc.awsVpcSiteTF({ name: awsSiteName, action: 'APPLY' });
                        if (error_output.indexOf('InvalidClientToken') > -1 && state == 'deleting') {
                            await this.f5xc.deleteAwsVpcSite({ name: awsSiteName });
                        }
                    }
                }
            }
        }, 30000);
    }

    periodicChecks() {
        //this.checkF5xcTf();
        this.checkCeReg();
    }

}

export default Xcmcnworkshop;