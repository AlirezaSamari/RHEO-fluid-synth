"""Package checked source and reference audio, excluding deployment identity."""
from pathlib import Path
import json, shutil, zipfile
root=Path(__file__).resolve().parent
validation=root/'validation';validation.mkdir(exist_ok=True)
version=json.loads((root/'package.json').read_text())['version']
reports=['test-results.json','physics-tests.json','release-tests.json','app-smoke.json']
checks=[]
for name in reports:
    data=json.loads((root/'artifacts'/name).read_text())
    assert all(r['pass'] for r in data['results']), f'Failed checks in {name}'
    checks.extend(data['results'])
    shutil.copy2(root/'artifacts'/name,validation/name)
shutil.copy2(root/'artifacts/audio-metrics.json',validation/'audio-metrics.json')
shutil.copy2(root/'artifacts/rheo-demo.wav',root/'dist/rheo-demo.wav')
(validation/'NOTES.md').write_text(f'''# RHEO {version} validation\n\n{len(checks)} automated checks passed across analytic fluid checks, numerical/DSP tests, release behavior and UI wiring.\n\nUI tests use Node stand-ins, not a real browser. Subjective audio quality, browser rendering and hardware latency remain unverified.\n''')
files=[root/n for n in ['README.md','CHANGELOG.md','run_local.py','Start-RHEO.bat','package.json','package_release.py','.gitignore']]
for folder in ['dist','tests','validation']:
    files.extend(p for p in (root/folder).rglob('*') if p.is_file() and p.name!='rheo-source.zip')
archive=root/'dist/rheo-source.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=7) as z:
    for p in sorted(files):z.write(p,Path('rheo-fluid-synth')/p.relative_to(root))
with zipfile.ZipFile(archive) as z:assert z.testzip() is None
print(json.dumps({'release':version,'checks':len(checks),'source_files':len(files),'zip_bytes':archive.stat().st_size}))
