import Fastify from 'fastify';
const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        ignore: 'pid,hostname,reqId',
        singleLine: true,
        messageFormat: '{reqId} {msg}',
      }
    }
  },


});



import Xcworkshop from './xcworkshop.js';
import Xcmcnworkshop from './xcmcnworkshop.js';
import Xck8sworkshop from './xck8sworkshop.js';
import Xcapiworkshop from './xcapiworkshop.js';
import Xcaisecurity from './xcaisecurity.js';
import Xcaigwworkshop from './xcaigwworkshop.js';
import Apisecurityshiftleft from './apisecurityshiftleft.js'
import Xcspeccore from './xcspeccore.js';
import { findDeployment, getDashboardStudents, updateDeploymentLastSeen } from './database.js';
import { validateUdfRequest } from './udf-validation.js';
import { renderDashboard, requireDashboardPassword } from './dashboard.js';



let f5xcemeaworkshop, f5xcemeak8sworkshop, f5xcemeamcnworkshop, f5xcemeaapiworkshop, f5xcemeaaiworkshop, f5xcemeaaigwworkshop, apisecurityshiftleft, xcspeccore;

const normalizeDomain = (domain) => domain?.replace(/^https?:\/\//, '').replace(/\/$/, '');

const loadWorkshopCredential = (courseId) => {
  const encodedCredentials = process.env.F5XC_CREDENTIALS_BASE64;
  if (!encodedCredentials) return undefined;

  let credentials;
  try {
    credentials = JSON.parse(Buffer.from(encodedCredentials, 'base64').toString('utf8'));
  } catch (error) {
    throw new Error('F5XC_CREDENTIALS_BASE64 must be base64-encoded valid JSON', { cause: error });
  }

  const credential = credentials[courseId];
  if (!credential) return undefined;

  const result = typeof credential === 'string'
    ? { domain: normalizeDomain(process.env.F5XC_DOMAIN), key: credential }
    : {
      domain: normalizeDomain(credential.domain || credential.address || process.env.F5XC_DOMAIN),
      key: credential.key || credential.apiKey || credential.apikey
    };

  if (!result.domain || !result.key) {
    throw new Error(`F5XC credential for ${courseId} requires both an XC domain and API key`);
  }

  return result;
};

const args = process.argv.slice(2);
if (args[0]) {
  f5xcemeaworkshop = new Xcworkshop({ domain: args[0], key: args[1], courseId: 'f5xcemeaworkshop' });
  f5xcemeamcnworkshop = new Xcmcnworkshop({ domain: args[0], key: args[1], courseId: 'f5xcemeamcnworkshop' });
  f5xcemeak8sworkshop = new Xck8sworkshop({ domain: args[0], key: args[1], courseId: 'f5xcemeak8sworkshop' });
  f5xcemeaapiworkshop = new Xcapiworkshop({ domain: args[0], key: args[1], courseId: 'f5xcemeaapiworkshop' });
  f5xcemeaaiworkshop = new Xcaisecurity({ domain: args[0], key: args[1], courseId: 'f5xcemeaaiworkshop' });
  f5xcemeaaigwworkshop = new Xcaigwworkshop({ domain: args[0], key: args[1], courseId: 'f5xcemeaaigwworkshop' });
  apisecurityshiftleft = new Apisecurityshiftleft({ domain: args[0], key: args[1], courseId: 'apisecurityshiftleft' });

}

const specCoreCredential = loadWorkshopCredential('xcspeccore');
if (specCoreCredential) {
  xcspeccore = new Xcspeccore({ ...specCoreCredential, courseId: 'xcspeccore' });
} else if (process.env.NODE_ENV === 'production') {
  throw new Error('F5XC_CREDENTIALS_BASE64 must contain an xcspeccore credential in production');
}

fastify.route({
  method: 'GET',
  url: '/',
  handler: (_request, reply) => reply.code(200).send({ status: 'OK' }),
});

fastify.route({
  method: 'GET',
  url: '/health',
  handler: (_request, reply) => reply.code(200).send({ status: 'OK' }),
});

fastify.route({
  method: 'GET',
  url: '/dashboard',
  preHandler: requireDashboardPassword,
  handler: async (_request, reply) => {
    const students = await getDashboardStudents();
    return reply
      .header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(renderDashboard(students));
  },
});

fastify.route({
  method: 'POST',
  url: '/deployment/ping',
  handler: async (request, reply) => {
    const { deploymentId, dep_id: depId, namespace } = request.body || {};
    const resolvedDeploymentId = deploymentId || depId;

    if (!resolvedDeploymentId || !namespace) {
      return reply.code(400).send({ status: 'error', message: 'deploymentId and namespace are required' });
    }

    const deployment = await findDeployment({ deploymentId: resolvedDeploymentId, namespace });
    if (!deployment) return reply.code(404).send({ status: 'error', message: 'Deployment was not found' });

    const isUdf = await validateUdfRequest({ udfHost: deployment.payload.udfHost, ip: request.ip }).catch((error) => {
      request.log.warn({ operation: 'validateUdfRequest', error });
      return false;
    });
    if (!isUdf) return reply.code(403).send({ status: 'error', message: 'Request did not originate from UDF' });

    const lastSeen = new Date();
    await updateDeploymentLastSeen({ deploymentId: resolvedDeploymentId, namespace, lastSeen });

    return { status: 'ok', lastSeen: lastSeen.toISOString() };
  },
});

fastify.route({
  method: 'POST',
  url: '/v1/student',
  handler: async (request, reply) => {
    if (f5xcemeaworkshop || xcspeccore) {
      request.log.info({ courseId: request.body.courseId, email: request.body.email });
      let { courseId, email } = request.body;

      if (email.toLowerCase() == 's.boiangiu@f5.com') email = 'sorinboia@gmail.com';
      if (email.toLowerCase() == 'm.dierick@f5.com') email = 'matt262810@gmail.com';
      if (email.toLowerCase() == 'p.cloup@f5.com') email = 'philippe@pipomolo.com';
      if (email.toLowerCase() == 'p.zoller@f5.com') email = 'patrick.zoller@gmx.de';
      if (email.toLowerCase() == 'a.vistola@f5.com') email = 'alfredo@vistola.de';
      let result;
      switch (courseId) {
        case 'f5xcemeaworkshop':
          result = await f5xcemeaworkshop.newStudent({ ...request.body, email, ip: request.ip, log: request.log });
          break;
        case 'xcspeccore':
          if (!xcspeccore) {
            result = { success: 'fail', msg: 'No available credentials for xcspeccore' };
            break;
          }
          result = await xcspeccore.newStudent({ ...request.body, email, ip: request.ip, log: request.log });
          break;
        case 'apisecurityshiftleft':
          result = await apisecurityshiftleft.newStudent({ ...request.body, email, ip: request.ip, log: request.log });
          break;
        case 'f5xcemeamcnworkshop':
          result = await f5xcemeamcnworkshop.newStudent({ ...request.body, email, ip: request.ip, log: request.log });
          break;
        case 'f5xcemeaapiworkshop':
          result = await f5xcemeaapiworkshop.newStudent({ ...request.body, email, ip: request.ip, log: request.log });
          break;
        case 'f5xcemeak8sworkshop':
          result = await f5xcemeak8sworkshop.newStudent({ ...request.body, email, ip: request.ip, log: request.log });
          break;
        case 'f5xcemeaaiworkshop':
          result = await f5xcemeaaiworkshop.newStudent({ ...request.body, email, ip: request.ip, log: request.log });
          break;
        case 'f5xcemeaaigwworkshop':
          result = await f5xcemeaaigwworkshop.newStudent({ ...request.body, email, ip: request.ip, log: request.log });
          break;
        default:
          result = { success: 'fail', msg: 'Unknow courseId' }
      }
      return result;
    } else {
      request.log.info('No available credentials for F5XC');
      return { success: 'fail', msg: 'No available credentials for F5XC' }
    }

  }
});

fastify.route({
  method: 'GET',
  url: '/v1/student/:courseId/:emailb64',
  handler: async (request, reply) => {

    const email = Buffer.from(request.params.emailb64, 'base64').toString('utf8');
    const courseId = request.params.courseId;


    request.log.info(`Getting student data for ${email} courseId ${courseId}`);
    if (f5xcemeaworkshop || xcspeccore) {
      let result;
      switch (courseId) {
        case 'f5xcemeaworkshop':
          result = await f5xcemeaworkshop.getStudentDetails({ email });
          break;
        case 'xcspeccore':
          if (!xcspeccore) {
            result = { success: 'fail', msg: 'No available credentials for xcspeccore' };
            break;
          }
          result = await xcspeccore.getStudentDetails({ email });
          break;
        case 'apisecurityshiftleft':
          result = await apisecurityshiftleft.getStudentDetails({ email });
          break;
        case 'f5xcemeamcnworkshop':
          result = await f5xcemeamcnworkshop.getStudentDetails({ email });
          break;
        case 'f5xcemeaapiworkshop':
          result = await f5xcemeaapiworkshop.getStudentDetails({ email });
          break;

        case 'f5xcemeak8sworkshop':
          result = await f5xcemeak8sworkshop.getStudentDetails({ email });
          break;
        case 'f5xcemeaaiworkshop':
          result = await f5xcemeaaiworkshop.getStudentDetails({ email });
          break;
        case 'f5xcemeaaigwworkshop':
          result = await f5xcemeaaigwworkshop.getStudentDetails({ email });
          break;
        default:
          result = { success: 'fail', msg: 'Unknow courseId' }
      }
      return result;
    } else {
      request.log.info('No available credentials for F5XC');
      return { success: 'fail', msg: 'No available credentials for F5XC' }
    }

  }
});

fastify.route({
  method: 'DELETE',
  url: '/v1/student',
  handler: async (request, reply) => {
    request.log.info(request.body);
    const result = await c.deleteStudent({ ...request.body, log: request.log });
    return result;
  }
});


fastify.route({
  method: 'POST',
  url: '/v1/f5xcred',
  handler: async (request, reply) => {
    request.log.info('Credentials received for F5XC');
    f5xcemeaworkshop = new Xcworkshop({ ...request.body, courseId: 'f5xcemeaworkshop' });
    f5xcemeamcnworkshop = new Xcmcnworkshop({ ...request.body, courseId: 'f5xcemeamcnworkshop' });
    f5xcemeak8sworkshop = new Xck8sworkshop({ ...request.body, courseId: 'f5xcemeak8sworkshop' });
    f5xcemeaapiworkshop = new Xcapiworkshop({ ...request.body, courseId: 'f5xcemeaapiworkshop' });
    f5xcemeaaiworkshop = new Xcaisecurity({ ...request.body, courseId: 'f5xcemeaaiworkshop' });
    f5xcemeaaigwworkshop = new Xcaigwworkshop({ ...request.body, courseId: 'f5xcemeaaigwworkshop' });
    apisecurityshiftleft = new Apisecurityshiftleft({ ...request.body, courseId: 'apisecurityshiftleft' });
    xcspeccore = new Xcspeccore({ ...request.body, courseId: 'xcspeccore' });
  }
});

const log = fastify.log;

export default fastify;
export { log }