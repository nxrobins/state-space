"""Bounded, fsync-acknowledged verification events; no simulation imports."""
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import re
import threading
import time

MAX_RECORD_BYTES = 8192
MAX_JOURNAL_BYTES = 16 * 1024 * 1024


def durable_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    temporary.replace(path)


class EventProtocol:
    """Validate progress independently of heartbeat text or receipt assertions."""
    def __init__(self, probe):
        self.probe = probe
        self.sequence = 0
        self.started = self.ended = self.succeeded = False
        self.current = None
        self.phase = None
        self.next_tick = 0
        self.frame = 0
        self.verified = 0
        self.statuses = set()

    def accept(self, sequence, event):
        if type(sequence) is not int or sequence != self.sequence + 1 or sequence > 20000:
            raise ValueError('Missing, duplicate or excessive event sequence')
        if not isinstance(event, dict) or self.ended:
            raise ValueError('Invalid event or event after completion')
        kind = event.get('kind')
        if not self.started:
            if kind != 'stage-start' or event.get('probe') != self.probe:
                raise ValueError('Missing stage start')
            self.started = True
        elif kind == 'status':
            text = event.get('text')
            if self.current or not isinstance(text, str) or not 0 < len(text) <= 2048 or text in self.statuses:
                raise ValueError('Status is not new progress')
            self.statuses.add(text)
        elif kind == 'range-start':
            start, end = event.get('start'), event.get('end')
            if self.current or type(start) is not int or type(end) is not int or not 0 <= start < end <= 1024:
                raise ValueError('Invalid replay range')
            self.current = (start, end); self.next_tick = start + 1; self.phase = 'step'
        elif kind == 'phase':
            if (not self.current or type(event.get('tick')) is not int or event['tick'] != self.next_tick
                    or self.next_tick > self.current[1] or self.phase not in ('step', 'snapshot', 'hash')
                    or event.get('phase') != self.phase):
                raise ValueError('Unexpected replay phase')
            self.phase = {'step': 'snapshot', 'snapshot': 'hash', 'hash': 'verified'}[self.phase]
        elif kind == 'verified':
            if (not self.current or type(event.get('start')) is not int or type(event.get('tick')) is not int
                    or event['start'] != self.current[0] or event['tick'] != self.next_tick
                    or self.phase != 'verified' or self.next_tick > self.current[1]
                    or not isinstance(event.get('digest'), str) or not re.fullmatch('[0-9a-f]{64}', event['digest'])):
                raise ValueError('Invalid verified tick')
            ms = event.get('stepMs')
            if type(ms) not in (int, float) or not math.isfinite(ms) or ms < 0:
                raise ValueError('Invalid tick timing')
            self.next_tick += 1; self.verified += 1; self.phase = 'step'
        elif kind == 'range-end':
            if not self.current or type(event.get('end')) is not int or event['end'] != self.current[1] or self.next_tick != self.current[1] + 1 or self.phase != 'step':
                raise ValueError('Incomplete replay range')
            self.current = None; self.phase = None
        elif kind == 'frame':
            if self.probe != 'frames' or type(event.get('tick')) is not int or event['tick'] != self.frame + 1 or self.frame >= 660:
                raise ValueError('Missing or duplicate gameplay frame')
            for key in ('workMs', 'completionMs'):
                value = event.get(key)
                if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                    raise ValueError('Invalid frame timing')
            self.frame += 1
        elif kind == 'stage-end':
            if (self.current or self.probe == 'frames' and self.frame != 660
                    or self.probe == 'level-trajectory' and not self.verified):
                raise ValueError('Incomplete stage')
            self.ended = self.succeeded = True
        elif kind == 'stage-error':
            if not isinstance(event.get('error'), str):
                raise ValueError('Missing error')
            self.ended = True
        else:
            raise ValueError('Unknown progress event')
        self.sequence = sequence


class DurableJournal:
    def __init__(self, directory, probe, *, ack_seconds=3):
        if type(ack_seconds) not in (int, float) or not math.isfinite(ack_seconds) or not 0 < ack_seconds <= 3:
            raise ValueError('Invalid journal deadline')
        self.path = Path(directory) / 'events.jsonl'
        self.protocol = EventProtocol(probe)
        self.ack_seconds = ack_seconds
        self.queue = queue.Queue(maxsize=64)
        self.events = queue.Queue(maxsize=128)
        self.error = None
        self.closed = False
        self.lock = threading.Lock()
        self.last_hash = '0' * 64
        self.durable_sequence = 0
        self.durable_verified = self.durable_frames = 0
        self.bytes_written = 0
        self.ready = threading.Event()
        self.thread = threading.Thread(target=self._write, daemon=True)
        self.thread.start()
        if not self.ready.wait(self.ack_seconds) or self.error:
            self.error = self.error or 'Journal startup deadline'
            self.closed = True
            self.queue.put_nowait(None)
            # A late open/fsync must exit without accepting work. Do not wait
            # again here for an already-stalled writer.
            raise RuntimeError(self.error)

    def _write(self):
        try:
            with self.path.open('x', encoding='utf-8', newline='\n') as stream:
                stream.flush(); os.fsync(stream.fileno())
                if self.closed:
                    return
                self.ready.set()
                while True:
                    item = self.queue.get()
                    if item is None:
                        return
                    record, done, deadline = item
                    raw = json.dumps(record, separators=(',', ':'), sort_keys=True, allow_nan=False)
                    digest = hashlib.sha256(raw.encode()).hexdigest()
                    line = json.dumps({**record, 'sha256': digest}, separators=(',', ':')) + '\n'
                    size = len(line.encode('utf-8'))
                    if size > MAX_RECORD_BYTES or self.bytes_written + size > MAX_JOURNAL_BYTES:
                        raise RuntimeError('Journal write exceeds evidence bound')
                    stream.write(line)
                    stream.flush(); os.fsync(stream.fileno())
                    self.bytes_written += size
                    self.last_hash = digest; self.durable_sequence = record['sequence']
                    self.durable_verified += record['event']['kind'] == 'verified'
                    self.durable_frames += record['event']['kind'] == 'frame'
                    if time.monotonic() >= deadline:
                        self.error = self.error or 'Durable journal acknowledgement timed out'
                    if self.error or self.closed:
                        # Bytes may have reached disk after a timeout. They are
                        # a diagnostic tail, never fresh progress or an ACK.
                        return
                    # Publish/ack only after persistence. Full queues fail the run.
                    self.events.put_nowait(record)
                    done.set()
        except BaseException as error:
            self.error = str(error) or type(error).__name__
            self.ready.set()

    def append(self, message):
        if self.closed or self.error:
            raise RuntimeError(self.error or 'Journal closed')
        if not self.lock.acquire(blocking=False):
            self.error = 'Concurrent journal request'
            raise RuntimeError(self.error)
        try:
            if not isinstance(message, dict) or set(message) != {'sequence', 'event'}:
                raise ValueError('Invalid journal envelope')
            self.protocol.accept(message['sequence'], message['event'])
            record = {**message, 'receivedAt': time.time(), 'previousSha256': self.last_hash}
            done = threading.Event()
            self.queue.put_nowait((record, done, time.monotonic() + self.ack_seconds))
            if not done.wait(self.ack_seconds) or self.error:
                raise RuntimeError(self.error or 'Durable journal acknowledgement timed out')
            return {'sequence': self.durable_sequence, 'sha256': self.last_hash}
        except BaseException as error:
            self.error = str(error) or type(error).__name__
            raise
        finally:
            self.lock.release()

    def summary(self):
        return {'path': self.path.name, 'durableSequence': self.durable_sequence,
                'lastSha256': self.last_hash, 'verifiedTicks': self.durable_verified,
                'frames': self.durable_frames, 'ended': self.protocol.ended,
                'complete': self.protocol.succeeded and not self.error
                    and self.protocol.sequence == self.durable_sequence, 'error': self.error}

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            self.queue.put_nowait(None)
        except queue.Full:
            self.error = self.error or 'Journal queue did not drain'
        self.thread.join(timeout=self.ack_seconds)
        if self.thread.is_alive():
            self.error = self.error or 'Journal writer did not exit'


def validate_evidence(journal, result, *, expected_ranges=None):
    """Reconcile the final receipt with the durable chain, never an in-memory tail."""
    if not journal.summary()['complete'] or not isinstance(result, dict):
        raise ValueError('Incomplete durable stage')
    protocol = EventProtocol(journal.protocol.probe)
    previous = '0' * 64
    checks, frames, ranges, timings = [], [], [], []
    start = None
    if journal.path.stat().st_size > MAX_JOURNAL_BYTES:
        raise ValueError('Journal exceeds evidence bound')
    with journal.path.open(encoding='utf-8') as stream:
        while True:
            line = stream.readline(8193)
            if not line:
                break
            if len(line) > 8192 or not line.endswith('\n'):
                raise ValueError('Truncated or oversized journal record')
            record = json.loads(line)
            digest = record.pop('sha256')
            if set(record) != {'sequence', 'event', 'receivedAt', 'previousSha256'}:
                raise ValueError('Invalid durable record')
            raw = json.dumps(record, separators=(',', ':'), sort_keys=True, allow_nan=False)
            if record['previousSha256'] != previous or hashlib.sha256(raw.encode()).hexdigest() != digest:
                raise ValueError('Journal hash chain mismatch')
            protocol.accept(record['sequence'], record['event'])
            previous = digest
            event = record['event']
            if event['kind'] == 'verified':
                checks.append({key: event[key] for key in ('start', 'tick', 'digest')})
                timings.append(event['stepMs'])
            elif event['kind'] == 'frame':
                frames.append({key: event[key] for key in ('tick', 'workMs', 'completionMs')})
            elif event['kind'] == 'range-start':
                start = event['start']
            elif event['kind'] == 'range-end':
                ranges.append({'start': start, 'end': event['end'], 'exact': True})
    if not protocol.succeeded or previous != journal.last_hash or protocol.sequence != journal.durable_sequence:
        raise ValueError('Journal final boundary differs')
    if protocol.probe == 'level-trajectory':
        if checks != result.get('checks') or ranges != result.get('runs') or timings != result.get('tickMs'):
            raise ValueError('Replay receipt differs from durable ticks')
        if expected_ranges is not None and [(row['start'], row['end']) for row in ranges] != expected_ranges:
            raise ValueError('Durable replay does not cover the requested ranges')
    if protocol.probe == 'frames':
        rows = result.get('warmup', []) + result.get('samples', [])
        retained = [{key: row[key] for key in ('tick', 'workMs', 'completionMs')} for row in rows]
        if len(result.get('warmup', [])) != 60 or len(result.get('samples', [])) != 600 or frames != retained:
            raise ValueError('Frame receipt differs from durable frames')
