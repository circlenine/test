/**
 * 005-Updater.gs（コードの自動更新）を検証する。
 *   実行: node gas/test/updater.test.js
 *
 * 自分自身を書き換えるコードなので、
 * 「壊す前に必ず保存する」「危ないときは書き込まない」を重点的に見る。
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ctx = { console };
vm.createContext(ctx);
const CtxDate = vm.runInContext('Date', ctx);

/* ---- 偽のドライブ ---- */
let drive;              // フォルダ名 → 偽フォルダ
function mkFolder(name) {
  const f = {
    _name: name, _files: [], _folders: [], _trashed: false,
    _created: Date.now(),
    getName: () => f._name,
    getDateCreated: () => new CtxDate(f._created),
    setTrashed: v => { f._trashed = v; },
    getFolders: () => iter(f._folders.filter(x => !x._trashed)),
    getFiles: () => iter(f._files),
    createFolder: n => { const c = mkFolder(n); f._folders.push(c); return c; },
    getFoldersByName: n => iter(f._folders.filter(x => x._name === n && !x._trashed)),
    createFile: (n, content) => {
      const file = mkFile(n, content); f._files.push(file); return file;
    }
  };
  return f;
}
function mkFile(name, content, updated) {
  return {
    getName: () => name,
    getLastUpdated: () => new CtxDate(updated || Date.now()),
    getBlob: () => ({ getDataAsString: () => content })
  };
}
function iter(arr) {
  let i = 0;
  return { hasNext: () => i < arr.length, next: () => arr[i++] };
}
ctx.DriveApp = {
  getFoldersByName: n => iter(drive[n] ? [drive[n]] : []),
  createFolder: n => (drive[n] = mkFolder(n))
};

/* ---- 偽のスプシ ---- */
const toasts = [], alerts = [], cells = {};
let uiWorks = true;
ctx.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    toast: (m, t) => toasts.push({ t: t, m: m }),
    getSheetByName: n => (n === '説明')
      ? { getRange: a1 => ({ setValue: v => { cells[a1] = String(v); } }) } : null
  }),
  getUi: () => {
    if (!uiWorks) throw new Error('ダイアログは使えません');
    return {
      alert: (t, b) => { alerts.push({ t: t, b: b }); return 'YES'; },
      Button: { YES: 'YES' }, ButtonSet: { YES_NO: 'YN', OK: 'OK' }
    };
  }
};
ctx.pad2_ = n => ('0' + n).slice(-2);
const props = {};
ctx.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in props ? props[k] : null),
  setProperty: (k, v) => { props[k] = String(v); },
  deleteProperty: k => { delete props[k]; } })};
let gh = null;      // {dir:[{name,path,type}], raw:{path:内容}, fail:{code,msg}}
ctx.ScriptApp = { getOAuthToken: () => 'tok', getScriptId: () => 'SID' };

/* ---- 偽の Apps Script API ---- */
let project;            // サーバー側にあることになっている中身
let apiCalls;           // 呼ばれた記録
let apiFail = null;     // {path, code, msg} を入れると、その呼び出しだけ失敗する
ctx.UrlFetchApp = { fetch: (url, opt) => {
  if (url.indexOf('https://api.github.com/') === 0) {
    if (gh && gh.fail) {
      return { getResponseCode: () => gh.fail.code,
               getContentText: () => JSON.stringify({ message: gh.fail.msg }) };
    }
    const p = decodeURI(url.split('/contents/')[1].split('?')[0]);
    if (gh && gh.raw && (p in gh.raw)) {
      return { getResponseCode: () => 200, getContentText: () => gh.raw[p] };
    }
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(gh.dir) };
  }
  const path = url.replace('https://script.googleapis.com/v1/projects/SID', '');
  apiCalls.push({ path: path, method: opt.method,
                  body: opt.payload ? JSON.parse(opt.payload) : null });
  if (apiFail && path.indexOf(apiFail.path) === 0 && opt.method === apiFail.method) {
    return { getResponseCode: () => apiFail.code,
             getContentText: () => JSON.stringify({ error: { message: apiFail.msg } }) };
  }
  if (path === '/content' && opt.method === 'get') {
    return ok({ files: project.files });
  }
  if (path === '/content' && opt.method === 'put') {
    project.files = JSON.parse(opt.payload).files;
    return ok({ files: project.files });
  }
  if (path === '/deployments' && opt.method === 'get') {
    return ok({ deployments: project.deployments });
  }
  if (path === '/versions' && opt.method === 'post') {
    project.version++;
    return ok({ versionNumber: project.version });
  }
  if (path.indexOf('/deployments/') === 0 && opt.method === 'put') {
    const id = path.split('/')[2];
    project.deployments.forEach(d => {
      if (d.deploymentId === id) d.deploymentConfig = JSON.parse(opt.payload).deploymentConfig;
    });
    return ok({});
  }
  return ok({});
}};
function ok(o) { return { getResponseCode: () => 200, getContentText: () => JSON.stringify(o) }; }

vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '005-Updater.gs'), 'utf8'), ctx,
  { filename: '005-Updater.gs' });
const F = n => vm.runInContext(n, ctx);

let ng = 0;
function t(c, l) { console.log((c ? '  ok   ' : '  NG   ') + l); if (!c) ng++; }
function has(s, n, l) {
  const hit = String(s).indexOf(n) !== -1;
  console.log((hit ? '  ok   ' : '  NG   ') + l +
    (hit ? '' : '  … 実際: ' + JSON.stringify(String(s).slice(0, 200))));
  if (!hit) ng++;
}
const MANIFEST = { name: 'appsscript', type: 'JSON', source: '{"timeZone":"Asia/Tokyo"}' };

function reset(driveFiles, projFiles) {
  drive = {};
  toasts.length = 0; alerts.length = 0;
  Object.keys(cells).forEach(k => delete cells[k]);
  apiCalls = []; apiFail = null; uiWorks = true;
  Object.keys(props).forEach(k => delete props[k]);
  gh = null;
  if (driveFiles) {
    const f = mkFolder('taxi-gas');
    driveFiles.forEach(([n, c, u]) => f._files.push(mkFile(n, c, u)));
    drive['taxi-gas'] = f;
  }
  project = {
    files: projFiles || [MANIFEST, { name: '001-Code', type: 'SERVER_JS', source: 'ふるい' }],
    deployments: [
      { deploymentId: 'D1', deploymentConfig: { versionNumber: 3, description: '本番' } },
      { deploymentId: 'HEAD', deploymentConfig: { description: '作業中' } }   // 版なし
    ],
    version: 3
  };
}
const lastPut = () => apiCalls.filter(c => c.path === '/content' && c.method === 'put').pop();

console.log('\n■ ドライブから読む');
reset([['001-Code.gs', 'あたらしい'], ['004-WebApp.gs', 'ページ'], ['めも.txt', 'これは無視']]);
let d = F('updReadDrive_')();
t(d.length === 2, '.gs だけ読む（.txt は無視）');
t(d.map(x => x.name).sort().join(',') === '001-Code,004-WebApp', '拡張子を落とした名前になる');
t(d[0].type === 'SERVER_JS', '種類は SERVER_JS');

reset([['004-WebApp.html', '<b>x</b>'], ['appsscript.json', '{}']]);
d = F('updReadDrive_')();
t(d.filter(x => x.name === '004-WebApp')[0].type === 'HTML', '.html は HTML');
t(d.filter(x => x.name === 'appsscript')[0].type === 'JSON', '.json は JSON');

console.log('\n■ 同じ名前が複数あったら、新しいほうを使う');
reset([['001-Code.gs', 'ふるい版', 1000], ['001-Code.gs', 'あたらしい版', 9000]]);
d = F('updReadDrive_')();
t(d.length === 1, '1つにまとまる');
t(d[0].source === 'あたらしい版', '新しいほうが勝つ');

console.log('\n■ 更新の流れ');
reset([['001-Code.gs', 'あたらしい'], ['005-Updater.gs', '更新係']]);
F('menuUpdateCode')();
t(lastPut() !== undefined, '書き込みが走った');
const put = lastPut().body.files;
t(put.filter(f => f.name === '001-Code')[0].source === 'あたらしい', '001-Code が入れ替わった');
t(put.filter(f => f.name === '005-Updater').length === 1, '無かったファイルは足される');
t(put.filter(f => f.name === 'appsscript').length === 1, 'appsscript は残る');
has(alerts[alerts.length - 1].t, '更新しました', '結果を知らせる');
t(Object.keys(drive['taxi-gas']._folders[0]._folders).length !== 0 ||
  drive['taxi-gas']._folders[0]._folders.length === 1, '書き換える前に保存された');
const bk = drive['taxi-gas']._folders[0]._folders[0];
t(bk._files.length === 2, '保存には元の全ファイルが入っている');
t(bk._files.map(f => f.getName()).indexOf('appsscript.json') !== -1,
  'appsscript も .json で保存される');

console.log('\n■ デプロイもやり直す');
t(project.version === 4, '新しい版が作られた');
const d1 = project.deployments.filter(x => x.deploymentId === 'D1')[0];
t(d1.deploymentConfig.versionNumber === 4, '公開中のデプロイが新しい版になった');
t(project.deployments.filter(x => x.deploymentId === 'HEAD')[0]
    .deploymentConfig.versionNumber === undefined, '作業中(@HEAD)のものは触らない');
has(alerts[alerts.length - 1].b, 'デプロイもやり直しました', 'その旨も伝える');

console.log('\n■ 危ないときは書き込まない');
reset([['001-Code.gs', 'あたらしい']]);
let threw = false;
try { F('updPutProject_')([{ name: '001-Code', type: 'SERVER_JS', source: 'x' }]); }
catch (e) { threw = true; has(e.message, 'appsscript', 'appsscript が無ければ止める'); }
t(threw, 'そのまま書き込まない');

reset([['001-Code.gs', 'あたらしい']]);
threw = false;
try { F('updPutProject_')([]); } catch (e) { threw = true; }
t(threw, '空でも書き込まない');

console.log('\n■ 保存に失敗したら書き込まない');
reset([['001-Code.gs', 'あたらしい']]);
const realCreate = drive['taxi-gas'].createFolder;
drive['taxi-gas'].createFolder = () => { throw new Error('ドライブがいっぱいです'); };
F('menuUpdateCode')();
t(lastPut() === undefined, '書き込みまで進まない');
has(alerts[alerts.length - 1].t, 'バックアップできませんでした', '理由を出す');
t(project.files.filter(f => f.name === '001-Code')[0].source === 'ふるい',
  'コードは元のまま');

console.log('\n■ APIが使えないとき');
reset([['001-Code.gs', 'あたらしい']]);
apiFail = { path: '/content', method: 'get', code: 403,
            msg: 'User has not enabled the Apps Script API.' };
F('menuUpdateCode')();
t(lastPut() === undefined, '書き込まない');
has(alerts[alerts.length - 1].b, 'usersettings', 'どこで ON にするか教える');

console.log('\n■ 書き込みが失敗したとき');
reset([['001-Code.gs', 'あたらしい']]);
apiFail = { path: '/content', method: 'put', code: 500, msg: 'なにか失敗' };
F('menuUpdateCode')();
has(alerts[alerts.length - 1].t, '書き込めませんでした', 'そう伝える');
has(alerts[alerts.length - 1].b, 'コードは元のまま', '元のままだと伝える');
t(drive['taxi-gas']._folders[0]._folders.length === 1, '保存は残っている');

console.log('\n■ 変わっていなければ何もしない');
reset([['001-Code.gs', 'ふるい']]);
F('menuUpdateCode')();
t(lastPut() === undefined, '書き込まない');
has(alerts[alerts.length - 1].t, 'すでに最新', 'そう伝える');
t(drive['taxi-gas']._folders.length === 0, '無駄な保存もしない');

console.log('\n■ ドライブに何も無いとき');
reset([]);
F('menuUpdateCode')();
t(lastPut() === undefined, '書き込まない');
has(alerts[alerts.length - 1].t, '新しいコードがありません', 'そう伝える');

console.log('\n■ 前のコードに戻す');
reset([['001-Code.gs', 'あたらしい']]);
F('menuUpdateCode')();
t(project.files.filter(f => f.name === '001-Code')[0].source === 'あたらしい', 'まず更新');
F('menuRestoreCode')();
t(project.files.filter(f => f.name === '001-Code')[0].source === 'ふるい', '元に戻った');
has(alerts[alerts.length - 1].t, '戻しました', 'そう伝える');

reset([['001-Code.gs', 'あたらしい']]);
F('menuRestoreCode')();
has(alerts[alerts.length - 1].b, '保存されたコードがありません', '保存が無ければそう言う');

console.log('\n■ 保存は増えすぎないように');
reset([['001-Code.gs', 'あたらしい']]);
for (let i = 0; i < 13; i++) {
  project.files = [MANIFEST, { name: '001-Code', type: 'SERVER_JS', source: 'v' + i }];
  F('menuBackupCode')();
}
const kept = drive['taxi-gas']._folders[0]._folders.filter(f => !f._trashed);
t(kept.length <= 10, '10個までに抑える（実際 ' + kept.length + '個）');

console.log('\n■ ダイアログが出せなくても動く');
reset([['001-Code.gs', 'あたらしい']]);
uiWorks = false;
F('menuUpdateCode')();
t(lastPut() !== undefined, 'ダイアログ無しでも更新できる');
t(toasts.length > 0, 'トーストで知らせる');
has(cells['Z5'], '更新しました', '説明タブZ5にも残る');

console.log('\n■ 状態を調べる');
reset([['001-Code.gs', 'あたらしい']]);
F('menuUpdateStatus')();
has(alerts[0].b, 'Apps Script API：使えます', 'APIが使えるか出る');
has(alerts[0].b, '001-Code', 'ドライブの中身が出る');

reset([['001-Code.gs', 'あたらしい']]);
apiFail = { path: '/content', method: 'get', code: 403, msg: 'not enabled' };
F('menuUpdateStatus')();
has(alerts[0].b, '使えません', '使えないときもそう出る');
has(alerts[0].b, 'usersettings', '直し方も出る');

console.log('\n■ 読み元の選び方');
reset([['001-Code.gs', 'x']]);
t(F('updSource_')() === 'drive', '鍵が無ければドライブから読む');
props['GH_REPO'] = 'circlenine/test';
t(F('updSource_')() === 'drive', 'リポジトリだけではドライブのまま');
props['GH_TOKEN'] = 'github_pat_xxx';
t(F('updSource_')() === 'github', '両方そろえばGitHubから読む');

console.log('\n■ GitHubから読む');
reset([]);
props['GH_REPO'] = 'circlenine/test';
props['GH_TOKEN'] = 'github_pat_xxx';
props['GH_BRANCH'] = 'claude/gas-code-info-collection-e5mxw3';
props['GH_PATH'] = 'gas';
gh = {
  dir: [
    { name: '001-Code.gs',    path: 'gas/001-Code.gs',    type: 'file' },
    { name: '004-WebApp.gs',  path: 'gas/004-WebApp.gs',  type: 'file' },
    { name: 'appsscript.json', path: 'gas/appsscript.json', type: 'file' },
    { name: 'README.md',      path: 'gas/README.md',      type: 'file' },
    { name: 'parts',          path: 'gas/parts',          type: 'dir' }
  ],
  raw: {
    'gas/001-Code.gs': 'あたらしいコード',
    'gas/004-WebApp.gs': 'ページ',
    'gas/appsscript.json': '{"timeZone":"Asia/Tokyo"}'
  }
};
let g = F('updReadGitHub_')();
t(g.length === 3, '.gs と .json だけ読む（.md とフォルダは無視）');
t(g.filter(x => x.name === '001-Code')[0].source === 'あたらしいコード', '中身が取れる');
t(g.filter(x => x.name === 'appsscript')[0].type === 'JSON', 'appsscript は JSON 扱い');

console.log('\n■ GitHubから読んで更新する');
F('menuUpdateCode')();
t(lastPut() !== undefined, '書き込みが走った');
t(project.files.filter(f => f.name === '001-Code')[0].source === 'あたらしいコード',
  'GitHubの中身で入れ替わった');
t(drive['taxi-gas']._folders[0]._folders.length === 1,
  'GitHubから読むときも、書き換える前に保存する');

console.log('\n■ GitHubのエラー');
reset([]);
props['GH_REPO'] = 'circlenine/test'; props['GH_TOKEN'] = 'わるい鍵';
gh = { fail: { code: 401, msg: 'Bad credentials' } };
F('menuUpdateCode')();
t(lastPut() === undefined, '読めなければ書き込まない');
has(alerts[alerts.length - 1].b, '期限切れ', '鍵の問題だと分かる文言を出す');

reset([]);
props['GH_REPO'] = 'circlenine/test'; props['GH_TOKEN'] = 'x';
gh = { fail: { code: 404, msg: 'Not Found' } };
F('menuUpdateCode')();
has(alerts[alerts.length - 1].b, '置き場所が見つかりません', '404なら置き場所の話をする');
t(project.files.filter(f => f.name === '001-Code')[0].source === 'ふるい', 'コードは無傷');

console.log('\n■ 鍵はどこにも書き出さない');
reset([]);
props['GH_REPO'] = 'circlenine/test'; props['GH_TOKEN'] = 'github_pat_himitsu';
gh = { dir: [{ name: '001-Code.gs', path: 'gas/001-Code.gs', type: 'file' },
             { name: 'appsscript.json', path: 'gas/appsscript.json', type: 'file' }],
       raw: { 'gas/001-Code.gs': 'x', 'gas/appsscript.json': '{}' } };
F('menuUpdateStatus')();
t(alerts[0].b.indexOf('github_pat_himitsu') === -1, '状態画面に鍵を出さない');
has(alerts[0].b, '読み元：GitHub', '読み元は出す');
t(JSON.stringify(cells).indexOf('github_pat_himitsu') === -1, 'シートにも書かない');

console.log(ng ? '\n✗ ' + ng + '件 失敗\n' : '\n✓ すべて通りました\n');
process.exit(ng ? 1 : 0);
