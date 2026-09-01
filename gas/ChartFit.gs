/**
 * ================================================================
 *  グラフのサイズ・位置を揃える（ChartFit.gs）
 *
 *  ★記録用スプシの Apps Script プロジェクトに別ファイルとして追加。
 *    （まとめスプシ側にはコードを置かず、こちらから ID 指定で操作する）
 *
 *  ダッシュボードのグラフが
 *    ・A列から始まっていない（中途半端な位置に浮いている）
 *    ・幅がバラバラで、Z列まで使っている表と揃っていない
 *    ・高さが足りず、次のセクションの見出しに重なる
 *  という状態になっているのを、まとめて直す。
 *
 *  グラフの幅は「A列〜Z列の実際の列幅の合計」に合わせる。
 *  列幅を変えても自動で追随する。
 * ================================================================
 */

/** まとめスプシのID（URLの /d/ と /edit の間） */
const CF_SUMMARY_SS_ID = "1A20PNddktpFilQ2VhIPjklODDQr6CPa9QE16YOGnURg";

const CF_LAST_COL   = 26;    // Z列まで
const CF_MARGIN_PX  = 2;     // 右端に残す余白
const CF_RATIO      = 0.42;  // 高さ = 幅 × これ
const CF_MIN_HEIGHT = 260;
const CF_MAX_HEIGHT = 520;
const CF_ROW_PX     = 21;    // 行の高さ（BASE_H と同じ）

/* ============ 計算（シートに触らない部分） ============ */

/** 幅から高さを決める。極端に縦長／横長にならないよう上下で止める */
function cfHeightFor_(width) {
  const h = Math.round(width * CF_RATIO);
  return Math.min(CF_MAX_HEIGHT, Math.max(CF_MIN_HEIGHT, h));
}

/** そのグラフが何行ぶんの高さになるか（重なり判定に使う） */
function cfRowsNeeded_(height) {
  return Math.ceil(height / CF_ROW_PX);
}

/** A列〜指定列の幅の合計 */
function cfWidthOf_(sheet, lastCol) {
  let w = 0;
  const n = Math.min(lastCol, sheet.getMaxColumns());
  for (let c = 1; c <= n; c++) w += sheet.getColumnWidth(c);
  return w;
}

/* ============ 実際に直す ============ */

/**
 * 1枚のシートのグラフを全部そろえる。
 * 戻り値 { n, width, height, items:[...] }
 *   items … 直した内容と、下に何行必要かの記録
 */
function cfFitSheet_(sheet) {
  const charts = sheet.getCharts();
  const width  = Math.max(200, cfWidthOf_(sheet, CF_LAST_COL) - CF_MARGIN_PX);
  const height = cfHeightFor_(width);
  const rows   = cfRowsNeeded_(height);
  const items  = [];

  charts.forEach(function (chart) {
    const info = chart.getContainerInfo();
    const from = {
      row: info.getAnchorRow(), col: info.getAnchorColumn(),
      x: info.getOffsetX(), y: info.getOffsetY()
    };

    // 常にA列の左端から始めて、幅をZ列に合わせる
    const rebuilt = chart.modify()
      .setPosition(from.row, 1, 0, 0)
      .setOption("width", width)
      .setOption("height", height)
      .build();
    sheet.updateChart(rebuilt);

    items.push({
      row: from.row,
      movedFrom: (from.col !== 1 || from.x !== 0 || from.y !== 0)
        ? ("列" + from.col + " +" + from.x + "," + from.y) : "",
      needRows: rows
    });
  });

  return { n: charts.length, width: width, height: height, rows: rows, items: items };
}

/** まとめスプシ（または現在のスプシ）の全シートを直す */
function cfFitAll_(ss) {
  const out = { sheets: [], total: 0 };
  ss.getSheets().forEach(function (sh) {
    const r = cfFitSheet_(sh);
    if (!r.n) return;
    out.sheets.push({ name: sh.getName(), r: r });
    out.total += r.n;
  });
  return out;
}

/* ============ メニュー ============ */

function menuChartFit() {
  runnerDialog_({
    title: "📐 グラフの大きさをZ列に合わせる",
    color: "#188038",
    desc: "まとめスプシの全タブのグラフを、<br>" +
          "<b>A列の左端から Z列の右端まで</b>の幅にそろえます。<br>" +
          "高さは幅に合わせて自動で決まります（" + CF_MIN_HEIGHT + "〜" + CF_MAX_HEIGHT + "px）。<br><br>" +
          "グラフの下に空き行が足りない場合は、必要な行数を報告します。",
    applyLabel: "全部そろえる",
    fn: "runChartFit",
    h: 240, height: 620
  });
}

function runChartFit(_apply) {
  progClear_();
  progSet_(5, "まとめスプシを開いています");

  let ss;
  try {
    ss = SpreadsheetApp.openById(CF_SUMMARY_SS_ID);
  } catch (e) {
    return "⚠️ まとめスプシを開けませんでした。\n" +
           "CF_SUMMARY_SS_ID が正しいか、共有設定を確認してください。\n\n" + e.message;
  }

  const sheets = ss.getSheets();
  let total = 0;
  let body = "";
  sheets.forEach(function (sh, i) {
    progSet_(Math.round(10 + 85 * i / sheets.length), sh.getName() + " を調整中");
    let r;
    try { r = cfFitSheet_(sh); } catch (e) { body += sh.getName() + " : エラー " + e.message + "\n"; return; }
    if (!r.n) return;
    total += r.n;
    body += "【" + sh.getName() + "】グラフ " + r.n + "個\n";
    body += "  幅 " + r.width + "px × 高さ " + r.height + "px（" + r.rows + "行ぶん）\n";
    const moved = r.items.filter(function (x) { return x.movedFrom; });
    if (moved.length) {
      body += "  位置を直した: " + moved.length + "個\n";
      moved.slice(0, 5).forEach(function (x) {
        body += "    " + x.row + "行目（" + x.movedFrom + " → A列）\n";
      });
    }
  });

  progSet_(100, "完了");
  if (!total) return "グラフが1つも見つかりませんでした。";

  return "✅ グラフ " + total + "個をZ列の幅にそろえました\n" +
         "──────────────\n" + body +
         "\n──────────────\n" +
         "※グラフの下に " + cfRowsNeeded_(cfHeightFor_(1000)) +
         "行前後の空きが無いと、次の見出しに重なります。\n" +
         "レポート生成側で、グラフの下に空き行を確保する必要があります。";
}

/** 今どうなっているかを見るだけ（変更しない） */
function menuChartInspect() {
  runnerDialog_({
    title: "🔎 グラフの現状を見る",
    color: "#0b5394",
    desc: "まとめスプシのグラフが、今どの位置・どの大きさかを一覧にします。<br>" +
          "<b>変更はしません。</b>",
    applyLabel: "一覧を出す",
    fn: "runChartInspect",
    h: 240, height: 620
  });
}

function runChartInspect(_apply) {
  progClear_();
  let ss;
  try {
    ss = SpreadsheetApp.openById(CF_SUMMARY_SS_ID);
  } catch (e) {
    return "⚠️ まとめスプシを開けませんでした。\n" + e.message;
  }

  let out = "";
  ss.getSheets().forEach(function (sh) {
    const charts = sh.getCharts();
    if (!charts.length) return;
    const zWidth = cfWidthOf_(sh, CF_LAST_COL);
    out += "【" + sh.getName() + "】A〜Z列の幅 = " + zWidth + "px\n";
    charts.forEach(function (c, i) {
      const info = c.getContainerInfo();
      const w = c.getOptions().get("width");
      const h = c.getOptions().get("height");
      out += "  グラフ" + (i + 1) + ": " + info.getAnchorRow() + "行 " +
             info.getAnchorColumn() + "列 (+" + info.getOffsetX() + "," + info.getOffsetY() + ")" +
             "  " + w + "×" + h + "px\n";
      if (info.getAnchorColumn() !== 1) out += "      ⚠️ A列から始まっていません\n";
      if (Math.abs(Number(w) - zWidth) > 40) out += "      ⚠️ Z列の幅と合っていません\n";
    });
    out += "\n";
  });

  return out || "グラフが1つも見つかりませんでした。";
}
