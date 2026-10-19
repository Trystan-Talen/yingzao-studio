from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

root = Path('/Users/xm-talen/Desktop/小明/coding/生图生视频')
target = root / 'platform/var/tools/ffmpeg-9.0.2-macos-arm64'
archives = target / 'archives'
binary = target / 'bin'
report = root / 'reviews/takeover/baseline/environment-20261016'
archives.mkdir(parents=True, exist_ok=True)
binary.mkdir(parents=True, exist_ok=True)
base = 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/'

def install(program):
    url = base + program + '.zip'
    checksum_url = url + '.sha256'
    checksum_file = archives / (program + '.zip.sha256')
    subprocess.run(['curl','--silent','--show-error','--fail','--location','--retry','2','--max-time','120','--output',str(checksum_file),checksum_url],check=True)
    checksum_text = checksum_file.read_text().strip()
    expected = checksum_text.split()[0].lower()
    if len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected):
        raise ValueError('Invalid checksum response for ' + program)
    archive = archives / (program + '.zip')
    subprocess.run(['curl','--silent','--show-error','--fail','--location','--retry','2','--max-time','120','--output',str(archive),url],check=True)
    actual = hashlib.sha256(archive.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError('Checksum mismatch for ' + program)
    with zipfile.ZipFile(archive) as bundle:
        entries = [e for e in bundle.infolist() if Path(e.filename).name == program and not e.is_dir()]
        if len(entries) != 1:
            raise ValueError('Ambiguous binary archive for ' + program)
        with bundle.open(entries[0]) as source, (binary / program).open('wb') as output:
            shutil.copyfileobj(source, output)
    (binary / program).chmod(0o755)
    commands=[]
    for command in [['file',str(binary/program)],['codesign','--verify','--verbose=4',str(binary/program)],['codesign','-dvvv',str(binary/program)],['xattr','-l',str(binary/program)],[str(binary/program),'-version']]:
        result=subprocess.run(command,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        commands.append({'command':command,'exitCode':result.returncode,'output':result.stdout})
        if command[0] in ['file', 'codesign', str(binary/program)] and result.returncode:
            raise RuntimeError('Validation failed: '+ ' '.join(command) + '\n' + result.stdout)
    return {'program':program,'source':url,'checksumSource':checksum_url,'archiveSha256':actual,'binarySha256':hashlib.sha256((binary/program).read_bytes()).hexdigest(),'binary':str(binary/program),'validation':commands}

with ThreadPoolExecutor(max_workers=2) as pool:
    programs=list(pool.map(install,['ffmpeg','ffprobe']))
manifest={'installedUtc':datetime.now(timezone.utc).isoformat(),'sourcePage':'https://ffmpeg.martin-riedl.de/','version':'9.0.2','target':str(target),'programs':programs,'globalConfigurationChanged':False}
(report/'media-tools.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'installed':str(binary),'programs':[p['program'] for p in programs]},ensure_ascii=False))
