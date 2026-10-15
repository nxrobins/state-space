import {guardNode,verificationYield} from './verification_guard.mjs';
await guardNode('cpu',1200);
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {cpus} from 'node:os';
import {createLevel} from '../examples/active-cavern/scene.js';
import {ActiveCavernGame,CpuTerrain} from '../examples/active-cavern/game.js';
const {values}=parseArgs({options:{recording:{type:'string',default:'dist/volume-m4/replay128/report.json'},output:{type:'string',default:'dist/volume-m4/node128'},'compare-game-refactor':{type:'boolean',default:false}}});
const hash=value=>createHash('sha256').update(value).digest('hex');
const decode=value=>{assert.equal(value.encoding,'gzip-base64');return JSON.parse(gunzipSync(Buffer.from(value.data,'base64')));};
const recording=JSON.parse(readFileSync(values.recording,'utf8'));assert(recording.passed&&recording.sourceUnchanged);const ref=recording.result;
const paths=['examples/active-cavern/game.js','examples/active-cavern/scene.js','examples/cavern/scene.js','dist/sdk/state-space-active-world.js','dist/sdk/state-space-world.js','dist/sdk/state-space-3d.js'];
const sources=()=>Object.fromEntries(paths.map(p=>[p,hash(readFileSync(p))]));const referenceInputs=sources(),verifierHash=hash(readFileSync(new URL(import.meta.url)));
const changedInputs=paths.filter(p=>referenceInputs[p]!==recording.sourceHashes[p]);
// A game setup refactor must still reproduce every original complete fixture,
// command and odd-tick restart below. CPU material/terrain sources stay pinned.
for(const p of changedInputs)assert(values['compare-game-refactor']&&p==='examples/active-cavern/game.js',p);
mkdirSync(values.output,{recursive:true});const report={passed:false,recordedAt:new Date().toISOString(),verifierHash,host:{cpu:cpus()[0].model,node:process.version},referenceInputHashes:referenceInputs,baselineInputHashes:Object.fromEntries(paths.map(p=>[p,recording.sourceHashes[p]])),changedInputs,recordingHash:hash(readFileSync(values.recording)),fixtures:{}};
const save=()=>writeFileSync(values.output+'/report.json',JSON.stringify(report,null,2)+'\n');
const keep=(name,value)=>{const bytes=Buffer.from(JSON.stringify(value)),path=values.output+'/'+name+'.json.gz';writeFileSync(path,gzipSync(bytes,{level:9}));report.fixtures[name]={path,sha256:hash(bytes),compressedSha256:hash(readFileSync(path))};};
save();process.once('uncaughtExceptionMonitor',error=>{report.error=String(error.stack||error);save();});
const game=new ActiveCavernGame(new CpuTerrain(createLevel(ref.seed)),ref.seed);await game.initialize();assert.deepEqual(await game.snapshot(),decode(ref.initialCompressed));keep('initial',await game.snapshot());
const timings=[],checkpoints={};
for(const c of ref.commands){const start=performance.now();await game.step(c);timings.push(performance.now()-start);if([3,31,509].includes(c.tick)){checkpoints[c.tick]=await game.snapshot();assert.deepEqual(checkpoints[c.tick],decode(ref.checkpointsCompressed[c.tick]));keep('game-'+c.tick,checkpoints[c.tick]);}if(c.tick%16===0)console.log(`128 CPU replay ${c.tick}/600`);await verificationYield();}
const final=await game.snapshot();assert.deepEqual(final,decode(ref.finalCompressed));assert.equal(final.status,'won');assert.equal(game.field.field.energyBalance().driftQ,0n);keep('final',final);keep('commands',ref.commands);
await game.restore(checkpoints[509]);for(const c of ref.commands.slice(509)){await game.step(c);if(c.tick%16===0)console.log(`128 CPU restart 509: ${c.tick}/600`);await verificationYield();}assert.deepEqual(await game.snapshot(),final);
assert.deepEqual(sources(),referenceInputs);assert.equal(hash(readFileSync(new URL(import.meta.url))),verifierHash);report.passed=true;report.sourceUnchanged=true;report.game={ticks:600,cpuGpuExact:true,restart:509,wonAt:final.events.find(e=>e.type==='crossed').tick,finalHash:hash(JSON.stringify(final)),energyDriftQ:'0'};report.cpuGameplayTickMs=timings;save();console.log('128 CPU/GPU complete state and odd-tick restart exact.');
