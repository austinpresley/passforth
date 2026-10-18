# Passforth

A native Mac workspace for tasks, notes, planning and conversations with your own Dot.

**[Download the Mac app and setup kit](https://github.com/austinpresley/passforth/releases/latest)**

One signed, notarized Mac app connects to your own private backend. Each person owns their hosting account, database, files and Dot connection. The publisher distributes software and does not operate a shared service for your workspace.

## Set up

1. Download and install the signed Mac app.
2. Download the setup kit, extract it and give your agent the prompt in [START-HERE.md](START-HERE.md).
3. Your agent deploys the included backend to your own private Site and generates `workspace.passforth`.
4. Import that connection file into Passforth, sign in and authorize your Dot.
5. Have your agent finish the acceptance checks. The report stays incomplete until every required gate passes.

The same `passforth.setup.v1` standard applies to the publisher's installation and new installations. [Read the spec](SPEC.md), [verification evidence requirements](EVIDENCE.md) and [recovery/update instructions](RECOVERY.md).

Your account needs the supported Sites, plugin, Dot and event-task features. Hosting and ChatGPT usage follow your own plan and limits. The agent asks before creating paid resources. See the setup prompt for the exact scope and approval.

## Updates

The Mac client receives signed updates from this repository. Its connection settings and private cache stay on your Mac. Your agent manages backend upgrades in your own hosting account, preserving the Site, data, plugin and subscription. Client/backend compatibility is checked before syncing.

The source included under `source/` is a sanitized, versioned snapshot. It contains no publisher workspace, credentials or task data. Third-party notices are retained. Keep profile files, exports and verification evidence private. Share an original release ZIP, not your configured working folder.
