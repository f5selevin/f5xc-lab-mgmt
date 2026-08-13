process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import axios from 'axios';
import _ from 'lodash';
import { LowSync, JSONFileSync } from 'lowdb';
import pino from 'pino';
import pretty from 'pino-pretty';

const logger = pino({}, pino.multistream([
  { stream: pretty({ sync: true, ignore: 'pid,hostname', crlf: true }) },
  {
    stream: pretty({
      sync: true,
      ignore: 'pid,hostname',
      crlf: true,
      destination: pino.destination({ dest: './log', sync: true, append: false, mkdir: true })
    })
  }
]));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sensitiveKeys = /authorization|password|secret|token/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sensitiveKeys.test(key) ? '[REDACTED]' : sanitize(item)])
  );
}

function errorDetails(error) {
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.response?.status,
    statusText: error.response?.statusText,
    response: sanitize(error.response?.data),
    stack: error.stack
  };
}

class SetupAutomation {
  constructor({ courseId, steps, f5xcLabMgmtDomain }) {
    this.courseId = courseId;
    this.f5xcLabMgmtDomain = f5xcLabMgmtDomain;
    this.db = new LowSync(new JSONFileSync('./db.json'));
    this.db.read();
    this.db.data ||= {
      courseId,
      udfMetadata: {},
      functions: {
        getUdfMetadata: { order: 1, state: 0, key: 'getUdfMetadata' },
        ...steps.reduce((result, key, index) => {
          result[key] = { order: index + 2, state: 0, key };
          return result;
        }, {})
      }
    };
  }

  async run() {
    const maxAttempts = 10;
    const retryDelayMs = 60000;
    const tasks = _.orderBy(this.db.data.functions, ['order'], ['asc']);

    for (const { key, state } of tasks) {
      if (state === 1) {
        logger.info({ task: key }, 'Skipping completed setup task');
        continue;
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        this.currentTask = key;
        this.currentTaskAttempt = attempt;
        logger.info({ task: key, attempt, maxAttempts }, 'Running setup task');
        const result = await this[key]();
        Object.assign(this.db.data.functions[key], result);
        this.db.write();

        if (result.state === 1) {
          logger.info({ task: key, attempt }, 'Setup task completed');
          break;
        }

        if (attempt === maxAttempts) {
          throw new Error(
            `Setup task "${key}" failed after ${maxAttempts} attempts: ${JSON.stringify(result.error)}`
          );
        }

        logger.warn(
          { task: key, attempt, retryDelayMs, error: result.error },
          'Setup task failed; retrying only this task'
        );
        await delay(retryDelayMs);
      }
    }
  }

  async request({ operation, method, url, data, timeout, headers, callAttempt, maxCallAttempts }) {
    const startedAt = Date.now();
    const context = {
      operation,
      task: this.currentTask,
      taskAttempt: this.currentTaskAttempt,
      callAttempt,
      maxCallAttempts,
      method: method.toUpperCase(),
      url
    };

    logger.info({ ...context, timeout, request: sanitize(data) }, 'HTTP request started');

    try {
      const response = await axios.request({ method, url, data, timeout, headers });
      logger.info({
        ...context,
        status: response.status,
        durationMs: Date.now() - startedAt,
        response: sanitize(response.data)
      }, 'HTTP request completed');
      return response;
    } catch (error) {
      logger.error({
        ...context,
        durationMs: Date.now() - startedAt,
        error: errorDetails(error)
      }, 'HTTP request failed');
      throw error;
    }
  }

  findPrivateIpv4(value) {
    const stack = [value];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (!current || typeof current !== 'object' || seen.has(current)) continue;
      seen.add(current);
      for (const item of Object.values(current)) {
        if (typeof item === 'string') {
          const match = item.match(/\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/);
          if (match) return match[0];
        } else if (item && typeof item === 'object') stack.push(item);
      }
    }
    return undefined;
  }

  async getLocalMetadata() {
    let lastError;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        const { data } = await this.request({
          operation: 'getLocalMetadata',
          method: 'get',
          url: 'http://localhost:5123/metadata',
          timeout: 5000,
          callAttempt: attempt,
          maxCallAttempts: 10
        });
        if (data?.dep_id && data?.email && data?.petname) return data;
        lastError = new Error('Local metadata is missing dep_id, email, or petname');
        logger.warn({
          operation: 'getLocalMetadata',
          taskAttempt: this.currentTaskAttempt,
          metadataAttempt: attempt,
          fieldsPresent: {
            dep_id: Boolean(data?.dep_id),
            email: Boolean(data?.email),
            petname: Boolean(data?.petname)
          }
        }, 'Local metadata response is incomplete');
      } catch (error) {
        lastError = error;
      }
      logger.warn({
        operation: 'getLocalMetadata',
        taskAttempt: this.currentTaskAttempt,
        metadataAttempt: attempt,
        maxMetadataAttempts: 10,
        retryDelayMs: attempt < 10 ? 10000 : undefined,
        error: errorDetails(lastError)
      }, 'Local UDF metadata is not ready');
      if (attempt < 10) await delay(10000);
    }
    throw lastError;
  }

  async getUdfMetadata() {
    try {
      const localMetadata = await this.getLocalMetadata();
      const metaDeployment = (await this.request({
        operation: 'getUdfDeploymentMetadata',
        method: 'get',
        url: 'http://metadata.udf/deployment'
      })).data;
      const ceComponent = _.find(metaDeployment.deployment.components, { name: 'F5XC CE RH (On Prem)' });
      if (!ceComponent) throw new Error('UDF component "F5XC CE RH (On Prem)" was not found');

      this.db.data.udfMetadata = {
        email: localMetadata.email,
        namespace: localMetadata.petname,
        deploymentId: localMetadata.dep_id,
        udfHost: metaDeployment.deployment.host,
        region: metaDeployment.deployment.region,
        ceManagementAddress: this.findPrivateIpv4(ceComponent) || '10.1.1.5'
      };
      this.db.write();
      return { state: 1, output: { metaDeployment, localMetadata }, error: undefined };
    } catch (error) {
      return { state: 2, output: undefined, error: errorDetails(error) };
    }
  }

  async f5xcCreateUserEnv() {
    try {
      const output = (await this.request({
        operation: 'f5xcCreateUserEnv',
        method: 'post',
        url: `${this.f5xcLabMgmtDomain}/v1/student`,
        data: {
          courseId: this.courseId,
          ...this.db.data.udfMetadata
        }
      })).data;
      if (output.code === 6 || output.status === 'error') {
        logger.error({
          operation: 'f5xcCreateUserEnv',
          task: this.currentTask,
          taskAttempt: this.currentTaskAttempt,
          response: sanitize(output)
        }, 'Server returned an application-level error');
        return { state: 2, output, error: output };
      }
      return { state: 1, output, error: undefined };
    } catch (error) {
      return { state: 2, output: undefined, error: errorDetails(error) };
    }
  }

  async registerOnPremCe() {
    try {
      const created = this.db.data.functions.f5xcCreateUserEnv.output;
      const url = `https://${this.db.data.udfMetadata.ceManagementAddress}:65500/api/ves.io.vpm/introspect/write/ves.io.vpm.config/update`;
      const response = await this.request({
        operation: 'registerOnPremCe',
        method: 'post',
        url,
        data: {
          token: created.smsv2Site.token,
          cluster_name: created.smsv2Site.siteName,
          hostname: created.createdNames.ceOnPrem.hostname,
          latitude: '32.06440042393975',
          longitude: '34.894059728328465'
        },
        headers: {
          Authorization: 'Basic YWRtaW46Vm9sdGVycmExMjM=',
          'Content-Type': 'application/json'
        }
      });
      return { state: 1, output: response.data, error: undefined };
    } catch (error) {
      return { state: 2, output: error.response?.data, error: errorDetails(error) };
    }
  }
}

export default SetupAutomation;
