/**
 * MapLink.gs の URL 生成を検証する（SpreadsheetApp には触れない）
 *   実行: node gas/test/maplink.test.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'gas-globals.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'MapLink.gs'), 'utf8'), ctx);

let fail = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log('FAIL', msg, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); }
  else console.log('ok  ', msg);
};
const q = u => decodeURIComponent((String(u).split('query=')[1] || ''));

/* ---- 対応表にあるもの ---- */
eq(q(ctx.mapUrlFor_('天満')), '大阪 天満駅', '天満 → 天満駅');
eq(q(ctx.mapUrlFor_('お初')), '露天神社 お初天神', 'お初 → 露天神社');
eq(q(ctx.mapUrlFor_('新地7')), '北新地', '新地7 → 北新地（要確認）');

/* ---- 表記ゆれを吸収して同じ行き先になること ---- */
eq(ctx.mapUrlFor_('新地７'), ctx.mapUrlFor_('新地7'), '全角数字の新地７も同じ行き先');
eq(ctx.mapUrlFor_('大丸 乗り場'), ctx.mapUrlFor_('大丸'), '「大丸 乗り場」も大丸と同じ');
eq(q(ctx.mapUrlFor_('ドンキ2')), 'ドン・キホーテ 道頓堀店', 'ドンキ2 → ドンを経由してドン2に一致');

/* ---- 対応表に無いものは地名ヒントを付けて検索 ---- */
eq(q(ctx.mapUrlFor_('西中ダイエー前')), '大阪市 西中ダイエー前', '未登録は「大阪市 」を付けて検索');
eq(q(ctx.mapUrlFor_('心斎橋筋長堀 西向き')), '大阪市 心斎橋筋長堀 西向き', '未登録の複合名もそのまま検索');

/* ---- 空欄・改行 ---- */
eq(ctx.mapUrlFor_(''), '', '空欄はリンクなし');
eq(ctx.mapUrlFor_('   '), '', '空白のみもリンクなし');
eq(ctx.mapUrlFor_(null), '', 'null もリンクなし');
eq(ctx.mapUrlFor_('セントレジス\n西向き'), ctx.mapUrlFor_('セントレジス 西向き'),
   '折り返しの改行が入っていても同じ行き先');

/* ---- URL の形 ---- */
const u = ctx.mapUrlFor_('天満');
eq(u.indexOf('https://www.google.com/maps/search/?api=1&query=') === 0, true,
   'Googleマップの検索URL形式');
eq(/[ ]/.test(u), false, 'URLに生のスペースが残っていない（エンコード済み）');

/* ---- 座標指定 ---- */
vm.runInContext('MAP_PLACES["テスト地点"] = { lat: 34.6937, lng: 135.5023 };', ctx);
eq(q(ctx.mapUrlFor_('テスト地点')), '34.6937,135.5023', '座標があれば座標で開く');

/* ---- 要確認の判定 ---- */
eq(ctx.mapNeedsCheck_('新地4'), true, '新地4 は要確認');
eq(ctx.mapNeedsCheck_('天満'), false, '天満 は確定');
eq(ctx.mapNeedsCheck_('西中ダイエー前'), true, '未登録は要確認あつかい');

console.log(fail ? `\n${fail} 件失敗` : '\n全テスト通過');
process.exit(fail ? 1 : 0);
