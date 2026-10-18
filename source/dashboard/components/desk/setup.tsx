'use client';

import { useState } from 'react';
import { reportingInstruction } from '../../lib/reporting';

const instruction =
  'Monitor Passforth request.created events for agent_id dot. Subscribe through the supported event flow, check list_requests now, and verify a real request and reply before saying monitoring is active. If the new event or tools are missing, tell me to refresh the existing Passforth connection.\n\n' +
  reportingInstruction;

export function Setup({ hasDotReport }: { hasDotReport: boolean }) {
  const [copyStatus, setCopyStatus] = useState('');
  return (
    <details className="setup">
      <summary>{hasDotReport ? 'Agent connection' : 'Connect Dot'}</summary>
      <p>
        Connect your Passforth plugin to the conversation where Dot works, then
        give it this instruction.
      </p>
      <textarea
        aria-label="Instruction for Dot"
        readOnly
        value={instruction}
        rows={7}
      />
      <button
        className="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(instruction);
            setCopyStatus('Copied.');
          } catch {
            setCopyStatus('Select the instruction above and copy it.');
          }
        }}
      >
        Copy instruction
      </button>
      <span role="status">{copyStatus}</span>
      <p>
        After the plugin discovers the new tools and request.created event, ask
        Dot to monitor requests for agent_id dot. Verify one request and reply
        here before relying on unattended work.
      </p>
      <p className="muted">
        Send to Dot saves a request. A verified event subscription can notify
        your agent; acknowledgement appears only after the agent reads it.
      </p>
    </details>
  );
}
