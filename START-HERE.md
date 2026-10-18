# Set up your own Passforth

This kit contains the app source, an agent runbook and executable acceptance checks. Your instance belongs to your account. It starts empty and uses your own Dot. The signed Mac app and its software update feed are shared. Your workspace, database, files and credentials belong to you.

Share the original ZIP. A configured folder can contain the recipient's private configuration and verification exports.

Unzip the whole kit. Give your AI agent access to the extracted folder and paste:

> Set up my own private Passforth using this folder. Read AGENT_SETUP.md and follow its acceptance gates. Use my own hosting account and my own Dot. I authorize creating and publishing my private instance, connecting its plugin, hourly maintenance with a daily verified backup, and harmless setup verification records. Use my existing plan; ask before creating paid resources. Preserve any existing resources or work. Perform the actual checks and give me the final acceptance report. Mark unavailable steps blocked instead of declaring them done.

First install the signed Mac app from [GitHub Releases](https://github.com/austinpresley/passforth/releases/latest). Your agent needs file and terminal access, a supported ChatGPT Sites connection, and access to your Mac to import the connection and verify the native app. You need Sites, custom plugin connections, dots and event-triggered tasks available to your account. These features depend on your account and workspace settings. A coding agent without Sites tools can prepare and test the source, then hand off the deployment stage to an agent with those tools.

You may need to personally complete sign-in and consent. A prebuilt app removes the need to install Apple developer tools or compile the client. The agent should do the work it can and give you one specific next action for each remaining dependency.

The result should be your private Site, your own database and file storage, a Mac app connected to that Site, a working Dot request/reply connection, and a recovery bundle. `evidence/acceptance.json` says `READY` only after every required gate passes. A published website alone is a partial installation.

The kit itself was tested against a clean local source copy. Your personal deployment and Dot connection must be verified in your account. Hosting and ChatGPT usage follow your own plan and limits; the kit does not promise free hosting.
