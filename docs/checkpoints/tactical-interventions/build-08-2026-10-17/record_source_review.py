"""Record source-only evidence. No engine imports, processes or telemetry."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re


FOLDER = Path(__file__).resolve().parent
ROOT = FOLDER.parents[3]


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def record():
    previous = json.loads((FOLDER.parent / 'build-07-2026-10-17' / 'summary.json').read_text())
    protected = {name: digest(ROOT / name) for name in previous['protectedSourceHashes']}
    changed = [name for name, value in protected.items() if value != previous['protectedSourceHashes'][name]]
    if len(protected) != 96 or changed:
        raise ValueError('Unexpected physical/configuration source change: ' + str(changed))
    hold = json.loads((ROOT / 'dist/verification/safety-hold.json').read_text())
    if not hold['blockRecovery'] or hold.get('recoveryPermit'):
        raise ValueError('Runtime hold changed.')
    names = sorted(set(previous['sourceHashes']) | {
        'engine/experimental/action-journal.ts', 'engine/experimental/action-journal.test.ts',
        'engine/experimental/action-journal.runtime-cases.ts', 'engine/vitest.tactical-journal-runtime.config.ts',
    })
    sources = {name: digest(ROOT / name) for name in names}
    whitespace = [{'path': name, 'line': i} for name in names
                  for i, line in enumerate((ROOT / name).read_text().splitlines(), 1)
                  if line.rstrip(' \t') != line]
    if whitespace:
        raise ValueError('Whitespace findings: ' + json.dumps(whitespace))
    def cases(name):
        return re.findall(r"^\s*test\('([^']+)'", (ROOT / 'engine/experimental' / name).read_text(), re.M)
    mock, held = cases('action-journal.test.ts'), cases('action-journal.runtime-cases.ts')
    if len(mock) != 27 or len(held) != 3:
        raise ValueError('Authored case count changed.')
    selection = (ROOT / 'engine/vitest.tactical-session.config.ts').read_text()
    if 'runtime-cases' in selection or "'engine/experimental/action-journal.test.ts'" not in selection:
        raise ValueError('Mock/physical selection changed.')
    now = datetime.now(timezone.utc).isoformat()
    review = {
        'reviewKind': 'Manual source inspection and read-only source/hash/whitespace comparison; no compilation or execution',
        'reviewedAt': now,
        'acceptance': [
            {'criterion': 1, 'source': 'tactical-session-core.ts change/captureAction and advance tick boundary',
             'basis': 'All seven intervention methods pass a kind; every complete logical tick appends after all domains and game update; zero advance does not append',
             'coverage': ['mixed operation order', 'zero-tick advance', 'reversed changes', 'stale preview identity']},
            {'criterion': 2, 'source': 'action-journal.ts and unchanged change-reports.ts',
             'basis': 'Adjacent before/after session snapshots feed full-domain/global-support comparison; event clocks identify that local interval instead of falsely labeling it as a base-to-end diff',
             'coverage': ['distant support restoration', 'hold expiry', 'multi-domain ticks', 'thermal and game reversal']},
            {'criterion': 3, 'source': 'action-journal.ts portableAction; tactical-session-core.ts intervention and tickMotion',
             'basis': 'Portable copies retain selected translation routes/cuts/anchors, transfers, energy receipts and holds; complete tick motion required; raw edits/game payloads are not replay commands',
             'coverage': ['receipt ownership and JSON round trip', 'explicit cuts/anchor release', 'reservoir handoff', 'net-zero motion across two inert ticks']},
            {'criterion': 4, 'source': 'readActionJournal3D and captured committed journal closure',
             'basis': 'Copied event detail and frozen root stamps; journal absent from session save schema; disabled capture bypasses all report generation',
             'coverage': ['disabled observer count', 'retained journal after restore', 'output/receipt mutation']},
            {'criterion': 5, 'source': 'tactical-session-core.ts change/advance cleanup and guarded captureAction callback',
             'basis': 'Journal arrays staged privately; no assignment to candidate until success; whole advance publishes after cleanup; observers run under mutation guard; failure makes branch terminal',
             'coverage': ['observation failure', 'reentrancy', 'second-tick game failure', 'cleanup failure', 'cancellation', 'last-domain invalid motion']},
            {'criterion': 6, 'source': 'appendActionEvent3D',
             'basis': 'Shared event/domain/detail caps; pre-copy receipt and motion counts; sparse overflow retains bounds as coarse; trace/journal overflow clears all events; known overflow skips report producer',
             'coverage': ['coarse zero-run report', 'trace overflow', 'exact detail capacity', '257th boundary', 'domain tick cap', 'known overflow avoids observation']},
            {'criterion': 7, 'source': 'action-journal.test.ts; action-journal.runtime-cases.ts; separate configurations',
             'basis': '27 authored edit/inert cases trap physical stepping and solves; 3 real cases are separately held; SDK assertions are presence only',
             'coverage': 'All execution results pending; this is source evidence only'},
        ],
        'findingsAddressed': [
            'Strip base-to-end report stamps from per-event changes; attach true adjacent boundary sequence/tick identities',
            'Capture all domains and resulting hold/game changes before appending a tick event',
            'Guard synchronous support observers during both editing and asynchronous advancement',
            'Use bounded complete output, conservative coarse bounds or explicit overflow rather than a partial prefix',
            'Copy receipt detail before returning the original receipt to a caller',
            'Skip added support observations after journal overflow',
            'Document exact intermediate-state reads/re-execution for coarse historical reports',
            'Keep multi-tick atomicity when journal caps are insufficient',
        ],
        'notProven': [
            'Current compiler/lint/SDK validity or authored regression assertions',
            'Actual physical capture neutrality, distant bridge behavior or restart equality',
            'Sub-pass trajectories, actor collisions/carry/exposure',
            'GPU production, cancellation latency, responsiveness or frame performance',
        ],
        'protectedSourcesUnchanged': 96,
    }
    summary = {
        'stage': 'wishlist-build-08-ordered-action-boundary-journal',
        'status': 'Source implementation and regression coverage authored; execution checks pending',
        'updatedAt': now, 'sourceHashes': sources, 'protectedSourceHashes': protected,
        'sourceReview': 'source-review.json',
        'authoredTests': {
            'newEditOrInertCases': mock, 'newHeldPhysicalCases': held,
            'newSelectedCases': 27, 'existingSelectedCases': 174, 'totalSelectedCasesExpected': 201,
            'newHeldPhysicalCasesCount': 3, 'existingHeldPhysicalCases': 10,
            'executed': False, 'passed': None,
        },
        'readOnlyChecks': {'protectedSourceComparison': '96 unchanged',
                           'whitespaceScan': {'files': len(names), 'findings': []},
                           'physicalFixturesExcludedFromSelectedSuite': True},
        'quietWindow': {'attempted': False, 'reason': 'Source-only stage; no current host-load claim or verification authorization created'},
        'SDKChecks': 'User-deferred; previous SDK output incomplete; presence assertions authored but not run',
        'runtimeHoldUnchanged': True, 'legacyDemosQuarantined': True,
        'verificationWorkloadsLaunched': [],
        'remainingValidation': [
            'Bounded selected edit/inert suite at current source hashes',
            'Current type checking and lint under the reviewed safe harness',
            'SDK build/public-entry checks after the user deferral is lifted',
            'Three held journal fixtures plus the ten previous held support/motion fixtures',
            'Full physical trajectories, exact replay, GPU equivalence and integrated gameplay',
            'Responsive execution/rendering and safe full-frame benchmarks',
        ],
        'scopeNotes': [
            'Full-domain observations at interventions and complete logical-tick boundaries, including reversed changes',
            'Global support law unchanged; no local edit-box truncation',
            'Derived portable journal is not authoritative state or an executable command log',
            'Selected intervention routes and net tick motion do not provide continuous actor/debris paths',
            'Synchronous scans and global support observations have no latency guarantee',
            'Actor response, four-element rules, GPU reporting, bounded execution and rendering integration remain open',
            'Full wishlist acceptance remains in progress',
        ],
        'recordScriptSHA256': digest(Path(__file__)),
    }
    for name, value in [('source-review.json', review), ('summary.json', summary)]:
        (FOLDER / name).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'sourceReviewRecorded': True, 'protectedUnchanged': 96, 'sourceWhitespaceFiles': len(names),
                      'newMockCasesAuthored': 27, 'newHeldCasesAuthored': 3, 'selectedCasesExpected': 201,
                      'verificationWorkloadsLaunched': []}))


if __name__ == '__main__':
    record()
