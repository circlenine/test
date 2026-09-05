/**
 * Opucha.gs（オプチャ印）と、Strategy.gs との連動を検証する。
 *   実行: node gas/test/opucha.test.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console };
vm.createContext(ctx);
const CtxDate = vm.runInContext('Date', ctx);

function row(who, y, m, d, time, money, place, other) {
  const r = new Array(11).fill('');
  r[0] = who; r[1] = new CtxDate(y, m - 1, d, 12, 0, 0);
  r[4] = time; r[5] = money; r[6] = place; r[8] = other || '';
  return r;
}
// 書き込みも受け付ける偽シート
function sheet(rows) {
  return {
    _rows: rows,
    getLastRow: () => 3 + rows.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 4, r - 4 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
      setValue: v => { rows[r - 4][c - 1] = v; }
    })
  };
}
const TABS = {
  'ﾀﾞｲｽｹ': [
    row('ﾀﾞｲｽｹ', 2026, 8, 3, '23:10', 12000, '新地4'),
    row('',       2026, 8, 4, '01:00',  4000, '天満'),          // LINE連携前=自社
    row('ﾀﾞｲｽｹ', 2026, 8, 5, '22:00', 18000, '夕陽丘', '関空'), // LINEで送ったオプチャ情報
  ],
  'ｼｭﾝ': [], 'ｶｲﾄ': [], 'ｱﾅﾙ': [], 'ﾏｰｸ': [],
  '北4':  [ row('ﾀﾞｲｽｹ', 2026, 8, 3, '23:10', 12000, '新地4') ],  // 写し
  '北他': [ row('',       2026, 8, 4, '01:00',  4000, '天満') ],    // 写し
  '関空': [ row('ﾀﾞｲｽｹ', 2026, 8, 5, '22:00', 18000, '夕陽丘', '関空') ],
  '北7': [], 'ﾐﾅﾐ': [], 'ほか': [], 'ﾊﾞﾗｼ': []
};
const props = {};
ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: n => TABS[n] ? sheet(TABS[n]) : null }) };
ctx.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in props ? props[k] : null),
  setProperty: (k, v) => { props[k] = v; }
}) };
vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-globals.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'parts', 'Opucha.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'parts', 'Strategy.gs'), 'utf8'), ctx);
const reset = () => vm.runInContext('_opuCache = null;', ctx);

let fail = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log('FAIL', msg, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); }
  else console.log('ok  ', msg);
};

/* ---- 乗車のまとめ ---- */
let all = ctx.opuCollect_();
eq(all.length, 3, '生6行 → 乗車3件にまとまる（写しを1件に畳む）');
const yu = all.find(x => x.place === '夕陽丘');
eq(yu.tabs.slice().sort(), ['関空', 'ﾀﾞｲｽｹ'], '夕陽丘は個人タブと関空タブの両方にある');
eq(all.every(x => !x.isOpucha), true, '印を付ける前は、全件が自社あつかい');

/* ---- 検索 ---- */
const F = c => ctx.opuFilter_(ctx.opuCollect_(), c);
eq(F({ word: '夕陽丘' }).length, 1, '乗り場名で検索できる');
eq(F({ word: '関空' }).length, 1, 'そのほか(I列)の語でも検索できる');
eq(F({ word: '夕陽丘 関空' }).length, 1, '空白区切りはAND');
eq(F({ word: '夕陽丘 新地4' }).length, 0, '両方は満たさないので0件');
eq(F({ minMoney: 10000 }).length, 2, '金額の下限で絞れる');
eq(F({ minMoney: 10000, maxMoney: 15000 }).length, 1, '上限でも絞れる');
eq(F({ tab: '関空' }).length, 1, 'タブで絞れる');
eq(F({ from: '2026-08-05' }).length, 1, '日付の開始で絞れる');
eq(F({ word: 'ゆうひがおか' }).length, 0, '読みでは引っかからない（表記そのままで検索する）');

/* ---- 印を付ける ---- */
let r = ctx.opuApply_([yu.key], []);
eq(r.marked, 1, '1件にオプチャ印を付けた');
eq(r.cells, 2, 'A列を2セル書き換えた（個人タブ＋関空タブ）');
eq(TABS['ﾀﾞｲｽｹ'][2][0], 'ｵﾌﾟﾁｬ', '個人タブのA列が「ｵﾌﾟﾁｬ」になった');
eq(TABS['関空'][0][0], 'ｵﾌﾟﾁｬ', '関空タブのA列も「ｵﾌﾟﾁｬ」になった');
eq(JSON.parse(props['OPUCHA_MARKS'])[yu.key], 'ﾀﾞｲｽｹ', '元のA列の値を覚えている');

reset();
all = ctx.opuCollect_();
eq(all.find(x => x.place === '夕陽丘').isOpucha, true, '再読み込みしてもオプチャのまま');
eq(all.filter(x => x.isOpucha).length, 1, 'オプチャは1件だけ');

/* ---- Strategy.gs が印を見ている ---- */
let S = ctx.buildStrategy(null, null);
eq(S.hasMark, true, 'Strategy が Opucha.gs の印を使っている');
eq(S.opu.length, 1, '  オプチャ1件');
eq(S.own.length, 2, '  自社2件（A列が空の天満も自社のまま）');
eq(S.opu[0].place, '夕陽丘', '  オプチャは夕陽丘');
const lm = S.longMap.find(x => x.place === '夕陽丘');
eq([lm.opuLong, lm.ownLong], [1, 0], '  ロングマップで夕陽丘はオプチャ側に計上される');

/* ---- 印を外すと元に戻る ---- */
reset();
r = ctx.opuApply_([], [yu.key]);
eq(r.unmarked, 1, '1件の印を外した');
eq(TABS['ﾀﾞｲｽｹ'][2][0], 'ﾀﾞｲｽｹ', 'A列が元の「ﾀﾞｲｽｹ」に戻った');
eq(TABS['関空'][0][0], 'ﾀﾞｲｽｹ', '関空タブのA列も戻った');
eq(Object.keys(JSON.parse(props['OPUCHA_MARKS'])).length, 0, '印の保存も空になった');

reset();
S = ctx.buildStrategy(null, null);
eq(S.opu.length, 0, 'Strategy 側もオプチャ0件に戻る');

/* ---- A列が直接「ｵﾌﾟﾁｬ」でも拾う ---- */
TABS['ｼｭﾝ'].push(row('ｵﾌﾟﾁｬ', 2026, 8, 9, '20:00', 30000, '関空直行'));
reset();
eq(ctx.opuCollect_().find(x => x.place === '関空直行').isOpucha, true,
   'A列に直接「ｵﾌﾟﾁｬ」と書かれていてもオプチャと判定する');

console.log(fail ? `\n${fail} 件失敗` : '\n全テスト通過');
process.exit(fail ? 1 : 0);
