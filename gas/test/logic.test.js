const fs = require('fs'), vm = require('vm');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);

let fail = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log('FAIL', msg, 'got', JSON.stringify(a), 'want', JSON.stringify(b)); }
  else console.log('ok  ', msg);
};

// --- オプチャ判定（A列） ---
eq(ctx.isOpucha_('オプチャ'), true, 'オプチャ');
eq(ctx.isOpucha_('ｵﾌﾟﾁｬ'), true, '半角カナ ｵﾌﾟﾁｬ');
eq(ctx.isOpucha_(' オプチャ経由 '), true, 'オプチャ経由（前後空白）');
eq(ctx.isOpucha_('オープンチャット'), true, 'オープンチャット');
eq(ctx.isOpucha_('自社'), false, '自社');
eq(ctx.isOpucha_(''), false, '空欄');

// --- 数値パース ---
eq(ctx.toNumber_(120000), 120000, '数値そのまま');
eq(ctx.toNumber_('1,200,000円'), 1200000, 'カンマ+円');
eq(ctx.toNumber_(''), null, '空欄は除外');
eq(ctx.toNumber_('未定'), null, '文字列は除外');

// --- 金額帯 ---
eq(ctx.bucketLabels_([100000,300000,500000,1000000,3000000]),
   ['〜10万','10万〜30万','30万〜50万','50万〜100万','100万〜300万','300万〜'], 'ラベル');
const E = vm.runInContext('CONFIG.BUCKETS', ctx);
eq(ctx.bucketIndex_(50000, E), 0, '5万 → 〜10万');
eq(ctx.bucketIndex_(100000, E), 1, '10万ちょうど → 10〜30万');
eq(ctx.bucketIndex_(2999999, E), 4, '299万 → 100〜300万');
eq(ctx.bucketIndex_(3000000, E), 5, '300万ちょうど → 300万〜');

// --- 2セクションの母集団が分かれているか ---
const rows = [
  {kubun:'自社',   sales:200000, isOpucha:false},
  {kubun:'自社',   sales:400000, isOpucha:false},
  {kubun:'紹介',   sales:900000, isOpucha:false},
  {kubun:'オプチャ', sales:5000000, isOpucha:true},  // 高額。平均に混ざると壊れる
];
const own = rows.filter(r => !r.isOpucha);
eq(ctx.sum_(own)/own.length, 500000, '自社実績の平均 = 50万（オプチャ500万は除外）');
eq(ctx.sum_(rows)/rows.length, 1625000, '（参考）全件平均だと162.5万に膨らむ');
eq(rows.length, 4, '大物マップは全4件が母集団');
eq(ctx.bucketIndex_(5000000, E), 5, 'オプチャの500万は「300万〜」に計上される');
eq(ctx.median_(own.map(r=>r.sales)), 400000, '中央値');

console.log(fail ? `\n${fail} 件失敗` : '\n全テスト通過');
process.exit(fail ? 1 : 0);
