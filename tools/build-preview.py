"""Make a separately hosted, explicitly simulated preview; leave docs untouched."""
import pathlib,shutil,re,json,hashlib,sys
repo=pathlib.Path(__file__).resolve().parents[1]
src=repo/'docs';out=pathlib.Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True)
manifest=json.loads((src/'production-sha256.json').read_text())
for rel in [*manifest,'production-sha256.json','.nojekyll']:
 p=out/rel;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src/rel,p)
shutil.copyfile(repo/'tools/preview-runtime.js',out/'preview-runtime.js')
for p in out.glob('*.html'):
 text=p.read_text();text=text.replace('<head>','<head><script src="./preview-runtime.js"></script>')
 p.write_text(text)
p=out/'r5/config.mjs';text=p.read_text().replace('little-growth-family-001','r5-selftest-family')
text=re.sub(r"base: 'https://[^']+'", "base: new URL('./demo-r5', location.href).href",text)
text=text.replace("learnUrl: 'https://sadkikyo0930.github.io/little-growth-workbench/v6/'", "learnUrl: new URL('./gate.html', location.href).href")
p.write_text(text)
# Block all CloudBase connections, including unanticipated fetch/XHR in future modules.
csp="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' blob: data:; frame-src 'self' about: blob:; worker-src 'self' blob:"
for p in out.glob('*.html'):
 text=p.read_text().replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="'+csp+'">',1);p.write_text(text)
new={p.relative_to(out).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file() and p.name not in ['production-sha256.json','.nojekyll']}
(out/'production-sha256.json').write_text(json.dumps(new,indent=2,ensure_ascii=False))
print('Preview built:',len(new),'files; CloudBase blocked; namespaced storage; simulated r5-selftest-family only')
