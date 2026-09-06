/**
 * LineReport.gs の期間まわりを検証する（SpreadsheetApp には触れない）
 *   実行: node gas/test/linereport.test.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console };
vm.createContext(ctx);
const D = vm.runInContext('Date', ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-globals.js'), 'utf8'), ctx);

// Gemini 呼び出しを差し替えられるようにしておく
const props = { GEMINI_API_KEY: 'dummy-key' };
let lastUrl = '', reply = { code: 200, body: '{}' };
ctx.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k in props ? props[k] : null),
  setProperty: (k, v) => { props[k] = v; }
}) };
ctx.UrlFetchApp = { fetch: (url) => { lastUrl = url; return {
  getResponseCode: () => reply.code, getContentText: () => reply.body }; } };
ctx.SpreadsheetApp = { getUi: () => ({}) };

vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '003-LineReport.gs'), 'utf8'), ctx);

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
const alt = "📈" + ctx.lrAlt_(new D(2026, 7, 16)) + "～" + ctx.lrAlt_(new D(2026, 8, 1)) + "レポート作成 byシバンニ";
eq(alt, '📈8/16(日)～9/1(火)レポート作成 byシバンニ', '裏メッセージの文面（先頭に📈）');
eq(alt.charAt(0), '📈'.charAt(0), '  先頭が📈で始まる');
eq(alt.length <= 400, true, 'LINEの altText 上限400文字に収まる');

/* ---- Gemini（ダッシュボードの「傾向と対策」） ---- */
// v185 は gemini-1.5-flash を叩いていたが、これは廃止済みで 404 が返る。
// 全行が「【AI分析エラー】データが取得できませんでした」になっていた原因。
eq(ctx.getGeminiModel_(), 'gemini-3.1-flash-lite', '既定のモデルは現行のもの');
eq(ctx.getGeminiModel_().indexOf('1.5') === -1, true, '廃止済みの1.5系を使っていない');

reply = { code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '新地4の23時台を狙う' }] } }] }) };
eq(ctx.generateAIText(7500, 12, 20, ['23:10']), '新地4の23時台を狙う', '正常時は本文を返す');
eq(lastUrl.indexOf('/models/gemini-3.1-flash-lite:generateContent') !== -1, true,
   '  設定したモデルでURLを組み立てている');

// 原因が分かるエラー文になっているか（v185は全部同じ文言だった）
reply = { code: 404, body: JSON.stringify({ error: { message: 'models/gemini-1.5-flash is not found' } }) };
eq(ctx.generateAIText(7500, 12, 20, []).indexOf('見つかりません') !== -1, true,
   '404はモデル廃止と分かる文言を返す');

reply = { code: 403, body: JSON.stringify({ error: { message: 'API key not valid' } }) };
const e403 = ctx.generateAIText(7500, 12, 20, []);
eq(e403.indexOf('APIキー') !== -1, true, '403はキーの問題と分かる');
eq(e403.indexOf('API key not valid') !== -1, true, '  APIからの理由もそのまま出す');

reply = { code: 429, body: '{}' };
eq(ctx.generateAIText(7500, 12, 20, []).indexOf('回数制限') !== -1, true, '429は回数制限と分かる');

eq(ctx.generateAIText(5000, 1, 0, []), 'データ不足のため判断保留。', '1件だけならAIを呼ばない');
delete props.GEMINI_API_KEY;
eq(ctx.generateAIText(7500, 12, 20, []).indexOf('AI未設定') !== -1, true, 'キー未設定なら呼ばずに知らせる');
props.GEMINI_API_KEY = 'dummy-key';

// モデル名は設定で差し替えられる（Googleが次々にモデルを止めるため）
props.GEMINI_MODEL = 'gemini-3.5-flash';
eq(ctx.getGeminiModel_(), 'gemini-3.5-flash', '設定でモデルを差し替えられる');

/* ============ 期間の打ち込み（そうさボタン [7]） ============ */
console.log('\n■ 期間の読み取り');
const NOW = new D(2026, 8, 6);            // 2026/9/6（日）
const R = (s) => ctx.rpParseRange_(s, NOW);
const ymd = (d) => d ? (d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate()) : null;
const span = (s) => { const r = R(s); return r.err ? 'ERR' : ymd(r.from) + '-' + ymd(r.to); };

eq(span('今期'), '2026/8/16-2026/9/6', '今期は 8/16〜今日');
eq(span('今期（8/16(日)〜9/6(日)）'), '2026/8/16-2026/9/6', 'プルダウンの飾りつきでも読める');
eq(span('前期'), '2026/7/16-2026/8/15', '前期は 7/16〜8/15');
eq(span('今日'), '2026/9/6-2026/9/6', '今日');
eq(span('昨日'), '2026/9/5-2026/9/5', '昨日');
eq(span('今月'), '2026/9/1-2026/9/6', '今月は 1日〜今日');
eq(span('先月'), '2026/8/1-2026/8/31', '先月は まるまる1か月');

eq(span('260716-0815'), '2026/7/16-2026/8/15', '260716-0815（月日は4桁）');
eq(span('260716-260815'), '2026/7/16-2026/8/15', '終わりにも年を付けてよい');
eq(span('2026/7/16-2026/8/15'), '2026/7/16-2026/8/15', '区切りありの書き方');
eq(span('2026/7/16〜2026/8/15'), '2026/7/16-2026/8/15', '〜でもよい');
eq(span('0716-0815'), '2026/7/16-2026/8/15', '年を書かなければ今年');
eq(span('２６０７１６－０８１５'), '2026/7/16-2026/8/15', '全角で打っても読める');
eq(span('261216-0115'), '2026/12/16-2027/1/15', '年をまたぐ書き方は、終わりを翌年にする');
eq(span('260905'), '2026/9/5-2026/9/5', '1つだけなら その日1日ぶん');

eq(R('あいうえお').err !== undefined, true, '読めなければエラーにする');
eq(R('あいうえお').err.indexOf('260716-0815') !== -1, true, '  書き方の例も出す');
eq(R('260231-0301').err !== undefined, true, '2月31日のような日はじく');
eq(R('260815-0716').err.indexOf('終わりの日') !== -1, true, '前後が逆なら、そう言う');
eq(R('').err.indexOf('空') !== -1, true, '空欄なら、そう言う');

console.log('\n■ 末尾の t / h で送り先を決める');
eq(R('260716-0815t').dest, 'test',  't は自分だけ');
eq(R('260716-0815h').dest, 'group', 'h はグループ');
eq(R('260716-0815T').dest, 'test',  '大文字でもよい');
eq(R('今期h').dest, 'group', '言葉で書いたときにも付けられる');
eq(R('260716-0815').dest, null, '付けなければ「指定なし」');
eq(span('260716-0815t'), '2026/7/16-2026/8/15', 't を付けても期間はそのまま');
eq(span('今日'), '2026/9/6-2026/9/6', '「今日」の日 は t と間違えない');

console.log('\n■ 送り先らんの読み取り');
eq(ctx.rpParseDest_('🧪 自分だけ（テスト）'), 'test',  '自分だけ');
eq(ctx.rpParseDest_('👥 グループ全員（本番）'), 'group', 'グループ');
eq(ctx.rpParseDest_(''), null, '空欄なら「指定なし」');
eq(ctx.rpParseDest_('よくわからない'), null, '読めないものも「指定なし」');

console.log(fail ? `\n${fail} 件失敗` : '\n全テスト通過');
process.exit(fail ? 1 : 0);
