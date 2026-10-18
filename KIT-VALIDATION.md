# Release verification

This setup kit uses the same signed Mac client and `passforth.setup.v1` acceptance contract as the publisher's installation. `requirements.json` is generated from the canonical standard. The source is pinned in `source/SELF-HOST-SOURCE.json`; the package manifest covers every included source and setup file.

The common client contains no fixed workspace address. The agent deploys the included backend, generates `workspace.passforth`, and verifies the owner imports it into the signed client. Developer tools and client compilation are optional for users modifying the Mac source.

Automated validation covers backend identity/authentication, SQLite/PostgreSQL behavior, task and conversation semantics, planning, actual workerd events, framework builds, HTTP/MCP smoke checks, workspace connection validation, cache isolation and legacy-data migration. The guided live checker requires actual responses, a fresh nonce-bearing Dot reply, native offline/restart observations and a complete private restore. Changing raw evidence invalidates acceptance.

Local fixtures verify the test machinery and never substitute for a person's real cloud/Dot/native evidence. The publisher's own installation runs in existing-instance mode, preserving baseline task IDs. New users run in new-instance mode and start empty. Every other acceptance gate is shared. A blocked operator or cloud-run observation stays unverified for everyone.
