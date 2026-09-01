/**
 * BigMap.gs の検証。
 * SpreadsheetApp を偽物に差し替えて bmCollect_ ごと通す。
 *   実行: node gas/test/bigmap.test.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

/* ---- 偽スプレッドシート ---- */
// GAS側は `date instanceof Date` で判定するので、日付は必ず vm 側の Date で作る。
// テスト側の Date で作ると realm が違って instanceof が false になり、全行が捨てられる。
const ctx = { console };
vm.createContext(ctx);
const CtxDate = vm.runInContext('Date', ctx);

// 行は [A名前, B日付, C付, D待, E発, F金, G乗, H種, I他, J消禁, K直]
function row(who, dateStr, time, money, place) {
  const [m, d] = dateStr.split('/').map(Number);
  const r = new Array(11).fill('');
  r[0] = who; r[1] = new CtxDate(2026, m - 1, d, 12, 0, 0);
  r[4] = time; r[5] = money; r[6] = place;
  return r;
}
function fakeSheet(rows) {
  return {
    getLastRow: () => 3 + rows.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 4, r - 4 + nr).map(x => x.slice(c - 1, c - 1 + nc))
    })
  };
}

const TABS = {
  // 個人タブ
  'ｼｭﾝ':   [row('ｼｭﾝ',   '5/21', '23:48', 1300,  '新地7')],
  'ﾀﾞｲｽｹ': [row('ﾀﾞｲｽｹ', '6/22', '23:52', 12000, '新地4')],
  'ｶｲﾄ': [], 'ｱﾅﾙ': [], 'ﾏｰｸ': [],
  // エリアタブ（個人タブの写し＋オプチャ）
  '北7': [
    row('',  '5/21', '23:48', 1300,  '新地7'),   // ← ｼｭﾝの写し。A列が失われている
    row('',  '5/21', '02:32', 6200,  '新地7'),   // ← 個人タブに無い = オプチャ
    row('',  '7/04', '01:10', 24130, 'アパホテル 御堂筋本町駅タワー'), // オプチャ大物
  ],
  '北4': [
    row('',  '6/22', '23:52', 12000, '新地4'),   // ← ﾀﾞｲｽｹの写し
    row('',  '6/25', '01:00', 15000, '新地4'),   // オプチャ大物
  ],
  '北他': [row('', '8/01', '02:00', 25920, '夕陽丘')],  // オプチャだけの大物
  'ﾐﾅﾐ': [], 'ほか': [], '関空': [], 'ﾊﾞﾗｼ': []
};

ctx.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({ getSheetByName: n => TABS[n] ? fakeSheet(TABS[n]) : null })
};
vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-globals.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'BigMap.gs'), 'utf8'), ctx);

let fail = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log('FAIL', msg, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); }
  else console.log('ok  ', msg);
};

const bm = ctx.buildBigMap(null, null);
const find = n => bm.ranked.find(r => r.name === n);

/* ---- 重複除外 ---- */
// 生の行は 1+1+3+2+1 = 8行。うち写し2件を除いて6件になるはず
eq(bm.rows.length, 6, '個人タブの写し2件を二重に数えない（生8行→6件）');

/* ---- 自社 / オプチャ の判定 ---- */
// ここが最重要。A列空白でも、個人タブに同じ乗車があれば自社。
eq(bm.ownCount, 2, '自社は2件（A列が空の写しも、個人タブにあるので自社）');
eq(bm.opuCount, 4, 'オプチャは4件（個人タブに無い行だけ）');

const s7 = find('新地7');
eq(s7.own.length, 1, '新地7: 自社1件（A列空の写しを自社として拾えている）');
eq(s7.opu.length, 1, '新地7: オプチャ1件');

const s4 = find('新地4');
eq(s4.own.length, 1, '新地4: 自社1件');
eq(s4.opu.length, 1, '新地4: オプチャ1件');
eq(s4.ownBig, 1, '新地4: 自社の大物1件（¥12,000）');
eq(s4.opuBig, 1, '新地4: オプチャの大物1件（¥15,000）');
eq(s4.big, 2, '新地4: 大物は合計2件');

/* ---- 🎯 まだ取れていない大物 ---- */
const un = bm.untapped.map(r => r.name);
eq(un.includes('夕陽丘'), true, '夕陽丘（自社実績なし・オプチャ大物あり）が候補に入る');
eq(un.includes('アパホテル 御堂筋本町駅タワー'), true, 'アパホテルも候補に入る');
eq(un.includes('新地4'), false, '新地4は自社も大物を取れているので候補に入らない');
eq(un.includes('新地7'), false, '新地7はオプチャに大物が無いので候補に入らない');
eq(bm.untapped[0].name, '夕陽丘', '金額の高い順に並ぶ（¥25,920が先頭）');

/* ---- 並び順 ---- */
eq(bm.ranked[0].name, '新地4', '大物マップは大物の多い順（新地4が2件で先頭）');

/* ---- 1件を「平均」と呼ばない ---- */
eq(ctx.bmMoneyLabel_([{money: 25920}]), '1件 ￥25,920', '1件のときは「平均」と書かない');
eq(ctx.bmMoneyLabel_([{money: 10000}, {money: 20000}]), '2件 平均￥15,000', '2件以上は平均を出す');
eq(ctx.bmMoneyLabel_([]), '0件', '0件でも落ちない');

/* ---- 期間フィルタ ---- */
const jul = ctx.buildBigMap(new CtxDate(2026, 6, 1), new CtxDate(2026, 6, 31, 23, 59, 59));
eq(jul.rows.length, 1, '7月だけに絞ると1件');
eq(jul.rows[0].place, 'アパホテル 御堂筋本町駅タワー', '7月の1件はアパホテル');

/* ---- Flex Message が組み立てられる ---- */
const flex = ctx.bmFlexBlock_(bm);
eq(Array.isArray(flex) && flex.length > 0, true, 'Flexブロックが配列で返る');
eq(JSON.stringify(flex).includes('夕陽丘'), true, 'Flexに「まだ取れていない大物」が載る');
// LineReport.gs が無い環境でも落ちないこと（toHalfWidthKana 未定義）
eq(typeof ctx.toHalfWidthKana, 'undefined', '前提: この環境に toHalfWidthKana は無い');

console.log(fail ? `\n${fail} 件失敗` : '\n全テスト通過');
process.exit(fail ? 1 : 0);
