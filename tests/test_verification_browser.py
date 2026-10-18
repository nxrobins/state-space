"""Mock transport tests: no browser or simulation is launched."""
import io
import json
from pathlib import Path
import queue
import tempfile
import threading
import time
import unittest
from unittest import mock
from scripts import verification_browser
from scripts import verify_volume_m5_browser
from scripts.verification_browser import PersistentBrowser
from scripts.verification_guard import DurableProgress, drain_output
from scripts.verify_volume_m5_browser import finish_resources


def fake_client():
    client = PersistentBrowser.__new__(PersistentBrowser)
    client.responses = queue.Queue(maxsize=2)
    client.requests = queue.Queue(maxsize=1)
    client.closing = threading.Event()
    client.expected_eof = threading.Event()
    client.fault = None
    client.sequence = 0
    client.lock = threading.Lock()
    client.child = mock.Mock()
    client.child.poll.return_value = None
    client.child.stdin = io.BytesIO()
    return client


class BrowserTransportTests(unittest.TestCase):
    def test_existing_evidence_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); executable = root / 'browser.exe'; executable.write_bytes(b'')
            output = root / 'evidence'; output.mkdir()
            receipt = output / 'report.json'; receipt.write_text('{"passed":false,"incident":"retained"}')
            original = receipt.read_bytes()
            with mock.patch.object(verify_volume_m5_browser, 'guarded_entry'), \
                 mock.patch('sys.argv', ['probe', '--browser-executable', str(executable), '--output', str(output)]), \
                 mock.patch.object(verify_volume_m5_browser, 'PersistentBrowser') as browser:
                with self.assertRaises(FileExistsError):
                    verify_volume_m5_browser.main()
                browser.assert_not_called()
            self.assertEqual(receipt.read_bytes(), original)

    def test_hard_hold_prevents_even_transport_process(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); hold = root / 'dist/verification/safety-hold.json'
            hold.parent.mkdir(parents=True); hold.write_text('{"blockRecovery":true}')
            with mock.patch.object(verification_browser, 'ROOT', root), \
                 mock.patch.object(verification_browser.subprocess, 'Popen') as child:
                with self.assertRaisesRegex(RuntimeError, 'blocked'):
                    PersistentBrowser(root / 'browser.exe', root)
                child.assert_not_called()

    def test_persistent_sequence_and_one_outstanding_request(self):
        client = fake_client()
        worker = threading.Thread(target=client._write, daemon=True); worker.start()
        try:
            client.responses.put({'id': 1, 'result': 'started'})
            client.responses.put({'id': 2, 'result': []})
            self.assertEqual(client.call('eval', expression='0'), 'started')
            self.assertEqual(client.call('errors'), [])
            sent = [json.loads(line) for line in client.child.stdin.getvalue().splitlines()]
            self.assertEqual([v['id'] for v in sent], [1, 2])
            with client.lock, self.assertRaisesRegex(RuntimeError, 'one browser request'):
                client.call('eval', expression='0')
        finally:
            client.closing.set(); worker.join(timeout=1)

    def test_blocked_pipe_write_returns_by_request_deadline(self):
        client = fake_client(); entered, release = threading.Event(), threading.Event()
        def blocked_write(raw):
            entered.set(); release.wait(2); return len(raw)
        client.child.stdin = mock.Mock(); client.child.stdin.write.side_effect = blocked_write
        worker = threading.Thread(target=client._write, daemon=True); worker.start()
        try:
            begin = time.monotonic()
            with self.assertRaisesRegex(RuntimeError, 'write deadline'):
                client.call('eval', expression='0', timeout=.2)
            self.assertTrue(entered.is_set())
            self.assertLess(time.monotonic() - begin, 1)
            self.assertIsNotNone(client.fault)
        finally:
            client.closing.set(); release.set(); worker.join(timeout=1)

    def test_timeout_wrong_id_truncated_tail_and_overflow_fail(self):
        client = fake_client()
        with self.assertRaisesRegex(RuntimeError, 'deadline'):
            client._response(1, .001)
        client.responses.put({'id': 2, 'result': True})
        with self.assertRaisesRegex(RuntimeError, 'sequence'):
            client._response(1, .001)
        client.child.stdout = io.BytesIO(b'{"id":1,"result":0}')
        client._read()
        self.assertIn('truncated', client.fault.lower())
        client = fake_client()
        client.child.stdout = io.BytesIO(b'{"id":1,"result":0}\n' * 3)
        client._read()
        self.assertIsNotNone(client.fault)

    def test_cleanup_failure_does_not_skip_remaining_resources(self):
        browser, server, journal = mock.Mock(), mock.Mock(), mock.Mock()
        browser.close.side_effect = RuntimeError('broken pipe'); browser.fault = None
        server.verification_started = False
        journal.summary.return_value = {'complete': True}
        report = {'passed': True}
        finish_resources(report, browser, server, journal)
        server.shutdown.assert_not_called()
        server.server_close.assert_called_once(); journal.close.assert_called_once()
        self.assertFalse(report['passed'])

    def test_close_kills_helper_before_closing_a_stalled_pipe(self):
        client = fake_client(); release = threading.Event(); entered = threading.Event()
        client.fault = 'write stalled'; client.stderr = io.BytesIO()
        client.child.stdout = io.BytesIO()
        def blocked_write(raw):
            entered.set(); release.wait(2); return len(raw)
        client.child.stdin = mock.Mock(); client.child.stdin.write.side_effect = blocked_write
        client.child.stdin.close.side_effect = lambda: self.assertTrue(release.is_set())
        client.child.wait.side_effect = [verification_browser.subprocess.TimeoutExpired('helper', .5), 125]
        client.child.kill.side_effect = release.set
        client.child.returncode = 125
        client.requests.put((b'payload', threading.Event()))
        client.writer = threading.Thread(target=client._write, daemon=True); client.writer.start()
        try:
            self.assertTrue(entered.wait(1))
            client.close()
            client.child.kill.assert_called_once()
            client.child.stdin.close.assert_called_once()
            self.assertFalse(client.writer.is_alive())
        finally:
            release.set(); client.closing.set(); client.writer.join(timeout=1)


class DurableProgressTests(unittest.TestCase):
    def test_final_output_is_checked_even_if_child_already_exited(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'stderr.log').write_bytes(b'')
            for tail in (b'', b'STATE_SPACE_PROGRESS {"job":"job","sequence":1}',
                         b'STATE_SPACE_PROGRESS {"job":"job","sequence":2}\n'):
                (root / 'stdout.log').write_bytes(tail)
                with mock.patch('scripts.verification_guard.sys.stdout', io.StringIO()), self.assertRaises(RuntimeError):
                    drain_output(root, [0, 0], DurableProgress('job'), final=True)
            (root / 'stdout.log').write_bytes(b'STATE_SPACE_PROGRESS {"job":"job","sequence":1}\n')
            progress = DurableProgress('job')
            with mock.patch('scripts.verification_guard.sys.stdout', io.StringIO()):
                drain_output(root, [0, 0], progress, final=True)
            self.assertEqual(progress.sequence, 1)

    def test_status_text_and_partial_lines_are_not_progress(self):
        p = DurableProgress('job')
        self.assertFalse(p.feed(b'still alive\nstill alive\n'))
        self.assertFalse(p.feed(b'STATE_SPACE_PROGRESS {"job":"job",'))
        self.assertTrue(p.feed(b'"sequence":1}\n'))
        self.assertEqual(p.sequence, 1)

    def test_duplicate_skipped_or_wrong_job_sequences_fail(self):
        for sequence, job in ((0, 'job'), (2, 'job'), (1, 'other')):
            with self.subTest(sequence=sequence, job=job), self.assertRaises(RuntimeError):
                DurableProgress('job').feed(('STATE_SPACE_PROGRESS ' + json.dumps({'job': job, 'sequence': sequence}) + '\n').encode())


if __name__ == '__main__':
    unittest.main()
