/**
 * ChartFit.gs の計算部分を検証する（SpreadsheetApp には触れない）
 *   実行: node gas/test/chartfit.test.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-globals.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ChartFit.gs'), 'utf8'), ctx);
const K = e => vm.runInContext(e, ctx);

let fail = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log('FAIL', msg, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); }
  else console.log('ok  ', msg);
};

const MIN = K('CF_MIN_HEIGHT'), MAX = K('CF_MAX_HEIGHT'), RATIO = K('CF_RATIO');

/* ---- 高さの決まり方 ---- */
eq(ctx.cfHeightFor_(1000), Math.round(1000 * RATIO), '幅1000px → 比率どおりの高さ');
eq(ctx.cfHeightFor_(100), MIN, '細すぎても最低の高さは確保する');
eq(ctx.cfHeightFor_(99999), MAX, '広すぎても縦に伸びすぎない');
eq(ctx.cfHeightFor_(MIN / RATIO) >= MIN, true, '境界で最低値を下回らない');

/* ---- 何行ぶんか ---- */
eq(ctx.cfRowsNeeded_(21), 1, '21px = 1行');
eq(ctx.cfRowsNeeded_(22), 2, '22px = 2行（切り上げ）');
eq(ctx.cfRowsNeeded_(420), 20, '420px = 20行');

/* ---- A〜Z列の幅の合計 ---- */
// 実データのダッシュボードに近い列幅（A〜Zで26列）
const widths = [30, 40, 80, 40, 40, 40, 40, 40, 70, 70, 40, 70, 70,
                40, 40, 70, 40, 40, 70, 40, 40, 40, 40, 40, 40, 40];
const sheet = {
  getMaxColumns: () => 30,
  getColumnWidth: c => widths[c - 1] || 100
};
eq(ctx.cfWidthOf_(sheet, 26), widths.reduce((a, b) => a + b, 0), 'A〜Z列の幅を合計する');
eq(ctx.cfWidthOf_(sheet, 3), 30 + 40 + 80, 'A〜C列だけの合計');

/* ---- 列数が足りないシートでも落ちない ---- */
const narrow = { getMaxColumns: () => 5, getColumnWidth: () => 100 };
eq(ctx.cfWidthOf_(narrow, 26), 500, '列がZまで無ければある分だけ合計する');

/* ---- 実際の並びで、下に必要な行数 ---- */
const w = ctx.cfWidthOf_(sheet, 26);
const h = ctx.cfHeightFor_(w);
console.log(`    （参考）A〜Z列=${w}px → グラフ ${w}×${h}px = ${ctx.cfRowsNeeded_(h)}行ぶん`);
eq(h >= MIN && h <= MAX, true, '実際の列幅でも高さが範囲内に収まる');

console.log(fail ? `\n${fail} 件失敗` : '\n全テスト通過');
process.exit(fail ? 1 : 0);
