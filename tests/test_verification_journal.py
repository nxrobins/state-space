"""Harness-only regressions. Written under the incident hold; not yet executed."""
import hashlib
import json
import queue
import tempfile
import threading
import unittest
from unittest import mock
from scripts.verification_journal import DurableJournal, EventProtocol, validate_evidence
from scripts.verification_watchdog import deadline_reason


def tick_events(start=3, end=4):
    yield {'kind': 'stage-start', 'probe': 'level-trajectory'}
    yield {'kind': 'range-start', 'start': start, 'end': end}
    for tick in range(start + 1, end + 1):
        for phase in ('step', 'snapshot', 'hash'):
            yield {'kind': 'phase', 'tick': tick, 'phase': phase}
        yield {'kind': 'verified', 'start': start, 'tick': tick, 'digest': 'a' * 64, 'stepMs': 2.5}
    yield {'kind': 'range-end', 'end': end}
    yield {'kind': 'stage-end'}


class EventProtocolTests(unittest.TestCase):
    def test_odd_restart_and_tick_order(self):
        p = EventProtocol('level-trajectory')
        for sequence, event in enumerate(tick_events(), 1):
            p.accept(sequence, event)
        self.assertEqual(p.verified, 1)
        self.assertTrue(p.succeeded)

    def test_missing_duplicate_or_boolean_sequence(self):
        for sequence in (0, 2, True):
            with self.subTest(sequence=sequence), self.assertRaises(ValueError):
                EventProtocol('compile').accept(sequence, {'kind': 'stage-start', 'probe': 'compile'})

    def test_repeated_status_and_heartbeats_are_not_progress(self):
        p = EventProtocol('compile')
        for sequence, event in enumerate([{'kind': 'stage-start', 'probe': 'compile'},
                {'kind': 'status', 'text': 'first'}, {'kind': 'status', 'text': 'second'}], 1):
            p.accept(sequence, event)
        for event in ({'kind': 'status', 'text': 'first'}, {'kind': 'heartbeat'}):
            with self.assertRaises(ValueError):
                p.accept(4, event)
        self.assertEqual(p.sequence, 3)

    def test_missing_phase_tick_and_early_completion_rejected(self):
        for event in ({'kind': 'phase', 'tick': 5, 'phase': 'step'},
                      {'kind': 'phase', 'tick': 4, 'phase': 'hash'},
                      {'kind': 'range-end', 'end': 4}, {'kind': 'stage-end'}):
            p = EventProtocol('level-trajectory')
            p.accept(1, {'kind': 'stage-start', 'probe': 'level-trajectory'})
            p.accept(2, {'kind': 'range-start', 'start': 3, 'end': 4})
            with self.subTest(event=event), self.assertRaises(ValueError):
                p.accept(3, event)

    def test_invalid_digest_does_not_complete_tick(self):
        p = EventProtocol('level-trajectory')
        events = list(tick_events())
        for sequence, event in enumerate(events[:5], 1):
            p.accept(sequence, event)
        with self.assertRaises(ValueError):
            p.accept(6, {**events[5], 'digest': 'approximate'})
        self.assertEqual(p.verified, 0)

    def test_stage_error_is_not_success(self):
        p = EventProtocol('compile')
        p.accept(1, {'kind': 'stage-start', 'probe': 'compile'})
        p.accept(2, {'kind': 'stage-error', 'error': 'lost device'})
        self.assertTrue(p.ended)
        self.assertFalse(p.succeeded)

    def test_all_660_frames_are_required(self):
        p = EventProtocol('frames')
        p.accept(1, {'kind': 'stage-start', 'probe': 'frames'})
        for tick in range(1, 660):
            p.accept(tick + 1, {'kind': 'frame', 'tick': tick, 'workMs': 1, 'completionMs': 2})
        with self.assertRaises(ValueError):
            p.accept(661, {'kind': 'stage-end'})
        p.accept(661, {'kind': 'frame', 'tick': 660, 'workMs': 1, 'completionMs': 2})
        p.accept(662, {'kind': 'stage-end'})
        self.assertTrue(p.succeeded)


class DurableJournalTests(unittest.TestCase):
    def test_hash_chain_and_receipt_must_agree(self):
        with tempfile.TemporaryDirectory() as temp:
            journal = DurableJournal(temp, 'level-trajectory')
            try:
                for sequence, event in enumerate(tick_events(), 1):
                    ack = journal.append({'sequence': sequence, 'event': event})
                    record = journal.events.get_nowait()
                    self.assertEqual(ack['sequence'], record['sequence'])
                result = {'checks': [{'start': 3, 'tick': 4, 'digest': 'a' * 64}],
                          'runs': [{'start': 3, 'end': 4, 'exact': True}], 'tickMs': [2.5]}
                validate_evidence(journal, result)
                with self.assertRaisesRegex(ValueError, 'requested ranges'):
                    validate_evidence(journal, result, expected_ranges=[(0, 1024)])
                with self.assertRaisesRegex(ValueError, 'differs'):
                    validate_evidence(journal, {**result, 'checks': []})
                with self.assertRaisesRegex(ValueError, 'differs'):
                    validate_evidence(journal, {**result, 'tickMs': [0]})
                journal.close()
                lines = journal.path.read_text().splitlines()
                first = json.loads(lines[0]); digest = first.pop('sha256')
                self.assertEqual(digest, hashlib.sha256(json.dumps(first, sort_keys=True, separators=(',', ':')).encode()).hexdigest())
                journal.path.write_text('\n'.join(lines[:-1]) + '\n')
                with self.assertRaisesRegex(ValueError, 'boundary'):
                    validate_evidence(journal, result)
            finally:
                journal.close()

    def test_blocked_fsync_is_not_acknowledged_or_progress(self):
        entered, release = threading.Event(), threading.Event()
        def blocked_fsync(_):
            entered.set(); release.wait(3)
        with tempfile.TemporaryDirectory() as temp:
            journal = DurableJournal(temp, 'compile', ack_seconds=.5)
            try:
                with mock.patch('scripts.verification_journal.os.fsync', side_effect=blocked_fsync):
                    with self.assertRaisesRegex(RuntimeError, 'timed out'):
                        journal.append({'sequence': 1, 'event': {'kind': 'stage-start', 'probe': 'compile'}})
                    self.assertTrue(entered.is_set())
                    self.assertEqual(journal.durable_sequence, 0)
                    self.assertTrue(journal.events.empty())
                    self.assertFalse(journal.summary()['complete'])
                    with self.assertRaises(RuntimeError):
                        journal.append({'sequence': 2, 'event': {'kind': 'stage-end'}})
                    release.set(); journal.thread.join(timeout=1)
                    self.assertFalse(journal.thread.is_alive())
                    self.assertTrue(journal.events.empty(), 'A late disk flush must not publish progress')
            finally:
                release.set(); journal.close()

    def test_writer_error_and_queue_overflow_fail_closed(self):
        for cause in ('disk', 'queue'):
            with self.subTest(cause=cause), tempfile.TemporaryDirectory() as temp:
                journal = DurableJournal(temp, 'compile', ack_seconds=.5)
                try:
                    target = 'scripts.verification_journal.os.fsync' if cause == 'disk' else None
                    patch = mock.patch(target, side_effect=OSError('disk unavailable')) if target else mock.patch.object(journal.events, 'put_nowait', side_effect=queue.Full)
                    with patch, self.assertRaises(RuntimeError):
                        journal.append({'sequence': 1, 'event': {'kind': 'stage-start', 'probe': 'compile'}})
                    self.assertFalse(journal.summary()['complete'])
                finally:
                    journal.close()

    def test_startup_io_failure_is_reported_before_journal_is_returned(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch('scripts.verification_journal.os.fsync', side_effect=OSError('disk unavailable')):
            with self.assertRaisesRegex(RuntimeError, 'disk unavailable'):
                DurableJournal(temp, 'compile')

    def test_size_limits_are_enforced_before_disk_write(self):
        with tempfile.TemporaryDirectory() as temp:
            journal = DurableJournal(temp, 'compile', ack_seconds=.5)
            try:
                with mock.patch('scripts.verification_journal.MAX_JOURNAL_BYTES', 1), self.assertRaises(RuntimeError):
                    journal.append({'sequence': 1, 'event': {'kind': 'stage-start', 'probe': 'compile'}})
                self.assertEqual(journal.path.stat().st_size, 0)
                self.assertTrue(journal.events.empty())
            finally:
                journal.close()


class WatchdogPolicyTests(unittest.TestCase):
    def test_heartbeat_cannot_extend_absolute_deadline(self):
        self.assertEqual(deadline_reason(10, 10, 10), 2)
        self.assertEqual(deadline_reason(9, 9, 10), 0)

    def test_blocked_supervisor_and_invalid_clock_fail_closed(self):
        self.assertEqual(deadline_reason(10, 6, 100), 1)
        self.assertEqual(deadline_reason(10, float('nan'), 100), 3)
        self.assertEqual(deadline_reason(10, 20, 100), 3)


if __name__ == '__main__':
    unittest.main()
