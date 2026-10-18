"""Bounded JSONL client for one owned, persistent browser transport."""
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time
from scripts.verification_guard import ROOT, assert_runtime_not_blocked

MAX_BYTES = 32 * 1024 * 1024


class PersistentBrowser:
    def __init__(self, executable, output):
        assert_runtime_not_blocked(ROOT)
        if os.name != 'nt' or not os.environ.get('STATE_SPACE_VERIFICATION_JOB'):
            raise RuntimeError('Persistent browser requires supervised Windows containment')
        node = shutil.which('node')
        if not node:
            raise RuntimeError('Node 22 or newer is required')
        self.child = None
        self.responses = queue.Queue(maxsize=2)
        self.requests = queue.Queue(maxsize=1)
        self.closing = threading.Event()
        self.expected_eof = threading.Event()
        self.sequence = 0
        self.fault = None
        self.lock = threading.Lock()
        self.stderr = (Path(output) / 'browser-transport.log').open('xb')
        try:
            self.child = subprocess.Popen([node, str(ROOT / 'scripts/verification_browser.mjs'),
                str(Path(executable).resolve()), str(Path(output).resolve())], cwd=ROOT,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr, bufsize=0,
                creationflags=subprocess.CREATE_NO_WINDOW)
            self.reader = threading.Thread(target=self._read, daemon=True)
            self.reader.start()
            self.writer = threading.Thread(target=self._write, daemon=True)
            self.writer.start()
            self.metadata = self._response(0, 20)
        except BaseException:
            self.close()
            raise

    def _read(self):
        try:
            pending = bytearray()
            while True:
                chunk = self.child.stdout.read(65536)
                if not chunk:
                    if pending:
                        raise RuntimeError('Truncated browser response')
                    if not self.closing.is_set() and not self.expected_eof.is_set():
                        self.fault = self.fault or 'Browser response pipe closed'
                    return
                pending.extend(chunk)
                while (end := pending.find(b'\n')) >= 0:
                    if end + 1 > MAX_BYTES:
                        raise RuntimeError('Oversized browser response')
                    line = bytes(pending[:end]); del pending[:end + 1]
                    self.responses.put_nowait(json.loads(line))
                if len(pending) >= MAX_BYTES:
                    raise RuntimeError('Oversized browser response')
        except BaseException as error:
            self.fault = str(error) or type(error).__name__

    def _write(self):
        try:
            while not self.closing.is_set():
                try:
                    raw, done = self.requests.get(timeout=.1)
                except queue.Empty:
                    continue
                remaining = memoryview(raw)
                while remaining and not self.closing.is_set():
                    count = self.child.stdin.write(remaining)
                    if not count:
                        raise RuntimeError('Browser request pipe closed')
                    remaining = remaining[count:]
                if not remaining:
                    done.set()
        except BaseException as error:
            self.fault = self.fault or str(error) or type(error).__name__

    def _response(self, expected, timeout):
        deadline = time.monotonic() + timeout
        while True:
            if self.fault:
                raise RuntimeError(self.fault)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError('Persistent browser response deadline')
            try:
                value = self.responses.get(timeout=min(.1, remaining))
                break
            except queue.Empty:
                self.check()
        if self.fault or not isinstance(value, dict) or type(value.get('id')) is not int or value['id'] != expected:
            raise RuntimeError(self.fault or 'Unexpected browser response sequence')
        if 'error' in value:
            raise RuntimeError(value['error'])
        if set(value) != {'id', 'result'}:
            raise RuntimeError('Invalid browser response envelope')
        return value['result']

    def check(self):
        if self.fault or self.child.poll() is not None:
            raise RuntimeError(self.fault or 'Persistent browser transport exited')

    def call(self, method, *, timeout=15, **params):
        self.check()
        if not self.lock.acquire(blocking=False):
            raise RuntimeError('Only one browser request may be outstanding')
        try:
            if not 0 < timeout <= 15:
                raise ValueError('Invalid browser request deadline')
            deadline = time.monotonic() + timeout
            self.sequence += 1
            raw = json.dumps({'id': self.sequence, 'method': method, 'params': params}, allow_nan=False).encode() + b'\n'
            if len(raw) > 1024 * 1024:
                raise RuntimeError('Oversized browser request')
            done = threading.Event()
            self.requests.put_nowait((raw, done))
            while not done.wait(min(.1, max(0, deadline - time.monotonic()))):
                self.check()
                if time.monotonic() >= deadline:
                    raise RuntimeError('Persistent browser write deadline')
            return self._response(self.sequence, max(0, deadline - time.monotonic()))
        except Exception as error:
            self.fault = self.fault or str(error) or type(error).__name__
            raise
        finally:
            self.lock.release()

    def close(self):
        if self.closing.is_set():
            return
        # Graceful shutdown uses the same bounded request path. Never flush or
        # close a pipe while a writer could hold its lock indefinitely.
        if self.child:
            try:
                if not self.fault and self.child.poll() is None:
                    self.expected_eof.set()
                    self.call('close', timeout=3)
            except Exception as error:
                self.fault = self.fault or str(error) or type(error).__name__
            self.closing.set()
            try:
                self.child.wait(timeout=.5)
            except subprocess.TimeoutExpired:
                try:
                    self.child.kill()
                    self.child.wait(timeout=1)
                except (OSError, subprocess.TimeoutExpired) as error:
                    self.fault = self.fault or 'Browser transport did not exit: ' + str(error)
            for name, pipe in (('writer', self.child.stdin), ('reader', self.child.stdout)):
                thread = getattr(self, name, None)
                if thread:
                    thread.join(timeout=.25)
                if thread and thread.is_alive():
                    self.fault = self.fault or 'Browser pipe thread did not exit'
                    # The outer Job still owns this process. Closing a stream
                    # concurrently with blocked I/O can itself block teardown.
                else:
                    try:
                        pipe.close()
                    except OSError as error:
                        self.fault = self.fault or str(error)
            if self.child.returncode not in (None, 0):
                self.fault = self.fault or f'Browser transport exit {self.child.returncode}'
        self.closing.set()
        try:
            self.stderr.close()
        except OSError as error:
            self.fault = self.fault or str(error)
