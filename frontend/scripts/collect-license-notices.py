"""Collect installed dependency license files for the offline About window.
Run after dependency installation and review again before a release.
No code, credentials, or package configuration is included in the output.
"""
from pathlib import Path
import json, tomllib, re, hashlib
ROOT=Path(__file__).resolve().parents[2]
FRONT=ROOT/'frontend'
groups={}
def collect(name, folder):
    for f in sorted(folder.iterdir()):
        if f.is_file() and re.match(r'^(LICEN[CS]E|COPYING|NOTICE)([._-]|$)',f.name,re.I) and f.stat().st_size<250000:
            text=f.read_text(errors='replace').strip()
            if not text: continue
            key=hashlib.sha256(text.encode()).hexdigest()
            if key not in groups: groups[key]=[text,[]]
            groups[key][1].append(name+' — '+f.name)

def resolve(package, base):
    for parent in [base,*base.parents]:
        candidate=parent/'node_modules'/package
        if (candidate/'package.json').exists(): return candidate.resolve()
    return None
seen=set();missing=[]
def visit(name,base):
    folder=resolve(name,base)
    if not folder: missing.append(name);return
    if folder in seen:return
    seen.add(folder)
    pkg=json.loads((folder/'package.json').read_text())
    collect(pkg.get('name',name)+' '+pkg.get('version',''),folder)
    for dep in pkg.get('dependencies',{}): visit(dep,folder)
for dep in json.loads((FRONT/'package.json').read_text()).get('dependencies',{}):visit(dep,FRONT)
for pkg in tomllib.loads((ROOT/'Cargo.lock').read_text()).get('package',[]):
    if pkg.get('source','').startswith('registry+'):
        folders=list((Path.home()/'.cargo/registry/src').glob('*/'+pkg['name']+'-'+pkg['version']))
        if folders: collect(pkg['name']+' '+pkg['version'],folders[0])
# Local dependency patches keep their original notices too.
for folder in (ROOT/'vendor').glob('*'):
    if folder.is_dir():
        collect(folder.name,folder)
        for license_file in folder.rglob('LICENSE*'):
            if license_file.is_file() and license_file.parent != folder: collect(str(license_file.parent.relative_to(ROOT)),license_file.parent)
# Keep both project copyright notices while making the separate brand terms clear.
result=('Tetro — Open-source notices\n\n'
        'Project code: MIT. The Tetro name, wordmark, logos, app icons and identity artwork\n'
        'are reserved to Vana Labs. See BRAND.md in the source repository.\n\n'
        'Project code license\n\n'+(ROOT/'LICENSE.md').read_text()+'\n\nDependency notices\n')
for text,names in groups.values(): result+='\n'+'─'*64+'\n'+'\n'.join(sorted(set(names)))+'\n\n'+text+'\n'
(FRONT/'public/tetro/licenses.txt').write_text(result)
print(f'Collected {len(groups)} distinct notices from {len(seen)} JS packages and installed Cargo dependencies; {len(missing)} optional/missing JS dependencies. Review platform binaries and bundled models separately before release.')
