/**
 * ================================================================
 *  G列の乗り場名 → Googleマップ リンク（MapLink.gs）
 *
 *  ★統合スクリプト（Code.gs）と同じプロジェクトに別ファイルとして追加。
 *    normalizePlace_ / ALL_TABS / C_PLACE 等は統合スクリプト側のものを使う。
 *
 *  ★リンクを貼りっぱなしにするには、統合スクリプトの formatTab_ の
 *      applyStyles_(sheet, out, meta);
 *    の直後に次の1行を足してください（整形のたびに貼り直される）:
 *      applyMapLinks_(sheet);
 *
 *  G列は formatTab_ が毎回 setValues で書き戻すため、
 *  =HYPERLINK() の数式では消えてしまう。そこでリッチテキストの
 *  リンクとして貼り、整形の最後に貼り直す方式にしている。
 * ================================================================
 */

/** 対応表に無い乗り場は、この語を頭に付けて検索する */
const MAP_AREA_HINT = "大阪市 ";

/**
 * 乗り場名 → Googleマップの行き先。
 *   キー … normalizePlace_() を通した名前
 *   値   … { q: "検索語" }      … その語でマップ検索
 *          { lat: 34.6, lng: 135.5 } … 座標で一発表示（こちらが正確）
 *          { q: "...", check: true } … 場所が確定していないもの
 *
 * ★ check:true は「たぶんここ」で入れてあるだけです。
 *    メニュー「🗺 マップの行き先を確認する」で一覧を出して、
 *    違うものを教えてください。座標に置き換えます。
 */
const MAP_PLACES = {
  // --- 地名・施設名がそのまま通るもの ---
  "天満":       { q: "大阪 天満駅" },
  "堂山":       { q: "大阪市北区堂山町" },
  "大丸":       { q: "大丸心斎橋店" },
  "センタラ":   { q: "センタラグランドホテル大阪" },
  "セントレジス": { q: "セントレジスホテル大阪" },
  "ニューオータニ": { q: "ホテルニューオータニ大阪" },
  "帝国":       { q: "帝国ホテル大阪" },
  "お初":       { q: "露天神社 お初天神" },
  "船大工":     { q: "大阪 船大工通り" },
  "アスエアリーナ": { q: "アスエアリーナ大阪" },
  "コナン像前": { q: "大阪 コナン像", check: true },
  "扇町":       { q: "大阪 扇町駅" },
  "南森町":     { q: "大阪 南森町駅" },
  "淀屋橋":     { q: "大阪 淀屋橋駅" },
  "西梅田":     { q: "大阪 西梅田駅" },
  "東梅田":     { q: "大阪 東梅田駅" },
  "中津":       { q: "大阪 中津駅" },
  "福島":       { q: "大阪 福島駅" },
  "野田":       { q: "大阪 野田駅" },
  "難波":       { q: "大阪 難波駅" },
  "心斎橋":     { q: "大阪 心斎橋駅" },
  "日本橋":     { q: "大阪 日本橋駅" },
  "長堀橋":     { q: "大阪 長堀橋駅" },
  "天神橋筋六丁目": { q: "天神橋筋六丁目駅" },
  "天六":       { q: "天神橋筋六丁目駅" },
  "江坂":       { q: "大阪 江坂駅" },
  "放出駅":     { q: "放出駅" },
  "北伊丹":     { q: "北伊丹駅" },
  "万博記念公園迎賓館前ロータリー": { q: "万博記念公園 迎賓館" },

  // --- ここから下は業界用語。場所が確定していません ---
  "新地1":  { q: "北新地", check: true },
  "新地2":  { q: "北新地", check: true },
  "新地4":  { q: "北新地", check: true },
  "新地5":  { q: "北新地", check: true },
  "新地7":  { q: "北新地", check: true },
  "新地15": { q: "北新地", check: true },
  "新地16": { q: "北新地", check: true },
  "新地17": { q: "北新地", check: true },
  "ガチマネプラ": { q: "大阪 マネケンプラザ", check: true },
  "乗場マネプラ": { q: "大阪 マネケンプラザ", check: true },
  "ドン":   { q: "ドン・キホーテ 道頓堀店", check: true },
  "ドン2":  { q: "ドン・キホーテ 道頓堀店", check: true },
  "ドン15": { q: "ドン・キホーテ", check: true },
  "八幡出口": { q: "阪神高速 八幡出口", check: true }
};

/* ============ リンクを作る ============ */

/**
 * 検索に使える形に均す。
 * G列の折り返しの改行は、元はスペースだった場所に入っている。
 * 消してしまうと「セントレジス西向き」のように語がくっついて検索が外れるので、
 * スペースに戻す。
 */
function mapPlaceText_(place) {
  return String(place == null ? "" : place)
    .replace(/\n/g, " ")
    .replace(/[\s　]+/g, " ")
    .trim();
}

/** 乗り場名から Googleマップ の URL を作る。空欄なら "" */
function mapUrlFor_(place) {
  const raw = mapPlaceText_(place);
  if (!raw) return "";

  const g = MAP_PLACES[normalizePlace_(raw)];
  if (g && typeof g.lat === "number" && typeof g.lng === "number") {
    // 座標が分かっているものは、検索を挟まず一発でその地点を開く
    return "https://www.google.com/maps/search/?api=1&query=" + g.lat + "," + g.lng;
  }
  const q = (g && g.q) ? g.q : (MAP_AREA_HINT + raw);
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
}

/** その乗り場が「場所が確定していない」ものか */
function mapNeedsCheck_(place) {
  const g = MAP_PLACES[normalizePlace_(mapPlaceText_(place))];
  return !g || !!g.check;
}

/* ============ シートに貼る ============ */

/**
 * G列にマップリンクを貼る。貼った件数を返す。
 * 文字サイズ・色・太字は今の見た目のまま保つ（リンクの青字・下線にしない）。
 */
function applyMapLinks_(sheet) {
  if (!sheet) return 0;
  const last = sheet.getLastRow();
  if (last < START_ROW) return 0;

  const n = last - START_ROW + 1;
  const rg = sheet.getRange(START_ROW, C_PLACE, n, 1);
  const vals = rg.getValues();
  const sizes = rg.getFontSizes();

  const out = [];
  let linked = 0;
  for (let i = 0; i < n; i++) {
    const text = String(vals[i][0] == null ? "" : vals[i][0]);
    const style = SpreadsheetApp.newTextStyle()
      .setFontSize(sizes[i][0] || 8)
      .setBold(true)
      .setUnderline(false)
      .setForegroundColor("#000000")
      .build();

    let b = SpreadsheetApp.newRichTextValue().setText(text);
    const url = mapUrlFor_(text);
    if (text !== "" && url) { b = b.setLinkUrl(url); linked++; }
    out.push([b.setTextStyle(style).build()]);
  }
  rg.setRichTextValues(out);
  return linked;
}

/* ============ メニュー ============ */

function menuMapLinksApply() {
  runnerDialog_({
    title: "🗺 乗り場にマップリンクを貼る",
    color: "#188038",
    desc: "全タブのG列（乗り場）に、Googleマップへのリンクを貼ります。<br>" +
          "見た目（文字サイズ・色）は変わりません。タップでマップが開きます。<br><br>" +
          "※整形を実行するとリンクは消えます。貼りっぱなしにするには " +
          "<b>formatTab_</b> に1行足してください（README参照）。",
    applyLabel: "リンクを貼る",
    fn: "runMapLinksApply",
    h: 200
  });
}

function runMapLinksApply(_apply) {
  progClear_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let total = 0, body = "";
  ALL_TABS.forEach(function (name, i) {
    progSet_(Math.round(5 + 90 * i / ALL_TABS.length), name + "タブにリンクを貼っています");
    const sh = ss.getSheetByName(name);
    if (!sh) { body += name + " : （タブなし）\n"; return; }
    let n = 0;
    try { n = applyMapLinks_(sh); } catch (e) { logErr_("mapLink:" + name, e); }
    total += n;
    body += name + " : " + n + "件\n";
  });
  progSet_(100, "完了");
  return "✅ " + total + "件の乗り場にマップリンクを貼りました\n──────────────\n" + body +
         "\n※整形を実行すると消えます。formatTab_ に applyMapLinks_(sheet); を足すと貼りっぱなしになります。";
}

/**
 * 今どこへ飛ぶことになっているかの一覧。
 * 「⚠️要確認」が付いているものを教えてもらえれば、座標に直せる。
 */
function menuMapLinksCheck() {
  runnerDialog_({
    title: "🗺 マップの行き先を確認する",
    color: "#0b5394",
    desc: "乗り場ごとに、今どこへ飛ぶ設定になっているかを出します。<br>" +
          "<b>⚠️</b> が付いているものは場所が確定していません。<br>" +
          "違うものがあれば、この一覧をコピーして教えてください。",
    applyLabel: "一覧を出す",
    fn: "runMapLinksCheck",
    h: 260, height: 660
  });
}

function runMapLinksCheck(_apply) {
  progClear_();
  progSet_(10, "乗り場を集計中");
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 個人タブだけ見れば、写しの分を数えずに済む
  const count = {}, disp = {};
  PERSONAL_TABS.forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const last = sh.getLastRow();
    if (last < START_ROW) return;
    sh.getRange(START_ROW, C_PLACE, last - START_ROW + 1, 1).getValues().forEach(function (r) {
      const raw = String(r[0]).replace(/\n/g, "").trim();
      if (!raw) return;
      const k = normalizePlace_(raw);
      count[k] = (count[k] || 0) + 1;
      if (!disp[k]) disp[k] = raw;
    });
  });

  const keys = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; });
  const ng = keys.filter(function (k) { return mapNeedsCheck_(disp[k]); });

  let out = "■ 乗り場 " + keys.length + "種類\n";
  out += "■ ⚠️ 場所が確定していないもの: " + ng.length + "種類\n";
  out += "──────────────\n";
  keys.forEach(function (k) {
    const g = MAP_PLACES[k];
    const mark = mapNeedsCheck_(disp[k]) ? "⚠️" : "　";
    let to;
    if (g && typeof g.lat === "number") to = "座標 " + g.lat + "," + g.lng;
    else if (g && g.q) to = g.q;
    else to = MAP_AREA_HINT + disp[k] + "（対応表になし）";
    out += mark + " " + disp[k] + " (" + count[k] + "件)\n        → " + to + "\n";
  });
  out += "\n──────────────\n";
  out += "⚠️ の行き先が違うものを教えてください。\n";
  out += "Googleマップで長押し → 座標をコピー、でもOKです。";

  progSet_(100, "完了");
  return out;
}
