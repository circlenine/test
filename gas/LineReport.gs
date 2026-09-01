/**
 * ================================================================
 *  LINE画像（Flex Message）＋ まとめスプシ レポート作成
 *  ── v185 からレポート部分のみを抜粋したもの ──
 *
 *  【抜粋した関数】
 *    showReportDialog            レポート送信UI（期間選択・日付指定・テスト送信）
 *    executeManualReportFromUI   UIからの実行受け口
 *    sendCustomReport            集計 → Flex Message組み立て → LINE送信
 *    updateDetailedDashboard     まとめスプシにダッシュボードを作る
 *    generateAIText              Gemini による「傾向と対策」生成
 *    getGridRange / normalizeStr / removeStreetSuffix
 *    toHalfWidthKana / isHolidayFunc
 *
 *  【抜粋しなかったもの】（記録用スプシの記録・整形まわり。v232が担当）
 *    doPost / parseAndRecordMessage / logUnknownId / onEdit
 *    executeSingleTabCheck / showSyncDialog / triggerManualSync
 *    calculateStartTime / insertLineBreak / onOpen
 *    USER_MAP / CATEGORY_TABS / RIDE_TYPES
 *
 *  【v232 と重複するので、この抜粋からは外した定義】
 *    PERSONAL_TABS / HOLIDAYS / NORTH_WORDS / SOUTH_WORDS
 *    → v232（統合スクリプト）側のものがそのまま使われます。
 *      同じプロジェクトに置かないと動きません。
 *
 *  【v185 から変えた点は2つだけ】
 *    1. LINEトークンとGeminiキーをコードから追い出し、
 *       スクリプトプロパティから読むようにした（元は直書き）
 *    2. 重複する定数の宣言を削除（同じプロジェクトに置くとエラーになるため）
 *    ロジックは触っていません。
 *
 *  【メニューに出す】v232 の onOpen() に1行:
 *      .addItem("📊 レポートを手動送信", "showReportDialog")
 * ================================================================
 */

/* ============ 鍵（コードに書かない） ============ */

/**
 * LINEチャネルアクセストークン。
 * v232 のメニュー「🔑 LINEトークンを設定」で保存したものを使う。
 */
function getLineToken_() {
  const t = PropertiesService.getScriptProperties().getProperty("LINE_TOKEN");
  if (!t) throw new Error("LINEトークンが未設定です。メニュー「🔑 LINEトークンを設定」から登録してください。");
  return t;
}

/**
 * Gemini APIキー。
 * 一度だけ setGeminiKey_() をエディタから実行して保存する。
 */
function getGeminiKey_() {
  return PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "";
}

/** スクリプトエディタから1回だけ実行してキーを保存する */
function setGeminiKey_() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt("Gemini APIキー", "APIキーを貼り付けてください。", ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const k = res.getResponseText().trim();
  if (!k) return;
  PropertiesService.getScriptProperties().setProperty("GEMINI_API_KEY", k);
  ui.alert("保存しました。");
}

/* ============ レポート専用の定数・道具 ============ */

const GRAPH_COLORS = ["#e6194B", "#3cb44b", "#ffe119", "#4363d8", "#f58231",
                      "#911eb4", "#42d4f4", "#f032e6", "#bfef45", "#fabed4"];

const TAB_COLORS = { "北7": "#e3f2fd", "北4": "#e8eaf6", "北他": "#e0f7fa",
                     "ﾐﾅﾐ": "#fce4ec", "関空": "#fff3e0", "ほか": "#f5f5f5" };

/** 祝日判定。HOLIDAYS は v232 側の定義を使う */
function isHolidayFunc(dateObj) {
  return HOLIDAYS.includes((dateObj.getMonth() + 1) + "/" + dateObj.getDate());
}

function normalizeStr(str) {
  if (!str) return "";
  let s = str.replace(/[Ａ-Ｚａ-ｚ０-９！-～]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  }).trim();
  s = s.replace(/大丸乗り場|大丸乗場/g, "大丸");
  s = s.replace(/アポロワンビル/g, "アポロビル");
  return s;
}

function removeStreetSuffix(str) { return str ? str.replace(/(筋|通り|町|橋)$/, "") : ""; }

function toHalfWidthKana(str) {
  if (!str) return "";
  const kanaMap = { "ガ": "ｶﾞ", "ギ": "ｷﾞ", "グ": "ｸﾞ", "ゲ": "ｹﾞ", "ゴ": "ｺﾞ", "ザ": "ｻﾞ", "ジ": "ｼﾞ", "ズ": "ｽﾞ", "ゼ": "ｾﾞ", "ゾ": "ｿﾞ", "ダ": "ﾀﾞ", "ヂ": "ﾁﾞ", "ヅ": "ﾂﾞ", "デ": "ﾃﾞ", "ド": "ﾄﾞ", "バ": "ﾊﾞ", "ビ": "ﾋﾞ", "ブ": "ﾌﾞ", "ベ": "ﾍﾞ", "ボ": "ﾎﾞ", "パ": "ﾊﾟ", "ピ": "ﾋﾟ", "プ": "ﾌﾟ", "ペ": "ﾍﾟ", "ポ": "ﾎﾟ", "ヴ": "ｳﾞ", "ア": "ｱ", "イ": "ｲ", "ウ": "ｳ", "エ": "ｴ", "オ": "ｵ", "カ": "ｶ", "キ": "ｷ", "ク": "ｸ", "ケ": "ｹ", "コ": "ｺ", "サ": "ｻ", "シ": "ｼ", "ス": "ｽ", "セ": "ｾ", "ソ": "ｿ", "タ": "ﾀ", "チ": "ﾁ", "ツ": "ﾂ", "テ": "ﾃ", "ト": "ﾄ", "ナ": "ﾅ", "ニ": "ﾆ", "ヌ": "ﾇ", "ネ": "ﾈ", "ノ": "ﾉ", "ハ": "ﾊ", "ヒ": "ﾋ", "フ": "ﾌ", "ヘ": "ﾍ", "ホ": "ﾎ", "マ": "ﾏ", "ミ": "ﾐ", "ム": "ﾑ", "メ": "ﾒ", "モ": "ﾓ", "ヤ": "ﾔ", "ユ": "ﾕ", "ヨ": "ﾖ", "ラ": "ﾗ", "リ": "ﾘ", "ル": "ﾙ", "レ": "ﾚ", "ロ": "ﾛ", "ワ": "ﾜ", "ヲ": "ｦ", "ン": "ﾝ", "ー": "ｰ" };
  let reg = new RegExp('(' + Object.keys(kanaMap).join('|') + ')', 'g');
  return str.replace(reg, function (match) { return kanaMap[match]; });
}

function getGridRange(sheet, startRow, startColIndex, rowCount, colSpanArray) {
  let ranges = []; let currentC = startColIndex;
  for (let i = 0; i < colSpanArray.length; i++) {
    let rng = sheet.getRange(startRow, currentC, rowCount, colSpanArray[i]);
    ranges.push(rng); currentC += colSpanArray[i];
  }
  return ranges;
}

/* ============ 期間（16日〜翌月15日） ============ */

const LR_DOW = ["日", "月", "火", "水", "木", "金", "土"];

/** その日が属する営業期間の開始日。16日起点 */
function lrPeriodStart_(d) {
  return (d.getDate() >= 16)
    ? new Date(d.getFullYear(), d.getMonth(), 16)
    : new Date(d.getFullYear(), d.getMonth() - 1, 16);
}

function lrFull_(d)  { return d.getFullYear() + "/" + pad2_(d.getMonth() + 1) + "/" + pad2_(d.getDate()) + "(" + LR_DOW[d.getDay()] + ")"; }
function lrShort_(d) { return pad2_(d.getMonth() + 1) + "/" + pad2_(d.getDate()) + "(" + LR_DOW[d.getDay()] + ")"; }
function lrAlt_(d)   { return (d.getMonth() + 1) + "/" + d.getDate() + "(" + LR_DOW[d.getDay()] + ")"; }
function lrVal_(d)   { return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate(); }

/**
 * プルダウンに出す期間を、新しい → 古い の順で作る。
 * 先頭は今期（16日〜今日）。それ以降は 16日〜翌月15日。
 * 記録が残っている月までしか作らない。
 */
function lrPeriodsFrom_(minDate, today) {
  const out = [];
  const cur = lrPeriodStart_(today);
  out.push({
    value: lrVal_(cur) + "-" + lrVal_(today),
    label: lrFull_(cur) + " ～ " + lrShort_(today) + "（今期）"
  });
  if (!minDate) return out;

  const limit = lrPeriodStart_(minDate);
  let s = cur, guard = 0;
  while (s.getTime() > limit.getTime() && guard++ < 240) {
    const ps = new Date(s.getFullYear(), s.getMonth() - 1, 16);
    const pe = new Date(s.getFullYear(), s.getMonth(), 15);
    out.push({ value: lrVal_(ps) + "-" + lrVal_(pe),
               label: lrFull_(ps) + " ～ " + lrShort_(pe) });
    s = ps;
  }
  return out;
}

/** 画面から呼ばれる。記録の一番古い営業日を調べて期間一覧を返す */
function getReportPeriods() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let minD = null;
  ALL_TABS.forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const last = sh.getLastRow();
    if (last < START_ROW) return;
    // B列(営業日)とF列(金額)を見る。金額が無い行は年見出しなので数えない
    sh.getRange(START_ROW, C_DATE, last - START_ROW + 1, C_MONEY - C_DATE + 1)
      .getValues().forEach(function (r) {
        const d = r[0];
        if (!(d instanceof Date)) return;
        if (d.getFullYear() < 2020 || d.getFullYear() > 2035) return;
        if (String(r[C_MONEY - C_DATE]).replace(/[^0-9]/g, "") === "") return;
        if (!minD || d < minD) minD = d;
      });
  });
  return JSON.stringify(lrPeriodsFrom_(minD, new Date()));
}

/** 送信先のグループIDを設定する（説明タブ Z1） */
function menuSetGroupId() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("説明");
  if (!sh) { ui.alert("説明タブが見つかりません。"); return; }
  const cur = String(sh.getRange("Z1").getValue() || "");
  const res = ui.prompt("グループLINEのID",
    "レポートを送るグループのID（C から始まる文字列）を貼り付けてください。\n現在: " + (cur || "未設定"),
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const v = res.getResponseText().trim();
  if (!v) return;
  sh.getRange("Z1").setValue(v);
  ui.alert("保存しました。（説明タブ Z1）");
}

/* ============ 📤 レポート送信UI ============ */

function showReportDialog() {
  const htmlContent = `<!DOCTYPE html><html><head><base target="_top"><style>
    body { font-family: sans-serif; padding: 15px; color: #333; margin: 0; }
    h3 { font-size: 16px; margin: 0 0 5px 0; color: #333; display: flex; align-items: center; }
    .line { border-bottom: 2px solid #1155ca; margin-bottom: 15px; }
    .radio-group { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; font-size: 14px; }
    .radio-group label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
    select, input[type="date"] { width: 100%; font-size: 14px; padding: 10px; margin-bottom: 15px; box-sizing: border-box; border-radius: 4px; border: 1px solid #ccc; }
    .date-inputs { display: none; align-items: center; gap: 10px; margin-bottom: 15px; }
    .date-inputs input { width: 45%; margin-bottom: 0; }
    .test-box { background-color: #f9fbe7; border: 1px solid #c0ca33; padding: 12px; border-radius: 5px; margin-bottom: 15px; }
    .test-box label { color: #d93025; font-weight: bold; font-size: 13px; display: flex; align-items: center; gap: 5px; cursor: pointer; }
    button { background-color: #1155ca; color: white; border: none; font-weight: bold; cursor: pointer; padding: 12px; border-radius: 5px; width: 100%; font-size: 14px; }
    .progress-container { width: 100%; background: #e0e0e0; border-radius: 5px; margin-top: 10px; display: none; height: 18px; overflow: hidden; }
    .progress-bar { width: 0%; height: 100%; background: #34a853; transition: width 0.3s; }
    .status-text { font-size: 13px; margin-top: 5px; text-align: center; display: none; font-weight: bold; }
  </style></head><body>
    <h3>📊 レポート期間指定 & 送信</h3>
    <div class="line"></div>
    <div class="radio-group">
      <label><input type="radio" name="mode" value="select" checked onchange="toggle()"> 📅 期間選択</label>
      <label><input type="radio" name="mode" value="custom" onchange="toggle()"> ✍️ 日付指定</label>
    </div>
    <div id="selectArea"><select id="periodSelect"></select></div>
    <div id="customArea" class="date-inputs">
      <input type="date" id="startDate"><span>～</span><input type="date" id="endDate">
    </div>
    <div class="test-box">
      <label><input type="checkbox" id="testMode" checked> 🛠️ マーク個人のLINEのみに送信 (テスト用)</label>
    </div>
    <button id="sendBtn" onclick="send()">LINEへ送信する</button>
    <div class="progress-container" id="pCont"><div class="progress-bar" id="pBar"></div></div>
    <div class="status-text" id="pText">処理中...</div>
    <script>
      function toggle() {
        var mode = document.querySelector('input[name="mode"]:checked').value;
        document.getElementById('selectArea').style.display = mode === 'select' ? 'block' : 'none';
        document.getElementById('customArea').style.display = mode === 'custom' ? 'flex' : 'none';
      }
      window.onload = function() {
        var s = document.getElementById('periodSelect');
        s.add(new Option('読み込み中…', ''));
        google.script.run.withSuccessHandler(function(js){
          var list = JSON.parse(js); s.innerHTML = '';
          if (!list.length) { s.add(new Option('記録がありません', '')); return; }
          list.forEach(function(p){ s.add(new Option(p.label, p.value)); });
        }).withFailureHandler(function(e){
          s.innerHTML = ''; s.add(new Option('期間を読めません: ' + e.message, ''));
        }).getReportPeriods();
      };
      function send() {
        var mode = document.querySelector('input[name="mode"]:checked').value;
        var val = mode === "select" ? document.getElementById('periodSelect').value : (document.getElementById('startDate').value.replace(/-/g, '/') + "-" + document.getElementById('endDate').value.replace(/-/g, '/'));
        var isTest = document.getElementById('testMode').checked;

        document.getElementById('sendBtn').style.display = 'none';
        document.getElementById('pCont').style.display = 'block';
        document.getElementById('pText').style.display = 'block';

        let progress = 0; let pBar = document.getElementById('pBar'); let pText = document.getElementById('pText');

        let interval = setInterval(() => {
          progress += 1.5;
          if (progress > 95) progress = 95;
          pBar.style.width = progress + '%';
          pText.innerText = "処理中... (推定残り" + Math.max(1, Math.round(60 - (progress / 1.5))) + "秒)";
        }, 1000);

        google.script.run
          .withSuccessHandler(function(res){
            clearInterval(interval);
            if(res && res.status === "error") {
                pBar.style.backgroundColor = '#d93025'; pBar.style.width = '100%'; pText.style.color = '#d93025';
                pText.innerText = "❌ エラー: " + res.message;
            } else {
                pBar.style.width = '100%'; pText.innerText = "✅ 送信完了！"; pText.style.color = "#2e7d32";
                setTimeout(() => google.script.host.close(), 1500);
            }
          })
          .withFailureHandler(function(error){
            clearInterval(interval); pBar.style.backgroundColor = '#d93025'; pBar.style.width = '100%'; pText.style.color = '#d93025';
            pText.innerText = "❌ スクリプトエラー: " + error.message;
          })
          .executeManualReportFromUI(val, isTest);
      }
    </script></body></html>`;
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(htmlContent).setWidth(380).setHeight(360), '📤 レポート送信');
}

function executeManualReportFromUI(val, isTest) {
  try {
    const parts = val.split('-'); const sParts = parts[0].split('/'); const eParts = parts[1].split('/');
    let startD = new Date(parseInt(sParts[0], 10), parseInt(sParts[1], 10) - 1, parseInt(sParts[2], 10), 0, 0, 0);
    let endD = new Date(parseInt(eParts[0], 10), parseInt(eParts[1], 10) - 1, parseInt(eParts[2], 10), 23, 59, 59);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let targetId = isTest ? "Uec8443d00bcec9f0463fd47775a41909" : (ss.getSheetByName("説明") ? ss.getSheetByName("説明").getRange("Z1").getValue() : "");
    sendCustomReport(targetId, startD, endD);
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}

/* ============ 集計 → Flex Message → LINE送信 ============ */

function sendCustomReport(targetId, customStartD, customEndD) {
  const ss = SpreadsheetApp.getActiveSpreadsheet(); let startD = customStartD, endD = customEndD;
  const daysStr = ["日", "月", "火", "水", "木", "金", "土"]; const DAY_TYPES = ["平日", "金曜", "土曜", "日祝"];
  let totalRidesCount = 0; let tabRidesCount = { "北7":0, "北4":0, "北他":0, "ﾐﾅﾐ":0, "関空":0, "ほか":0 };
  let areaStats = {}; DAY_TYPES.forEach(dt => { areaStats[dt] = { "北": {l:0, m:0, s:0, t:0, sales:0, lSum:0, mSum:0, sSum:0, waitSum:0, waitCount:0, lWait:0, lWaitC:0, mWait:0, mWaitC:0, sWait:0, sWaitC:0, spots:{}}, "ﾐﾅﾐ": {l:0, m:0, s:0, t:0, sales:0, lSum:0, mSum:0, sSum:0, waitSum:0, waitCount:0, lWait:0, lWaitC:0, mWait:0, mWaitC:0, sWait:0, sWaitC:0, spots:{}}, "ほか": {l:0, m:0, s:0, t:0, sales:0, lSum:0, mSum:0, sSum:0, waitSum:0, waitCount:0, lWait:0, lWaitC:0, mWait:0, mWaitC:0, sWait:0, sWaitC:0, spots:{}} }; });

  let spotStats = {}; let spotHotData = {}; let spotDayBreakdown = {}; let timelineStats = {}; DAY_TYPES.forEach(dt => { timelineStats[dt] = {}; [20,21,22,23,0,1,2,3,4,5].forEach(h => { timelineStats[dt][h] = {}; }); });
  let spotHeatmapSales = {}; let spotHeatmapTimes = {}; let recordsForGraph = []; let ticketRides = []; let avoidRides = []; let reproRides = [];
  const avoidWords = ["ゲロ", "ガキ", "障割", "カス", "ババア", "ジジイ", "元3"];

  PERSONAL_TABS.forEach(tabName => {
    let sheet = ss.getSheetByName(tabName); if (!sheet || sheet.getMaxRows() < 4) return;
    let dataVals = sheet.getRange(4, 1, sheet.getMaxRows() - 3, 10).getValues(); let displayVals = sheet.getRange(4, 1, sheet.getMaxRows() - 3, 10).getDisplayValues();
    let currentYear = startD.getFullYear();
    for (let r = 0; r < dataVals.length; r++) {
      let rawDate = dataVals[r][1]; let rDate = null;
      if (Object.prototype.toString.call(rawDate) === "[object Date]") { rDate = rawDate; } else if (displayVals[r][1]) { let mm = displayVals[r][1].match(/^(\d+)\/(\d+)/); if (mm) rDate = new Date(currentYear, parseInt(mm[1], 10) - 1, parseInt(mm[2], 10), 12, 0, 0); }
      if (!rDate || rDate < startD || rDate > endD) continue;
      let memo = String(dataVals[r][7]); let remarks = String(dataVals[r][8]); let place = normalizeStr(String(dataVals[r][6]));
      if (remarks.includes("バラシ") || place.includes("バラシ")) continue;
      let price = parseInt(String(dataVals[r][5]).replace(/[^0-9]/g, ''), 10); if (isNaN(price) || price === 0) continue;
      let hr = -1, min = 0, exactTimeStr = ""; let tm = displayVals[r][4].match(/^(\d+):(\d+)/); if (tm) { hr = parseInt(tm[1], 10); min = parseInt(tm[2], 10); exactTimeStr = ("0"+hr).slice(-2) + ":" + ("0"+min).slice(-2); }
      let waitMinutes = parseInt(String(dataVals[r][3]).replace(/[^0-9]/g, ''), 10); if(isNaN(waitMinutes)) waitMinutes = 0;
      let dayOfWeek = rDate.getDay(); let dayType = "平日"; if (isHolidayFunc(rDate) || dayOfWeek === 0) dayType = "日祝"; else if (dayOfWeek === 6) dayType = "土曜"; else if (dayOfWeek === 5) dayType = "金曜";

      let dateStr = `${rDate.getMonth()+1}/${rDate.getDate()}`; let timeStr = `${daysStr[dayOfWeek]}曜 ${exactTimeStr}`;

      if ((memo.includes("チケ") || memo.includes("チケット") || remarks.includes("チケ") || remarks.includes("チケット")) && price >= 5000) { ticketRides.push([dateStr, timeStr, place, price, waitMinutes > 0 ? waitMinutes+"分" : "－", tabName + ": " + memo + " " + remarks]); }
      if (avoidWords.some(w => memo.includes(w) || remarks.includes(w)) || price <= 999) { avoidRides.push([dateStr, timeStr, place, price, waitMinutes > 0 ? waitMinutes+"分" : "－", tabName + ": " + memo + " " + remarks]); }
      if (memo.includes("再現性") || remarks.includes("再現性") || (remarks.trim() !== "" && price >= 5000)) { reproRides.push([dateStr, timeStr, place, price, waitMinutes > 0 ? waitMinutes+"分" : "－", tabName + ": " + memo + " " + remarks]); }

      let specificCat = "ほか"; let searchPlace = removeStreetSuffix(place); let comb = (remarks + " " + place).toUpperCase();
      if (comb.includes("関空") || place.toUpperCase().includes("KIX")) specificCat = "関空"; else if (place.includes("新地7")) specificCat = "北7"; else if (place.includes("新地4")) specificCat = "北4"; else if (place.includes("ドン") || SOUTH_WORDS.some(w => searchPlace.includes(w))) specificCat = "ﾐﾅﾐ"; else if (place.includes("新地") || NORTH_WORDS.some(w => searchPlace.includes(w))) specificCat = "北他";
      let broadArea = (specificCat === "北7" || specificCat === "北4" || specificCat === "北他") ? "北" : (specificCat === "ﾐﾅﾐ" ? "ﾐﾅﾐ" : "ほか");
      totalRidesCount++; if (tabRidesCount[specificCat] !== undefined) tabRidesCount[specificCat]++; else tabRidesCount["ほか"]++;

      let sKey = `${specificCat}|${place}`; let aSt = areaStats[dayType][broadArea];
      aSt.t++; aSt.sales += price; if(waitMinutes > 0) { aSt.waitSum += waitMinutes; aSt.waitCount++; }
      if (!aSt.spots[place]) aSt.spots[place] = {l:0, m:0, s:0, lSum:0, mSum:0, sSum:0, lTimes:{}, mTimes:{}, sTimes:{}};
      let exactDStr = hr !== -1 ? `(${daysStr[dayOfWeek]}) ${exactTimeStr}` : "";

      if (price >= 10000) { aSt.l++; aSt.lSum += price; aSt.spots[place].l++; aSt.spots[place].lSum += price; if(waitMinutes>0){ aSt.lWait += waitMinutes; aSt.lWaitC++; } if(exactDStr) { aSt.spots[place].lTimes[exactDStr] = (aSt.spots[place].lTimes[exactDStr] || 0) + 1; } }
      else if (price >= 5000) { aSt.m++; aSt.mSum += price; aSt.spots[place].m++; aSt.spots[place].mSum += price; if(waitMinutes>0){ aSt.mWait += waitMinutes; aSt.mWaitC++; } if(exactDStr) { aSt.spots[place].mTimes[exactDStr] = (aSt.spots[place].mTimes[exactDStr] || 0) + 1; } }
      else { aSt.s++; aSt.sSum += price; aSt.spots[place].s++; aSt.spots[place].sSum += price; if(waitMinutes>0){ aSt.sWait += waitMinutes; aSt.sWaitC++; } if(exactDStr) { aSt.spots[place].sTimes[exactDStr] = (aSt.spots[place].sTimes[exactDStr] || 0) + 1; } }

      if (!spotStats[sKey]) spotStats[sKey] = {count: 0, sales: 0, waitSum: 0, waitCount: 0, heatmapValidCount: 0};
      spotStats[sKey].count++; spotStats[sKey].sales += price; if(waitMinutes > 0) { spotStats[sKey].waitSum += waitMinutes; spotStats[sKey].waitCount++; }

      if(!spotDayBreakdown[sKey]) { spotDayBreakdown[sKey] = {}; DAY_TYPES.forEach(dt => spotDayBreakdown[sKey][dt] = {c:0, s:0, waits:[], exactTimes:[]}); }
      spotDayBreakdown[sKey][dayType].c++; spotDayBreakdown[sKey][dayType].s += price;
      if (waitMinutes > 0) spotDayBreakdown[sKey][dayType].waits.push(waitMinutes);
      if (hr !== -1) spotDayBreakdown[sKey][dayType].exactTimes.push(`${daysStr[dayOfWeek]}曜 ${exactTimeStr}`);

      if (hr !== -1) {
        if(!spotHotData[sKey]) spotHotData[sKey] = {}; let dhKey = `${dayOfWeek}|${hr}`;
        if(!spotHotData[sKey][dhKey]) spotHotData[sKey][dhKey] = {count: 0, sales: 0, times: []};
        spotHotData[sKey][dhKey].count++; spotHotData[sKey][dhKey].sales += price; spotHotData[sKey][dhKey].times.push(exactTimeStr);
        let isHeatmapValidTime = [20,21,22,23,0,1,2,3,4,5].includes(hr); if(isHeatmapValidTime) spotStats[sKey].heatmapValidCount++;

        if(timelineStats[dayType][hr]) {
          if(!timelineStats[dayType][hr][place]) timelineStats[dayType][hr][place] = {count: 0, sales: 0, waitSum: 0, waitCount: 0, times: []};
          timelineStats[dayType][hr][place].count++; timelineStats[dayType][hr][place].sales += price; timelineStats[dayType][hr][place].times.push(`(${daysStr[dayOfWeek]}) ${exactTimeStr}`);
          if(waitMinutes > 0) { timelineStats[dayType][hr][place].waitSum += waitMinutes; timelineStats[dayType][hr][place].waitCount++; }
        }
        if(isHeatmapValidTime) {
          if(!spotHeatmapSales[sKey]) { spotHeatmapSales[sKey] = {}; spotHeatmapTimes[sKey] = {}; }
          if(!spotHeatmapSales[sKey][dayOfWeek]) { spotHeatmapSales[sKey][dayOfWeek] = {}; spotHeatmapTimes[sKey][dayOfWeek] = {}; }
          if(!spotHeatmapSales[sKey][dayOfWeek][hr]) { spotHeatmapSales[sKey][dayOfWeek][hr] = 0; spotHeatmapTimes[sKey][dayOfWeek][hr] = []; }

          spotHeatmapSales[sKey][dayOfWeek][hr] += price;
          spotHeatmapTimes[sKey][dayOfWeek][hr].push({ time: exactTimeStr, dateStr: dateStr });
        }
        let sortHr = hr < 16 ? hr + 24 : hr; let timeDec = sortHr + (min / 60);
        if (timeDec >= 20 && timeDec <= 29) recordsForGraph.push({ dateStr: dateStr, timeDec: timeDec, price: price, spotName: place, dayOfWeek: dayOfWeek });
      }
    }
  });

  function getBestTimeStr(timesObj) { if(!timesObj) return ""; let maxC = 0, bestT = ""; for(let t in timesObj) { if(timesObj[t] > maxC) { maxC = timesObj[t]; bestT = t; } } return bestT ? " [" + bestT + "]" : ""; }

  let finalTimeline = {}; DAY_TYPES.forEach(dt => finalTimeline[dt] = {});
  let targetHours = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
  DAY_TYPES.forEach(dType => {
    targetHours.forEach(hr => {
      let spots = timelineStats[dType][hr]; let candidates = [];
      for(let pName in spots) { if(spots[pName].count >= 2) { candidates.push({name: pName, count: spots[pName].count, avg: spots[pName].sales / spots[pName].count, wait: spots[pName].waitCount > 0 ? Math.round(spots[pName].waitSum / spots[pName].waitCount) : 0, times: spots[pName].times }); } }
      let bSpot = null, wSpot = null;
      if(candidates.length > 0) { candidates.sort((a,b) => b.avg - a.avg); bSpot = candidates[0]; let avoidCands = candidates.slice(1).filter(c => c.avg <= 1500 || c.avg <= (bSpot.avg - 2000)); if(avoidCands.length > 0) { avoidCands.sort((a,b) => a.avg - b.avg); wSpot = avoidCands[0]; } }
      finalTimeline[dType][hr] = { best: bSpot, worst: wSpot };
    });
  });

  let dashboardUrl = updateDetailedDashboard(ss, startD, endD, recordsForGraph, areaStats, spotHeatmapSales, spotHeatmapTimes, spotStats, spotHotData, spotDayBreakdown, finalTimeline, totalRidesCount, tabRidesCount, DAY_TYPES, ticketRides, avoidRides, reproRides, getBestTimeStr);

  const periodStr = `${startD.getMonth()+1}/${startD.getDate()}(${daysStr[startD.getDay()]})～${endD.getMonth()+1}/${endD.getDate()}(${daysStr[endD.getDay()]})`;
  let flexContents = [];
  flexContents.push({ "type": "box", "layout": "vertical", "backgroundColor": "#fff4e5", "paddingAll": "10px", "cornerRadius": "md", "contents": [ { "type": "text", "text": `📊 今月の総乗車数: ${totalRidesCount}件`, "weight": "bold", "size": "sm", "color": "#e65100" }, { "type": "text", "text": `北7:${tabRidesCount["北7"]}/北4:${tabRidesCount["北4"]}/北他:${tabRidesCount["北他"]}/ﾐﾅﾐ:${tabRidesCount["ﾐﾅﾐ"]}/関空:${tabRidesCount["関空"]}/ほか:${tabRidesCount["ほか"]}`, "size": "xxs", "color": "#666666", "wrap": true, "margin": "xs" } ] });
  flexContents.push({ "type": "separator", "margin": "md" }, { "type": "text", "text": "🔥アツいエリア【パーセント・積立グラフ】", "weight": "bold", "size": "sm", "color": "#1155ca", "margin": "md" });

  DAY_TYPES.forEach(type => {
    let areaRanks = [];
    ["北", "ﾐﾅﾐ", "ほか"].forEach(area => {
      let d = areaStats[type][area]; if(d.t > 0) { areaRanks.push({ name: area, lR: d.l/d.t, score: d.t <= 1 ? -100 : (d.l/d.t), l: d.l, m: d.m, s: d.s, t: d.t, avg: Math.round(d.sales/d.t), wait: d.waitCount > 0 ? Math.round(d.waitSum/d.waitCount) : 0, lA: d.l>0?Math.round(d.lSum/d.l):0, mA: d.m>0?Math.round(d.mSum/d.m):0, sA: d.s>0?Math.round(d.sSum/d.s):0, lW: d.lWaitC>0?Math.round(d.lWait/d.lWaitC):0, mW: d.mWaitC>0?Math.round(d.mWait/d.mWaitC):0, sW: d.sWaitC>0?Math.round(d.sWait/d.sWaitC):0, spots: d.spots }); }
    });
    areaRanks.sort((a,b) => b.score - a.score);
    if(areaRanks.length > 0) {
      let boxContents = [ { "type": "text", "text": `【${type}】`, "size": "sm", "weight": "bold", "color": "#333333", "margin": "sm" } ];
      areaRanks.forEach((r, i) => {
        let lrP = Math.round(r.lR*100); let mrP = Math.round((r.m/r.t)*100); let srP = Math.round((r.s/r.t)*100); let rankStr = r.t > 1 ? (i < 3 ? ["🥇","🥈","🥉"][i] : "") : "(参考)";
        let bestL = "-", bestM = "-", worstS = "-"; let bcL = 0, bcM = 0, bcS = 999999;
        for(let sn in r.spots) { let st = r.spots[sn]; if(st.l > bcL) { bcL = st.l; bestL = sn; } if(st.m > bcM) { bcM = st.m; bestM = sn; } if(st.s > 0 && (st.sSum/st.s) < bcS) { bcS = st.sSum/st.s; worstS = sn; } }
        boxContents.push({ "type": "text", "text": `${rankStr} ${r.name} (${r.t}件／平均￥${r.avg.toLocaleString()}／待ち${r.wait}分)`, "size": "xs", "weight": "bold", "color": "#1155ca", "margin": "md", "wrap": true });

        let percentTexts = []; let percentBars = [];
        if (lrP > 0) { percentTexts.push({ "type": "text", "text": `ﾛﾝｸﾞ${lrP}%`, "color": "#d93025", "size": "xxs", "weight": "bold", "flex": 0 }); percentBars.push({ "type": "box", "layout": "baseline", "backgroundColor": "#d93025", "flex": lrP, "contents": [] }); }
        if (mrP > 0) { percentTexts.push({ "type": "text", "text": `ﾐﾄﾞﾙ${mrP}%`, "color": "#3b82f6", "size": "xxs", "weight": "bold", "flex": 0 }); percentBars.push({ "type": "box", "layout": "baseline", "backgroundColor": "#3b82f6", "flex": mrP, "contents": [] }); }
        if (srP > 0) { percentTexts.push({ "type": "text", "text": `ｼｮｰﾄ${srP}%`, "color": "#888888", "size": "xxs", "weight": "bold", "flex": 0 }); percentBars.push({ "type": "box", "layout": "baseline", "backgroundColor": "#aaaaaa", "flex": srP, "contents": [] }); }
        if (percentTexts.length > 0) { boxContents.push({ "type": "box", "layout": "horizontal", "spacing": "md", "justifyContent": "flex-start", "margin": "xs", "contents": percentTexts }); }
        if (percentBars.length > 0) { boxContents.push({ "type": "box", "layout": "horizontal", "cornerRadius": "md", "height": "8px", "margin": "none", "contents": percentBars }); } else { boxContents.push({ "type": "box", "layout": "horizontal", "cornerRadius": "md", "height": "8px", "margin": "none", "contents": [ { "type": "box", "layout": "baseline", "backgroundColor": "#cccccc", "flex": 1, "contents": [] } ] }); }

        let lTxt = `ﾛﾝｸﾞ：${r.l}件/平均￥${r.lA.toLocaleString()}/待ち${r.lW}分` + (bestL !== "-" ? `\n(🔥アツい：${toHalfWidthKana(bestL)}${getBestTimeStr(r.spots[bestL].lTimes)})` : "");
        let mTxt = `ﾐﾄﾞﾙ：${r.m}件/平均￥${r.mA.toLocaleString()}/待ち${r.mW}分` + (bestM !== "-" ? `\n(🔥アツい：${toHalfWidthKana(bestM)}${getBestTimeStr(r.spots[bestM].mTimes)})` : "");
        let sTxt = `ｼｮｰﾄ：${r.s}件/平均￥${r.sA.toLocaleString()}/待ち${r.sW}分` + (worstS !== "-" ? `\n(⚠️避ける：${toHalfWidthKana(worstS)}${getBestTimeStr(r.spots[worstS].sTimes)})` : "");
        boxContents.push({ "type": "text", "text": lTxt, "size": "xxs", "color": "#d93025", "wrap": true, "margin": "xs", "weight": "bold" }, { "type": "text", "text": mTxt, "size": "xxs", "color": "#3b82f6", "wrap": true, "margin": "xs", "weight": "bold" }, { "type": "text", "text": sTxt, "size": "xxs", "color": "#666666", "wrap": true, "margin": "xs", "weight": "bold" });
      });
      flexContents.push({ "type": "box", "layout": "vertical", "backgroundColor": "#f4f4f4", "paddingAll": "10px", "margin": "sm", "cornerRadius": "md", "contents": boxContents });
    }
  });

  flexContents.push({ "type": "separator", "margin": "lg" }, { "type": "text", "text": "🔥アツい ✖️ ⚠️避ける【曜日・時間】", "weight": "bold", "size": "sm", "color": "#34a853", "margin": "md", "wrap": true });
  DAY_TYPES.forEach(dType => {
    let tLines = []; targetHours.forEach(hr => {
      let b = finalTimeline[dType][hr].best; let w = finalTimeline[dType][hr].worst;
      if(b || w) {
        let bTimeStr = b ? Array.from(new Set(b.times)).sort().join(", ") : "";
        let wTimeStr = w ? Array.from(new Set(w.times)).sort().join(", ") : "";

        if (b) tLines.push({ "type": "text", "size": "xs", "margin": "sm", "wrap": true, "contents": [ { "type": "span", "text": `🔥`, "color": "#444444" }, { "type": "span", "text": `${toHalfWidthKana(b.name)} `, "weight": "bold", "color": "#000000" }, { "type": "span", "text": `(${b.count}件/平￥${Math.round(b.avg).toLocaleString()})\n[${bTimeStr}]`, "color": "#444444" } ]});
        if (w) tLines.push({ "type": "text", "size": "xs", "margin": b ? "none" : "sm", "wrap": true, "contents": [ { "type": "span", "text": (b ? `\n⚠️` : `⚠️`), "color": "#444444" }, { "type": "span", "text": `${toHalfWidthKana(w.name)} `, "weight": "bold", "color": "#000000" }, { "type": "span", "text": `(${w.count}件/平￥${Math.round(w.avg).toLocaleString()})\n[${wTimeStr}]`, "color": "#444444" } ]});
      }
    });
    if(tLines.length === 0) tLines.push({ "type": "text", "text": "データ不足", "size": "xs" });
    flexContents.push({ "type": "box", "layout": "vertical", "backgroundColor": "#e8f5e9", "paddingAll": "8px", "margin": "sm", "cornerRadius": "md", "contents": [ { "type": "text", "text": `【${dType}】`, "size": "xs", "weight": "bold", "color": "#2e7d32", "margin": "none" }, ...tLines ] });
  });

  let flexMessage = { "type": "bubble", "size": "giga", "header": { "type": "box", "layout": "vertical", "backgroundColor": "#1155ca", "paddingAll": "15px", "contents": [ { "type": "text", "text": `📈 【${periodStr}】分析・戦略レポート`, "weight": "bold", "color": "#ffffff", "size": "md", "wrap": true } ] }, "body": { "type": "box", "layout": "vertical", "paddingAll": "12px", "spacing": "none", "contents": flexContents }, "footer": { "type": "box", "layout": "vertical", "paddingAll": "15px", "contents": [ { "type": "button", "style": "primary", "color": "#d93025", "action": { "type": "uri", "label": "🚨ボタンを押せッ!!!!(スプシへ移動)🚨", "uri": dashboardUrl } } ] } };
  // 裏メッセージ（通知やトーク一覧に出る文字）
  const altText = lrAlt_(startD) + "～" + lrAlt_(endD) + "レポート作成 byシバンニ";
  let messages = [ { type: "flex", altText: altText, contents: flexMessage } ];
  const token = getLineToken_();
  // 送信先が無いときに broadcast（公式アカウントの友だち全員に配信）へ落ちないようにする。
  // グループへ送るにはグループIDが要る。未設定なら止める。
  if (!targetId) {
    throw new Error("送信先が未設定です。メニュー「👥 グループIDを設定」から登録してください。" +
                    "（友だち全員への配信を防ぐため中止しました）");
  }
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    payload: JSON.stringify({ to: targetId, messages: messages })
  });
}

/* ============ 🤖 Gemini「傾向と対策」 ============ */

function generateAIText(avgSales, count, waitAvg, timesArr) {
  if (count <= 1) return "データ不足のため判断保留。";
  const key = getGeminiKey_();
  if (!key) return "【AI未設定】GEMINI_API_KEY が未登録です。";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
  const prompt = `あなたはプロのタクシードライバー専用のデータ分析AIです。以下の実績データをもとに、大阪の夜勤タクシードライバー（20:00〜04:00）に向けた今後の戦略やアドバイスを、簡潔に「30文字以内」で出力してください。
  ・平均売上: ${avgSales}円
  ・今月乗車件数: ${count}件
  ・平均待ち時間: ${waitAvg}分
  ・アツい乗車時間帯: ${timesArr.join(", ")}`;

  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  const options = { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true };

  try {
    const res = UrlFetchApp.fetch(endpoint, options);
    const json = JSON.parse(res.getContentText());
    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      let aiText = json.candidates[0].content.parts[0].text.trim();
      return aiText.replace(/\r?\n/g, ' ');
    } else {
      return "【AI分析エラー】データが取得できませんでした。";
    }
  } catch(e) {
    return "【通信エラー】AIに接続できませんでした。";
  }
}

/* ============ 📊 まとめスプシ ダッシュボード作成 ============ */

function updateDetailedDashboard(mainSS, startD, endD, recordsForGraph, areaStats, spotHeatmapSales, spotHeatmapTimes, spotStats, spotHotData, spotDayBreakdown, finalTimeline, totalRidesCount, tabRidesCount, DAY_TYPES, ticketRides, avoidRides, reproRides, getBestTimeStr) {
  let descSheet = mainSS.getSheetByName("説明"); let dashboardId = descSheet ? descSheet.getRange("Z2").getValue() : ""; let dbSS;
  try { if (dashboardId) dbSS = SpreadsheetApp.openById(dashboardId); else throw new Error(); } catch(e) { dbSS = SpreadsheetApp.create("☣️僕はグールだッシュボード☣️"); if (descSheet) descSheet.getRange("Z2").setValue(dbSS.getId()); }
  const daysStr = ["日", "月", "火", "水", "木", "金", "土"]; let tabName = `📈 ${startD.getMonth()+1}/${startD.getDate()}(${daysStr[startD.getDay()]})`;
  let sheet = dbSS.getSheetByName(tabName) || dbSS.insertSheet(tabName, 0); sheet.clear(); sheet.getCharts().forEach(c => sheet.removeChart(c));
  let maxR = sheet.getMaxRows(); if(maxR < 600) sheet.insertRowsAfter(maxR, 600 - maxR);

  for(let i=1; i<=26; i++) sheet.setColumnWidth(i, 50);

  let curRow = 1;
  sheet.getRange(curRow, 1, 1, 26).merge().setValue(`📈 【${startD.getMonth()+1}/${startD.getDate()}～${endD.getMonth()+1}/${endD.getDate()}】 営業ダッシュボード`).setFontSize(14).setFontWeight("bold").setBackground("#e3f2fd").setHorizontalAlignment("center").setVerticalAlignment("middle"); curRow++;

  curRow += 3;

  sheet.getRange(curRow, 1, 1, 26).merge().setValue("🔥アツい乗り場 ✖️ ⚠️避ける乗り場【曜日・時間】 (条件: アツい=平均売上最高 / 避ける=平均￥1,500以下又はアツいより￥2,000以上低い)").setFontWeight("bold").setBackground("#d9ead3"); curRow++;
  let headerRngsTL = getGridRange(sheet, curRow, 1, 1, [2,3,3,2,2,3,3,4,4]);
  let headersTL = ["時間帯", "平日\n(🔥アツい)", "平日\n(⚠️避ける)", "金曜\n(🔥アツい)", "金曜\n(⚠️避ける)", "土曜\n(🔥アツい)", "土曜\n(⚠️避ける)", "日祝\n(🔥アツい)", "日祝\n(⚠️避ける)"];
  for(let i=0; i<9; i++) { headerRngsTL[i].merge().setValue(headersTL[i]).setBackground("#cccccc").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle"); }
  sheet.setRowHeight(curRow, 50); curRow++;

  let targetHours = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
  targetHours.forEach(hr => {
    let rngs = getGridRange(sheet, curRow, 1, 1, [2,3,3,2,2,3,3,4,4]);
    rngs[0].merge().setValue(`${("0"+hr).slice(-2)}時台`).setHorizontalAlignment("center").setVerticalAlignment("middle");
    let colIdx = 1;
    DAY_TYPES.forEach(dType => {
      let b = finalTimeline[dType][hr].best; let w = finalTimeline[dType][hr].worst;
      let bTimeStr = b ? Array.from(new Set(b.times)).sort().join(", ") : "";
      let wTimeStr = w ? Array.from(new Set(w.times)).sort().join(", ") : "";
      rngs[colIdx].merge().setValue(b ? `${b.name}\n(${b.count}件/平均￥${Math.round(b.avg).toLocaleString()})\n[${bTimeStr}]` : "－").setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground("#f4cccc").setFontColor("#990000").setFontWeight("bold").setWrap(true); colIdx++;
      rngs[colIdx].merge().setValue(w ? `${w.name}\n(${w.count}件/平均￥${Math.round(w.avg).toLocaleString()})\n[${wTimeStr}]` : "－").setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground("#f3f3f3").setFontColor("#434343").setFontWeight("bold").setWrap(true); colIdx++;
    });
    sheet.setRowHeight(curRow, 50); curRow++;
  });
  sheet.getRange(curRow - targetHours.length - 1, 1, targetHours.length + 1, 26).setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID);
  curRow++;

  let datesArr = Array.from(new Set(recordsForGraph.map(r => r.dateStr))).sort();
  let dateColorMap = {}; datesArr.forEach((d, i) => { dateColorMap[d] = GRAPH_COLORS[i % GRAPH_COLORS.length]; });

  let daysOrder = [1, 2, 3, 4, 5, 6, 0]; let heatmapSpotNames = []; let hiddenDataRow = 900;
  for (let key in spotStats) {
    if(spotStats[key].heatmapValidCount >= 3 && spotHeatmapSales[key]) {
      let parts = key.split("|"); let tName = parts[0]; let spotName = parts[1]; heatmapSpotNames.push(spotName);
      sheet.getRange(curRow, 1, 1, 18).merge().setValue(`🔥 【${spotName}】曜日×時間帯別ヒートマップ (条件: 時間帯20〜29内で月間3件以上の実績)`).setFontWeight("bold").setBackground(TAB_COLORS[tName] || "#fce5cd"); curRow++;
      let headerRngs = getGridRange(sheet, curRow, 1, 1, [2,2,2,2,2,2,2,2,2]);
      let dayHeaders = ["時間帯", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜", "日曜", ""];
      for(let i=0; i<9; i++) { headerRngs[i].merge().setValue(dayHeaders[i]).setBackground("#cccccc").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle"); }
      sheet.setRowHeight(curRow, 50); curRow++;

      let hmAvgSalesList = [];
      targetHours.forEach(hr => { daysOrder.forEach(d => { let s = (spotHeatmapSales[key][d] && spotHeatmapSales[key][d][hr]) ? spotHeatmapSales[key][d][hr] : 0; let tArr = (spotHeatmapTimes[key][d] && spotHeatmapTimes[key][d][hr]) ? spotHeatmapTimes[key][d][hr] : []; let avg = s > 0 ? Math.round(s / tArr.length) : 0; if (avg > 0) hmAvgSalesList.push(avg); }); });
      let top3 = [...new Set(hmAvgSalesList)].sort((a,b)=>b-a).slice(0,3);

      targetHours.forEach(hr => {
        let rngs = getGridRange(sheet, curRow, 1, 1, [2,2,2,2,2,2,2,2,2]);
        rngs[0].merge().setValue(`${("0"+hr).slice(-2)}時台`).setHorizontalAlignment("center").setVerticalAlignment("middle");
        let colIdx = 1;
        daysOrder.forEach(d => {
          let s = (spotHeatmapSales[key][d] && spotHeatmapSales[key][d][hr]) ? spotHeatmapSales[key][d][hr] : 0; let timesArr = (spotHeatmapTimes[key][d] && spotHeatmapTimes[key][d][hr]) ? spotHeatmapTimes[key][d][hr] : [];
          let avgSales = s > 0 ? Math.round(s / timesArr.length) : 0;
          let cell = rngs[colIdx].merge().setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);

          if (avgSales > 0) {
            let matchedColor = dateColorMap[timesArr[0].dateStr] || "#333333";
            let timeStrJoined = timesArr.map(t => t.time).join(", ");
            let cellText = `平均￥${avgSales.toLocaleString()}\n[${timeStrJoined}]`;

            let rt = SpreadsheetApp.newRichTextValue().setText(cellText);
            rt.setTextStyle(0, cellText.indexOf('\n'), SpreadsheetApp.newTextStyle().setBold(true).setForegroundColor("#000000").build());
            rt.setTextStyle(cellText.indexOf('\n') + 1, cellText.length, SpreadsheetApp.newTextStyle().setBold(true).setForegroundColor(matchedColor).build());

            let rankIdx = top3.indexOf(avgSales);
            if (rankIdx === 0) cell.setBackground("#f4cccc"); else if (rankIdx === 1) cell.setBackground("#fff2cc"); else if (rankIdx === 2) cell.setBackground("#cfe2f3"); else cell.setBackground("#ffffff");

            if(rankIdx !== -1) {
                cellText += `\n${["🥇","🥈","🥉"][rankIdx]}`;
                rt = SpreadsheetApp.newRichTextValue().setText(cellText);
                rt.setTextStyle(0, cellText.indexOf('\n'), SpreadsheetApp.newTextStyle().setBold(true).setForegroundColor("#000000").build());
                rt.setTextStyle(cellText.indexOf('\n') + 1, cellText.indexOf('\n', cellText.indexOf('\n')+1), SpreadsheetApp.newTextStyle().setBold(true).setForegroundColor(matchedColor).build());
            }
            cell.setRichTextValue(rt.build());
          } else { cell.setValue("－").setFontColor("#b7b7b7").setBackground("#ffffff"); }
          colIdx++;
        });
        rngs[8].merge(); sheet.setRowHeight(curRow, 50); curRow++;
      });
      sheet.getRange(curRow - 11, 1, 11, 16).setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID);

      let recs = recordsForGraph.filter(r => r.spotName === spotName);
      if(recs.length > 0) {
        let header = ["時間"]; datesArr.forEach(d => { header.push("'" + d); }); let table = [header];
        let times = Array.from(new Set(recs.map(r => r.timeDec))).sort((a,b) => a - b);
        for(let t of times) { let row = [t]; for(let d of datesArr) { let rec = recs.find(r => r.timeDec === t && r.dateStr === d); row.push(rec ? rec.price : null); } table.push(row); }
        if (table.length > 1) {
          let dataRng = sheet.getRange(hiddenDataRow, 1, table.length, header.length); sheet.getRange(hiddenDataRow, 1, 1, header.length).setNumberFormat('@'); dataRng.setValues(table);
          let seriesOpt = {}; for (let i = 0; i < datesArr.length; i++) { seriesOpt[i] = { lineWidth: 1, lineDashStyle: [4, 4], pointShape: 'circle', pointSize: 4, color: dateColorMap[datesArr[i]], labelInLegend: datesArr[i] }; }
          let customTicks = []; for(let i=20; i<=29.1; i+=1/6) { customTicks.push(Math.round(i*1000)/1000); }
          let maxP = Math.max(...recs.map(r=>r.price)) || 10000; let vTicks = []; for(let v=0; v<=maxP+2000; v+=1000) vTicks.push(v);

          let chart = sheet.newChart().asLineChart().addRange(dataRng).setPosition(curRow, 1, 0, 0)
            .setOption('title', `📈 【${spotName}】詳細分数・売上推移`).setOption('hAxis', {title: '時間 (10分単位)', minValue: 20, maxValue: 29, ticks: customTicks, gridlines: {color: '#e0e0e0'}})
            .setOption('vAxis', {title: '売上金額 (￥1,000単位)', format: '￥#,##0', ticks: vTicks, gridlines: {color: '#e0e0e0'}}).setOption('series', seriesOpt).setOption('useFirstColumnAsDomain', true).setOption('headers', 1)
            .setOption('legend', {position: 'right', textStyle: {fontSize: 11}}).setOption('chartArea', {left: '8%', top: '10%', width: '75%', height: '75%'}).setOption('interpolateNulls', true)
            .setOption('width', 900).setOption('height', 400).build();
          sheet.insertChart(chart); hiddenDataRow += 40;
        }
      }
      curRow += 20;
    }
  }

  sheet.getRange(curRow, 1, 1, 26).merge().setValue("🔥 個別乗り場 実績 (条件: ヒートマップ基準未達の月間1～2件の個別乗り場)").setFontWeight("bold").setBackground("#cfe2f3"); curRow++;
  let spotHeaderSpans = [1, 2, 4, 3, 3, 8];
  let shRngs = getGridRange(sheet, curRow, 1, 1, spotHeaderSpans);
  let sHeaders = ["タブ", "乗り場名", "🔥アツい乗車時間\n(具体的な曜日・時間)", "待ち時間内訳\n(各曜日の平均)", "今月件数内訳\n(各金額帯)", "🤖 傾向と対策 (Gemini AI自動分析)"];
  for(let i=0; i<6; i++) { shRngs[i].merge().setValue(sHeaders[i]).setBackground("#cccccc").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle"); }
  sheet.setRowHeight(curRow, 50); curRow++;

  let spotRowsData = [];
  for (let key in spotStats) {
    let p = key.split("|"); let tab = p[0], name = p[1]; if(heatmapSpotNames.includes(name)) continue; let d = spotStats[key];
    let bAvg = Math.round(d.sales / d.count);
    spotRowsData.push({tab: tab, name: name, d: d, avgSales: bAvg, key: key});
  }
  const tOrder = {"北7":1, "北4":2, "北他":3, "ﾐﾅﾐ":4, "関空":5, "ほか":6};
  spotRowsData.sort((a,b) => (tOrder[a.tab]||99) - (tOrder[b.tab]||99) || b.avgSales - a.avgSales);

  for (let item of spotRowsData) {
    let bestT = "データ不足";
    let allTimes = [];
    if(spotHotData[item.key]) {
        let bC=-1, bS=-1;
        for(let dh in spotHotData[item.key]) {
            let hd = spotHotData[item.key][dh];
            allTimes.push(...hd.times);
            if(hd.count > bC || (hd.count===bC && hd.sales>bS)) {
                bC=hd.count; bS=hd.sales; let p2=dh.split("|");
                bestT=`(${daysStr[p2[0]]}) ${("0"+p2[1]).slice(-2)}時台\n${bC}件(平均￥${Math.round(bS/bC).toLocaleString()})\n[${hd.times.join(", ")}]`;
            }
        }
    }

    let waitText = ""; let wArrAll = [];
    if(spotDayBreakdown[item.key]) {
      DAY_TYPES.forEach(dt => {
          if(spotDayBreakdown[item.key][dt] && spotDayBreakdown[item.key][dt].waits.length>0) {
              let wArr = spotDayBreakdown[item.key][dt].waits; wArrAll.push(...wArr);
              let wAvg = Math.round(wArr.reduce((a,b)=>a+b,0)/wArr.length); waitText += `${dt}平均: ${wAvg}分\n`;
          }
      });
    }
    if(!waitText) waitText = "記録なし";

    let priceStyleText = `計${item.d.count}件\n(平均￥${item.avgSales.toLocaleString()})`;
    let overallWait = wArrAll.length > 0 ? Math.round(wArrAll.reduce((a,b)=>a+b,0)/wArrAll.length) : 0;

    let aiAdvice = generateAIText(item.avgSales, item.d.count, overallWait, allTimes);

    let drngs = getGridRange(sheet, curRow, 1, 1, spotHeaderSpans);
    drngs[0].merge().setValue(item.tab).setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground(TAB_COLORS[item.tab]||"#ffffff").setFontWeight("bold");
    drngs[1].merge().setValue(item.name).setHorizontalAlignment("left").setVerticalAlignment("middle").setWrap(true).setFontWeight("bold").setFontSize(11);
    drngs[2].merge().setValue(bestT).setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true).setFontWeight("bold").setFontSize(11);
    drngs[3].merge().setValue(waitText).setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);

    let pCell = drngs[4].merge().setValue(priceStyleText).setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true).setFontWeight("bold").setFontSize(11);
    if(item.avgSales >= 20000) pCell.setFontColor("#990000"); else if(item.avgSales >= 10000) pCell.setFontColor("#b45f06"); else if(item.avgSales >= 5000) pCell.setFontColor("#0b5394"); else pCell.setFontColor("#4b0082");

    drngs[5].merge().setValue(aiAdvice).setHorizontalAlignment("left").setVerticalAlignment("middle").setWrap(true).setFontColor("#274e13").setFontWeight("bold");

    sheet.setRowHeight(curRow, 100); curRow++;
  }
  if(spotRowsData.length === 0) {
      getGridRange(sheet, curRow, 1, 1, spotHeaderSpans)[1].merge().setValue("該当データなし"); sheet.setRowHeight(curRow, 50); curRow++;
  }
  sheet.getRange(curRow - spotRowsData.length - 2, 1, spotRowsData.length + 2, 21).setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID);
  curRow++;

  function createSpecialTable(title, dataArr, startRow, bgC, isAvoid) {
    sheet.setRowHeight(startRow, 21); let titleRow = startRow + 1;
    sheet.getRange(titleRow, 1, 1, 26).merge().setValue((isAvoid ? "⚠️ " : "🔥 ") + title).setFontWeight("bold").setBackground(bgC);
    let hSpans = [1, 2, 4, 2, 2, 8];
    let headerRow = titleRow + 1;
    let hRngs = getGridRange(sheet, headerRow, 1, 1, hSpans); let sHeaders = ["タブ", "乗り場名", "日付・曜日・時間", "待ち時間", "金額", "備考"];
    for(let i=0; i<6; i++) { hRngs[i].merge().setValue(sHeaders[i]).setBackground("#cccccc").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle"); }
    sheet.setRowHeight(headerRow, 50);

    dataArr.sort((a,b) => isAvoid ? a[3] - b[3] : b[3] - a[3]);

    let dataStart = headerRow + 1;
    if(dataArr.length > 0) {
      for(let i=0; i<dataArr.length; i++) {
        let rData = dataArr[i]; let rowIdx = dataStart + i;
        let dRngs = getGridRange(sheet, rowIdx, 1, 1, hSpans);
        let tabN = rData[5].split(":")[0];
        dRngs[0].merge().setValue(tabN).setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground(TAB_COLORS[tabN] || "#ffffff");
        dRngs[1].merge().setValue(rData[2]).setHorizontalAlignment("left").setVerticalAlignment("middle").setWrap(true).setFontWeight("bold").setFontSize(11);
        dRngs[2].merge().setValue(rData[0]+" "+rData[1]).setHorizontalAlignment("left").setVerticalAlignment("middle").setWrap(true).setFontWeight("bold").setFontSize(11);
        dRngs[3].merge().setValue(rData[4]).setHorizontalAlignment("right").setVerticalAlignment("middle");

        let priceCell = dRngs[4].merge().setValue(rData[3]).setNumberFormat('￥#,##0').setHorizontalAlignment("right").setVerticalAlignment("middle").setFontWeight("bold").setFontSize(11);
        if (isAvoid && rData[3] <= 999) {
            dRngs.forEach(rng => { rng.setBackground("#f3f3f3").setFontColor("#434343"); });
            priceCell.setBackground("#f3f3f3").setFontColor("#434343");
        } else {
            if (rData[3] >= 20000) { priceCell.setBackground("#f4cccc").setFontColor("#990000"); } else if (rData[3] >= 10000) { priceCell.setBackground("#fff2cc").setFontColor("#b45f06"); } else if (rData[3] >= 5000) { priceCell.setBackground("#cfe2f3").setFontColor("#0b5394"); }
        }
        dRngs[5].merge().setValue(rData[5].substring(rData[5].indexOf(":")+1)).setHorizontalAlignment("left").setVerticalAlignment("middle").setWrap(true);
        sheet.setRowHeight(rowIdx, 100);
      }
    } else {
      getGridRange(sheet, dataStart, 1, 1, hSpans)[1].merge().setValue("データなし"); sheet.setRowHeight(dataStart, 50);
    }
    sheet.getRange(headerRow, 1, Math.max(1, dataArr.length) + 1, 19).setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID);
    return dataStart + Math.max(1, dataArr.length);
  }

  curRow = createSpecialTable("再現したい乗車 一覧 (条件: 再現性を含む 又は 備考ありで￥5,000以上)", reproRides, curRow, "#cfe2f3", false);
  curRow = createSpecialTable("チケット乗車 一覧 (条件: 備考にチケを含み、かつ￥5,000以上)", ticketRides, curRow, "#fff2cc", false);
  curRow = createSpecialTable("避けたい乗車 一覧 (条件: NGワードを含む 又は ￥999以下)", avoidRides, curRow, "#f4cccc", true);
  return dbSS.getUrl();
}
