/**
 * Strategy.gs の検証。SpreadsheetApp を偽物に差し替えて通す。
 *   実行: node gas/test/strategy.test.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console };
vm.createContext(ctx);
const CtxDate = vm.runInContext('Date', ctx);   // realm を合わせないと instanceof Date が効かない

// [A名前, B日付, C付, D待, E発, F金, G乗, H種, I他, J消禁, K直]
function row(who, y, m, d, time, money, place, wait) {
  const r = new Array(11).fill('');
  r[0] = who; r[1] = new CtxDate(y, m - 1, d, 12, 0, 0);
  r[3] = (wait === undefined) ? '' : wait + '分';
  r[4] = time; r[5] = money; r[6] = place;
  return r;
}
function sheet(rows) {
  return { getLastRow: () => 3 + rows.length,
           getRange: (r, c, nr, nc) => ({
             getValues: () => rows.slice(r - 4, r - 4 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }) };
}
// 2026年: 8/3=月, 8/7=金, 8/8=土, 8/9=日, 8/6=木
const TABS = {
  'ﾀﾞｲｽｹ': [
    row('ﾀﾞｲｽｹ', 2026, 8, 3, '23:10', 12000, '新地4', 30),
    row('ﾀﾞｲｽｹ', 2026, 8, 3, '23:40',  3000, '新地4', 40),
    row('',       2026, 8, 3, '23:50',  9000, '新地4', 35),   // A列空でも個人タブなら自社
    row('ﾀﾞｲｽｹ', 2026, 8, 7, '01:00',  4000, '天満',  10),
    row('ﾀﾞｲｽｹ', 2026, 8, 6, '22:00', 20000, '新地7',  5),
  ],
  'ｼｭﾝ': [
    row('ｼｭﾝ', 2026, 8, 8, '00:30', 2000, 'ドン15', 5),
    row('ｼｭﾝ', 2026, 8, 8, '00:50', 2500, 'ドン15', 5),
    row('ｼｭﾝ', 2026, 8, 8, '01:10', 3000, 'ドン15', 5),
  ],
  'ｶｲﾄ': [], 'ｱﾅﾙ': [], 'ﾏｰｸ': [],
  '北4': [ row('', 2026, 8, 3, '23:10', 12000, '新地4', 30) ],  // 個人タブの写し
  '北7': [], '北他': [], 'ﾐﾅﾐ': [], 'ほか': [], 'ﾊﾞﾗｼ': [],
  '関空': [
    row('', 2026, 8, 5, '04:40', 25920, '夕陽丘'),          // オプチャ
    row('ﾀﾞｲｽｹ', 2026, 8, 6, '22:00', 20000, '新地7', 5),   // 個人タブにもある = 自社
  ]
};
ctx.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: n => TABS[n] ? sheet(TABS[n]) : null }) };
vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-globals.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Strategy.gs'), 'utf8'), ctx);

let fail = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log('FAIL', msg, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); }
  else console.log('ok  ', msg);
};

/* ---- 金額区分（ユーザー定義） ---- */
eq(ctx.stBand_(4999),  'ショート', '¥4,999 → ショート');
eq(ctx.stBand_(5000),  'ミドル',   '¥5,000 → ミドル');
eq(ctx.stBand_(9999),  'ミドル',   '¥9,999 → ミドル');
eq(ctx.stBand_(10000), 'ロング',   '¥10,000 → ロング');

/* ---- 営業時間の並び ---- */
eq(ctx.stSlot_(20), 20, '20時はそのまま');
eq(ctx.stSlot_(1),  25, '深夜1時は25として並ぶ');
eq(ctx.stSlot_(5),  29, '朝5時は29');
eq(ctx.stSlot_(17), 17, '17時は営業開始なのでそのまま');
eq(ctx.stHourLabel_(25), '1時', '25 は「1時」と表示');

const S = ctx.buildStrategy(null, null);

/* ---- オプチャ判定（Opucha.gs 未導入のとき） ---- */
// 印は Opucha.gs が持つ。このテストでは読み込んでいないので、全件が自社になる。
// 印を付けたときの動きは gas/test/opucha.test.js で検証している。
eq(S.hasMark, false, 'Opucha.gs が無いときは印を使わない');
eq(S.opu.length, 0, '  オプチャは0件（印が無いので全件自社）');
eq(S.own.length, 9, '  自社は9件');
eq(S.own.filter(x => x.place === '新地7' && x.money === 20000).length, 1,
   '関空タブのﾀﾞｲｽｹ¥20,000は個人タブにもあるので二重にならない');
eq(S.all.length, 9, '個人タブと北4の写しが二重にならない（生10行→9件）');

/* ---- 曜日区分 ---- */
const dt = d => ctx.stDayType_(new CtxDate(2026, 7, d, 12, 0, 0));
eq(dt(3), '平日', '8/3(月)は平日');
eq(dt(7), '金曜', '8/7(金)は金曜');
eq(dt(8), '土曜', '8/8(土)は土曜');
eq(dt(9), '日祝', '8/9(日)は日祝');
eq(ctx.stDayType_(new CtxDate(2026, 7, 11, 12, 0, 0)), '日祝', '8/11(祝)は平日でも日祝');

/* ---- 件数が少ない枠を過大評価しない ---- */
// 全体平均は約¥9,000。1件¥25,000の枠は補正で大きく下がるはず
const shrunk1 = ctx.stShrink_(25000, 1, 9000);
const shrunk9 = ctx.stShrink_(25000 * 9, 9, 9000);
eq(shrunk1 < 15000, true, '1件¥25,000は補正で¥15,000未満まで下がる');
eq(shrunk9 > 20000, true, '9件そろえば実平均に近づく');
eq(shrunk1 < shrunk9, true, '件数が多いほど実平均に近い');

/* ---- 立ち回り候補 ---- */
const t = S.tachimawari;
eq(t.every(r => r.n >= 3), true, '3件未満の枠は候補に出さない');
const s4 = t.find(r => r.place === '新地4' && r.dayType === '平日' && r.slot === 23);
eq(!!s4, true, '平日23時の新地4が候補に入る');
eq(s4.n, 3, '  件数3件');
eq(s4.long, 1, '  ロング1件（¥12,000）');
eq(s4.mid, 1, '  ミドル1件（¥9,000）');
eq(s4.short, 1, '  ショート1件（¥3,000）');

/* ---- 待ち時間あたりの効率 ---- */
const eff = S.efficiency;
eq(eff.length, 0, '5件未満の乗り場は効率に出さない');
const eff3 = ctx.stEfficiency_(S.own, 3);
const don = eff3.find(r => r.place === 'ドン15');
const sh4 = eff3.find(r => r.place === '新地4');
eq(don.avg < sh4.avg, true, 'ドン15は新地4より平均売上が低い');
eq(don.perHour > sh4.perHour, true, 'それでも待ちが短いので効率は上（順位が逆転する）');
eq(don.perHour, Math.round(7500 / 15 * 60), 'ドン15: ¥7,500÷15分×60 = 待ち1時間あたり¥30,000');

/* ---- 曜日ごと ---- */
const wd = S.byWeekday;
eq(wd.find(r => r.dow === '木').n, 1, '木曜は1件');
eq(wd.find(r => r.dow === '木').long, 1, '木曜のロングは1件');

/* ---- ロングマップ（オプチャ込み） ---- */
const lm = S.longMap;
const yu = lm.find(r => r.place === '夕陽丘');
eq(yu.long, 1, '夕陽丘のロングは1件');
eq(yu.ownLong, 1, '印が無いので自社側に計上される（印を付ければオプチャ側へ移る）');
eq(lm.find(r => r.place === '新地7').ownLong, 1, '新地7の¥20,000は自社のロング');
eq(lm.every(r => r.long > 0), true, 'ロングが無い乗り場はロングマップに出さない');

console.log(fail ? `\n${fail} 件失敗` : '\n全テスト通過');
process.exit(fail ? 1 : 0);
