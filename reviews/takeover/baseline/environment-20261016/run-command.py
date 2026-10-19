import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path('/Users/xm-talen/Desktop/小明/coding/生图生视频')
report = root / 'reviews/takeover/baseline/environment-20261016'
report.mkdir(parents=True, exist_ok=True)
name, *command = sys.argv[1:]
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
before = time.monotonic()
env = os.environ.copy()
env['NO_COLOR'] = '1'
with (report / (name + '.txt')).open('w') as log:
    log.write('$ ' + ' '.join(command) + '\n')
    log.flush()
    result = subprocess.run(command, cwd=root / 'platform', env=env, stdout=log, stderr=subprocess.STDOUT)
metadata = {
    'command': command,
    'cwd': str(root / 'platform'),
    'startedUtc': started,
    'endedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'elapsedSeconds': round(time.monotonic() - before, 3),
    'exitCode': result.returncode,
    'environmentOverrides': {'NO_COLOR': '1'},
    'output': name + '.txt',
}
media_bin = str(root / 'platform/var/tools/ffmpeg-9.0.2-macos-arm64/bin')
if env.get('PATH', '').split(os.pathsep)[0] == media_bin:
    metadata['environmentOverrides']['PATHPrefix'] = media_bin
(report / (name + '.json')).write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(metadata, ensure_ascii=False))
sys.exit(result.returncode)
