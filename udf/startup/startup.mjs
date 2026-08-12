import setupAutomation from './setupAutomation.mjs';

const f5xcLabMgmtDomain = 'https://xs.partner-spec.f5demos.com';

const args = process.argv.slice(2);
const course = args[0];
console.log('Args are', args);


let runSetup;

const main = async () => {
  switch (course) {
    case 'xcspeccore':
      runSetup = new setupAutomation({
        courseId: course,
        f5xcLabMgmtDomain,
        steps: [
          'f5xcCreateUserEnv',
          'registerOnPremCe'
        ]
      })
      await runSetup.run();
      break;

    case 'f5xcemeaworkshop':
      runSetup = new setupAutomation({
        courseId: course,
        f5xcLabMgmtDomain,
        steps: [
          'terraform',
          'f5xcCreateUserEnv',
          'registerOnPremCe',
          'installAwsMicrok8s',
          'awsCeLbRecordUpdate',
          'runBot'
        ]
      })
      await runSetup.run();
      break;

    case 'apisecurityshiftleft':
      runSetup = new setupAutomation({
        courseId: course,
        f5xcLabMgmtDomain,
        steps: [
          'f5xcCreateUserEnv',
          'registerOnPremCeApiSecurityShiftLeft',
        ]
      })
      await runSetup.run();
      break;

    case 'f5xcemeaapiworkshop':
      runSetup = new setupAutomation({
        courseId: course,
        f5xcLabMgmtDomain,
        steps: [
          'f5xcCreateUserEnv'
        ]
      })
      await runSetup.run();
      break;

    case 'f5xcemeak8sworkshop':
      runSetup = new setupAutomation({
        courseId: course,
        f5xcLabMgmtDomain,
        steps: [
          'f5xcCreateUserEnv'
        ]
      })
      await runSetup.run();
      break;

    case 'f5xcemeaaiworkshop':
      runSetup = new setupAutomation({
        courseId: course,
        f5xcLabMgmtDomain,
        steps: [
          'f5xcCreateUserEnv'
        ]
      })
      await runSetup.run();
      break;

    case 'f5xcemeaaigwworkshop':
      runSetup = new setupAutomation({
        courseId: course,
        f5xcLabMgmtDomain,
        steps: [
          'terraform_aigw',
          'f5xcCreateUserEnv'
        ]
      })
      await runSetup.run();
      break;

    case 'agility2025aigw':
      runSetup = new setupAutomation({
        courseId: course,
        f5xcLabMgmtDomain,
        steps: [
          'terraform_aigw_agility',
        ]
      })
      await runSetup.run();
      break;

    case 'appworld2025':
      runSetup = new setupAutomation({
        courseId: course,
        f5xcLabMgmtDomain,
        steps: [
          'terraform_aigw_appworld2025',
        ]
      })
      await runSetup.run();
      break;

    case 'f5xcemeamcnworkshop':
      runSetup = new setupAutomation({
        courseId: course,
        f5xcLabMgmtDomain,
        steps: [
          'f5xcCreateUserEnv',
          'registerOnPremCeMCN',
        ]
      })
      await runSetup.run();
      break;

    default:
      console.log('Unknown course')
      break;
  }
}


main();



