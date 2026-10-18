# Backups, recovery and updates

The final live backup operation returns a verified checksum, record counts and attachment-copy count. Keep its safe result with the acceptance evidence. Backups and the original database remain private in the owner's instance.

For an independent restore check, run the shared client's `--export-verification` command against a new empty private directory after the live checker completes. It reads the complete version 4 record export and every original attachment through the signed-in app, and records live file SHA256 values without exposing credentials. Keep those files private.

Run:

```sh
python3 scripts/restore-check.py --snapshot evidence/private-client-export/records.json --files evidence/private-client-export/files --manifest evidence/private-client-export/files-sha256.json
```

The script creates an empty temporary SQLite database, applies the included schema migrations, inserts the exported records and compares every field and table count. It verifies the setup task and the test file against the live plugin's file SHA256, then removes only its own temporary directory. It never overwrites the live database. Keep the successful `evidence/recovery.json`.

To recover a real installation, preserve the old source, profile, records and files. Create an empty recipient-owned destination. Use the matching supported import/migration path and verify every record and attachment before changing the app's connection. Record writes must remain frozen during a real cutover. Backups exclude webhook signing secrets; establish a new verified personal Dot subscription after recovery. A temporary local restore check is not a completed hosted disaster recovery.

## Updates

The shared Mac app receives signed updates from the public Passforth feed. Backend code stays in the recipient's own account. To update, obtain a reviewed source kit, preserve the recipient's profile, Site ID, bundle ID, plugin and storage, and take a verified backup first. Review schema migrations and validate the new source locally. Preserve the current runtime connection file and local cache during app updates. A backend upgrade does not require recompiling the client. Deploy a tested commit through the same private Site workflow. Verify sign-in, existing records, one request/reply and the new build's workspace connection before replacing the user's working app. Reuse the current plugin and subscription unless the platform explicitly requires reconnection.

Keep records and attachment bytes together in private recovery storage. Hosting/account backups are the recipient's responsibility. Record a retention plan and inspect actual usage; copying all attachments into daily backups consumes storage. Never send private backups, session files or credentials to the app's author as part of setup.
