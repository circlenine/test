/**
 * ================================================================
 *  売上レポート（Report.gs）
 *
 *  ★統合スクリプト（Code.gs / v232）と同じプロジェクトに
 *    「別ファイル」として追加してください。
 *    ALL_TABS・C_DATE・normalizePlace_ などは統合スクリプト側のものを
 *    そのまま使うため、このファイルには重複定義を置いていません。
 *
 *  ★メニューに出すには、統合スクリプトの onOpen() 内 m4 に
 *    次の1行を足してください（詳しくは README.md）:
 *      .addItem("📊 売上レポートを作る", "menuSalesReport")
 *
 *  出力は「レポート」タブ。ALL_TABS に含まれないので、
 *  formatTab_ / rebuildDerivedTabs / onEdit の対象外です。
 *
 *  【セクション1】自社実績（平均売上）
 *      A列が「ｵﾌﾟﾁｬ」または空白の行を除外した、自分たちの実績。
 *      オプチャは他人の目撃情報なので、混ぜると自分たちの平均が歪む。
 *
 *  【セクション2】大物マップ（件数分布）
 *      オプチャ込みの全行を対象に、乗り場ごとの金額帯別件数を出す。
 *      「どこで大物が出ているか」は他人の情報も含めて見たいため。
 * ================================================================
 */

const RP_SHEET = "レポート";

// 金額帯。記録用スプシのセル色（F列）と同じ区切りにしてある
const RP_TIERS = [
  { min: 20000, label: "特大 ¥20,000〜", bg: "#ffbbd9", tx: "#a61c00" },
  { min: 10000, label: "大物 ¥10,000〜", bg: "#ffe086", tx: "#7f6000" },
  { min:  5000, label: "中 ¥5,000〜",    bg: "#c6f6ff", tx: "#1155ca" },
  { min:     0, label: "小 〜¥5,000",    bg: "#ffffff", tx: "#000000" }
];
const RP_BIG_MIN = 10000;          // これ以上を「大物」と数える
const RP_NO_PLACE = "(乗り場なし)";

/* ============ メニュー ============ */

function menuSalesReport() {
  runnerDialog_({
    title: "📊 売上レポートを作る",
    color: "#0b5394",
    desc: "「レポート」タブに2つの表を作ります。<br>" +
          "<b>①自社実績</b>… A列が「ｵﾌﾟﾁｬ」または<b>空白</b>の行を除いた平均売上<br>" +
          "<b>②大物マップ</b>… オプチャ込みの全件で、乗り場ごとの件数分布<br>" +
          "※記録用のタブは一切変更しません。",
    applyLabel: "レポートを作る",
    fn: "runSalesReport",
    h: 240
  });
}

function runSalesReport(_apply) {
  progClear_();
  return buildSalesReport();
}

/* ============ 本体 ============ */

/** レポートを作って、結果の要約テキストを返す */
function buildSalesReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  progSet_(10, "全タブを読み込み中");
  const data = rp_collect_();
  if (!data.rows.length) {
    return "⚠️ 集計できる行がありませんでした。\nF列（金）に金額が入った行が見つかりません。";
  }

  progSet_(45, "乗り場名をまとめています");
  const index = rp_buildPlaceIndex_(data.rows);

  progSet_(60, "レポートを書き出し中");
  const sh = rp_prepareSheet_(ss);
  let row = rp_writeHead_(sh, 1, data);
  const own = rp_writeOwnSection_(sh, row + 1, data);
  progSet_(80, "大物マップを作成中");
  rp_writeBigMapSection_(sh, own.nextRow + 2, data, index);

  sh.setColumnWidth(1, 190);
  for (let c = 2; c <= 9; c++) sh.setColumnWidth(c, 92);
  sh.setFrozenRows(0);
  ss.setActiveSheet(sh);

  progSet_(100, "完了");
  return rp_summaryText_(data, own);
}

/**
 * 全タブ（ALL_TABS）を読んで、重複を除いた1件1行の配列にする。
 *
 * エリアタブ・関空・ﾊﾞﾗｼ は個人タブの写しなので、そのまま数えると
 * 二重・三重に数えてしまう。J列は写し側だけ埋まることがあり当てにならないため、
 * 内容（名前・営業日・乗車時間・金額・乗り場）で重複を判定する。
 */
function rp_collect_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const seen = {}, rows = [];
  let dup = 0, noMoney = 0;
  let minD = null, maxD = null;
  const unknownWho = {};

  ALL_TABS.forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const last = sh.getLastRow();
    if (last < START_ROW) return;

    sh.getRange(START_ROW, 1, last - START_ROW + 1, LAST_COL).getValues().forEach(function (r) {
      const date = r[C_DATE - 1];
      if (!(date instanceof Date)) return;                 // 空行

      const money = parseInt(String(r[C_MONEY - 1]).replace(/[^0-9]/g, ""), 10);
      if (isNaN(money) || money <= 0) { noMoney++; return; } // 年見出し・金額不明

      const who   = String(r[C_SENDER - 1]).trim();
      const place = String(r[C_PLACE - 1]).replace(/\n/g, "").trim();
      const time  = String(r[C_TIME - 1]).trim();

      const key = who + "|" + ymdOf_(date) + "|" + time + "|" + money + "|" + normalizePlace_(place);
      if (seen[key]) { dup++; return; }
      seen[key] = true;

      const opucha = rp_isOpucha_(who);
      if (!opucha && PERSONAL_TABS.indexOf(who) === -1) {
        unknownWho[who] = (unknownWho[who] || 0) + 1;
      }
      if (!minD || date < minD) minD = date;
      if (!maxD || date > maxD) maxD = date;

      rows.push({ who: who, date: date, time: time, money: money,
                  place: place, isOpucha: opucha });
    });
  });

  return { rows: rows, dup: dup, noMoney: noMoney,
           minD: minD, maxD: maxD, unknownWho: unknownWho };
}

/**
 * A列がオプチャ由来かどうか。
 *   ・空白はオプチャ扱い（実際の記録では、オプチャ由来はA列が空のまま入っている）
 *   ・「ｵﾌﾟﾁｬ」「オープンチャット」表記も拾う（半角カナは全角に直してから判定）
 */
function rp_isOpucha_(who) {
  const v = toFullKana_(String(who == null ? "" : who)).replace(/[\s　]/g, "");
  if (v === "") return true;
  return /オプチャ|オープンチャット/.test(v);
}

/**
 * 乗り場名をまとめる索引を作る。
 *   disp  … 正規化名 → 一番よく使われている書き方（表示用）
 *   merge … 正規化名 → 寄せ先（REPORT_MERGE_RULES。1件しかない名前だけが対象）
 */
function rp_buildPlaceIndex_(rows) {
  const g = {};
  rows.forEach(function (r) {
    const k = normalizePlace_(r.place) || RP_NO_PLACE;
    if (!g[k]) g[k] = { count: 0, variants: {} };
    g[k].count++;
    const raw = r.place || RP_NO_PLACE;
    g[k].variants[raw] = (g[k].variants[raw] || 0) + 1;
  });

  const disp = {};
  Object.keys(g).forEach(function (k) {
    const vs = Object.keys(g[k].variants).sort(function (a, b) {
      return g[k].variants[b] - g[k].variants[a];
    });
    disp[k] = vs[0];
  });

  // レポートのときだけ寄せる。1件しかない名前に限る
  // （「ドン2三ツ寺」のような1回きりの表記だけを「ドン2」へまとめ、
  //   何度も使われている正式な乗り場名は動かさないため）
  const merge = {};
  Object.keys(g).forEach(function (k) {
    if (g[k].count !== 1) return;
    for (let i = 0; i < REPORT_MERGE_RULES.length; i++) {
      const R = REPORT_MERGE_RULES[i];
      if (R.from.test(disp[k])) {
        const tk = normalizePlace_(R.to);
        merge[k] = { key: tk, name: disp[tk] || R.to };
        break;
      }
    }
  });

  return { disp: disp, merge: merge };
}

/** その行がどの乗り場グループに属するか { key, name } */
function rp_placeOf_(index, place) {
  const k = normalizePlace_(place) || RP_NO_PLACE;
  const m = index.merge[k];
  if (m) return m;
  return { key: k, name: index.disp[k] || place || RP_NO_PLACE };
}

/** 金額が何番目の帯か */
function rp_tierIndex_(money) {
  for (let i = 0; i < RP_TIERS.length; i++) {
    if (money >= RP_TIERS[i].min) return i;
  }
  return RP_TIERS.length - 1;
}

/* ============ 書き出し ============ */

function rp_prepareSheet_(ss) {
  let sh = ss.getSheetByName(RP_SHEET);
  if (sh) {
    sh.clear();
    if (sh.getFilter()) sh.getFilter().remove();
  } else {
    sh = ss.insertSheet(RP_SHEET);
  }
  return sh;
}

function rp_writeHead_(sh, row, data) {
  const now = new Date();
  const period = (data.minD && data.maxD)
    ? (fmtDate_(data.minD) + " 〜 " + fmtDate_(data.maxD)) : "-";
  sh.getRange(row, 1).setValue("📊 売上レポート")
    .setFontSize(15).setFontWeight("bold");
  sh.getRange(row + 1, 1).setValue(
    "集計期間 " + period + "　/　作成 " +
    (now.getMonth() + 1) + "/" + now.getDate() + " " +
    pad2_(now.getHours()) + ":" + pad2_(now.getMinutes()) +
    "　/　全 " + data.rows.length + "件（重複 " + data.dup + "件を除外済み）")
    .setFontSize(9).setFontColor("#666666");
  return row + 2;
}

function rp_sectionTitle_(sh, row, title, note, color) {
  sh.getRange(row, 1).setValue(title)
    .setFontSize(13).setFontWeight("bold").setFontColor(color);
  sh.getRange(row + 1, 1).setValue(note).setFontSize(9).setFontColor("#666666");
  return row + 2;
}

function rp_headerRow_(sh, row, labels) {
  sh.getRange(row, 1, 1, labels.length).setValues([labels])
    .setFontWeight("bold").setBackground("#f0f0f0")
    .setHorizontalAlignment("center")
    .setBorder(true, true, true, true, true, true, "#cccccc", SpreadsheetApp.BorderStyle.SOLID);
  return row + 1;
}

/** セクション1: 自社実績（オプチャ・空白を除外） */
function rp_writeOwnSection_(sh, row, data) {
  const own = data.rows.filter(function (r) { return !r.isOpucha; });
  const excluded = data.rows.length - own.length;

  row = rp_sectionTitle_(sh, row,
    "【自社実績】平均売上",
    "母集団: A列が「ｵﾌﾟﾁｬ」または空白の行を除外（除外 " + excluded +
    "件 / 全 " + data.rows.length + "件）",
    "#0b5394");

  const labels = ["メンバー", "件数", "売上合計", "平均売上", "中央値", "最高額",
                  "大物件数", "大物率"];
  row = rp_headerRow_(sh, row, labels);
  const top = row;

  const table = [];
  if (own.length) table.push(rp_statLine_("■ 全体", own));

  const byWho = {};
  own.forEach(function (r) { (byWho[r.who] = byWho[r.who] || []).push(r); });
  Object.keys(byWho)
    .sort(function (a, b) { return byWho[b].length - byWho[a].length; })
    .forEach(function (w) { table.push(rp_statLine_(w, byWho[w])); });

  if (table.length) {
    const rg = sh.getRange(row, 1, table.length, labels.length);
    rg.setValues(table);
    rg.setBorder(true, true, true, true, true, true, "#cccccc", SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(row, 2, table.length, 1).setNumberFormat("#,##0");
    sh.getRange(row, 3, table.length, 4).setNumberFormat('"¥"#,##0');
    sh.getRange(row, 7, table.length, 1).setNumberFormat("#,##0");
    sh.getRange(row, 8, table.length, 1).setNumberFormat("0.0%");
    sh.getRange(row, 1, 1, labels.length).setFontWeight("bold").setBackground("#e8f0fe");
    row += table.length;
  }

  return { nextRow: row, own: own, excluded: excluded, top: top };
}

function rp_statLine_(name, list) {
  const v = list.map(function (r) { return r.money; }).sort(function (a, b) { return a - b; });
  const sum = v.reduce(function (a, b) { return a + b; }, 0);
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  const big = v.filter(function (x) { return x >= RP_BIG_MIN; }).length;
  return [name, v.length, sum, sum / v.length, median, v[v.length - 1],
          big, big / v.length];
}

/** セクション2: 大物マップ（オプチャ込みの全件） */
function rp_writeBigMapSection_(sh, row, data, index) {
  const opuchaN = data.rows.filter(function (r) { return r.isOpucha; }).length;

  row = rp_sectionTitle_(sh, row,
    "【大物マップ】件数分布（オプチャ込み）",
    "母集団: 全 " + data.rows.length + "件（オプチャ・A列空白の " + opuchaN +
    "件を含む）　/　「大物」= ¥" + RP_BIG_MIN.toLocaleString() + "以上",
    "#b45f06");

  const labels = ["乗り場", "総件数"]
    .concat(RP_TIERS.map(function (t) { return t.label; }))
    .concat(["大物率", "平均売上", "うちオプチャ"]);
  row = rp_headerRow_(sh, row, labels);

  // 乗り場ごとに集計
  const g = {};
  data.rows.forEach(function (r) {
    const p = rp_placeOf_(index, r.place);
    if (!g[p.key]) {
      g[p.key] = { name: p.name, n: 0, sum: 0, opucha: 0,
                   tiers: RP_TIERS.map(function () { return 0; }) };
    }
    const b = g[p.key];
    b.n++;
    b.sum += r.money;
    b.tiers[rp_tierIndex_(r.money)]++;
    if (r.isOpucha) b.opucha++;
  });

  const bigIdx = RP_TIERS.map(function (t) { return t.min; }).indexOf(RP_BIG_MIN);
  const bigOf = function (b) {
    // 「大物」は ¥10,000以上なので、特大（¥20,000〜）も足す
    let n = 0;
    for (let i = 0; i <= bigIdx; i++) n += b.tiers[i];
    return n;
  };

  const keys = Object.keys(g).sort(function (a, b) {
    const d = bigOf(g[b]) - bigOf(g[a]);
    return d !== 0 ? d : g[b].n - g[a].n;
  });

  const table = keys.map(function (k) {
    const b = g[k];
    return [b.name, b.n].concat(b.tiers, [bigOf(b) / b.n, b.sum / b.n, b.opucha]);
  });

  // 総計
  const tot = { n: 0, sum: 0, opucha: 0, tiers: RP_TIERS.map(function () { return 0; }) };
  keys.forEach(function (k) {
    const b = g[k];
    tot.n += b.n; tot.sum += b.sum; tot.opucha += b.opucha;
    b.tiers.forEach(function (v, i) { tot.tiers[i] += v; });
  });
  table.push(["■ 総計", tot.n].concat(tot.tiers,
    [bigOf(tot) / tot.n, tot.sum / tot.n, tot.opucha]));

  const rg = sh.getRange(row, 1, table.length, labels.length);
  rg.setValues(table);
  rg.setBorder(true, true, true, true, true, true, "#cccccc", SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(row, 2, table.length, 1 + RP_TIERS.length).setNumberFormat("#,##0");
  sh.getRange(row, 2 + RP_TIERS.length + 1, table.length, 1).setNumberFormat("0.0%");
  sh.getRange(row, 2 + RP_TIERS.length + 2, table.length, 1).setNumberFormat('"¥"#,##0');
  sh.getRange(row, 2 + RP_TIERS.length + 3, table.length, 1).setNumberFormat("#,##0");

  // 金額帯の列に、記録用スプシと同じ色を付ける
  RP_TIERS.forEach(function (t, i) {
    sh.getRange(row, 3 + i, table.length, 1).setBackground(t.bg).setFontColor(t.tx);
  });
  sh.getRange(row + table.length - 1, 1, 1, labels.length).setFontWeight("bold");

  sh.getRange(row - 1, 1, table.length + 1, labels.length).createFilter();
  return row + table.length;
}

function rp_summaryText_(data, own) {
  const list = own.own;
  const sum = list.reduce(function (a, r) { return a + r.money; }, 0);
  const all = data.rows.reduce(function (a, r) { return a + r.money; }, 0);

  let msg = "✅ 「" + RP_SHEET + "」タブに書き出しました\n";
  msg += "──────────────\n";
  msg += "全 " + data.rows.length + "件（他タブとの重複 " + data.dup + "件を除外）\n\n";
  msg += "【自社実績】オプチャ・空白を除いた " + list.length + "件\n";
  msg += "  平均売上: ¥" + Math.round(sum / list.length).toLocaleString() + "\n";
  msg += "  （参考）オプチャ込み全件だと ¥" +
         Math.round(all / data.rows.length).toLocaleString() + "\n\n";
  msg += "【大物マップ】オプチャ " + own.excluded + "件を含む全件で集計\n";

  const uk = Object.keys(data.unknownWho);
  if (uk.length) {
    msg += "\n⚠️ A列が見慣れない値の行があります（自社実績に入っています）:\n";
    uk.forEach(function (n) { msg += "・" + n + " (" + data.unknownWho[n] + "件)\n"; });
  }
  if (data.noMoney) {
    msg += "\n※ 金額が読めない行 " + data.noMoney + "件は集計から外しました（「不明」等）。";
  }
  return msg;
}
