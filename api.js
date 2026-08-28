import Fastify from 'fastify';
import { findDeployment, getDashboardStudents, updateDeploymentLastSeen } from './database.js';
import { validateUdfRequest } from './udf-validation.js';
import { renderDashboard, requireDashboardPassword } from './dashboard.js';

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

const supportedCourseIds = ['xcspeccore', 'xcspecsecurity'];
const courses = new Map();

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

for (const courseId of supportedCourseIds) {
  const { default: CourseImplementation } = await import(`./${courseId}.js`);
  const credential = loadWorkshopCredential(courseId);
  if (credential) {
    courses.set(courseId, new CourseImplementation({ ...credential, courseId }));
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error(`F5XC_CREDENTIALS_BASE64 must contain a ${courseId} credential in production`);
  }
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
    const { deploymentId, dep_id: depId, namespace, udfHost } = request.body || {};
    const resolvedDeploymentId = deploymentId || depId;

    if (!resolvedDeploymentId || !namespace || !udfHost) {
      return reply.code(400).send({ status: 'error', message: 'deploymentId, namespace, and udfHost are required' });
    }

    const deployment = await findDeployment({ deploymentId: resolvedDeploymentId, namespace });
    if (!deployment) return reply.code(404).send({ status: 'error', message: 'Deployment was not found' });

    const isUdf = await validateUdfRequest({
      udfHost,
      ip: request.ip,
      log: request.log,
      allowIpMismatch: true
    }).catch((error) => {
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
    const { courseId: requestedCourseId, email } = request.body || {};
    request.log.info({ courseId: requestedCourseId, email });

    if (!supportedCourseIds.includes(requestedCourseId)) {
      return reply.code(400).send({ status: 'error', msg: 'Unknown courseId' });
    }
    const course = courses.get(requestedCourseId);
    if (!course) {
      return reply.code(503).send({ status: 'error', msg: `No available credentials for ${requestedCourseId}` });
    }
    if (!email) {
      return reply.code(400).send({ status: 'error', msg: 'email is required' });
    }

    const student = await course.newStudent({ ...request.body, email, ip: request.ip, log: request.log });
    request.log.info({
      operation: 'studentResponse.send',
      courseId: requestedCourseId,
      email,
      token: student?.smsv2Site?.token
    });
    return student;
  }
});

export default fastify;
