import setupAutomation from './setupAutomation.mjs';

const f5xcLabMgmtDomain = 'https://xs.partner-spec.f5demos.com';

const courseId = process.argv[2];

if (!courseId) {
  throw new Error('A course ID must be provided as the first argument');
}

const runSetup = new setupAutomation({
  courseId,
  f5xcLabMgmtDomain,
  steps: [
    'f5xcCreateUserEnv',
    'registerOnPremCe'
  ]
});

await runSetup.run();

