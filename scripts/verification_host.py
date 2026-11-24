"""Persistent incident state for self-hosted verification runners."""
import json
import hashlib
import os
from pathlib import Path
import subprocess


def host_directory():
    value = os.environ.get('STATE_SPACE_HOST_STATE_DIR')
    if value is None:
        return None
    path = Path(value)
    if not value or not path.is_absolute():
        raise RuntimeError('Host incident directory must be an absolute path')
    return path.resolve()


def assert_host_allowed(root):
    directory = host_directory()
    if directory is None:
        return
    try:
        root = Path(root).resolve()
        if directory == root or root in directory.parents:
            raise ValueError('host incident directory is inside a checkout')
        state = json.loads((directory / 'safety-hold.json').read_text(encoding='utf-8'))
        if state['blockRecovery'] is not False:
            raise ValueError('host incident is blocked')
        roots = state['checkoutRoots']
        if not isinstance(roots, list) or not roots:
            raise ValueError('checkoutRoots must inventory the existing host checkouts')
        registrations = directory / 'checkouts'
        roots = roots + [json.loads(path.read_text(encoding='utf-8'))
                         for path in registrations.glob('*.json')]
        checkouts = set()
        for value in roots:
            if not isinstance(value, str) or not Path(value).is_absolute():
                raise ValueError('checkoutRoots must contain absolute paths')
            checkout = Path(value).resolve(strict=True)
            result = subprocess.run(
                ['git', '-C', str(checkout), 'worktree', 'list', '--porcelain', '-z'],
                check=True, capture_output=True, text=True, timeout=10,
            )
            paths = [line[9:] for line in result.stdout.split('\0') if line.startswith('worktree ')]
            if not paths:
                raise ValueError('worktree inventory is empty')
            checkouts.update(Path(path).resolve(strict=True) for path in paths)
        for checkout in checkouts:
            if directory == checkout or checkout in directory.parents:
                raise ValueError('host incident directory is inside a checkout')
            if (checkout / 'dist/verification/safety-hold.json').exists():
                raise ValueError('a checkout incident requires review before runner use')
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        raise RuntimeError('Host verification blocked: ' + str(error)) from error


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    assert_host_allowed(root)
    directory = host_directory()
    if directory:
        if (root / 'dist/verification/safety-hold.json').exists():
            raise RuntimeError('Host verification blocked by the new checkout incident hold')
        # Each checkout owns one entry, so concurrent registrations cannot lose roots.
        registrations = directory / 'checkouts'
        registrations.mkdir(exist_ok=True)
        name = hashlib.sha256(str(root).encode()).hexdigest() + '.json'
        from scripts.verification_journal import durable_json
        durable_json(registrations / name, str(root))
