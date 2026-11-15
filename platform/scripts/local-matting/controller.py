"""Offline process-group controller. The TS worker constructs every command."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys

PROTOCOL = 'yingzao-local-matting-v2'

def main():
    data = sys.stdin.buffer.read(32769)
    if len(data) > 32768:
        raise ValueError('REQUEST_TOO_LARGE')
    request = json.loads(data)
    if request.get('protocol') != PROTOCOL or len(request.get('steps', [])) not in (1, 2):
        raise ValueError('PROTOCOL_INVALID')
    lock = None
    if request.get('lockPath'):
        lock = open(request['lockPath'], 'a+b')
        # Blocking wait is cancellable by the TS parent's process-group watchdog.
        # flock releases automatically after a crash, unlike a stale mkdir lock.
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
    results = []
    try:
        for step in request['steps']:
            if not os.path.isabs(step['command']) or not all(isinstance(arg, str) for arg in step['args']):
                raise ValueError('COMMAND_INVALID')
            child = subprocess.Popen([step['command'], *step['args']], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr, env=os.environ.copy())
            child.stdin.write(json.dumps(step['request']).encode())
            child.stdin.close()
            output = child.stdout.read(32769)
            if len(output) > 32768:
                child.kill()
                child.wait()
                raise ValueError('LOCAL_STAGE_OUTPUT_LIMIT')
            child.wait()
            if child.returncode != 0:
                raise ValueError('LOCAL_STAGE_FAILED')
            result = json.loads(output)
            if result.get('protocol') != PROTOCOL:
                raise ValueError('CHILD_PROTOCOL_INVALID')
            results.append(result)
        print(json.dumps({'protocol': PROTOCOL, 'results': results}), flush=True)
    finally:
        if lock is not None:
            lock.close()

try:
    main()
except Exception:
    print('LOCAL_MATTING_CONTROLLER_FAILED', file=sys.stderr, flush=True)
    sys.exit(1)
