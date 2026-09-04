/**
 * C008ver で足した「スクショ取込」まわりを検証する。
 *   実行: node gas/test/opucha-image.test.js
 *
 * Code.gs をそのまま vm に流し込み、GAS のサービスは偽物で差し替える。
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ctx = { console };
vm.createContext(ctx);
const CtxDate = vm.runInContext('Date', ctx);

/* ---- 偽のシート（書き込みを覚えておく） ---- */
const written = {};      // タブ名 → 書かれた行の配列
function makeSheet(name, rows) {
  return {
    getName: () => name,
    getLastRow: () => 3 + rows.length,
    getMaxRows: () => 1000,
    insertRowsAfter: () => {},
    getRange: () => chain(name, rows),
    getRangeList: () => chain(name, rows),
    setRowHeights: () => {}, setRowHeightsForced: () => {},
    autoResizeColumns: () => {}, setColumnWidth: () => {},
    deleteRows: () => {}, insertRowsBefore: () => {}, sort: () => {},
    getFrozenRows: () => 3, setFrozenRows: () => {},
    getDataRange: () => chain(name, rows)
  };
}
// 呼ばれても困らないよう、何を呼んでも自分を返す偽の Range
function chain(name, rows) {
  const r = {
    getValues: () => rows.map(x => x.slice()),
    getValue: () => '',
    getDisplayValues: () => rows.map(x => x.map(String)),
    getNumRows: () => rows.length,
    getLastRow: () => 3 + rows.length,
    setValues: v => { written[name] = (written[name] || []).concat(v); }
  };
  return new Proxy(r, { get: (t, k) => (k in t ? t[k] : () => r) });
}
let TABS = {};
function resetSheets(preset) {
  TABS = {};
  ["ﾀﾞｲｽｹ","ｼｭﾝ","ｶｲﾄ","ｱﾅﾙ","ﾏｰｸ","北7","北4","北他","ﾐﾅﾐ","ほか","関空","ﾊﾞﾗｼ","説明"]
    .forEach(n => { TABS[n] = (preset && preset[n]) || []; });
  Object.keys(written).forEach(k => delete written[k]);
}
resetSheets();

ctx.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getSheetByName: n => TABS[n] ? makeSheet(n, TABS[n]) : null,
    toast: () => {}
  }),
  BorderStyle: { SOLID: 'SOLID' },
  WrapStrategy: { CLIP: 'CLIP', WRAP: 'WRAP' },
  getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; },
                                       addSubMenu() { return this; }, addToUi() {} }) })
};

/* ---- 偽のキャッシュ／ロック／プロパティ ---- */
const cacheStore = {};
ctx.CacheService = { getScriptCache: () => ({
  get: k => (k in cacheStore ? cacheStore[k] : null),
  put: (k, v) => { cacheStore[k] = String(v); },
  remove: k => { delete cacheStore[k]; }
})};
ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
const propStore = { LINE_ACCESS_TOKEN: 'dummy' };
ctx.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in propStore ? propStore[k] : null),
  setProperty: (k, v) => { propStore[k] = v; },
  deleteProperty: k => { delete propStore[k]; }
})};
ctx.Utilities = {
  base64Encode: () => 'BASE64',
  formatDate: (d, tz, f) => String(d),
  sleep: () => {}
};

/* ---- 偽の UrlFetchApp（プロフィール取得と返信を記録する） ---- */
const sent = [];        // 送った返信の本文
let profileName = 'ダイスケ';
let profileCode = 200;
ctx.UrlFetchApp = { fetch: (url, opt) => {
  if (url.indexOf('/message/reply') !== -1) {
    sent.push(JSON.parse(opt.payload).messages[0].text);
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  }
  if (url.indexOf('/profile/') !== -1 || url.indexOf('/member/') !== -1) {
    return { getResponseCode: () => profileCode,
             getContentText: () => JSON.stringify({ displayName: profileName }) };
  }
  throw new Error('未対応のURL: ' + url);
}};

/* ---- Code.gs を読み込む ---- */
const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
vm.runInContext(src, ctx, { filename: 'Code.gs' });

/* ---- ここから検証 ---- */
// function 宣言も vm の中で解決してから使う
const F = n => vm.runInContext(n, ctx);
let ng = 0;
function ok(cond, label) {
  console.log((cond ? '  ok   ' : '  NG   ') + label);
  if (!cond) ng++;
}
function has(s, needle, label) { ok(String(s).indexOf(needle) !== -1, label + '  … 実際: ' + JSON.stringify(String(s).slice(0, 160))); }

console.log('\n■ 取込の時間帯は 17:00〜翌05:15');
// const は ctx に生えないので、中で評価して取り出す
const K = n => vm.runInContext(n, ctx);
ok(K('OPUCHA_FROM_MIN') === 17 * 60, 'OPUCHA_FROM_MIN = 17:00');
ok(K('OPUCHA_TO_MIN') === 5 * 60 + 15, 'OPUCHA_TO_MIN = 翌05:15');
ok(K('OPUCHA_HOURS_TEXT') === '17:00〜翌05:15（29:15）', '文面用の時間帯も同じ');

console.log('\n■ 時間外は「乗車不可な時間」として理由付きで落とす');
resetSheets();
let r = F('writeOpuchaRecords_')([
  { time: '16:59', money: 12000, place: '新地4' },   // 17時より前 → 対象外
  { time: '05:16', money: 12000, place: '新地4' },   // 05:15より後 → 対象外
  { time: '29:15', money: 12000, place: '新地4' },   // = 05:15 ちょうど → 入る
  { time: '17:00', money: 12000, place: '新地7' }    // ちょうど17:00 → 入る
], 'MID1', new CtxDate(2026, 8, 3));
ok(r.wrote === 2, '境目ちょうどの2件だけ取り込む（実際 ' + r.wrote + '件）');
ok(r.skipped.length === 2, '落としたのは2件（実際 ' + r.skipped.length + '件）');
has(r.skipped[0], '私たちでは乗車不可な時間のため、除外します', '16:59 の理由に指定の文言が入る');
has(r.skipped[0], '17:00〜翌05:15', '理由に時間帯そのものが書いてある');
has(r.skipped[1], '05:16', 'どの行のことか分かる目印が付く');

console.log('\n■ そのほかの不備も、理由を具体的に返す');
resetSheets();
r = F('writeOpuchaRecords_')([
  { time: '23:00', money: 500,   place: '新地4' },
  { time: '',      money: 12000, place: '新地4' },
  { time: '23:00', money: 'あ',  place: '新地4' },
  { time: '23:00', money: 12000, place: '' },
  { time: '23:00', money: 12000, place: '新地4', note: 'DiDi' }
], 'MID2', new CtxDate(2026, 8, 3));
ok(r.wrote === 0, '5件とも取り込まれない');
has(r.skipped[0], '￥1,000未満',     '金額が下限割れ');
has(r.skipped[1], '乗車時刻が読み取れません', '時刻なし');
has(r.skipped[2], '金額が読み取れません',     '金額なし');
has(r.skipped[3], '乗り場が読み取れません',   '乗り場なし');
has(r.skipped[4], 'DiDi・連続配車',           'DiDi は対象外');

console.log('\n■ 同じ内容は二重に登録しない');
resetSheets();
const dup = new Array(11).fill('');
dup[K('C_DATE') - 1] = new CtxDate(2026, 8, 3, 12, 0, 0);
dup[K('C_TIME') - 1] = '23:00';
dup[K('C_MONEY') - 1] = 12000;
resetSheets({ '北4': [dup] });
r = F('writeOpuchaRecords_')([{ time: '23:00', money: 12000, place: '新地4' }],
                            'MID3', new CtxDate(2026, 8, 3));
ok(r.wrote === 0, 'すでにある行は足さない');
has(r.skipped[0], 'すでに登録されています', '重複だと分かる理由が返る');

console.log('\n■ 返信の文面');
ok(F('opuchaReplyText_')('ダイスケ', [{ idx: 1, ok: 2, ng: [] }], 1) === '',
   '1枚で全部通ったときは何も返さない');
let t = F('opuchaReplyText_')('ダイスケ', [{ idx: 1, ok: 1, ng: [] }, { idx: 2, ok: 2, ng: [] }], 2);
has(t, 'ダイスケ様', '連投で全部通ったら名前つきで件数を返す');
has(t, 'スクショ2枚', '何枚だったかを書く');

t = F('opuchaReplyText_')('ダイスケ', [
  { idx: 1, ok: 1, ng: [] },
  { idx: 2, ok: 0, read: 1, ng: ['16:59 ￥12,000 新地4 → 乗車時刻が 17:00〜翌05:15（29:15） の外です。私たちでは乗車不可な時間のため、除外します'] }
], 2);
has(t, 'ダイスケ様データは', '「〇〇様データは」の形になっている');
has(t, 'レポート作成に不十分と判断', '指定の言い回しが入っている');
has(t, '【2枚目】', '何枚目がダメだったか分かる');
has(t, '乗車不可な時間', '何がダメだったかまで書いてある');
has(t, 'ほか1件は取り込みました', '通ったぶんも伝える');

t = F('opuchaReplyText_')('', [{ idx: 1, ok: 0, ng: ['乗り場が読み取れません'] }], 1);
has(t, 'いただいたデータは', '名前が取れなくても文が崩れない');
ok(t.indexOf('様') === -1, '名前が無いときに「様」だけ残らない');

console.log('\n■ 連投（imageSet）は全部そろってから1回だけ返す');
sent.length = 0;
const set = { id: 'SET1', total: 3 };
F('opuchaReplyBurst_')('rt1', 'ダイスケ', { idx: 1, ok: 0, ng: ['乗り場が読み取れません'] }, set, 3);
ok(sent.length === 0, '1枚目では返信しない');
F('opuchaReplyBurst_')('rt2', 'ダイスケ', { idx: 2, ok: 1, ng: [] }, set, 3);
ok(sent.length === 0, '2枚目でも返信しない');
F('opuchaReplyBurst_')('rt3', 'ダイスケ', { idx: 3, ok: 0, ng: ['金額が読み取れません'] }, set, 3);
ok(sent.length === 1, '3枚目でまとめて1回だけ返信する');
has(sent[0], '【1枚目】', '1枚目の不備が入っている');
has(sent[0], '【3枚目】', '3枚目の不備が入っている');
ok(sent[0].indexOf('【2枚目】') === -1, '通った2枚目は不備欄に出さない');

console.log('\n■ imageSet が無い連投は、同じ人の連続送信として数える');
Object.keys(cacheStore).forEach(k => delete cacheStore[k]);
const ev = { source: { type: 'group', groupId: 'G1', userId: 'U1' } };
ok(F('opuchaBurstSeq_')(ev) === 1, '1枚目');
ok(F('opuchaBurstSeq_')(ev) === 2, '2枚目');
ok(F('opuchaBurstSeq_')({ source: { type: 'group', groupId: 'G1', userId: 'U2' } }) === 1,
   '別の人は別に数える');

console.log('\n■ アイコン名（表示名）の取得');
profileName = 'やましき';
ok(F('opuchaSenderName_')({ source: { type: 'group', groupId: 'G1', userId: 'U1' } }) === 'やましき',
   'グループならメンバープロフィールから取る');
ok(F('opuchaSenderName_')({ source: { type: 'user', userId: 'U1' } }) === 'やましき',
   '1対1でも取れる');
profileCode = 404;
ok(F('opuchaSenderName_')({ source: { type: 'user', userId: 'Ued4659890c83b3b0bcf2a3f8bf008e7f' } }) === 'ﾀﾞｲｽｹ',
   '取れなければ登録済みのタブ名を使う');
ok(F('opuchaSenderName_')({ source: { type: 'user', userId: 'Uxxxx' } }) === '',
   '知らない人なら空文字（文面は「いただいたデータは」になる）');
ok(F('opuchaSenderName_')({ source: {} }) === '', 'userId が無くても落ちない');
profileCode = 200;

console.log('\n■ 空文字を lineReply_ に渡しても送らない');
sent.length = 0;
F('lineReply_')('rt', '');
F('lineReply_')('rt', '   ');
ok(sent.length === 0, '中身が無ければ通知しない');

console.log('\n■ スクショ1枚に乗車記録が2件以上写っていても全部拾う');
resetSheets();
r = F('writeOpuchaRecords_')([
  { time: '22:10', money: 12000, place: '新地4' },
  { time: '23:40', money:  8000, place: '新地7' },
  { time: '01:20', money:  3000, place: 'ドン2' },
  { time: '16:00', money: 15000, place: '新地4' }   // 時間外
], 'MID4', new CtxDate(2026, 8, 3));
ok(r.wrote === 3, '1枚から3件とも書き込む（実際 ' + r.wrote + '件）');
ok(r.skipped.length === 1, '時間外の1件だけ落ちる');
has(r.skipped[0], '16:00', '落ちたのがどれかは時刻で分かる');

console.log('\n■ 1枚に複数件あったときは「何件中の何件が不備か」を書く');
t = F('opuchaReplyText_')('ダイスケ',
  [{ idx: 1, read: 4, ok: 3, ng: ['16:00 ￥15,000 新地4 → 乗車時刻が 17:00〜翌05:15（29:15） の外です。私たちでは乗車不可な時間のため、除外します'] }], 1);
has(t, '読み取れた4件のうち1件が不備です', '何件中の何件かが分かる');
has(t, 'ほか3件は取り込みました', '通ったぶんの件数も出る');
t = F('opuchaReplyText_')('ダイスケ', [{ idx: 1, read: 1, ok: 0, ng: ['乗り場が読み取れません'] }], 1);
ok(t.indexOf('のうち') === -1, '1件だけのときは件数の但し書きを付けない');

console.log('\n■ imageSet が無い連投でも「〇枚目」と書く');
t = F('opuchaReplyText_')('ダイスケ', [{ idx: 2, ok: 0, ng: ['乗り場が読み取れません'] }], 1);
has(t, '【2枚目】', '2枚目だと分かる');
t = F('opuchaReplyText_')('ダイスケ', [{ idx: 1, ok: 0, ng: ['乗り場が読み取れません'] }], 1);
has(t, '【このスクショ】', '1枚目なら「このスクショ」のまま');

console.log(ng ? '\n✗ ' + ng + '件 失敗\n' : '\n✓ すべて通りました\n');
process.exit(ng ? 1 : 0);
