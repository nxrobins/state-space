"""Record source-only Build 7 evidence. Never imports or executes the engine.

Reads bounded source files, compares retained baselines and writes this folder's
JSON receipts. No compiler, test runner, browser, telemetry or simulation launch.
"""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re


FOLDER = Path(__file__).resolve().parent
ROOT = FOLDER.parents[3]
PREVIOUS = FOLDER.parent / 'build-06-2026-10-17' / 'summary.json'


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def replace_once(text, old, new=''):
    if text.count(old) != 1:
        raise ValueError('Projection anchor is missing or ambiguous: ' + old[:100])
    return text.replace(old, new, 1)


def project_material(text):
    text = replace_once(text, "import type { ProvenancePass3D } from './motion-trace.js';\n")
    text = replace_once(text, ', provenance?: ProvenancePass3D')
    text = replace_once(text, '  if (provenance) provenance.output.set(provenance.input);\n')
    return replace_once(text, '''    if (provenance) {
      provenance.output[s] = provenance.input[t]; provenance.output[t] = provenance.input[s];
      provenance.touched[provenance.input[s]] = 1; provenance.touched[provenance.input[t]] = 1;
    }
''')


def project_world(text):
    text = replace_once(text, "import { createMotionRecorder3D, motionEntryLimit3D, type MaterialMotionTrace3D, type MotionTraceOptions3D } from './motion-trace.js';\n")
    text = replace_once(text, '''  step(ticks=1,options:StructuralStepOptions3D={}) {this.#advance(ticks,options);}
  /** Optional provenance for one complete tick; it is never stored in snapshots. */
  stepWithMotion(options:MotionTraceOptions3D={}):MaterialMotionTrace3D {
    return this.#advance(1,{},motionEntryLimit3D(options))!;
  }
  #advance(ticks:number,options:StructuralStepOptions3D,captureLimit?:number):MaterialMotionTrace3D|undefined {
''', '  step(ticks=1,options:StructuralStepOptions3D={}) {\n')
    text = replace_once(text, 'let input=edited.state,lastTrace:MaterialMotionTrace3D|undefined;', 'let input=edited.state;')
    text = replace_once(text, '''      let state:StructuralState3D,recorder:ReturnType<typeof createMotionRecorder3D>|undefined;
      if(captureLimit===undefined) state=solveStructure3D(input,this).state;
      else {
        const plan=solveStructure3D(input,this);state=plan.state;
        recorder=createMotionRecorder3D(plan,this,this.#tick,{physicsRulesVersion:STRUCTURAL_RULES_VERSION_3D,materialCatalogHash:MATERIAL_CATALOG_HASH_3D},captureLimit);
      }
      let spare=clone(state);
''', '      let state=solveStructure3D(input,this).state,spare=clone(state);\n')
    text = replace_once(text, ',pass,recorder?.provenance)', ',pass)')
    text = replace_once(text, '        recorder?.endPass();\n')
    text = replace_once(text, '      lastTrace=recorder?.finish();\n')
    return replace_once(text, '    return lastTrace;\n')


def record():
    previous = json.loads(PREVIOUS.read_text())
    before = json.loads((FOLDER / 'physics-before.json').read_text())
    protected_before = previous['protectedSourceHashes']
    protected_now = {name: digest(ROOT / name) for name in protected_before}
    changed = {name: {'before': value, 'current': protected_now[name]}
               for name, value in protected_before.items() if protected_now[name] != value}
    if len(protected_before) != 96 or set(changed) != set(before):
        raise ValueError('Unexpected protected-source change; review before recording evidence.')

    projection = {'kind': 'read-only source projection, not runtime equivalence proof', 'files': {}}
    for name, project in [('structural-material.ts', project_material), ('structural-world-core.ts', project_world)]:
        relative = 'engine/experimental/' + name
        path = ROOT / relative
        baseline = FOLDER / before[relative]['copy']
        if digest(baseline) != before[relative]['sha256'] or digest(baseline) != protected_before[relative]:
            raise ValueError('Retained baseline hash differs.')
        matched = re.sub(r'\s+', '', project(path.read_text())) == re.sub(r'\s+', '', baseline.read_text())
        if not matched:
            raise ValueError('Physical source projection differs: ' + name)
        projection['files'][name] = {
            'physicalSourceAfterRemovingInstrumentationMatchesBaselineIgnoringWhitespace': matched,
            'currentSHA256': digest(path), 'baselineSHA256': digest(baseline),
        }
    old_kernel = (FOLDER / 'before-structural-material.ts.txt').read_bytes()
    fixture = ROOT / 'engine/experimental/structural-material.motion-baseline.ts'
    header = b'/** Frozen pre-motion kernel for held equivalence verification only. */\r\n'
    if fixture.read_bytes() != header + old_kernel:
        raise ValueError('Frozen old kernel changed.')
    projection.update(frozenKernelExactApartFromHeader=True, physicalReplayVerified=False)

    gate = json.loads((FOLDER / 'quiet-window-01.json').read_text())
    if gate['passed'] is not False or gate['workloadLaunched'] is not False:
        raise ValueError('Unexpected quiet-gate result.')
    hold = json.loads((ROOT / 'dist/verification/safety-hold.json').read_text())
    if not hold['blockRecovery'] or hold.get('recoveryPermit'):
        raise ValueError('Runtime hold changed.')

    new_sources = [
        'engine/experimental/motion-trace.ts', 'engine/experimental/motion-trace.test.ts',
        'engine/experimental/motion-trace.runtime-cases.ts', 'engine/experimental/structural-material.motion-baseline.ts',
        'engine/experimental/structural-world-core.ts', 'engine/experimental/structural-material.ts',
        'engine/vitest.tactical-motion-runtime.config.ts',
    ]
    names = sorted(set(previous['sourceHashes']) | set(new_sources))
    sources = {name: digest(ROOT / name) for name in names}
    whitespace = [{'path': name, 'line': i} for name in names
                  for i, line in enumerate((ROOT / name).read_text().splitlines(), 1)
                  if line.rstrip(' \t') != line]
    if whitespace:
        raise ValueError('Source whitespace findings: ' + json.dumps(whitespace))
    mock_text = (ROOT / 'engine/experimental/motion-trace.test.ts').read_text()
    physical_text = (ROOT / 'engine/experimental/motion-trace.runtime-cases.ts').read_text()
    mock_cases = re.findall(r"^\s*test\('([^']+)'", mock_text, re.M)
    held_cases = re.findall(r"^\s*test\('([^']+)'", physical_text, re.M)
    if len(mock_cases) != 26 or len(held_cases) != 6:
        raise ValueError('Authored case counts changed.')
    selection = (ROOT / 'engine/vitest.tactical-session.config.ts').read_text()
    if 'runtime-cases' in selection or "'engine/experimental/motion-trace.test.ts'" not in selection:
        raise ValueError('Mock selection changed.')

    now = datetime.now(timezone.utc).isoformat()
    review = {
        'reviewKind': 'Manual source inspection and read-only source comparison/hashes; no runtime or compilation',
        'reviewedAt': now,
        'checks': [
            {'invariant': 'Observe actual matter identity', 'basis': 'Recorder starts from executed structural sources; the existing swap closure transports provenance in parallel; heat/phase preserve identity'},
            {'invariant': 'Keep physical inputs and decisions separate', 'basis': 'Recorder owns derived arrays only; observation finishes before tracked-tick publication; source projection recovers both previous physical files ignoring whitespace'},
            {'invariant': 'Trace incomplete coverage explicitly', 'basis': 'Single shared detail counter; overflow clears every detail array while keeping exact counts; no snapshot fallback claims to recover identity'},
            {'invariant': 'Bound hostile nested trace decoding', 'basis': 'Moves, touched runs, fragment headers and member runs consume one budget before nested detail copying'},
            {'invariant': 'Validate identities and correspondence', 'basis': 'Require matching geometry/rules/catalog/ticks; canonical disjoint runs; closed source/destination permutation; touched coverage; canonical fragments descending within floor bounds'},
            {'invariant': 'Publish journals atomically with candidate state', 'basis': 'Private per-advance journal; stage domain results; validate trace budgets; finish all game updates and driver cleanup before assigning candidate and journal'},
            {'invariant': 'Preserve retained report ownership', 'basis': 'Driver traces are validated/copied; inspection copies nested detail; committed closure retains original private journal after branch cleanup and later restore'},
            {'invariant': 'Keep physical verification held', 'basis': 'Mock suite traps real step, stepWithMotion and solve; real comparisons are in a separate runtime-cases suffix/config outside ordinary discovery'},
            {'invariant': 'Preserve atomic action semantics at journal limits', 'basis': 'Documentation requires rejection when complete coverage exceeds hard caps; does not propose splitting live commits to evade limits'},
        ],
        'findingsAddressed': [
            'Return explicit geometry fields instead of spreading a CPU world or full snapshot into a trace',
            'Retain moving/component arrays without retaining the entire structural plan',
            'Enforce shared decoder budget before copying nested fragment detail',
            'Reject a driver trace whose detail exceeds the branch-requested limit',
            'Keep full journals private through cancellation and cleanup failures',
            'Describe the journal as simulation-only; intervention receipts and sub-pass paths remain separate',
        ],
        'notProven': [
            'Compiler, lint, SDK or authored test results at current source hashes',
            'Capture-on/off complete-state equivalence against the frozen original kernel',
            'Actual physical fragment identities, phase continuity or exact snapshot restart',
            'GPU correspondence, actor response, responsiveness or performance',
        ],
        'protectedSources': {'total': len(protected_before), 'unchanged': 94, 'intentionallyInstrumented': changed},
    }
    summary = {
        'stage': 'wishlist-build-07-observed-cpu-motion',
        'status': 'Source implementation and regression coverage authored; current execution checks pending',
        'updatedAt': now,
        'sourceHashes': sources,
        'protectedSourceHashesBefore': protected_before,
        'protectedSourceHashes': protected_now,
        'intentionalProtectedSourceChanges': changed,
        'sourceReview': 'source-review.json',
        'authoredTests': {
            'newPureOrInertCases': mock_cases, 'newHeldPhysicalCases': held_cases,
            'mockExpandedCasesExpected': len(mock_cases), 'existingSelectedCases': 148,
            'totalSelectedCasesExpected': 174, 'heldMotionCases': 6, 'previousHeldSupportCases': 4,
            'executed': False, 'passed': None,
        },
        'readOnlyChecks': {
            'protectedSourceComparison': '94 unchanged; 2 deliberately instrumented and retained with before-source copies',
            'physicalSourceProjection': 'physics-source-projection.json; not runtime proof',
            'whitespaceScan': {'files': len(names), 'findings': whitespace},
            'physicalFixturesExcludedFromMockSuite': True,
        },
        'quietWindow': {
            'receipt': 'quiet-window-01.json', 'sha256': digest(FOLDER / 'quiet-window-01.json'),
            'passed': False, 'failureHostCpuPercent': gate['samples'][-1]['hostCpuPercent'], 'workloadLaunched': False,
        },
        'SDKChecks': 'Explicitly user-deferred; previous SDK output incomplete; new assertions check export/method presence only',
        'runtimeHoldUnchanged': True, 'legacyDemosQuarantined': True, 'verificationWorkloadsLaunched': [],
        'remainingValidation': [
            'Bounded selected CPU edit/inert suite at current source hashes',
            'Current type checking and lint under the reviewed harness',
            'SDK build/public-entry checks after the user deferral is lifted',
            'Six held physical motion/equivalence/restart cases and four held real-support cases',
            'Complete exact trajectories, GPU equivalence, integrated gameplay and performance',
        ],
        'scopeNotes': [
            'Motion and journal data are derived; authoritative schema and rules identity unchanged',
            'Journal scope is simulation ticks, excluding direct interventions and sub-pass paths',
            'Overflow requires re-execution; consumers needing coverage must reject incomplete journals',
            'Optional CPU capture allocates full-volume provenance and has no latency guarantee',
            'Actor integration, per-tick support/thermal reports, GPU capture and bounded observation remain open',
            'Source inspection is not execution evidence; the full wishlist remains in progress',
        ],
        'recordScriptSHA256': digest(Path(__file__)),
    }
    for name, value in [('physics-source-projection.json', projection), ('source-review.json', review), ('summary.json', summary)]:
        (FOLDER / name).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'sourceReviewRecorded': True, 'protectedUnchanged': 94, 'instrumented': 2,
                      'sourceWhitespaceFiles': len(names), 'mockCasesAuthored': 26, 'heldCasesAuthored': 6,
                      'physicalSourceProjectionMatches': True, 'verificationWorkloadsLaunched': []}))


if __name__ == '__main__':
    record()
