"""Read-only projection of optional observation hooks; not a runtime equivalence proof."""
from hashlib import sha256
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]


def main():
    baseline = json.loads((OUT / 'baseline.json').read_text())
    results = {}
    for name, expected in baseline.items():
        path = ROOT / name
        before_path = OUT / (path.name + '.before.txt')
        assert sha256(before_path.read_bytes()).hexdigest() == expected
        before, current = before_path.read_text(), path.read_text()
        projected = current
        if path.name == 'structural-world-core.ts':
            projected = re.sub(r"^import \{ createMotionPathRecorder3D,.*\n", '', projected, flags=re.M)
            projected = re.sub(r"  /\*\* Observed sub-pass transfers.*?\n  \}\n", '', projected, count=1, flags=re.S)
            projected = projected.replace(',pathCapture?:{limit:number;result?:MaterialMotionPaths3D}', '')
            projected = projected.replace(',pathRecorder:ReturnType<typeof createMotionPathRecorder3D>|undefined', '')
            projected = re.sub(r'^        if\(pathCapture\)\{pathRecorder=.*\n', '', projected, flags=re.M)
            projected = projected.replace('        pathRecorder?.endPass(pass);\n', '')
            projected = projected.replace('      if(pathCapture)pathCapture.result=pathRecorder!.finish(lastTrace!);\n', '')
        elif path.name == 'structural-material.ts':
            projected = projected.replace('      provenance.pathSwap?.(s, t, provenance.input[s], provenance.input[t]);\n', '')
        elif path.name == 'motion-trace.ts':
            projected = projected.replace("export type ProvenancePass3D = {input: Uint32Array; output: Uint32Array; touched: Uint8Array;\n  /** Internal, optional observer of the executed swap, using pre-pass identities. */\n  pathSwap?: (source: number, target: number, sourceOrigin: number, targetOrigin: number) => void};", "export type ProvenancePass3D = {input: Uint32Array; output: Uint32Array; touched: Uint8Array};")
        assert projected == before, 'Physical projection differs: ' + name
        results[name] = {'beforeSHA256': expected, 'currentSHA256': sha256(path.read_bytes()).hexdigest(), 'observationHookProjectionMatches': True}
    print(json.dumps({'physicalProjection': results, 'runtimeEquivalenceProven': False}))


if __name__ == '__main__':
    main()
