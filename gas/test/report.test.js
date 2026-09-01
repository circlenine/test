/**
 * Report.gs の判定・集計ロジックを Node で検証する。
 * SpreadsheetApp に触れない純粋関数だけが対象。
 *   実行: node gas/test/report.test.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-globals.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Report.gs'), 'utf8'), ctx);
const K = function (expr) { return vm.runInContext(expr, ctx); };

let fail = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log('FAIL', msg, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); }
  else console.log('ok  ', msg);
};

/* ---- A列のオプチャ判定 ---- */
// 実データ(2026/09/01時点)では「ｵﾌﾟﾁｬ」表記の行は0件で、
// オプチャ由来は全てA列が空白のまま入っている。空白の判定が要。
eq(ctx.rp_isOpucha_(''), true, '空白はオプチャ扱い');
eq(ctx.rp_isOpucha_('   '), true, '空白のみもオプチャ扱い');
eq(ctx.rp_isOpucha_(null), true, 'null もオプチャ扱い');
eq(ctx.rp_isOpucha_('ｵﾌﾟﾁｬ'), true, '半角カナ ｵﾌﾟﾁｬ');
eq(ctx.rp_isOpucha_('オプチャ'), true, '全角 オプチャ');
eq(ctx.rp_isOpucha_('オープンチャット'), true, 'オープンチャット');
['ﾀﾞｲｽｹ', 'ｼｭﾝ', 'ｶｲﾄ', 'ｱﾅﾙ', 'ﾏｰｸ'].forEach(function (m) {
  eq(ctx.rp_isOpucha_(m), false, 'メンバー ' + m + ' は自社実績');
});

/* ---- 金額帯 ---- */
eq(ctx.rp_tierIndex_(44370), 0, '¥44,370 → 特大');
eq(ctx.rp_tierIndex_(20000), 0, '¥20,000ちょうど → 特大');
eq(ctx.rp_tierIndex_(19999), 1, '¥19,999 → 大物');
eq(ctx.rp_tierIndex_(10000), 1, '¥10,000ちょうど → 大物');
eq(ctx.rp_tierIndex_(9999), 2, '¥9,999 → 中');
eq(ctx.rp_tierIndex_(600), 3, '¥600 → 小');

/* ---- 乗り場のまとめ ---- */
// REPORT_MERGE_RULES は「1件しかない名前」だけを寄せる。
// 何度も出てくる正式な乗り場名を勝手に統合しないため。
const rows = [
  { place: 'ドン2三ツ寺', money: 10930, isOpucha: false },  // 1件 → ドン2へ寄る
  { place: 'ドン2',       money: 2000,  isOpucha: false },
  { place: 'ドン2',       money: 1500,  isOpucha: true  },
  { place: '新地7',       money: 1300,  isOpucha: false },
  { place: '新地7',       money: 900,   isOpucha: true  },
  { place: '天満',        money: 700,   isOpucha: false },
  { place: '天満',        money: 3600,  isOpucha: false },
];
const idx = ctx.rp_buildPlaceIndex_(rows);
eq(ctx.rp_placeOf_(idx, 'ドン2三ツ寺').name, 'ドン2', '1件だけの「ドン2三ツ寺」は「ドン2」へ寄る');
eq(ctx.rp_placeOf_(idx, '新地7').name, '新地7', '新地7 はそのまま');
eq(ctx.rp_placeOf_(idx, '天満').name, '天満', '複数件ある「天満」は寄せ先にならず据え置き');
eq(ctx.rp_placeOf_(idx, '').name, '(乗り場なし)', '乗り場が空でも落ちない');
// 表記ゆれ（半角カナ・乗り場サフィックス）が同じグループに入ること
eq(ctx.rp_placeOf_(idx, '新地７').key, ctx.rp_placeOf_(idx, '新地7').key, '全角数字の新地７も同じグループ');

/* ---- 統計 ---- */
const stat = ctx.rp_statLine_('テスト', [
  { money: 1000 }, { money: 3000 }, { money: 5000 }, { money: 11000 },
]);
eq(stat[1], 4, '件数');
eq(stat[2], 20000, '売上合計');
eq(stat[3], 5000, '平均売上');
eq(stat[4], 4000, '中央値（偶数件は中2つの平均）');
eq(stat[5], 11000, '最高額');
eq(stat[6], 1, '大物件数（¥10,000以上）');
eq(stat[7], 0.25, '大物率');

/* ---- 2セクションの母集団が分かれていること ---- */
const mixed = [
  { who: 'ﾀﾞｲｽｹ', money: 3000,  isOpucha: false },
  { who: 'ﾏｰｸ',   money: 5000,  isOpucha: false },
  { who: '',      money: 44000, isOpucha: true  },  // 空白=オプチャ。平均に混ざると壊れる
];
const own = mixed.filter(r => !r.isOpucha);
eq(ctx.rp_statLine_('自社', own)[3], 4000, '自社実績の平均 = ¥4,000（オプチャ¥44,000は除外）');
eq(ctx.rp_statLine_('全件', mixed)[3], 17333.333333333332, '（参考）オプチャ込みだと¥17,333に膨らむ');
eq(mixed.length, 3, '大物マップは全3件が母集団');

console.log(fail ? `\n${fail} 件失敗` : '\n全テスト通過');
process.exit(fail ? 1 : 0);
