/**
 * LineReport.gs の期間まわりを検証する（SpreadsheetApp には触れない）
 *   実行: node gas/test/linereport.test.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console };
vm.createContext(ctx);
const D = vm.runInContext('Date', ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-globals.js'), 'utf8'), ctx);
// LineReport.gs のうち、シートに触れない部分だけを取り出して読み込む
const src = fs.readFileSync(path.join(__dirname, '..', 'LineReport.gs'), 'utf8');
const from = src.indexOf('const LR_DOW');
const to = src.indexOf('/** 画面から呼ばれる。記録の一番古い営業日を調べて期間一覧を返す */');
vm.runInContext(src.slice(from, to), ctx);

let fail = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log('FAIL', msg, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); }
  else console.log('ok  ', msg);
};

/* ---- 16日起点の期間 ---- */
const ps = d => ctx.lrPeriodStart_(d);
eq(ctx.lrVal_(ps(new D(2026, 8, 1))),  '2026/8/16',  '9/1 は 8/16 開始の期に入る');
eq(ctx.lrVal_(ps(new D(2026, 7, 16))), '2026/8/16',  '8/16 ちょうどは その日が開始');
eq(ctx.lrVal_(ps(new D(2026, 7, 15))), '2026/7/16',  '8/15 はまだ前の期');
eq(ctx.lrVal_(ps(new D(2026, 0, 3))),  '2025/12/16', '1/3 は年をまたいで 12/16 開始');

/* ---- 表示の形 ---- */
// 2026/8/16 は日曜、9/1 は火曜
eq(ctx.lrFull_(new D(2026, 7, 16)), '2026/08/16(日)', 'プルダウン先頭は yyyy/MM/dd(曜)');
eq(ctx.lrShort_(new D(2026, 8, 1)),      '09/01(火)', '終わりは MM/dd(曜)');
eq(ctx.lrAlt_(new D(2026, 8, 1)),         '9/1(火)',  '裏メッセージは 0埋めなし');

/* ---- プルダウンの中身 ---- */
const today = new D(2026, 8, 1);          // 2026/9/1(火)
const list = ctx.lrPeriodsFrom_(new D(2025, 10, 22), today);   // 記録は 2025/11/22 から

eq(list[0].label, '2026/08/16(日) ～ 09/01(火)（今期）', '先頭は今期（16日〜今日）');
eq(list[0].value, '2026/8/16-2026/9/1',                 '  値は開始-終了');
eq(list[1].label, '2026/07/16(木) ～ 08/15(土)',        '2番目は 7/16〜8/15');
eq(list[1].value, '2026/7/16-2026/8/15',                '  値も 16日〜15日');

// 新しい → 古い の順に並んでいること
const starts = list.map(p => p.value.split('-')[0]);
const asDate = v => { const a = v.split('/').map(Number); return new D(a[0], a[1] - 1, a[2]).getTime(); };
eq(starts.every((v, i) => i === 0 || asDate(starts[i - 1]) > asDate(v)), true, '新しい→古い の順に並ぶ');

// 記録がある月まで作る（2025/11/16 が最後）
eq(list[list.length - 1].value.split('-')[0], '2025/11/16', '一番古い記録の期まで作って止まる');
eq(list.length, 10, '今期 + 過去9期 = 10個（2026年の7〜1月 と 2025年の12・11月）');

/* ---- 記録が無い / 少ないとき ---- */
eq(ctx.lrPeriodsFrom_(null, today).length, 1, '記録が無ければ今期だけ');
const one = ctx.lrPeriodsFrom_(new D(2026, 7, 20), today);
eq(one.length, 1, '記録が今期しか無ければ1個だけ');

/* ---- 年をまたぐ ---- */
const ny = ctx.lrPeriodsFrom_(new D(2025, 10, 1), new D(2026, 0, 5));  // 今日=2026/1/5
eq(ny[0].value, '2025/12/16-2026/1/5', '年をまたぐ今期も正しく作れる');
eq(ny[1].value, '2025/11/16-2025/12/15', '  その前は 11/16〜12/15');

/* ---- 裏メッセージの文面 ---- */
const alt = ctx.lrAlt_(new D(2026, 7, 16)) + "～" + ctx.lrAlt_(new D(2026, 8, 1)) + "レポート作成 byシバンニ";
eq(alt, '8/16(日)～9/1(火)レポート作成 byシバンニ', '裏メッセージの文面');
eq(alt.length <= 400, true, 'LINEの altText 上限400文字に収まる');

console.log(fail ? `\n${fail} 件失敗` : '\n全テスト通過');
process.exit(fail ? 1 : 0);
