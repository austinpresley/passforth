# Live plugin verification

Run from the extracted kit root after configuring the recipient's actual profile and connecting its plugin. Use the actual plugin returned by this Site. Choose tools by their discovered names; connector prefixes vary per account.

```sh
python3 scripts/verify-mcp.py start --profile profile.json
python3 scripts/verify-mcp.py next
```

The helper prints the next tool and exact arguments. Call that real tool and save its raw result as JSON, for example `evidence/response-01.json`. A standard MCP `content` result, JSON-RPC `result` envelope, or the decoded JSON tool payload is accepted. Retain the result itself, rather than paraphrasing it or writing a status flag.

```sh
python3 scripts/verify-mcp.py record --response evidence/response-01.json
```

The checker advances only when its predicates pass and then prints the next call. Save the original response before `record`. On a network timeout, repeat the same generated call and event ID. On a validation failure, fix the named problem and fetch a fresh response; the failed step remains pending. Use `next` or `status` to resume. Keep the session file unchanged except through this helper. Do not start another session to erase a failed gate. If the personal Dot updated the setup test task between the final read and its completion, use `refresh-final-context` while that completion is pending. It rereads only that test task and uses a fresh event ID for the new version. Other peer conflicts require review.

Initial reads require an empty instance. Creation/replay, partial update, stale-version rejection, organization, links, saved view, time block and maintenance deduplication are machine-checked. Those calls create only setup records. Local regression suites cover the remaining task, date, label, read-state, daily-note and storage semantics.

When a step includes native UI instructions, perform them before collecting its tool response. At `attachment`, run:

```sh
python3 scripts/verify-mcp.py attachment
```

Upload that generated file once through the native app. The helper locates it by filename and verifies the private attachment bytes returned by `read_attachment`. A successful backup response must include its read-back checksum and verified attachment-copy count.

At `monitoring` follow DOT_CONNECTION.md. At `dot_reply`, send the exact helper-generated message once through the native app. It contains a fresh nonce. Wait for the personal Dot event response, then call `get_context`. Neither the setup agent nor a test helper should call acknowledge_request or reply_request. The checker requires the exact reply, request identity, agent author, answered state and acknowledgement timestamps. If the Dot is delayed, preserve the session and report that step pending.

At `offline_absent` and `offline_present` follow NATIVE_CHECKS.md. These reads verify the offline capture is absent while offline and exists once after reconnecting. The remaining calls archive the temporary note/view/block/project/area, complete the offline capture and create a final private backup. Test history and the attachment remain available for recovery verification.

The final helper `PASS` covers its live plugin checks. Overall readiness additionally requires all gates in `scripts/acceptance.py`.
