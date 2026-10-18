"""CPU-only regression checks for containment, exclusion and cancellation."""
import ctypes
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
from scripts import verification_guard
from scripts import recover_m4_verification
from scripts.verification_guard import Lease, ROOT, assert_verification_allowed
from scripts.verification_health import health_error


class VerificationHoldTests(unittest.TestCase):
    """No child process, GPU context or simulation is used by these tests."""

    def test_missing_hold_allows_preflight(self):
        with tempfile.TemporaryDirectory() as temp:
            assert_verification_allowed(Path(temp))

    def test_engine_entry_reenters_the_correct_module(self):
        with mock.patch.dict(os.environ, {}, clear=True), \
             mock.patch.object(verification_guard, 'assert_runtime_not_blocked'), \
             mock.patch.object(subprocess, 'call', return_value=0) as child, \
             mock.patch.object(sys, 'argv', ['verify.py', '--report', 'example.json']):
            with self.assertRaises(SystemExit):
                verification_guard.guarded_entry('gpu', 1800, module='engine.verify')
            self.assertIn('engine.verify', child.call_args.args[0])

    def test_inherited_job_does_not_bypass_hard_hold(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); hold = root / 'dist/verification/safety-hold.json'
            hold.parent.mkdir(parents=True); hold.write_text('{"blockRecovery":true}')
            with mock.patch.object(verification_guard, 'ROOT', root), \
                 mock.patch.dict(os.environ, {'STATE_SPACE_VERIFICATION_JOB': 'fake-job'}), \
                 mock.patch.object(subprocess, 'call') as child:
                with self.assertRaisesRegex(RuntimeError, 'blocked'):
                    verification_guard.guarded_entry('gpu')
                child.assert_not_called()

    def test_m5_refuses_before_permit_hashing_and_launch(self):
        from scripts import recover_m5_verification
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); hold = root / 'dist/verification/safety-hold.json'
            hold.parent.mkdir(parents=True); hold.write_text('{"blockRecovery":true}')
            before = hold.read_bytes()
            with mock.patch.object(recover_m5_verification, 'ROOT', root), \
                 mock.patch.object(sys, 'argv', ['recovery', 'typecheck']), \
                 mock.patch.object(subprocess, 'run') as child:
                with self.assertRaisesRegex(RuntimeError, 'blocked'):
                    recover_m5_verification.main()
                child.assert_not_called()
            self.assertEqual(hold.read_bytes(), before)
            self.assertFalse((root / 'dist/volume-m5').exists())

    def test_expired_watchdog_cannot_resume_a_late_created_child(self):
        job = verification_guard.WindowsJob.__new__(verification_guard.WindowsJob)
        job.handle = 1; job.k = mock.Mock()
        job.k.AssignProcessToJobObject.return_value = 1
        child = mock.Mock(); child._handle = 2
        pulse = mock.Mock(side_effect=RuntimeError('watchdog expired during process creation'))
        with self.assertRaisesRegex(RuntimeError, 'watchdog expired'):
            job.assign_and_resume(child, pulse)
        job.k.AssignProcessToJobObject.assert_called_once()
        job.k.ResumeThread.assert_not_called()
        job.k.CreateToolhelp32Snapshot.assert_not_called()

    def test_termination_failure_is_not_silently_reported_as_cleanup_success(self):
        job = verification_guard.WindowsJob.__new__(verification_guard.WindowsJob)
        job.handle = 1; job.k = mock.Mock()
        job.k.TerminateJobObject.return_value = 0
        job.k.CloseHandle.return_value = 1
        job.check = mock.Mock(side_effect=RuntimeError('termination failed'))
        with self.assertRaisesRegex(RuntimeError, 'termination failed'):
            job.close()
        job.k.CloseHandle.assert_called_once_with(1)
        self.assertIsNone(job.handle)

    def test_hold_blocks_runtime_preflight(self):
        with tempfile.TemporaryDirectory() as temp:
            hold = Path(temp) / 'dist/verification/safety-hold.json'
            hold.parent.mkdir(parents=True)
            hold.write_text('{"reason":"reported host freeze"}', encoding='utf-8')
            with self.assertRaisesRegex(RuntimeError, 'No workload was launched'):
                assert_verification_allowed(Path(temp))

    def test_damaged_hold_also_blocks(self):
        with tempfile.TemporaryDirectory() as temp:
            hold = Path(temp) / 'dist/verification/safety-hold.json'
            hold.parent.mkdir(parents=True)
            hold.write_bytes(b'not valid JSON')
            with self.assertRaisesRegex(RuntimeError, 'Verification suspended'):
                assert_verification_allowed(Path(temp))

    def test_all_profiles_stop_before_job_or_child_creation(self):
        for kind in ('cpu', 'gpu', 'frames'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                hold = root / 'dist/verification/safety-hold.json'
                hold.parent.mkdir(parents=True)
                hold.write_text('{}', encoding='utf-8')
                output = root / 'blocked'
                argv = ['verification_guard', '--kind', kind, '--output', str(output),
                        '--', sys.executable, '-c', 'raise AssertionError("must not run")']
                with mock.patch.object(verification_guard, 'ROOT', root), \
                     mock.patch.object(sys, 'argv', argv), \
                     mock.patch.object(verification_guard, 'WindowsJob') as job, \
                     mock.patch.object(subprocess, 'Popen') as child, \
                     mock.patch('builtins.print'):
                    self.assertEqual(verification_guard.main(), 1)
                    job.assert_not_called()
                    child.assert_not_called()
                report = json.loads((output / 'report.json').read_text())
                self.assertFalse(report['passed'])
                self.assertIn('Verification suspended', report['error'])
                self.assertNotIn('childPid', report)

    def test_recovery_permit_matches_once_and_keeps_hold(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); hold = root / 'dist/verification/safety-hold.json'
            hold.parent.mkdir(parents=True)
            command = ['node', 'tiny-probe.mjs']
            state = {'status': 'suspended', 'recoveryPermit': {'command': command, 'kind': 'cpu',
                     'expiresAt': time.time() + 60, 'timeoutSeconds': 5}}
            hold.write_text(json.dumps(state), encoding='utf-8')
            for bad in (['node', 'large-benchmark.mjs'], None):
                with self.assertRaises(RuntimeError):
                    assert_verification_allowed(root, command=bad, kind='cpu', timeout=5)
            with self.assertRaises(RuntimeError):
                assert_verification_allowed(root, command=command, kind='frames', timeout=5)
            with self.assertRaises(RuntimeError):
                assert_verification_allowed(root, command=command, kind='cpu', timeout=6)
            assert_verification_allowed(root, command=command, kind='cpu', timeout=5)
            self.assertEqual(json.loads(hold.read_text())['status'], 'suspended')
            with self.assertRaises(RuntimeError):
                assert_verification_allowed(root, command=command, kind='cpu', timeout=5)

    def test_expired_permit_does_not_resume(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); hold = root / 'dist/verification/safety-hold.json'
            hold.parent.mkdir(parents=True)
            hold.write_text(json.dumps({'recoveryPermit': {'command': ['node'], 'kind': 'cpu',
                'timeoutSeconds': 5, 'expiresAt': time.time() - 1}}), encoding='utf-8')
            with self.assertRaises(RuntimeError):
                assert_verification_allowed(root, command=['node'], kind='cpu', timeout=5)

    def test_new_incident_blocks_even_valid_recovery_permits(self):
        for blocked in (True, None, 1, 'true', {}):
            with self.subTest(blocked=blocked), tempfile.TemporaryDirectory() as temp:
                root = Path(temp); hold = root / 'dist/verification/safety-hold.json'
                hold.parent.mkdir(parents=True)
                command = ['node', 'tiny-probe.mjs']
                state = {'blockRecovery': blocked, 'recoveryPermit': {'command': command,
                    'kind': 'cpu', 'timeoutSeconds': 5, 'expiresAt': time.time() + 60}}
                hold.write_text(json.dumps(state), encoding='utf-8')
                with self.assertRaisesRegex(RuntimeError, 'recovery launches are blocked'):
                    assert_verification_allowed(root, command=command, kind='cpu', timeout=5)
                self.assertEqual(json.loads(hold.read_text()), state)


class VerificationHealthTests(unittest.TestCase):
    def test_busy_host_and_gpu_block_preflight(self):
        host = {'freeMemoryMiB': 32768, 'hostCpuPercent': 5}
        gpu = {'temperatureC': 40, 'utilizationPercent': 1, 'freeMemoryMiB': 16000}
        self.assertIsNone(health_error(host, gpu, preflight=True))
        self.assertIsNotNone(health_error({**host, 'hostCpuPercent': 80}, gpu, preflight=True))
        self.assertIsNotNone(health_error(host, {**gpu, 'utilizationPercent': 90}, preflight=True))
        self.assertIsNotNone(health_error(host, {**gpu, 'temperatureC': 65}, preflight=True))
        self.assertIsNotNone(health_error({**host, 'freeMemoryMiB': 1000}, gpu))
        self.assertIsNotNone(health_error(host, {**gpu, 'freeMemoryMiB': 500}))

    def test_runtime_allows_work_but_stops_at_temperature_budget(self):
        host = {'freeMemoryMiB': 32768, 'hostCpuPercent': 5}
        gpu = {'temperatureC': 50, 'utilizationPercent': 99, 'freeMemoryMiB': 16000}
        self.assertIsNone(health_error(host, gpu))
        self.assertIsNotNone(health_error(host, {**gpu, 'temperatureC': 75}))


class VerificationRecoveryTests(unittest.TestCase):
    def test_optics_probe_is_required_before_appearance_replay(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);base=root/'dist/volume-m4/recovery';base.mkdir(parents=True)
            hashes={}
            for source in (recover_m4_verification.ROOT/'engine/experimental').glob('*.ts'):
                path='engine/experimental/'+source.name;target=root/path
                target.parent.mkdir(parents=True,exist_ok=True);data=source.read_bytes();target.write_bytes(data)
                hashes[path]=hashlib.sha256(data).hexdigest()
            (root/'evidence.json').write_text(json.dumps({'sourceHashes':hashes}),encoding='utf-8')
            (base/'appearance-probe.json').write_text(json.dumps({'passed':True,'evidence':'evidence.json'}),encoding='utf-8')
            (base/'optics-probe.json').write_text('{"passed":false}',encoding='utf-8')
            with mock.patch.object(recover_m4_verification,'ROOT',root), mock.patch.object(sys,'argv',['recovery','appearance-replay']), mock.patch.object(subprocess,'run') as child:
                with self.assertRaisesRegex(RuntimeError,'optics-probe did not pass'):recover_m4_verification.main()
                child.assert_not_called()
            self.assertFalse((root/'dist/verification/safety-hold.json').exists())

    def test_haze_probe_is_required_before_appearance_replay(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);base=root/'dist/volume-m4/recovery';base.mkdir(parents=True)
            hashes={}
            for source in (recover_m4_verification.ROOT/'engine/experimental').glob('*.ts'):
                path='engine/experimental/'+source.name;target=root/path
                target.parent.mkdir(parents=True,exist_ok=True);data=source.read_bytes();target.write_bytes(data)
                hashes[path]=hashlib.sha256(data).hexdigest()
            (root/'evidence.json').write_text(json.dumps({'sourceHashes':hashes}),encoding='utf-8')
            (base/'appearance-probe.json').write_text(json.dumps({'passed':True,'evidence':'evidence.json'}),encoding='utf-8')
            (base/'optics-probe.json').write_text(json.dumps({'passed':True,'evidence':'evidence.json'}),encoding='utf-8')
            (base/'haze-probe.json').write_text('{"passed":false}',encoding='utf-8')
            with mock.patch.object(recover_m4_verification,'ROOT',root), mock.patch.object(sys,'argv',['recovery','appearance-replay']), mock.patch.object(subprocess,'run') as child:
                with self.assertRaisesRegex(RuntimeError,'haze-probe did not pass'):recover_m4_verification.main()
                child.assert_not_called()
            self.assertFalse((root/'dist/verification/safety-hold.json').exists())

    def test_heat_probe_is_required_before_appearance_replay(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);base=root/'dist/volume-m4/recovery';base.mkdir(parents=True)
            hashes={}
            for source in (recover_m4_verification.ROOT/'engine/experimental').glob('*.ts'):
                path='engine/experimental/'+source.name;target=root/path
                target.parent.mkdir(parents=True,exist_ok=True);data=source.read_bytes();target.write_bytes(data)
                hashes[path]=hashlib.sha256(data).hexdigest()
            (root/'evidence.json').write_text(json.dumps({'sourceHashes':hashes}),encoding='utf-8')
            (base/'appearance-probe.json').write_text(json.dumps({'passed':True,'evidence':'evidence.json'}),encoding='utf-8')
            (base/'optics-probe.json').write_text(json.dumps({'passed':True,'evidence':'evidence.json'}),encoding='utf-8')
            (base/'haze-probe.json').write_text(json.dumps({'passed':True,'evidence':'evidence.json'}),encoding='utf-8')
            (base/'heat-probe.json').write_text('{"passed":false}',encoding='utf-8')
            with mock.patch.object(recover_m4_verification,'ROOT',root), mock.patch.object(sys,'argv',['recovery','appearance-replay']), mock.patch.object(subprocess,'run') as child:
                with self.assertRaisesRegex(RuntimeError,'heat-probe did not pass'):recover_m4_verification.main()
                child.assert_not_called()
            self.assertFalse((root/'dist/verification/safety-hold.json').exists())

    def test_beauty_frames_require_current_appearance_proof(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);base=root/'dist/volume-m4/recovery';base.mkdir(parents=True)
            hashes={}
            for source in (recover_m4_verification.ROOT/'engine/experimental').glob('*.ts'):
                relative='engine/experimental/'+source.name;destination=root/relative
                destination.parent.mkdir(parents=True,exist_ok=True);data=source.read_bytes();destination.write_bytes(data)
                hashes[relative]=hashlib.sha256(data).hexdigest()
            (root/'engine/experimental/cavern-appearance.ts').write_text('changed shading',encoding='utf-8')
            (root/'evidence.json').write_text(json.dumps({'sourceHashes':hashes}),encoding='utf-8')
            (base/'appearance-replay.json').write_text(json.dumps({'passed':True,'evidence':'evidence.json'}),encoding='utf-8')
            with mock.patch.object(recover_m4_verification,'ROOT',root), mock.patch.object(sys,'argv',['recovery','frames128beauty']), mock.patch.object(subprocess,'run') as child:
                with self.assertRaisesRegex(RuntimeError,'appearance-replay is stale.*cavern-appearance'):recover_m4_verification.main()
                child.assert_not_called()
            self.assertFalse((root/'dist/verification/safety-hold.json').exists())

    def test_beauty_replay_requires_passing_small_probe(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);base=root/'dist/volume-m4/recovery';base.mkdir(parents=True)
            (base/'appearance-probe.json').write_text('{"passed":false}',encoding='utf-8')
            with mock.patch.object(recover_m4_verification,'ROOT',root), mock.patch.object(sys,'argv',['recovery','appearance-replay']), mock.patch.object(subprocess,'run') as child:
                with self.assertRaisesRegex(RuntimeError,'appearance-probe did not pass'):recover_m4_verification.main()
                child.assert_not_called()

    def test_stale_gpu_proof_stops_before_permit_or_child(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); base = root / 'dist/volume-m4/recovery'; base.mkdir(parents=True)
            source = root / 'engine/experimental/3d-gpu-core.ts'; source.parent.mkdir(parents=True)
            source.write_text('changed GPU transport', encoding='utf-8')
            (root / 'evidence.json').write_text(json.dumps({'sourceHashes': {
                'engine/experimental/3d-gpu-core.ts': 'stale'}}), encoding='utf-8')
            (base / 'gate64.json').write_text(json.dumps({'passed': True, 'evidence': 'evidence.json'}), encoding='utf-8')
            with mock.patch.object(recover_m4_verification, 'ROOT', root), \
                 mock.patch.object(sys, 'argv', ['recovery', 'frames32']), \
                 mock.patch.object(subprocess, 'run') as child:
                with self.assertRaisesRegex(RuntimeError, 'gate64 is stale'):
                    recover_m4_verification.main()
                child.assert_not_called()
            self.assertFalse((root / 'dist/verification/safety-hold.json').exists())


    def test_resident_128_requires_the_small_gameplay_probe_too(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);base=root/'dist/volume-m4/recovery';base.mkdir(parents=True)
            hashes={}
            for source in (recover_m4_verification.ROOT/'engine/experimental').glob('*.ts'):
                relative='engine/experimental/'+source.name;destination=root/relative
                destination.parent.mkdir(parents=True,exist_ok=True);data=source.read_bytes();destination.write_bytes(data)
                hashes[relative]=hashlib.sha256(data).hexdigest()
            (root/'evidence.json').write_text(json.dumps({'sourceHashes':hashes}),encoding='utf-8')
            (base/'continuation128.json').write_text(json.dumps({'passed':True,'evidence':'evidence.json'}),encoding='utf-8')
            (base/'gameplay-probe.json').write_text(json.dumps({'passed':False}),encoding='utf-8')
            with mock.patch.object(recover_m4_verification,'ROOT',root), mock.patch.object(sys,'argv',['recovery','gameplay128']), mock.patch.object(subprocess,'run') as child:
                with self.assertRaisesRegex(RuntimeError,'gameplay-probe did not pass'):recover_m4_verification.main()
                child.assert_not_called()
            self.assertFalse((root/'dist/verification/safety-hold.json').exists())


@unittest.skipUnless(os.name == 'nt' and os.environ.get('STATE_SPACE_TEST_CONTAINMENT') == 'reviewed-non-gpu',
                     'Owned print/sleep subprocess tests require explicit non-GPU containment approval')
class VerificationGuardTests(unittest.TestCase):
    def run_guard(self, folder, script, timeout=5, stalled_writer=False):
        # Isolated state directory; tests neither consume nor clear the real
        # host incident hold. Payloads only print or sleep, with no simulation.
        entry = ('import sys;from pathlib import Path;from scripts import verification_guard as guard;'
                 'guard.ROOT=Path(sys.argv.pop(1));'
                 'guard.HostHealth=type("TestHost",(),{"sample":lambda self:{"time":guard.time.time(),'
                 '"hostCpuPercent":0,"freeMemoryMiB":32768}});'
                 + ('original_fsync=guard.os.fsync;first=[True];'
                    'guard.os.fsync=lambda fd:((first.pop() and guard.time.sleep(4)) if first else None,original_fsync(fd));'
                    if stalled_writer else '') +
                 'raise SystemExit(guard.main())')
        return subprocess.run([sys.executable, '-c', entry, str(folder), '--kind', 'cpu',
                               '--timeout', str(timeout), '--stall', str(timeout), '--output', str(folder),
                               '--', sys.executable, '-u', '-c', script], cwd=ROOT,
                              capture_output=True, text=True, timeout=15)

    def test_contained_success(self):
        with tempfile.TemporaryDirectory() as temp:
            result = self.run_guard(Path(temp), 'print("bounded child " + chr(10003), flush=True)')
            report = json.loads((Path(temp) / 'report.json').read_text())
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue(report['passed'])
            self.assertIn('bounded child', (Path(temp) / 'stdout.log').read_text())

    @unittest.skipUnless(os.name == 'nt', 'Independent watchdog uses Windows Jobs')
    def test_independent_watchdog_survives_blocked_receipt_writer(self):
        with tempfile.TemporaryDirectory() as temp:
            result = self.run_guard(Path(temp), 'import time;print("started",flush=True);time.sleep(30)',
                                    timeout=10, stalled_writer=True)
            report = json.loads((Path(temp) / 'report.json').read_text())
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(report['passed'])
            self.assertTrue(report['independentWatchdog']['armed'])
            self.assertIn('heartbeat expired', report['error'])
            self.assertEqual(report['exitCode'], 125)

    def test_second_verification_never_starts(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(verification_guard, 'ROOT', Path(temp)), Lease():
            result = self.run_guard(Path(temp), 'print("must not run")')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('owns the lease', (Path(temp) / 'report.json').read_text())
            self.assertFalse((Path(temp) / 'stdout.log').exists())

    def test_timeout_kills_descendants(self):
        with tempfile.TemporaryDirectory() as temp:
            script = 'import subprocess,sys,time; p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"]); print(p.pid,flush=True); time.sleep(30)'
            result = self.run_guard(Path(temp), script, timeout=1)
            report = json.loads((Path(temp) / 'report.json').read_text())
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(report['passed'])
            pid = int((Path(temp) / 'stdout.log').read_text().strip())
            if os.name == 'nt':
                kernel = ctypes.WinDLL('kernel32', use_last_error=True)
                kernel.OpenProcess.restype = ctypes.c_void_p
                kernel.CloseHandle.argtypes = [ctypes.c_void_p]
                handle = kernel.OpenProcess(0x1000, False, pid)
                if handle:
                    code = ctypes.c_ulong()
                    kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
                    kernel.GetExitCodeProcess(handle, ctypes.byref(code))
                    kernel.CloseHandle(handle)
                    self.assertNotEqual(code.value, 259, 'Descendant survived containment timeout')


if __name__ == '__main__':
    unittest.main()
