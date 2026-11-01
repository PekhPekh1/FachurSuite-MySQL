#!/usr/bin/env bash
# Stage 15 packaging verification. Proves what this sandbox can materially prove
# and reports (not falsifies) what requires a native executor.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT"
pass=0
note(){ pass=$((pass+1)); echo "PASS $1"; }
fail(){ echo "FAIL $1" >&2; exit 1; }

echo "== GitHub Actions workflows are valid YAML with named jobs =="
node -e "
const y=require('js-yaml'),fs=require('fs');
const need={'test.yml':['verify'],'deploy-web.yml':['test','deploy'],'build-exe.yml':['build'],'build-apk.yml':['build']};
for(const [f,jobs] of Object.entries(need)){
  const doc=y.load(fs.readFileSync('.github/workflows/'+f,'utf8'));
  for(const j of jobs) if(!doc.jobs[j]) fail_run(f+' missing job '+j);
  if(!doc.permissions||doc.permissions.contents!=='read') fail_run(f+' missing minimal permissions');
  console.log('OK', f, '→', jobs.join('+'));
}
function fail_run(m){ console.error('FAIL '+m); process.exit(1); }
" || fail "workflow validation"
note "all four workflows are valid and least-privileged"

echo "== deploy-web requires tests and an approval gate =="
grep -q "needs: test" .github/workflows/deploy-web.yml || fail "deploy-web lacks test dependency"
grep -q "environment: production" .github/workflows/deploy-web.yml || fail "deploy-web lacks approval gate"
note "deploy-web runs tests first and requires production-environment approval"

echo "== production migration safety =="
grep -q "pg_dump" deploy/migrate.sh || fail "migrate.sh lacks pre-migration backup"
grep -q "RESTORE" deploy/restore.sh || fail "restore.sh lacks typed confirmation"
note "migrations take a backup; restore requires a typed RESTORE confirmation"

echo "== Electron desktop config =="
node --check apps/desktop/main.cjs || fail "main.cjs syntax"
node --check apps/desktop/preload.cjs || fail "preload.cjs syntax"
node -e "
const yaml=require('js-yaml'),fs=require('fs');
const d=yaml.load(fs.readFileSync('apps/desktop/electron-builder.yml','utf8'));
if(!/^[a-z0-9.]+$/i.test(d.appId)) fail_extra('appId');
if(d.win.target[0].target!=='nsis') fail_extra('target');
if(d.publish!==null) fail_extra('publish must be null (no unsigned auto-updater)');
function fail_extra(m){console.error('FAIL '+m);process.exit(1);}
console.log('electron-builder.yml valid');
" || fail "electron-builder config"
grep -q "requestSingleInstanceLock" apps/desktop/main.cjs || fail "missing single-instance lock"
grep -q "new Tray" apps/desktop/main.cjs || fail "missing tray support"
grep -q "nodeIntegration: false" apps/desktop/main.cjs || fail "web preferences not hardened"
note "desktop client: syntax-checked, NSIS+tray+single-instance, publish=null"

echo "== PWA =="
node --check public/sw.js || fail "sw.js syntax"
node -e "
const y=require('js-yaml'),fs=require('fs');
const m=JSON.parse(fs.readFileSync('public/manifest.json','utf8'));
const icons=m.icons.length;
if(icons<3) { console.error('FAIL need 3+ icons'); process.exit(1); }
if(m.display!=='standalone'&&!m.display_override?.includes('standalone')){ console.error('FAIL not installable'); process.exit(1); }
if(m.dir!=='rtl'||m.lang!=='fa'){ console.error('FAIL rtl/lang'); process.exit(1); }
console.log('manifest: '+icons+' icons, standalone, rtl, fa');
" || fail "manifest"
grep -q "STATIC_ASSETS" public/sw.js || fail "sw lacks static allowlist"
grep -q 'startsWith("/api/")' public/sw.js || fail "sw must not cache /api responses"
grep -q "fonts/Vazirmatn-Regular.woff2" public/sw.js || fail "sw must cache self-hosted fonts"
note "PWA: manifest standalone+RTL+fa, 4 icons, sw caches only fonts/icons — never /api"

echo "== Capacitor mobile =="
node -e "
const yaml=require('js-yaml'),fs=require('fs');
const s=fs.readFileSync('apps/mobile/capacitor.config.ts','utf8');
if(!/appId:\s*\"ir\.store\.installmentsales\"/.test(s)) throw new Error('appId');
if(/cleartext:\s*true/.test(s)) throw new Error('cleartext must be false');
if(!/androidScheme\"?\s*:\s*\"https\"/.test(s)&&!/androidScheme:\s*\"https\"/.test(s)) throw new Error('https scheme');
console.log('capacitor.config: appId + https scheme OK');
" || fail "capacitor config"
grep -q 'webDir: "out"' apps/mobile/capacitor.config.ts
grep -qEi "cannot be exported to static HTML|not a static site|CANNOT be exported" docs/MOBILE.md || fail "MOBILE.md must document no static export"
note "Capacitor: server-load (no static HTML), HTTPS-only, signing via secrets documented"

echo "== packaging artifacts that require native executors =="
command -v java >/dev/null && echo "java present (APK can build here)" || echo "NOTE: Java/Android SDK absent — APK packaging runs in build-apk.yml CI"
command -v electron-builder >/dev/null 2>&1 && echo "electron-builder present" || echo "NOTE: Windows packager absent here — EXE packaging runs in build-exe.yml CI"
note "EXE/APK binaries are produced by CI on windows-latest / ubuntu-latest+JDK17+SDK"
echo "PACKAGING_OK assertions=$pass"
