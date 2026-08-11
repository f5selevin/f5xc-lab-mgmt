# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Fastify service that provisions per-student F5 Distributed Cloud (F5XC/Volterra) tenant resources for hands-on workshops running in F5 UDF (UDF = F5's lab environment). A student's UDF blueprint boots, runs the automation in [udf/startup/](udf/startup/), which calls this service's HTTP API to get F5XC objects created and returns the generated resource names back to the lab.

Two independent Node projects live here:
- Repo root — the lab-management API server (deployed as a container, see [Dockerfile](Dockerfile)).
- [udf/startup/](udf/startup/) — the agent that runs *inside* each student's UDF lab VM (own `package.json`, own deps, not built by the Dockerfile).

Both are ESM (`"type": "module"`). There is no test suite, no linter, and no build step.

## Running

```bash
npm install
cp ./modifiedNpms/axios-retry/lib/esm/index.js ./node_modules/axios-retry/lib/esm/index.js  # required, see below
mkdir -p db
node index.js <f5xc-domain> <f5xc-api-token>   # e.g. node index.js f5-sales-public.console.ves.volterra.io <token>
```

Listens on `0.0.0.0:8080`. Credentials may also be supplied at runtime instead of via argv by POSTing to `/v1/f5xcred` — see [examples.txt](examples.txt) for working curl invocations of every endpoint.

`db/` must exist before start: each course opens a synchronous lowdb file at `./db/db-<courseId>.json` relative to the process CWD. The directory is gitignored, so a fresh clone has no `db/` and startup will throw.

### The axios-retry patch

[modifiedNpms/axios-retry/lib/esm/index.js](modifiedNpms/axios-retry/lib/esm/index.js) is a vendored copy of the installed package with rejections changed to `Promise.reject({ status, statusText, ...error.response.data })` instead of an axios error. All the `.catch((e) => log.warn({operation:'...', ...e}))` handlers throughout the course classes spread that shape — they log nothing useful against an unpatched axios-retry. The Dockerfile copies it over `node_modules` after `npm install`; do the same by hand for local runs, and re-copy after any `npm install`.

## Architecture

### Course inheritance

[course.js](course.js) defines the `Course` base class; each workshop is a subclass in its own file ([xcworkshop.js](xcworkshop.js), [xcmcnworkshop.js](xcmcnworkshop.js), [xck8sworkshop.js](xck8sworkshop.js), [xcapiworkshop.js](xcapiworkshop.js), [xcaisecurity.js](xcaisecurity.js), [xcaigwworkshop.js](xcaigwworkshop.js), [apisecurityshiftleft.js](apisecurityshiftleft.js)). [api.js](api.js) instantiates one long-lived object per course and every route `switch`es on `request.body.courseId` to pick one. A course's identity is its `courseId` string, which is simultaneously the switch key, the lowdb filename suffix, and the argument the UDF agent passes to [udf/startup/startup.mjs](udf/startup/startup.mjs).

Subclasses all follow the same shape: call `super.newStudent(...)`, then a chain of `if (!err) { await this.f5xc.<op>(...).catch(...) }` guards, then write the student record to lowdb. They differ only in which F5XC objects they create (AWS VPC site, vK8s, SMSv2 site + token, role updates) and which they tear down.

[f5xc.js](f5xc.js) is the only place that talks to the F5XC REST API — one method per endpoint, no business logic. Add new tenant operations here, not in a course.

### How a student gets provisioned

`Course.newStudent` does **not** create the F5XC user or namespace, and nothing else in this repo does either. It polls `getUsersNs()` every 5s (10 attempts max), scanning every user in the tenant for one whose email matches and who holds `ves-io-power-developer-role` on some namespace — that namespace is then adopted as the student's. If no such user appears within ~50s, `newStudent` rejects and the lab's `f5xcCreateUserEnv` step fails.

**The user and its role grant are an undocumented out-of-band prerequisite.** Nothing in this repo, the Terraform, or the UDF startup code creates them; ask the maintainer before assuming a mechanism. Until b487fab (Jun 2023) the service did create them — `createNS(namespace)` + `createUser(email, namespace)` — and `createNames` generated the namespace (`'ns-' + id`, still there commented out) rather than discovering it. That commit commented the calls out and added the polling loop.

`createUser`, `createNS`, and `assignNs` in [f5xc.js](f5xc.js) are leftovers from that era with **zero callers**. Don't read them as live behavior: `createUser` grants `ves-io-admin-role`, not the `ves-io-power-developer-role` the poller matches on, so restoring the call alone would not satisfy the loop.

`createNames()` in [course.js](course.js) derives every F5XC object name from a date prefix plus a random 8-char id; the resulting `createdNames` object is persisted and is what teardown reads back. Students are keyed by `md5(lowercased email)`.

### Background loops

Every course runs `setInterval` loops that start in the constructor and never stop:
- `deleteInactiveStudents` (base class, 20s) — HEADs `https://<udfHost>` expecting a 401; after 5 consecutive failures it marks the student `deleting` and calls the subclass's `deleteStudent`. This is the only teardown trigger in normal operation, i.e. resources are reclaimed by detecting the UDF lab going away.
- `checkF5xcTf` (30s) — polls terraform apply status on the AWS VPC site and re-applies on known-transient error strings (`PendingVerification`, `failed to apply`).
- `checkCeReg` (30s) — auto-approves pending Customer Edge site registrations.
- [xcworkshop.js](xcworkshop.js) also has a module-level queue drained every 60s, so AWS VPC site creation is serialized to one per minute across all students.

Because these loops key off `this.db.data`, deletions are deferred with a 4-minute `setTimeout` before the record is dropped.

### UDF side ([udf/startup/](udf/startup/))

[setupAutomation.mjs](udf/startup/setupAutomation.mjs) is a resumable step runner: [startup.mjs](udf/startup/startup.mjs) declares an ordered `steps` array per course, each step is a method name on the class, and each step's outcome (`state: 1` = ok, `2` = error) is persisted to `./db.json` so a re-run skips completed steps. A failed step touches `/home/ubuntu/startup/error` and aborts the chain. Steps shell out to `terraform`, `aws`, `kubectl`, `ssh`, and `docker` against hardcoded paths under `/home/ubuntu/lab/` — this code only runs inside the UDF VM.

Steps read UDF-injected facts from `http://metadata.udf` (AWS creds, deployer email, lab hostname), pass them to `POST /v1/student` on this service, and feed the returned `createdNames` back into later steps (CE registration, bot startup).

The Terraform under [udf/terraform/](udf/terraform/) and [udf/terraform_aigw/](udf/terraform_aigw/) is applied by those steps, not by CI.

## Adding a course

A new course touches four places, and missing any one fails silently or at runtime rather than at load:
1. New `Course` subclass file.
2. [api.js](api.js) — the module-level `let`, the argv-path constructor block, a `case` in the POST `/v1/student` switch, a `case` in the GET `/v1/student/:courseId/:emailb64` switch, and the `/v1/f5xcred` handler.
3. [udf/startup/startup.mjs](udf/startup/startup.mjs) — a `case` with the step list.
4. `setupAutomation` — any new step methods, plus the `getUdfMetadata` switch if the course exposes different UDF components.

## Gotchas

- `validateStudent` in [course.js](course.js) returns `true || result.address == ip` — the UDF-host-vs-source-IP check is effectively disabled while still performing the DNS lookup (which can still throw).
- [api.js](api.js) hardcodes a few F5 employee email rewrites to personal addresses; F5XC rejects `@f5.com` accounts for lab users.
- `DELETE /v1/student` references an undefined `c` and will throw; deletion happens via the inactivity loop instead.
- The API server holds all credentials in memory only. A restart loses them until argv is re-supplied or `/v1/f5xcred` is re-posted, and every request meanwhile returns `{success:'fail', msg:'No available credentials for F5XC'}`.
- [examples.txt](examples.txt), [createAccounts.js](createAccounts.js), and the Terraform files contain real-looking AWS keys, F5XC site tokens, and CE basic-auth credentials from past labs. Treat them as compromised; don't propagate them into new code.
