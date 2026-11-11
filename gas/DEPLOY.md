# Direct publication to the existing dashboard

No manual file replacement and no new Google project are needed. The target is
the **existing** dashboard in `ops/apps-script-targets.json`, not `gas-relay`.
Script/deployment IDs are identifiers, not credentials. The existing coworkers'
URL, access policy and server-side Script Properties are preserved.

## Normal agent workflow

Use Node 22 or newer on `monthly-report-v1`:

```powershell
npm ci
npm ci --prefix gas
npm run gas:check
npm run gas:test
npm run build
# Review, commit and push changes on monthly-report-v1; never merge main.
npm run gas:deploy
# Equivalent Windows entry point:
.\gas\deploy.ps1
```

`npm run gas:plan` validates/stages offline without Google writes.
`npm run gas:access` checks OAuth and the existing deployment without publishing.
No `.env.local`, database access or backend secrets are required for publication.

The deploy command rejects other branches, detached HEAD and a dirty working tree;
runs the GAS/connector test suite; stages all `.gs` and `.html` files plus the
manifest (including Admin, RPC, filters and the inline Excel vendor); checks all
includes and parses all server/browser JavaScript. Staging removes old deployable
files and never retains the legacy `OwnerSetup.gs` bootstrap.

Before pushing, it confirms the existing deployment, saves remote HEAD source and
the old published version under ignored `runtime/gas-releases/<timestamp>/`, and
checks that access and executeAs match the reviewed configuration. It pushes with
official pinned clasp, reads the remote source back and compares content hashes,
creates an immutable version, updates the **existing deployment ID**, and verifies
the version through the Google API. A local lock prevents simultaneous releases
from this checkout. Do not run another publisher/editor against the same Google
project while a release runs.

The release receipt records commit, source hashes and previous/new versions.
Source backups are local and ignored; treat them as private. The command never
copies Script Properties or OAuth into source or logs. It does not automatically
roll back after an ambiguous network failure: inspect the receipt and run
`gas:access` first. After a killed process, inspect the remote state before removing
`runtime/gas-dashboard-release.lock`.

## Only if Google authorization is missing or revoked

The **only user action** normally needed is approving the Google sign-in opened by:

```powershell
npm run login --prefix gas
```

Use the account that owns/can edit the existing project. If Google reports the
Apps Script API is disabled, enable it once at
<https://script.google.com/home/usersettings>. Workspace admin restrictions may
require the account administrator's approval. The agent then retries `gas:access`
and continues deployment. Never paste refresh tokens into chat or commit them.
Default OAuth lives at `~/.clasprc.json`; `GAS_CLASP_AUTH` may point to another
private file. Missing IDs belong in `ops/apps-script-targets.json`; do not create
a replacement project/deployment merely because authentication failed.

## Rollback

Use the receipt's `previousVersion` and the same target. No source push is needed:

```powershell
# Stage first if this is a fresh checkout.
node ops/stage-google-project.cjs dashboard
.\ops\apps-script.ps1 -Project dashboard create-deployment --deploymentId <existing-id> --versionNumber <previous-version> --description rollback
npm run gas:access
```

The legacy wrapper expects the existing per-user clasp installation. For a portable
checkout use `node gas/node_modules/@google/clasp/build/src/index.js --project
<absolute-runtime-stage-directory> create-deployment ...` instead.

## GitHub Actions decision

Validation runs on pushes to `monthly-report-v1`; it needs no Google secret.
Local publication is preferred here because working owner OAuth already exists
outside Git. An Actions publisher would require storing a long-lived Google
refresh token in a protected GitHub Environment, limiting deploys to this branch,
concurrency control and possibly secret/environment approval. It adds no benefit
for this workstation workflow, so no deployment workflow or secret was created.
If later requested, use a manually dispatched protected-environment job and
ephemeral credential files, never PR-provided code with deployment secrets.

Official references: [clasp commands](https://github.com/google/clasp),
[Google Apps Script CLI guide](https://developers.google.com/apps-script/guides/clasp).
