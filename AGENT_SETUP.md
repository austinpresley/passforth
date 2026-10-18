# Agent setup runbook

Set up the included Passforth source as one recipient-owned private instance. Treat SPEC.md and requirements.json as the acceptance contract. Use real command, provider, HTTP, native UI and plugin evidence. Preserve the exact upstream behavior except for the included self-host configuration. Keep the entire extracted kit so its scripts and source remain available.

## 1. Inspect and establish ownership

Use Python 3.11 or later, Node.js 22.13 or later and npm on macOS or Linux. A Windows agent should use a Linux environment for the backend; the native stage still runs on the recipient's Mac.

Run `python3 scripts/verify-package.py` before changing source. Read SPEC.md, then inspect available hosting, plugin, Dot, native UI and terminal tools. Resolve missing capabilities through the supported connection flow. Keep successful work while reporting unavailable capabilities separately.

Confirm the selected provider account and workspace belong to this user. Review the current plan, usage limits and authority to create resources. Create `evidence/operator.json` using EVIDENCE.md. A paid upgrade needs the user's authorization. Keep credentials in the platform's protected login or secret flow. No API key for model inference is required by this app.

Use `profile.example.json` as `profile.json`. Record the user's actual timezone. Keep `agent_id` as `dot`; it is an inbox routing label, not another person's Dot ID. Profile fields are non-secret. Keep sign-in tokens, callback URLs, webhook signing secrets and credentials out of profiles, prompts, source, screenshots and reports.

Completion: package integrity passes; account, plan, timezone and missing capabilities are recorded.

## 2. Create the recipient's private Site

Supported route: ChatGPT Sites with D1 `DB`, R2 `BUCKET` and the `mcp` capability. The included manifest has no Site ID. This is a fresh installation, not an import or an update to an existing user's workspace. Preserve a non-empty preexisting instance and report it for review rather than emptying it.

Use the current Sites skill/workflow exposed to this agent. Prepare the included `source/dashboard` as a retained template. Preserve its server code, migrations, build integration, lockfile and MCP endpoint. Do not replace it with a static site or regenerate the app from a prose description. Registration and deployment must happen through the supported authenticated Sites flow. A directly deployed Worker that trusts client identity headers does not satisfy this kit's authentication contract.

Read `.openai/hosting.json` before creating a Site. If a previous attempt already saved a project ID, inspect and resume it. Otherwise create one new private Site in the recipient's account and immediately persist its exact returned ID. Save that ID and the provider-returned HTTPS origin in `profile.json`. Resolve uncertain creation before retrying. Never derive project/plugin IDs from names or reuse examples.

Run `python3 scripts/configure.py --profile profile.json --source source`. This binds the backend manifest and backup timezone, then generates `workspace.passforth`. The shared Mac app reads that connection at runtime and keeps a separate cache for each workspace. Its signed app updates use the public Passforth release feed. Keep `DESK_STORAGE=d1` and Sites authentication; leave independent-auth and static agent-credential settings unset for this route.

Completion: one recipient-owned private Site is registered; source is bound to it; database and file bindings are declared.

## 3. Build and deploy the exact source

In `source/dashboard`, run the locked install command `npm run install:ci`. Use the current Sites helper to prepare portable execution metadata when required by that environment. Build the included application rather than replacing it with another starter.

Run, from the kit root:

```sh
python3 scripts/run-checks.py server
python3 scripts/run-checks.py smoke
```

These commands run the actual regression suites, build the framework and start an isolated local HTTP preview for smoke checks. They never call the hosted instance. Preserve logs; fix failures and rerun affected phases. They use an available local port and local D1/R2 state.

The publisher and existing installations use this same standard. For an authorized existing installation only, start live verification with `--mode existing`; it preserves and checks the baseline task IDs instead of requiring an empty database. All other gates still apply. New recipients use the default new mode.

Use the recipient Site's supported source synchronization, commit and artifact packaging workflow. Apply all included D1 migrations through that workflow. Save and deploy the pushed commit privately. Confirm deployment succeeded, ownership is `owner`, access is owner-only with one allowed viewer, and both D1 and R2 belong to this Site. Do not expand the audience to make tests or service access work.

Capture safe provider fields in `evidence/provider.json`. Never serialize an entire credential-bearing provider response. Record the tested source fingerprint, exact deployed commit and returned IDs. Run `node scripts/probe-public.mjs --profile profile.json --out evidence/public.json` against the new Site.

Completion: source checks, local smoke checks and anonymous/forged-identity probes pass; deployment and ownership evidence matches this profile.

## 4. Connect and exercise the new plugin

Get this Site with MCP connection details. Use its returned plugin ID and platform installation UI. Each recipient signs in with their own account. Reuse the Site's provisioned plugin. Confirm a real tool call succeeds; installation UI or a deployment result alone does not prove connection.

Follow LIVE_CHECKS.md. Its state machine starts with the empty instance and generates exact tool calls. Invoke those calls on this installation's actual connected plugin. Store the actual tool result, then pass it to the checker. It checks versions, partial updates, retries, conflicts, organization, links, planning, private files, backup and the final real Dot response. Preserve the test task as an audit record. Do not create normal tasks or seed content before the empty-instance checks.

Completion: resume the live checker until it reaches the native reference step. Do not skip failed checks or edit its session receipts.

## 5. Build and verify the native app

On the recipient's Mac, download the signed, notarized app from the public Passforth release, verify its checksum and signature, and install it. Use the same released binary as the publisher. No compiler or publisher signing credential is needed. Import `workspace.passforth`, sign in and follow NATIVE_CHECKS.md. The app checks the backend's project ID, API version and shared setup standard before syncing.

After sign-in, use the app's read-only verification export command with a new empty private destination:

```sh
"/Applications/Passforth.app/Contents/MacOS/DotDesk" --export-verification "$PWD/evidence/private-client-export"
```

It uses the app's saved sign-in without exposing cookies or tokens. It exports private records and file bytes plus `instance.json`, `client.json` and file checksums for recovery. Use a fresh export after the final live-checker backup for the restore step. Copy `client.json` to `evidence/client.json`. Keep the other export files private. If the app is installed elsewhere, use its actual path. Follow NATIVE_CHECKS.md and continue the live checker at its reference and attachment steps. Verify the native UI and actual plugin see the same records.

Completion: released client, sign-in, reference comment and attachment checks pass with retained UI evidence.

## 6. Connect the personal Dot and finish recovery checks

Follow DOT_CONNECTION.md for the owner's personal Dot subscription and hourly maintenance. The owner's personal Dot must receive and answer the native verification request through the event subscription. The setup agent must not use acknowledge_request or reply_request to manufacture that proof. A successful callback delivery alone is insufficient.

Continue LIVE_CHECKS.md and NATIVE_CHECKS.md for offline capture, restart and exactly one reconnect save. The checker then archives its temporary organization/planning records and completes the offline test task. Follow RECOVERY.md for the export, attachment download and disposable restore check.

Complete the evidence files described in EVIDENCE.md. Run:

```sh
python3 scripts/acceptance.py --profile profile.json
```

Completion: every gate passes and the generated report says `READY`. Otherwise report the passing gates, the exact blocker and the next supported action. Leave the report `INCOMPLETE`; preserve resumable state and do not call the complete installation verified.

## Handoff

Give the recipient their Site URL, local app path, plugin name, observed Dot reply, source/version record, backup/recovery locations and acceptance report. State who owns hosting and how to inspect costs. Separate automated checks from agent-observed UI/provider checks. Keep private exports and credentials with the recipient. For updates use RECOVERY.md; retain their Site ID, storage, plugin, profile and bundle ID.
