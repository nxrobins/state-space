"""Policy for fixed, bounded native Metal probes; no GPU imports or telemetry."""
from pathlib import Path
import sys

STAGES = ('adapter', 'sdk', 'conformance')


def validate_metal_smoke(command, timeout, *, platform=None, executable=None):
    if (platform or sys.platform) != 'darwin':
        raise RuntimeError('Metal smoke probes require macOS.')
    if not 0 < timeout <= 60:
        raise RuntimeError('Metal smoke probes require a deadline of at most 60 seconds.')
    if (len(command) != 5 or Path(command[0]).resolve() != Path(executable or sys.executable).resolve()
            or command[1:4] != ['-m', 'scripts.verify_macos_native', '--stage'] or command[4] not in STAGES):
        raise RuntimeError('Metal smoke permits only the fixed adapter, sdk, or conformance probe.')
    return {'stage': command[4], 'gpuTelemetryAvailable': False,
            'maxCases': 40, 'maxCellsPerCase': 576, 'maxTicksPerCase': 16, 'maxTotalTicks': 256}


def bounded_corpus(cases):
    if not isinstance(cases, list) or not 1 <= len(cases) <= 40:
        raise ValueError('Metal smoke corpus must contain between 1 and 40 cases.')
    total_ticks = 0
    maximum = 0
    for case in cases:
        dimensions = [case.get('width'), case.get('height')]
        ticks = case.get('ticks')
        if (any(type(n) is not int or not 1 <= n <= 24 for n in dimensions)
                or type(ticks) is not int or not 1 <= ticks <= 16):
            raise ValueError('Metal smoke case exceeds its dimension or tick bound.')
        cells = dimensions[0] * dimensions[1]
        if len(case.get('cells', [])) != cells:
            raise ValueError('Metal smoke case has incomplete initial cells.')
        maximum = max(maximum, cells)
        total_ticks += ticks
    if total_ticks > 256:
        raise ValueError('Metal smoke corpus exceeds 256 total ticks.')
    return {'cases': len(cases), 'maxCells': maximum, 'totalTicks': total_ticks}
