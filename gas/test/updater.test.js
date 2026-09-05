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
  flush: () => {},
  ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
  newDataValidation: () => ({ requireCheckbox: () => ({ build: () => ({}) }) }),
  getActiveSpreadsheet: () => ({
    toast: (m, t) => toasts.push({ t: t, m: m }),
    getSheetByName: n => (n === '説明') ? panel : null,
    insertSheet: () => (panel = mkPanel())
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
ctx.ScriptApp = { getOAuthToken: () => 'tok', getScriptId: () => 'SID',
  getProjectTriggers: () => triggers,
  deleteTrigger: t => { triggers = triggers.filter(x => x !== t); },
  newTrigger: fn => {
    const b = { _fn: fn, _kind: '' };
    const api = {
      forSpreadsheet: () => api, onEdit: () => { b._kind = 'edit'; return api; },
      timeBased: () => api, everyMinutes: () => { b._kind = 'min'; return api; },
      create: () => { triggers.push({ getHandlerFunction: () => b._fn, _kind: b._kind });
                      return b; }
    };
    return api;
  }};
let triggers = [];
ctx.LockService = { getScriptLock: () => ({ tryLock: () => lockFree,
  releaseLock() {}, waitLock() {} }) };
let lockFree = true;
ctx.logErr_ = (w, e) => { errs.push(w + ':' + (e && e.message ? e.message : e)); };
const errs = [];
// 「説明」タブの偽物（パネルはこの中の8行目から下に置かれる）
let panel;
function mkPanel() {
  const cells = {};
  const prot = [];
  let protFails = false;
  return {
    _cells: cells,
    _prot: prot,
    _failProtect: v => { protFails = v; },
    getProtections: () => prot.slice(),

    getName: () => '説明',
    getMaxRows: () => 100,
    insertRowsAfter: () => {},
    clear: () => { throw new Error('説明タブを clear してはいけません'); },
    setFrozenRows: () => {}, setRowHeight: () => {}, setRowHeights: () => {},
    setColumnWidth() { return this; },
    insertCheckboxes() { return this; },
    getRange: (r, c, nr, nc) => {
      // getRange("Y5") のような呼び方にも応える
      if (typeof r === 'string') {
        const key = r;
        const S = { setValue: v => { cells[key] = String(v); return S; },
                    getValue: () => cells[key] };
        return new Proxy(S, { get: (t, k) => (k in t ? t[k] : () => S) });
      }
      let px;
      const R = {
        getA1Notation: () => 'A' + r + ':A' + (r + (nr || 1) - 1),
        protect: () => {
          if (protFails) throw new Error('保護できません');
          const p = {
            _a1: 'A' + r + ':A' + (r + (nr || 1) - 1),
            _editors: ['tomodachi@example.com', 'stranger@example.com'],
            _domain: true,
            setDescription() { return p; },
            getRange: () => ({ getA1Notation: () => p._a1 }),
            getEditors: () => p._editors.slice(),
            removeEditors: list => {
              p._editors = p._editors.filter(e => list.indexOf(e) === -1); },
            canDomainEdit: () => p._domain,
            setDomainEdit: v => { p._domain = v; },
            canEdit: () => true,
            remove: () => { const i = prot.indexOf(p); if (i >= 0) prot.splice(i, 1); }
          };
          prot.push(p);
          return p;
        },
        setValue: v => { cells[r + ',' + c] = v; return px; },
        getValue: () => cells[r + ',' + c],
        getValues: () => {
          const out = [];
          for (let i = 0; i < (nr || 1); i++) {
            const row = [];
            for (let j = 0; j < (nc || 1); j++) {
              const v = cells[(r + i) + ',' + (c + j)];
              row.push(v === undefined ? '' : v);
            }
            out.push(row);
          }
          return out;
        },
        setValues: v => { v.forEach((vr, i) => vr.forEach((vv, j) => {
          cells[(r + i) + ',' + (c + j)] = vv; })); return px; }
      };
      // 知らないメソッドを呼ばれても、つないで呼べるように自分（Proxy）を返す
      px = new Proxy(R, { get: (t, k) => (k in t ? t[k] : () => px) });
      return px;
    }
  };
}

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
  gh = null; triggers = []; lockFree = true; errs.length = 0;
  panel = mkPanel();          // 「説明」タブは最初からある
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
has(panel._cells['Z5'], '更新しました', '説明タブZ5にも残る');

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
t(JSON.stringify(panel._cells).indexOf('github_pat_himitsu') === -1, 'シートにも書かない');

console.log('\n■ そうさタブ（スマホアプリ用のボタン）');
reset([['001-Code.gs', 'あたらしい']]);
F('menuMakePanel')();
t(String(panel._cells['8,2']) === '▼ チェックを入れると動きます（終わると自動で外れます）',
  '説明タブの8行目に見出しが入る');
let items = F('panelItems_')();
// このテストでは 005-Updater しか読み込んでいないので、
// 004-WebApp や 001-Code の機能は出てこないのが正しい
t(items.length === 3, '入っている機能だけ並ぶ（' + items.length + '個）');
t(items[0].fn === 'menuUpdateCode', '1つめは「コードを更新する」');
t(items.every(x => F('panelHas_')(x.fn)), '並んだものは全部呼べる');
t(items.every(x => x.fn !== 'menuFormatAll'), '入れていない機能は出さない');
vm.runInContext('function menuFormatAll(){}', ctx);   // あとから足したことにする
items = F('panelItems_')();
t(items.length === 4, '足せば並ぶ');
t(items.some(x => x.fn === 'menuFormatAll'), '足したものが出る');
vm.runInContext('menuFormatAll = undefined', ctx);
t(F('panelHas_')('menuUpdateCode') === true, 'ある関数は true');
t(F('panelHas_')('そんな関数はない') === false, '無い関数は false');

console.log('\n■ 見張りのしくみが入る');
t(triggers.filter(x => x.getHandlerFunction() === 'panelOnEdit').length === 1,
  'チェックした瞬間に動くトリガー');
t(triggers.filter(x => x.getHandlerFunction() === 'panelWatch').length === 1,
  '1分おきの見張り');
F('menuMakePanel')();
t(triggers.filter(x => x.getHandlerFunction() === 'panelWatch').length === 1,
  '作り直しても二重にならない');
F('menuPanelWatchOff')();
t(triggers.filter(x => x.getHandlerFunction() === 'panelWatch').length === 0,
  '見張りだけ止められる');
t(triggers.filter(x => x.getHandlerFunction() === 'panelOnEdit').length === 1,
  'onEdit のほうは残る');

console.log('\n■ チェックすると動く');
reset([['001-Code.gs', 'あたらしい']]);
F('menuMakePanel')();
const TOP = 9;   // 見出しが8行目、ボタンは9行目から
panel._cells[TOP + ',1'] = true;                       // 1行目＝コードを更新する
F('panelOnEdit')({ range: { getSheet: () => panel, getColumn: () => 1,
                            getRow: () => TOP }, value: 'TRUE' });
t(panel._cells[TOP + ',1'] === false, '終わったらチェックが外れる');
t(lastPut() !== undefined, '更新が実際に走った');
const resRow = TOP + F('panelItems_')().length + 2;
has(panel._cells[resRow + ',2'], '✅', '結果らんに出る');
has(panel._cells[resRow + ',2'], 'コードを更新する', 'どれを動かしたか分かる');

console.log('\n■ チェックを外したときは動かない');
reset([['001-Code.gs', 'あたらしい']]);
F('menuMakePanel')();
F('panelOnEdit')({ range: { getSheet: () => panel, getColumn: () => 1,
                            getRow: () => TOP }, value: 'FALSE' });
t(lastPut() === undefined, '外したときは何もしない');

console.log('\n■ 関係ない場所を触っても動かない');
reset([['001-Code.gs', 'あたらしい']]);
F('menuMakePanel')();
F('panelOnEdit')({ range: { getSheet: () => panel, getColumn: () => 2,
                            getRow: () => TOP }, value: 'TRUE' });
t(lastPut() === undefined, 'B列を触っても動かない');
F('panelOnEdit')({ range: { getSheet: () => ({ getName: () => 'ﾀﾞｲｽｹ' }),
                            getColumn: () => 1, getRow: () => TOP }, value: 'TRUE' });
t(lastPut() === undefined, '別のタブなら動かない');
F('panelOnEdit')({});
F('panelOnEdit')(null);
t(errs.length === 0, '変な呼ばれ方をしても落ちない');

console.log('\n■ 1分おきの見張りでも動く（アプリでonEditが効かないとき用）');
reset([['001-Code.gs', 'あたらしい']]);
F('menuMakePanel')();
panel._cells[TOP + ',1'] = true;
F('panelWatch')();
t(lastPut() !== undefined, '見張りが拾って動かす');
t(panel._cells[TOP + ',1'] === false, 'チェックも外れる');

reset([['001-Code.gs', 'あたらしい']]);
F('menuMakePanel')();
F('panelWatch')();
t(lastPut() === undefined, 'チェックが無ければ何もしない');

console.log('\n■ 二重に動かない');
reset([['001-Code.gs', 'あたらしい']]);
F('menuMakePanel')();
panel._cells[TOP + ',1'] = true;
lockFree = false;                                   // すでに誰かが動かしている
F('panelWatch')();
t(lastPut() === undefined, '鍵が取れなければ動かさない');
t(panel._cells[TOP + ',1'] === true, 'チェックも外さない（あとで拾えるように）');

console.log('\n■ 失敗しても結果が残る');
reset([]);                                          // ドライブに何も無い状態
F('menuMakePanel')();
panel._cells[TOP + ',1'] = true;
F('panelWatch')();
t(panel._cells[TOP + ',1'] === false, 'チェックは外れる（押しっぱなしにならない）');
has(panel._cells[resRow + ',2'], '✅', '処理自体は最後まで通る');

console.log('\n■ 8行目より上は絶対に触らない');
reset([['001-Code.gs', 'あたらしい']]);
// 説明タブに、もともと入っているものを置いておく
panel._cells['1,1'] = 'このシートの説明';
panel._cells['2,2'] = '大事なメモ';
panel._cells['6,1'] = '6行目のなにか';
panel._cells['Z1'] = 'Cgroup123';
panel._cells['Z2'] = 'dashboardId';
F('menuMakePanel')();
t(panel._cells['1,1'] === 'このシートの説明', '1行目はそのまま');
t(panel._cells['2,2'] === '大事なメモ', '2行目はそのまま');
t(panel._cells['6,1'] === '6行目のなにか', '6行目はそのまま');
t(panel._cells['Z1'] === 'Cgroup123', 'Z1（グループID）はそのまま');
t(panel._cells['Z2'] === 'dashboardId', 'Z2（ダッシュボード）はそのまま');
t(panel._cells['7,1'] === undefined, '7行目は空のまま');
t(String(panel._cells['8,2']).indexOf('チェックを入れると') !== -1, '8行目に見出し');
t(String(panel._cells['9,2']).indexOf('コードを更新') !== -1, '9行目から1つめのボタン');

console.log('\n■ 置き場所に何か入っていたら、上書きせずに止める');
reset([['001-Code.gs', 'あたらしい']]);
panel._cells['10,2'] = '消されたら困るもの';
F('menuMakePanel')();
t(panel._cells['10,2'] === '消されたら困るもの', '中身を消していない');
t(panel._cells['8,2'] === undefined, '見出しも書いていない（何も書かずに止めた）');
has(alerts[alerts.length - 1].t, '置けませんでした', 'そう伝える');
has(alerts[alerts.length - 1].b, '10行目', 'どこに何があったか教える');
has(alerts[alerts.length - 1].b, '消されたら困るもの', '中身も見せる');
t(triggers.length === 0, '止めたときはトリガーも作らない');

console.log('\n■ 2回目からは、自分が置いたものとして上書きしてよい');
reset([['001-Code.gs', 'あたらしい']]);
F('menuMakePanel')();
const firstHead = panel._cells['8,2'];
F('menuMakePanel')();
t(panel._cells['8,2'] === firstHead, '2回目も普通に置き直せる');
has(alerts[alerts.length - 1].t, 'ボタンを置きました', '止まらない');

console.log('\n■ 説明タブを clear しない');
reset([['001-Code.gs', 'あたらしい']]);
panel._cells['3,1'] = 'きえたら困る';
F('menuMakePanel')();
t(panel._cells['3,1'] === 'きえたら困る', 'clear していない（していたら例外で落ちる作りにしてある）');

console.log('\n■ チェックのらんだけを自分だけが押せるようにする');
reset([['001-Code.gs', 'あたらしい']]);
F('menuMakePanel')();
t(panel._prot.length === 1, '保護がかかる');
t(panel._prot[0]._a1 === 'A9:A11', 'チェックのらんだけを守る（説明タブ全体ではない）');
t(panel._prot[0]._editors.length === 0, 'ほかの編集者は外される（＝自分だけ）');
t(panel._prot[0]._domain === false, '同じドメインの人もまとめて外す');
has(alerts[alerts.length - 1].b, 'あなただけが触れるように', 'そう伝える');
t(F('panelIsProtected_')(panel) === true, '保護されていると分かる');

console.log('\n■ 作り直しても保護が二重にならない');
F('menuMakePanel')();
t(panel._prot.length === 1, '保護は1つのまま');

console.log('\n■ 保護をかけられなかったときは、はっきり言う');
reset([['001-Code.gs', 'あたらしい']]);
panel._failProtect(true);
F('menuMakePanel')();
has(alerts[alerts.length - 1].b, '保護をかけられませんでした', '黙って済ませない');
has(alerts[alerts.length - 1].b, '誰でもチェックを押せます', '何が起きるか書く');
t(F('panelIsProtected_')(panel) === false, '保護なしと分かる');

console.log(ng ? '\n✗ ' + ng + '件 失敗\n' : '\n✓ すべて通りました\n');
process.exit(ng ? 1 : 0);
