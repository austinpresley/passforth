import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../lib/instance.ts', import.meta.url), 'utf8').replace(/import hosting from[^;]+;/, 'const hosting = {project_id: "fixture-project"};');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {instanceMetadata}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const value=instanceMetadata();
assert.equal(value.product,'passforth');assert.equal(value.api_version,1);assert.equal(value.standard,'passforth.setup.v1');assert.equal(value.project_id,'fixture-project');
for(const feature of ['tasks','conversations','notes','planning','files','backups','mcp-events'])assert.ok(value.capabilities.includes(feature));
const endpoint=readFileSync(new URL('../app/api/instance/route.ts',import.meta.url),'utf8')
 .replace(/import \{ identity, fail \} from[^;]+;/, `const identity=async request=>{if(request.headers.get('authorization')!=='Bearer fixture')throw {status:401};};const fail=error=>Response.json({error:'Denied'},{status:error.status||500});`)
 .replace(/import \{ instanceMetadata \} from[^;]+;/, 'const instanceMetadata=globalThis.fixtureMetadata;');
globalThis.fixtureMetadata=instanceMetadata;
const routeCode=ts.transpileModule(endpoint,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {GET}=await import('data:text/javascript;base64,'+Buffer.from(routeCode).toString('base64'));
assert.equal((await GET(new Request('https://fixture.example/api/instance'))).status,401);
const authorized=await GET(new Request('https://fixture.example/api/instance',{headers:{authorization:'Bearer fixture'}}));
assert.equal(authorized.status,200);assert.equal(authorized.headers.get('cache-control'),'no-store');assert.deepEqual(await authorized.json(),value);
delete globalThis.fixtureMetadata;
console.log('Shared workspace identity, compatibility and authenticated metadata route passed.');
