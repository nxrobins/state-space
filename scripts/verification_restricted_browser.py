"""Fixed blank-page containment probe; no generic CDP/eval/navigation API."""
import base64
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import struct
import subprocess
import sys
import time
import unittest

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.verification_journal import durable_json
from scripts.verification_scope import ROOT, claim_leaf, exclusive_json

METHODS = ('Browser.getVersion', 'Browser.getBrowserCommandLine', 'Target.getTargets', 'Browser.close')
MAX_MESSAGE = 65536


class BlankCDP:
    """One outstanding fixed command; strict bounded WebSocket subset.

    Browser-level CDP on a fresh profile emits unfragmented text replies for
    these four methods. Anything else fails closed, including unsolicited data.
    No HTTP discovery, redirects, page sessions, or arbitrary parameters.
    """
    def __init__(self, port, path, *, gpu_enabled=False):
        if type(port) is not int or not 1024 <= port <= 65535 or not re.fullmatch(
                r'/devtools/browser/[a-fA-F0-9-]{36}', path):
            raise RuntimeError('Invalid owned DevTools endpoint')
        self.socket = socket.create_connection(('127.0.0.1', port), timeout=2)
        self.methods = METHODS + (('SystemInfo.getInfo',) if gpu_enabled else ())
        self.next_id = 0
        self.pending = None
        try:
            key = base64.b64encode(os.urandom(16)).decode()
            request = (f'GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n'
                       f'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n'
                       'Sec-WebSocket-Version: 13\r\n\r\n')
            self.socket.sendall(request.encode('ascii'))
            headers = bytearray()
            deadline = time.monotonic() + 2
            while not headers.endswith(b'\r\n\r\n'):
                self.socket.settimeout(max(.001, deadline - time.monotonic()))
                if len(headers) >= 8192 or time.monotonic() >= deadline:
                    raise RuntimeError('CDP handshake exceeded its bound')
                headers.extend(self.exact(1))
            lines = headers.decode('ascii').split('\r\n')
            fields = dict(line.lower().split(':', 1) for line in lines[1:] if ':' in line)
            expected = base64.b64encode(hashlib.sha1(
                (key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            # Header values are case sensitive for the accept token.
            accept = dict(line.split(':', 1) for line in lines[1:] if ':' in line)
            token = next((v.strip() for k, v in accept.items() if k.lower() == 'sec-websocket-accept'), None)
            if (lines[0] != 'HTTP/1.1 101 WebSocket Protocol Handshake'
                    and not lines[0].startswith('HTTP/1.1 101 ')):
                raise RuntimeError('CDP upgrade refused')
            if (token != expected or fields.get('upgrade', '').strip() != 'websocket'
                    or fields.get('connection', '').strip() != 'upgrade'):
                raise RuntimeError('Invalid CDP WebSocket handshake')
            self.socket.settimeout(2)
        except BaseException:
            self.socket.close()
            raise

    def exact(self, count):
        result = bytearray()
        while len(result) < count:
            block = self.socket.recv(count - len(result))
            if not block:
                raise RuntimeError('CDP socket closed')
            result.extend(block)
        return bytes(result)

    def send(self, method):
        if method not in self.methods or self.pending is not None:
            raise RuntimeError('Unapproved or overlapping CDP command')
        self.next_id += 1
        self.pending = self.next_id
        data = json.dumps({'id': self.next_id, 'method': method}).encode('utf-8')
        mask = os.urandom(4)
        header = bytes([0x81, 0x80 | len(data)])  # All fixed requests are <126 bytes.
        self.socket.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def receive(self):
        if self.pending is None:
            raise RuntimeError('No outstanding CDP command')
        # An absolute operation deadline also bounds a slow trickle of bytes.
        deadline = time.monotonic() + 2
        original = self.socket

        def bounded(count):
            result = bytearray()
            while len(result) < count:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('CDP operation deadline')
                original.settimeout(remaining)
                block = original.recv(count - len(result))
                if not block:
                    raise RuntimeError('CDP socket closed')
                result.extend(block)
            return bytes(result)

        a, b = bounded(2)
        if a != 0x81 or b & 0x80:
            raise RuntimeError('Unexpected fragmented, control, or masked CDP frame')
        size = b & 127
        if size == 126:
            size = struct.unpack('!H', bounded(2))[0]
        elif size == 127:
            size = struct.unpack('!Q', bounded(8))[0]
        if size > MAX_MESSAGE:
            raise RuntimeError('CDP message budget exceeded')
        value = json.loads(bounded(size).decode('utf-8'))
        if (type(value.get('id')) is not int or value['id'] != self.pending
                or 'error' in value or not isinstance(value.get('result'), dict)):
            raise RuntimeError('Unexpected or failed CDP response')
        self.pending = None
        return value['result']

    def call(self, method):
        self.send(method)
        return self.receive()

    def close(self):
        self.socket.close()


def assert_blank_targets(result):
    targets = result.get('targetInfos')
    if (not isinstance(targets, list) or len(targets) != 1
            or targets[0].get('type') != 'page' or targets[0].get('url') != 'about:blank'):
        raise RuntimeError('Browser is not the single approved blank page')


def wait_blank_targets(cdp, attempt, deadline):
    """CDP readiness precedes initial target creation. Wait only for an empty list.

    Any unexpected target still fails immediately; no filtering, navigation, or
    new target is used to manufacture a passing scene. Retain every observation.
    """
    observations = []
    for _ in range(20):
        if time.monotonic() >= deadline:
            break
        targets = cdp.call('Target.getTargets')
        observations.append(targets)
        durable_json(attempt / 'browser-targets.json', {'observations': observations})
        if targets.get('targetInfos') != []:
            assert_blank_targets(targets)
            return targets
        time.sleep(.1)
    raise RuntimeError('Initial blank-page target did not become ready within its bound')


def assert_hardware_gpu(info):
    gpu = info.get('gpu', {})
    devices = gpu.get('devices', [])
    description = str(gpu.get('auxAttributes', {}).get('glRenderer', '')).lower()
    if (not devices or devices[0].get('vendorId') not in (0x10de, 0x1002, 0x8086)
            or not devices[0].get('deviceId')
            or gpu.get('featureStatus', {}).get('gpu_compositing') != 'enabled'
            or any(word in description for word in ('swiftshader', 'software', 'warp'))):
        raise RuntimeError('Browser did not report hardware GPU compositing')


def assert_arguments(actual, expected):
    if not isinstance(actual, list) or not all(isinstance(arg, str) for arg in actual):
        raise RuntimeError('Browser command line differs from its authorized flags')
    observed = actual[1:]
    # Chromium can append empty about:flags sentinels even in a fresh profile.
    # Accept only ONE adjacent empty pair; flags inside it, duplicates, and every
    # other extra/missing/changed argument remain failures. Never strip switches
    # by prefix or normalize away a value.
    begin, end = '--flag-switches-begin', '--flag-switches-end'
    if begin in observed or end in observed:
        if (observed.count(begin) != 1 or observed.count(end) != 1
                or observed.index(end) != observed.index(begin) + 1):
            raise RuntimeError('Nonempty or malformed Chrome experiment switches')
        index = observed.index(begin)
        observed = observed[:index] + observed[index + 2:]
    if Counter(observed) != Counter(expected):
        added = list((Counter(observed) - Counter(expected)).elements())
        missing = list((Counter(expected) - Counter(observed)).elements())
        raise RuntimeError(f'Browser command line differs: added={added!r}, missing={missing!r}')


def run_units():
    def audit(event, args):
        if event in ('subprocess.Popen', 'os.system', 'socket.connect', 'socket.bind'):
            raise RuntimeError('Isolated tests attempted process/network activity: ' + event)
    sys.addaudithook(audit)
    sys.path.insert(0, str(ROOT / 'tests'))
    suite = unittest.defaultTestLoader.loadTestsFromNames([
        'test_verification_scope', 'test_restricted_browser', 'test_verification_observer'])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return {'passed': result.wasSuccessful(), 'testsRun': result.testsRun,
            'failures': len(result.failures), 'errors': len(result.errors),
            'skipped': len(result.skipped)}


def main(attempt):
    attempt = Path(attempt).resolve()
    cap, review = claim_leaf(attempt)
    report = {'passed': False, 'case': cap['case'], 'mode': cap['mode'], 'pid': os.getpid()}
    cdp = None
    try:
        if cap['case'] == 'unit':
            report.update(run_units())
            return 0 if report['passed'] else 1
        profile = attempt / 'profile'
        profile.mkdir()  # Never reuse an existing profile.
        args = [review['browser'], *cap['browserArguments']]
        with (attempt / 'browser.log').open('wb') as log:
            browser = subprocess.Popen(args, cwd=ROOT, stdin=subprocess.DEVNULL,
                                       stdout=log, stderr=log, close_fds=True,
                                       creationflags=subprocess.CREATE_NO_WINDOW)
        exclusive_json(attempt / 'browser.json', {'pid': browser.pid, 'arguments': args})
        ready_by = time.monotonic() + 12
        port_file = profile / 'DevToolsActivePort'
        while not port_file.exists():
            if browser.poll() is not None or time.monotonic() >= ready_by:
                raise RuntimeError('Owned browser did not become ready within 12 seconds')
            time.sleep(.05)
        if port_file.stat().st_size > 256:
            raise RuntimeError('Oversized DevTools endpoint')
        lines = port_file.read_text(encoding='ascii').splitlines()
        if len(lines) != 2:
            raise RuntimeError('Incomplete DevTools endpoint')
        cdp = BlankCDP(int(lines[0]), lines[1], gpu_enabled=cap['mode'] == 'gpu-enabled')
        report['version'] = cdp.call('Browser.getVersion')
        actual = cdp.call('Browser.getBrowserCommandLine')['arguments']
        # Preserve the actual returned flags BEFORE acceptance so a refusal is
        # diagnosable without repeating a real browser workload.
        report['reportedBrowserArguments'] = actual
        durable_json(attempt / 'browser-command-line.json', {'arguments': actual})
        assert_arguments(actual, cap['browserArguments'])
        report['argumentsVerified'] = True
        targets = wait_blank_targets(cdp, attempt, min(ready_by, time.monotonic() + 2))
        report['reportedBrowserTargets'] = targets
        report['argumentsVerified'] = report['singleBlankPageVerified'] = True
        if cap['mode'] == 'gpu-enabled':
            info = cdp.call('SystemInfo.getInfo')
            durable_json(attempt / 'browser-gpu-info.json', info)
            assert_hardware_gpu(info)
            report['hardwareGpuCompositingVerified'] = True
        report['browserPid'] = browser.pid
        if cap['case'] in ('stalled-cdp', 'supervisor-loss'):
            # A real request on the real connection is pending. Deliberately
            # stop consuming replies, modelling a wedged CDP reader. The host
            # must cancel without asking this transport to cooperate.
            cdp.send('Browser.getVersion')
            exclusive_json(attempt / 'fault-ready.json', {
                **report, 'pendingMethod': 'Browser.getVersion',
                'fault': 'injected non-reading CDP client', 'time': time.time()})
            time.sleep(30)
            raise RuntimeError('Fault injection survived containment deadline')
        cdp.call('Browser.close')
        cdp.close()
        cdp = None
        report['browserExitCode'] = browser.wait(timeout=2)
        report['passed'] = report['browserExitCode'] == 0
        return 0 if report['passed'] else 1
    except BaseException as error:
        report['error'] = repr(error)
        return 1
    finally:
        if cdp:
            cdp.close()
        durable_json(attempt / 'leaf-report.json', report)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('One exact capability directory is required')
    raise SystemExit(main(sys.argv[1]))
