"""Read-only receipt/attribution audit; no verification workload execution."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def require(value, reason):
    if not value:
        raise ValueError(reason)

target = OUT / 'progress-02.json'
require(not target.exists(), 'Refusing to overwrite evidence')
previous = read(OUT / 'progress-01.json')
count = 0
for key in ('checkedSourceHashes', 'protectedSourceHashes', 'sdkArtifactHashes', 'browserArtifactHashes'):
    for name, expected in previous[key].items():
        require(digest(ROOT / name) == expected, 'Implementation/artifact changed: ' + name)
        count += 1
for attempt, stage in previous['stages'].items():
    for name, expected in stage['evidenceSHA256'].items():
        require(digest(OUT / attempt / name) == expected, 'Prior evidence changed')
        count += 1
for name, gate in previous['preflightGates'].items():
    require(digest(OUT / name) == gate['SHA256'], 'Prior preflight changed')
    count += 1
require(digest(ROOT / 'dist/verification/safety-hold.json') == previous['holdSHA256'], 'Runtime hold changed')
require(digest(OUT / 'record_partial.py') == previous['recorderSHA256'], 'Prior recorder changed')
require(digest(OUT / 'sdk-resume-authorization.json') == previous['authorizationSHA256'], 'CPU authorization changed')
gate_path = OUT / 'quiet-window-attempt-04.json'
gate = read(gate_path)
require(not gate['passed'] and gate['maxHostCpuPercent'] == 50 and not (OUT / 'attempt-04').exists(), 'Failed gate launched work')
capture = OUT / 'cpu-attribution-01'
require(digest(capture / 'sample_cpu.py') == digest(ROOT / 'docs/checkpoints/verification-harness/cpu-spikes-20261017T175127Z/sample_cpu.py'), 'Reviewed sampler changed')
summary = read(capture / 'summary.json')
samples = [json.loads(line) for line in (capture / 'samples.jsonl').read_text().splitlines()]
identity = read(capture / 'process-identity.json')
require(summary['samples'] == len(samples) == 45 and summary['logicalCpuCount'] == 16, 'Capture dimensions differ')
require(summary['hostCpuAveragePercent'] == sum(s['hostCpuPercent'] for s in samples) / len(samples), 'Average differs')
require(summary['hostCpuMaxPercent'] == max(s['hostCpuPercent'] for s in samples), 'Peak differs')
leader = summary['topProcesses'][0]
require(leader['pid'] == 43536 and leader['name'] == 'bun.exe' and leader['parentPid'] == 13396, 'Dominant process differs')
require(leader['averageMachineCpuPercent'] > 85 and leader['peakMachineCpuPercent'] > 93, 'Attribution differs')
child = next(p for p in identity if p['ProcessId'] == leader['pid'])
parent = next(p for p in identity if p['ProcessId'] == leader['parentPid'])
require(child['ParentProcessId'] == parent['ProcessId'] and 'gpu/season-sweep.ts gangsters full 100 30 52 16 3000' in child['CommandLine'] and '.claude/shell-snapshots/' in parent['CommandLine'], 'Identity differs')
record = {**previous,
    'recordedAt': datetime.now(timezone.utc).isoformat(),
    'previousProgressSHA256': digest(OUT / 'progress-01.json'),
    'status': 'partial: CPU-only preflight refused launch; saturation attributed to a separate Bun sweep; remaining gates pending',
    'continuation': {'newWorkloadsLaunched': 0, 'quietGate': gate_path.name, 'quietGateSHA256': digest(gate_path),
        'maxHostCpuPercent': max(s['hostCpuPercent'] for s in gate['samples']), 'sourceAndPriorReceiptHashesVerified': count,
        'staticReview': 'No additional source fix identified; previous passing source hashes still match',
        'attribution': {'pid': leader['pid'], 'name': leader['name'], 'averageMachineCpuPercent': leader['averageMachineCpuPercent'],
            'hostAveragePercent': summary['hostCpuAveragePercent'], 'samples': len(samples), 'processControlPerformed': False},
        'evidenceSHA256': {p.relative_to(OUT).as_posix(): digest(p) for p in capture.iterdir() if p.is_file()}},
    'documentationSHA256': {n: digest(ROOT / n) for n in ['docs/SDK.md', 'docs/checkpoints/TACTICAL_INTERVENTIONS.md']},
    'continuationRecorderSHA256': digest(Path(__file__)),
}
target.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'status': 'partial', 'attributedProcess': leader['pid'], 'verifiedHashes': count, 'newWorkloadsLaunched': 0}))
