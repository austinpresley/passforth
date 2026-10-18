import hosting from '../.openai/hosting.json';

export function instanceMetadata() {
  return {
    product: 'passforth', api_version: 1, standard: 'passforth.setup.v1',
    project_id: 'project_id' in hosting ? hosting.project_id : null,
    capabilities: ['tasks', 'conversations', 'notes', 'planning', 'files', 'backups', 'mcp-events'],
  };
}
