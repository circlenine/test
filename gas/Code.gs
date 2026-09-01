/**
 * 売上レポート生成
 *
 * セクション1【自社実績】 : 平均売上。A列が「オプチャ」の行は集計から除外する。
 * セクション2【大物マップ】: 件数分布。オプチャ行も含めた全行を対象にする。
 *
 * 2つのセクションは母集団が違うため、同じ表に混ぜず必ず別セクションとして出力する。
 */

const CONFIG = {
  // ---- 入力 ----
  SOURCE_SHEET: 'データ',   // 元データのシート名
  HEADER_ROW: 1,            // ヘッダー行（1始まり）
  KUBUN_COL: 1,             // A列 = 区分/流入経路
  SALES_HEADER: '売上',     // 売上金額の列ヘッダー名

  // A列がこのいずれかを含む行を「オプチャ」と判定する（表記ゆれ対策）。
  // なお A列が空白の行もオプチャ扱いにする（未記入＝オプチャ経由の運用のため）。
  OPUCHA_ALIASES: ['オプチャ', 'オープンチャット', 'ｵﾌﾟﾁｬ'],
  OPUCHA_LABEL: 'オプチャ',  // 大物マップでオプチャ行（空白含む）をまとめる列名

  // ---- 出力 ----
  REPORT_SHEET: 'レポート',

  // ---- 大物マップの金額帯（円・上限値の配列 / 最後は「以上」の開区間）----
  BUCKETS: [100000, 300000, 500000, 1000000, 3000000],
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('レポート')
    .addItem('レポートを生成', 'buildReport')
    .addToUi();
}

/** エントリポイント。2セクションのレポートを生成する。 */
function buildReport() {
  const rows = readRows_();
  const sheet = prepareReportSheet_();

  let row = 1;
  row = writeOwnPerformance_(sheet, row, rows);
  row += 2; // セクション間の余白
  writeBigDealMap_(sheet, row, rows);

  sheet.autoResizeColumns(1, 8);
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
}

// ---------------------------------------------------------------- 入力

/**
 * 元データを読み込み、{ kubun, sales, isOpucha } の配列にして返す。
 * 売上が数値でない行（空欄・見出しの続き等）は除外する。
 */
function readRows_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SOURCE_SHEET);
  if (!sheet) {
    throw new Error('シート「' + CONFIG.SOURCE_SHEET + '」が見つかりません。CONFIG.SOURCE_SHEET を確認してください。');
  }

  const values = sheet.getDataRange().getValues();
  const header = values[CONFIG.HEADER_ROW - 1];
  const salesCol = header.indexOf(CONFIG.SALES_HEADER);
  if (salesCol === -1) {
    throw new Error('売上列「' + CONFIG.SALES_HEADER + '」がヘッダー行に見つかりません。実際のヘッダー: ' + header.join(' / '));
  }

  const rows = [];
  for (let i = CONFIG.HEADER_ROW; i < values.length; i++) {
    const sales = toNumber_(values[i][salesCol]);
    if (sales === null) continue;

    const kubun = String(values[i][CONFIG.KUBUN_COL - 1] || '').trim();
    const opucha = isOpucha_(kubun);
    rows.push({
      kubun: kubun,
      sales: sales,
      isOpucha: opucha,
      // 空白行も明示「オプチャ」行も、大物マップ上は同じ列にまとめる
      displayKubun: opucha ? CONFIG.OPUCHA_LABEL : kubun,
    });
  }
  return rows;
}

/**
 * A列の値がオプチャ由来かどうか。
 * 空白はオプチャ扱い。それ以外は表記ゆれを吸収するため部分一致で判定する。
 */
function isOpucha_(kubun) {
  const v = normalize_(kubun);
  if (v === '') return true;
  return CONFIG.OPUCHA_ALIASES.some(function (alias) {
    return v.indexOf(normalize_(alias)) !== -1;
  });
}

/** 全角/半角・大小文字・空白の揺れを潰す。 */
function normalize_(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 数値化できれば number、できなければ null。「1,200円」のような表記も拾う。 */
function toNumber_(v) {
  if (typeof v === 'number') return isNaN(v) ? null : v;
  if (v == null || v === '') return null;
  const cleaned = normalize_(v).replace(/[,¥円]/g, '');
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

// ------------------------------------------------- セクション1: 自社実績

/**
 * 自社実績（平均売上）。オプチャ行を除いた母集団のみで集計する。
 * 書き込んだ最終行を返す。
 */
function writeOwnPerformance_(sheet, startRow, rows) {
  const own = rows.filter(function (r) { return !r.isOpucha; });
  const excluded = rows.length - own.length;

  let row = startRow;
  row = writeSectionTitle_(sheet, row, '【自社実績】平均売上');
  sheet.getRange(row, 1)
    .setValue('母集団: A列が「オプチャ」または空白の行を除外（除外 ' + excluded + ' 件 / 全 ' + rows.length + ' 件）')
    .setFontColor('#666666').setFontSize(9);
  row += 2;

  // サマリー
  sheet.getRange(row, 1, 1, 2).setValues([['指標', '値']]).setFontWeight('bold').setBackground('#f0f0f0');
  row++;

  const summary = [
    ['件数', own.length],
    ['売上合計', sum_(own)],
    ['平均売上', own.length ? sum_(own) / own.length : 0],
    ['中央値', median_(own.map(function (r) { return r.sales; }))],
    ['最大', own.length ? Math.max.apply(null, own.map(function (r) { return r.sales; })) : 0],
    ['最小', own.length ? Math.min.apply(null, own.map(function (r) { return r.sales; })) : 0],
  ];
  sheet.getRange(row, 1, summary.length, 2).setValues(summary);
  sheet.getRange(row + 1, 2, summary.length - 1, 1).setNumberFormat('¥#,##0');
  sheet.getRange(row, 2).setNumberFormat('#,##0');
  row += summary.length + 1;

  // 区分別の平均（オプチャは母集団にいないので当然出てこない）
  // own 行は空白がオプチャ判定で除外済みなので、区分は必ず埋まっている
  const byKubun = groupBy_(own, function (r) { return r.kubun; });
  const names = Object.keys(byKubun).sort();
  if (names.length) {
    sheet.getRange(row, 1, 1, 3).setValues([['区分', '件数', '平均売上']])
      .setFontWeight('bold').setBackground('#f0f0f0');
    row++;

    const table = names.map(function (name) {
      const g = byKubun[name];
      return [name, g.length, sum_(g) / g.length];
    });
    sheet.getRange(row, 1, table.length, 3).setValues(table);
    sheet.getRange(row, 3, table.length, 1).setNumberFormat('¥#,##0');
    row += table.length;
  }

  return row;
}

// ----------------------------------------------- セクション2: 大物マップ

/**
 * 大物マップ（件数分布）。オプチャ行も含めた全行が対象。
 * 金額帯 × 区分 のクロス集計で件数を出す。
 */
function writeBigDealMap_(sheet, startRow, rows) {
  let row = startRow;
  row = writeSectionTitle_(sheet, row, '【大物マップ】件数分布（オプチャ込み）');
  sheet.getRange(row, 1)
    .setValue('母集団: 全 ' + rows.length + ' 件（オプチャ・A列空白の行を含む）')
    .setFontColor('#666666').setFontSize(9);
  row += 2;

  const labels = bucketLabels_(CONFIG.BUCKETS);
  const kubunNames = uniqueSorted_(rows.map(function (r) { return r.displayKubun; }));

  // ヘッダー: 金額帯 | 区分... | 合計
  sheet.getRange(row, 1, 1, kubunNames.length + 2)
    .setValues([['金額帯'].concat(kubunNames, ['合計'])])
    .setFontWeight('bold').setBackground('#f0f0f0');
  row++;

  // 件数カウント
  const counts = labels.map(function () {
    const o = {};
    kubunNames.forEach(function (n) { o[n] = 0; });
    return o;
  });
  rows.forEach(function (r) {
    counts[bucketIndex_(r.sales, CONFIG.BUCKETS)][r.displayKubun]++;
  });

  const table = labels.map(function (label, i) {
    const line = kubunNames.map(function (n) { return counts[i][n]; });
    return [label].concat(line, [line.reduce(function (a, b) { return a + b; }, 0)]);
  });

  // 総計行
  const totals = kubunNames.map(function (n, j) {
    return table.reduce(function (a, line) { return a + line[j + 1]; }, 0);
  });
  table.push(['総計'].concat(totals, [rows.length]));

  const range = sheet.getRange(row, 1, table.length, kubunNames.length + 2);
  range.setValues(table);
  sheet.getRange(row, 2, table.length, kubunNames.length + 1).setNumberFormat('#,##0');
  sheet.getRange(row + table.length - 1, 1, 1, kubunNames.length + 2).setFontWeight('bold');
  row += table.length;

  return row;
}

/** 金額帯のラベル。['〜10万', '10〜30万', ..., '300万〜'] */
function bucketLabels_(edges) {
  const man = function (v) { return (v / 10000) + '万'; };
  const labels = edges.map(function (e, i) {
    return i === 0 ? '〜' + man(e) : man(edges[i - 1]) + '〜' + man(e);
  });
  labels.push(man(edges[edges.length - 1]) + '〜');
  return labels;
}

/** 売上金額が何番目の金額帯に入るか。 */
function bucketIndex_(sales, edges) {
  for (let i = 0; i < edges.length; i++) {
    if (sales < edges[i]) return i;
  }
  return edges.length;
}

// ---------------------------------------------------------------- 共通

function prepareReportSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.REPORT_SHEET);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(CONFIG.REPORT_SHEET);
  }
  return sheet;
}

function writeSectionTitle_(sheet, row, title) {
  sheet.getRange(row, 1).setValue(title).setFontWeight('bold').setFontSize(13);
  return row + 1;
}

function sum_(rows) {
  return rows.reduce(function (a, r) { return a + r.sales; }, 0);
}

function median_(nums) {
  if (!nums.length) return 0;
  const s = nums.slice().sort(function (a, b) { return a - b; });
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function groupBy_(rows, keyFn) {
  return rows.reduce(function (acc, r) {
    const k = keyFn(r);
    (acc[k] = acc[k] || []).push(r);
    return acc;
  }, {});
}

function uniqueSorted_(values) {
  return Object.keys(values.reduce(function (acc, v) { acc[v] = true; return acc; }, {})).sort();
}
