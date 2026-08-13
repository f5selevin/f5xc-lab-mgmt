process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import axios from 'axios';
import { execSync } from 'node:child_process';
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

function exec(command) {
  const result = execSync(command);
  logger.info(`CMD: ${command} => ${result.toString()}`);
  return result;
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
    try {
      exec('rm /home/ubuntu/startup/error');
    } catch {}

    const tasks = _.orderBy(this.db.data.functions, ['order'], ['asc']);
    for (const { key, state } of tasks) {
      if (state === 1) continue;
      const result = await this[key]();
      Object.assign(this.db.data.functions[key], result);
      this.db.write();
      if (result.state !== 1) {
        exec('touch /home/ubuntu/startup/error');
        break;
      }
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
        const { data } = await axios.get('http://localhost:5123/metadata', { timeout: 5000 });
        if (data?.dep_id && data?.email && data?.petname) return data;
        lastError = new Error('Local metadata is missing dep_id, email, or petname');
      } catch (error) {
        lastError = error;
      }
      logger.warn({ attempt, error: lastError.message }, 'Local UDF metadata is not ready');
      if (attempt < 10) await delay(10000);
    }
    throw lastError;
  }

  async getUdfMetadata() {
    try {
      const localMetadata = await this.getLocalMetadata();
      const metaDeployment = (await axios.get('http://metadata.udf/deployment')).data;
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
      return { state: 2, output: undefined, error: error.stack || error };
    }
  }

  async f5xcCreateUserEnv() {
    try {
      const output = (await axios.post(`${this.f5xcLabMgmtDomain}/v1/student`, {
        courseId: this.courseId,
        ...this.db.data.udfMetadata
      })).data;
      if (output.code === 6 || output.status === 'error') return { state: 2, output, error: output };
      return { state: 1, output, error: undefined };
    } catch (error) {
      return { state: 2, output: undefined, error: error.stack || error };
    }
  }

  async registerOnPremCe() {
    try {
      const created = this.db.data.functions.f5xcCreateUserEnv.output;
      const url = `https://${this.db.data.udfMetadata.ceManagementAddress}:65500/api/ves.io.vpm/introspect/write/ves.io.vpm.config/update`;
      const response = await axios.post(url, {
        token: created.smsv2Site.token,
        cluster_name: created.smsv2Site.siteName,
        hostname: created.createdNames.ceOnPrem.hostname,
        latitude: '32.06440042393975',
        longitude: '34.894059728328465'
      }, {
        headers: {
          Authorization: 'Basic YWRtaW46Vm9sdGVycmExMjM=',
          'Content-Type': 'application/json'
        }
      });
      return { state: 1, output: response.data, error: undefined };
    } catch (error) {
      const details = {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        stack: error.stack
      };
      logger.error({ response: details }, 'registerOnPremCe request failed');
      return { state: 2, output: error.response?.data, error: details };
    }
  }
}

export default SetupAutomation;
