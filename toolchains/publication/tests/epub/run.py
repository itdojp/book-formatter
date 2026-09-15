#!/usr/bin/env python3
"""Fixed synthetic EPUB experiment. NOT a general book/config rendering API."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time
import uuid
import zipfile

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent.parent
PINS = json.loads((HERE / 'pins.json').read_text())
OWNER = 'book-formatter synthetic EPUB gate v1\n'
ENGINE = os.environ.get('EPUB_GATE_ENGINE', 'podman')


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inventory(root):
    paths = sorted(root.rglob('*'))
    require(not any(p.is_symlink() for p in paths), 'symlink in owned tree')
    return {str(p.relative_to(root)): digest(p) for p in paths if p.is_file()}


def fixture_gate():
    require(inventory(HERE / 'fixtures') == PINS['fixtures'], 'fixture hash/inventory drift')
    require(digest(TOOL / 'package-lock.json') == PINS['toolchainLockSha256'], 'toolchain lock drift')
    return inventory(HERE / 'fixtures')


def command(args, *, env=None, timeout=120, capture=False):
    print('+', ' '.join(map(str, args)), flush=True)
    result = subprocess.run(list(map(str, args)), env=env, check=True, timeout=timeout,
                            stdout=subprocess.PIPE if capture else None, text=True)
    return result.stdout if capture else None


def podman(state, *args, timeout=120, capture=False):
    # Dedicated storage/config; never read or change the operator's existing container store.
    env = {'PATH': os.environ['PATH'], 'HOME': str(state / 'home'),
           'XDG_RUNTIME_DIR': str(state / 'runtime'), 'XDG_CACHE_HOME': str(state / 'cache')}
    return command(['podman', '--storage-driver=vfs', f'--root={state / "root"}',
                   f'--runroot={state / "r"}', f'--tmpdir={state / "temporary"}', *args],
                   env=env, timeout=timeout, capture=capture)


def runtime(state, *args, timeout=120, capture=False):
    if ENGINE == 'podman':
        return podman(state, *args, timeout=timeout, capture=capture)
    elif ENGINE == 'docker':
        # Explicit dedicated-CI mode, never an automatic fallback. Docker's
        # daemon is trusted infrastructure; no socket is mounted in a container.
        return command(['docker', *args], timeout=timeout, capture=capture)
    else:
        raise ValueError('unsupported engine')


def container(state, image, mounts, args, *, java=False):
    # No -v host-home, runtime socket, credentials, devices, host network or privileged fallback.
    engine_options = ['--read-only-tmpfs=false', '--userns=keep-id'] if ENGINE == 'podman' else []
    name = 'epub-gate-' + uuid.uuid4().hex
    primary_error = None
    try:
        runtime(state, 'run', '--name', name, '--rm', '--pull=never', '--network=none', '--read-only', *engine_options,
                '--tmpfs', '/work:rw,noexec,nosuid,nodev,size=128m,mode=1777',
                '--workdir=/work', '--env', 'HOME=/work', '--env', 'TMPDIR=/work',
                '--user', f'{os.getuid()}:{os.getgid()}',
                '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=1g',
                '--pids-limit=128', '--cpus=1', '--entrypoint', 'java' if java else 'node',
                *[arg for host, target, mode in mounts for arg in ('--volume', f'{host}:{target}:{mode}')],
                image, *args)
    except BaseException as exc:
        primary_error = exc
        raise
    finally:
        # Killing a timed-out CLI client does not necessarily stop its container.
        # Remove only this invocation's exact random name, never other workloads.
        try:
            remaining = runtime(state, 'ps', '--all', '--filter', f'name={name}', '--format', '{{.Names}}', capture=True)
            if name in remaining.splitlines():
                runtime(state, 'rm', '--force', name)
        except Exception as cleanup_error:
            if primary_error is None:
                raise
            print(f'Cleanup also failed for owned container {name}; manual removal may be required: {cleanup_error}',
                  file=sys.stderr)


def prepare(state):
    state.mkdir(mode=0o700)  # Existing directories are NEVER reused or erased by preparation.
    (state / 'owner').write_text(OWNER)
    (state / 'pins.json').write_bytes((HERE / 'pins.json').read_bytes())
    (state / 'engine').write_text(ENGINE)
    for name in ['home', 'runtime', 'cache', 'temporary', 'checker']:
        (state / name).mkdir(mode=0o700)
    for key in ['nodeImage', 'javaImage']:
        runtime(state, 'pull', PINS[key], timeout=600)
    archive = state / 'epubcheck.zip'
    command(['curl', '--fail', '--location', '--retry', '3', '--proto', '=https',
             '--proto-redir', '=https', '--max-time', '180', '--output', archive, PINS['epubcheckUrl']], timeout=240)
    require(digest(archive) == PINS['epubcheckSha256'], 'EPUBCheck release checksum mismatch')
    with zipfile.ZipFile(archive) as package:
        for item in package.infolist():
            require(not item.filename.startswith('/') and '..' not in Path(item.filename).parts,
                    'invalid pinned archive member')
        package.extractall(state / 'checker')
    (state / 'checker-inventory.json').write_text(json.dumps(inventory(state / 'checker'), sort_keys=True))
    (state / 'prepared').write_text(OWNER)


def run(state):
    require((state / 'prepared').read_text() == OWNER, 'preparation incomplete')
    require((state / 'owner').read_text() == OWNER, 'not owned by EPUB gate')
    require((state / 'engine').read_text() == ENGINE, 'prepared engine mismatch; no fallback')
    require((state / 'pins.json').read_bytes() == (HERE / 'pins.json').read_bytes(), 'prepared pins drift')
    expected = json.loads((state / 'checker-inventory.json').read_text())
    require(inventory(state / 'checker') == expected, 'checker inventory drift')
    require(digest(state / 'epubcheck.zip') == PINS['epubcheckSha256'], 'checker archive drift')
    before = fixture_gate()
    execution = state / 'execution'
    execution.mkdir()  # No overwrite, resume, or implicit cleanup of an earlier run.
    inputs = execution / 'input'
    inputs.mkdir()
    for name in ['chapter.md', 'vivliostyle.config.mjs']:
        shutil.copyfile(HERE / 'fixtures' / name, inputs / name)
    selected = inventory(inputs)
    timings = []
    for number in [1, 2]:
        output = execution / str(number)
        output.mkdir()
        started = time.monotonic()
        container(state, PINS['nodeImage'], [(TOOL / 'node_modules', '/opt/toolchain/node_modules', 'ro'),
                  (HERE / 'container-render.mjs', '/gate/container-render.mjs', 'ro'), (inputs, '/input', 'ro'),
                  (output, '/output', 'rw')], ['/gate/container-render.mjs'])
        render_seconds = time.monotonic() - started
        checker = state / 'checker' / f'epubcheck-{PINS["epubcheckVersion"]}'
        started = time.monotonic()
        container(state, PINS['javaImage'], [(checker, '/checker', 'ro'), (output, '/artifact', 'ro')],
                  ['-Djava.io.tmpdir=/work', '-jar', '/checker/epubcheck.jar', '/artifact/book.epub',
                   '--failonwarnings', '--locale', 'en'], java=True)
        timings.append({'renderSeconds': round(render_seconds, 3), 'epubcheckSeconds': round(time.monotonic() - started, 3)})
    require(inventory(inputs) == selected and fixture_gate() == before, 'input/canonical drift')
    require(inventory(state / 'checker') == expected, 'checker changed during validation')
    command(['python3', HERE / 'verify.py', execution / '1/book.epub', execution / '2/book.epub',
             '--report', execution / 'report.json'])
    command(['python3', HERE / 'verify_test.py', execution / '1/book.epub'])
    (execution / 'timings.json').write_text(json.dumps(timings, indent=2) + '\n')
    print(json.dumps({'syntheticOnly': True, 'distributionApproved': False, 'timings': timings}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'run'])
    parser.add_argument('state', type=Path, help='new dedicated, short absolute directory under your authorized workspace')
    args = parser.parse_args()
    require(platform.system() == 'Linux' and platform.machine() == 'x86_64', 'Linux x86_64 required')
    require(os.getuid() != 0, 'rootless operator required')
    require(ENGINE in {'podman', 'docker'}, 'unsupported engine')
    state = args.state
    require(state.is_absolute() and state.resolve() == state and ':' not in str(state)
            and not any(c.isspace() for c in str(state)), 'canonical absolute state path without delimiters required')
    if ENGINE == 'podman':
        require(len(str(state / 'r')) <= 50, 'Podman runroot must not exceed 50 characters; choose a short owned workspace path')
    fixture_gate()
    {'prepare': prepare, 'run': run}[args.mode](state)


if __name__ == '__main__':
    main()
