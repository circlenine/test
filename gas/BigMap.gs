/**
 * ================================================================
 *  オプチャ込み 大物マップ（BigMap.gs）
 *
 *  ★記録用スプシの Apps Script プロジェクトに別ファイルとして追加。
 *    統合スクリプト（v223/v232）側の PERSONAL_TABS・normalizePlace_ 等を使う。
 *
 *  【何をするか】
 *    「どこで大物（高額乗車）が出ているか」を、オプチャ情報も含めて出す。
 *    目玉は "🎯 オプチャだけが知っている大物" ＝
 *    自分たちがまだ1件も取れていないのに、他人は取れている乗り場。
 *    これがオプチャ情報を集めている意味そのもの。
 *
 *  【自社 / オプチャ の見分け方（重要）】
 *    A列が空白かどうかでは判定しない。実データを調べたところ、
 *    A列空白184件のうち50件(27%)は個人タブにある自分たちの記録の写しで、
 *    A列だけが失われたものだった。空白＝オプチャとすると、自分たちの
 *    実績を4件に1件の割合で捨ててしまう。
 *
 *    そこで「個人タブに同じ乗車(営業日+乗車時間+金額)があるか」で判定する。
 *      ある → 自社実績（誰の記録かも分かる）
 *      ない → エリアタブにしか無い ＝ 外から来た情報 ＝ オプチャ
 *    A列が空でも名前入りでも正しく判定できる。
 * ================================================================
 */

const BM_BIG_MIN = 10000;   // これ以上を「大物」と数える
const BM_HUGE_MIN = 20000;  // これ以上を「特大」
const BM_TOP_N = 12;        // LINE画像に載せる乗り場の数
const BM_NO_PLACE = "(乗り場なし)";

/* ============ 集計 ============ */

/**
 * 期間内の乗車を集めて、自社 / オプチャ に分けて返す。
 * startD, endD を省略すると全期間。
 */
function bmCollect_(startD, endD) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ① まず個人タブを読んで「自分たちの乗車」の索引を作る
  const ownKeys = {};
  const rows = [];
  const seen = {};

  const readTab = function (name, isPersonal) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const last = sh.getLastRow();
    if (last < START_ROW) return;

    sh.getRange(START_ROW, 1, last - START_ROW + 1, LAST_COL).getValues().forEach(function (r) {
      const date = r[C_DATE - 1];
      if (!(date instanceof Date)) return;                 // 空行・年見出し
      if (startD && date < startD) return;
      if (endD && date > endD) return;

      const money = parseInt(String(r[C_MONEY - 1]).replace(/[^0-9]/g, ""), 10);
      if (isNaN(money) || money <= 0) return;              // 金額不明は集計外

      const time  = String(r[C_TIME - 1]).trim();
      const place = String(r[C_PLACE - 1]).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      const who   = String(r[C_SENDER - 1]).trim();
      const rideKey = ymdOf_(date) + "|" + time + "|" + money;

      if (isPersonal) {
        // 個人タブの行は、誰の乗車かの索引に登録する
        if (!ownKeys[rideKey]) ownKeys[rideKey] = who;
      }

      // 同じ乗車を二重に数えない（エリアタブは個人タブの写しを含む）
      const dupKey = rideKey + "|" + normalizePlace_(place);
      if (seen[dupKey]) return;
      seen[dupKey] = true;

      rows.push({ date: date, time: time, money: money, place: place,
                  who: who, rideKey: rideKey, tab: name });
    });
  };

  // 個人タブを先に読む（索引を作ってからでないと判定できない）
  PERSONAL_TABS.forEach(function (n) { readTab(n, true); });
  ALL_TABS.forEach(function (n) {
    if (PERSONAL_TABS.indexOf(n) === -1) readTab(n, false);
  });

  // ② 自社 / オプチャ を振り分ける
  let own = 0, opu = 0;
  rows.forEach(function (x) {
    x.isOwn = Object.prototype.hasOwnProperty.call(ownKeys, x.rideKey);
    x.owner = x.isOwn ? (ownKeys[x.rideKey] || x.who) : "";
    if (x.isOwn) own++; else opu++;
  });

  return { rows: rows, ownCount: own, opuCount: opu };
}

/** 乗り場ごとに 自社/オプチャ の金額をまとめる */
function bmGroup_(rows) {
  const g = {};
  rows.forEach(function (x) {
    const key = normalizePlace_(x.place) || BM_NO_PLACE;
    if (!g[key]) g[key] = { names: {}, own: [], opu: [] };
    g[key].names[x.place || BM_NO_PLACE] = (g[key].names[x.place || BM_NO_PLACE] || 0) + 1;
    (x.isOwn ? g[key].own : g[key].opu).push(x);
  });

  // 表示名は一番よく使われている書き方
  Object.keys(g).forEach(function (k) {
    const vs = Object.keys(g[k].names).sort(function (a, b) {
      return g[k].names[b] - g[k].names[a];
    });
    g[k].name = vs[0];
  });
  return g;
}

function bmBigCount_(list) {
  return list.filter(function (x) { return x.money >= BM_BIG_MIN; }).length;
}
function bmHugeCount_(list) {
  return list.filter(function (x) { return x.money >= BM_HUGE_MIN; }).length;
}
function bmAvg_(list) {
  if (!list.length) return 0;
  return Math.round(list.reduce(function (a, x) { return a + x.money; }, 0) / list.length);
}
function bmMax_(list) {
  return list.length ? Math.max.apply(null, list.map(function (x) { return x.money; })) : 0;
}

/**
 * 件数が1件のときに「平均」と書かない。
 * 1件しかないものを「平均」と呼ぶと、実績があるように見えてしまうため。
 */
function bmMoneyLabel_(list) {
  if (!list.length) return "0件";
  if (list.length === 1) return "1件 ￥" + list[0].money.toLocaleString();
  return list.length + "件 平均￥" + bmAvg_(list).toLocaleString();
}

/** 大物の多い順に並べた一覧 */
function bmRank_(groups) {
  return Object.keys(groups).map(function (k) {
    const v = groups[k];
    const all = v.own.concat(v.opu);
    return {
      key: k, name: v.name,
      own: v.own, opu: v.opu, all: all,
      ownBig: bmBigCount_(v.own), opuBig: bmBigCount_(v.opu),
      big: bmBigCount_(all), huge: bmHugeCount_(all),
      avg: bmAvg_(all), max: bmMax_(all), n: all.length
    };
  }).sort(function (a, b) {
    return (b.big - a.big) || (b.max - a.max) || (b.n - a.n);
  });
}

/**
 * 🎯 オプチャだけが知っている大物。
 * 自社の大物が0件で、オプチャには大物がある乗り場。
 * ＝ まだ自分たちが取れていない場所。ここが一番の狙い目になる。
 */
function bmUntapped_(ranked) {
  return ranked.filter(function (r) { return r.ownBig === 0 && r.opuBig > 0; })
    .sort(function (a, b) { return b.max - a.max; });
}

/* ============ LINE画像（Flex Message）用のブロック ============ */

/**
 * 既存レポートの flexContents に push できる配列を返す。
 *   const bm = buildBigMap(startD, endD);
 *   bmFlexBlock_(bm).forEach(function (c) { flexContents.push(c); });
 *
 * スマホの縦1列で読めるよう、横並びは使わず上から積む。
 */
function bmFlexBlock_(bm) {
  const out = [];
  // LineReport.gs があれば半角カナに寄せる（無くても動くようにする）
  const kana = function (v) {
    return (typeof toHalfWidthKana === "function") ? toHalfWidthKana(v) : v;
  };

  out.push({ "type": "separator", "margin": "lg" });
  out.push({ "type": "text", "text": "🗺️ 大物マップ（オプチャ込み）",
             "weight": "bold", "size": "sm", "color": "#b45f06", "margin": "md" });
  out.push({ "type": "text",
             "text": "全" + (bm.ownCount + bm.opuCount) + "件 = 自社" + bm.ownCount +
                     " + オプチャ" + bm.opuCount + "　/　大物 = ￥" +
                     BM_BIG_MIN.toLocaleString() + "以上",
             "size": "xxs", "color": "#666666", "wrap": true, "margin": "xs" });

  // --- 大物マップ本体 ---
  const top = bm.ranked.filter(function (r) { return r.big > 0; }).slice(0, BM_TOP_N);
  const body = [];
  if (!top.length) {
    body.push({ "type": "text", "text": "この期間に大物はありませんでした", "size": "xs" });
  }
  top.forEach(function (r) {
    body.push({ "type": "text", "size": "xs", "wrap": true, "margin": "md", "contents": [
      { "type": "span", "text": kana(r.name),
        "weight": "bold", "color": "#000000" },
      { "type": "span", "text": "  大物" + r.big + "件", "color": "#b45f06", "weight": "bold" },
      { "type": "span", "text": " / 全" + r.n + "件", "color": "#888888" }
    ]});
    // 自社とオプチャの内訳を、太さの違うバーで見せる
    const ownF = r.ownBig, opuF = r.opuBig;
    if (ownF + opuF > 0) {
      const bars = [];
      if (ownF > 0) bars.push({ "type": "box", "layout": "baseline",
                                "backgroundColor": "#1155ca", "flex": ownF, "contents": [] });
      if (opuF > 0) bars.push({ "type": "box", "layout": "baseline",
                                "backgroundColor": "#f6b26b", "flex": opuF, "contents": [] });
      body.push({ "type": "box", "layout": "horizontal", "cornerRadius": "md",
                  "height": "6px", "margin": "xs", "contents": bars });
    }
    body.push({ "type": "text", "size": "xxs", "color": "#666666", "wrap": true, "margin": "xs",
      "text": "自社" + ownF + "件 ／ オプチャ" + opuF + "件　最高￥" + r.max.toLocaleString() });
  });
  out.push({ "type": "box", "layout": "vertical", "backgroundColor": "#fdf6ec",
             "paddingAll": "10px", "margin": "sm", "cornerRadius": "md", "contents": body });

  // --- オプチャだけが知っている大物 ---
  const un = bm.untapped.slice(0, 8);
  const unBody = [{ "type": "text", "text": "🎯 まだ取れていない大物",
                    "size": "xs", "weight": "bold", "color": "#a61c00" },
                  { "type": "text", "text": "自社の大物0件 / オプチャには大物あり",
                    "size": "xxs", "color": "#666666", "margin": "xs" }];
  if (!un.length) {
    unBody.push({ "type": "text", "text": "該当なし", "size": "xs", "margin": "sm" });
  }
  un.forEach(function (r) {
    unBody.push({ "type": "text", "size": "xs", "wrap": true, "margin": "sm", "contents": [
      { "type": "span", "text": kana(r.name) + " ",
        "weight": "bold", "color": "#000000" },
      { "type": "span", "text": "最高￥" + r.max.toLocaleString(), "color": "#a61c00", "weight": "bold" },
      { "type": "span", "text": "（オプチャ" + r.opuBig + "件／自社は" + r.own.length + "件で大物0）",
        "color": "#666666" }
    ]});
  });
  out.push({ "type": "box", "layout": "vertical", "backgroundColor": "#fdecea",
             "paddingAll": "10px", "margin": "sm", "cornerRadius": "md", "contents": unBody });

  return out;
}

/* ============ まとめスプシ用のセクション ============ */

/**
 * ダッシュボードに大物マップを書く。書き終えた次の行を返す。
 * 既存レポートの updateDetailedDashboard から
 *   curRow = bmWriteSection_(sheet, curRow, bm);
 * のように呼べる。
 */
function bmWriteSection_(sheet, row, bm) {
  sheet.getRange(row, 1, 1, 26).merge()
    .setValue("🗺️ 大物マップ（オプチャ込み） 全" + (bm.ownCount + bm.opuCount) +
              "件 = 自社" + bm.ownCount + " + オプチャ" + bm.opuCount +
              "　/　大物 = ￥" + BM_BIG_MIN.toLocaleString() + "以上")
    .setFontWeight("bold").setBackground("#fce5cd");
  row++;

  const spans = [5, 3, 3, 3, 3, 3, 6];
  const heads = ["乗り場", "大物 合計", "うち自社", "うちオプチャ", "全件数", "最高額", "平均"];
  let rngs = getGridRange(sheet, row, 1, 1, spans);
  for (let i = 0; i < heads.length; i++) {
    rngs[i].merge().setValue(heads[i]).setBackground("#cccccc").setFontWeight("bold")
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
  }
  sheet.setRowHeight(row, 30);
  row++;

  const list = bm.ranked.filter(function (r) { return r.big > 0; });
  if (!list.length) {
    getGridRange(sheet, row, 1, 1, spans)[0].merge().setValue("この期間に大物はありません");
    sheet.setRowHeight(row, 24);
    return row + 1;
  }

  list.forEach(function (r) {
    const rr = getGridRange(sheet, row, 1, 1, spans);
    rr[0].merge().setValue(r.name).setHorizontalAlignment("left").setVerticalAlignment("middle")
      .setWrap(true).setFontWeight("bold");
    rr[1].merge().setValue(r.big).setHorizontalAlignment("center").setVerticalAlignment("middle")
      .setFontWeight("bold");
    rr[2].merge().setValue(r.ownBig).setHorizontalAlignment("center").setVerticalAlignment("middle")
      .setFontColor("#1155ca");
    rr[3].merge().setValue(r.opuBig).setHorizontalAlignment("center").setVerticalAlignment("middle")
      .setFontColor("#b45f06");
    rr[4].merge().setValue(r.n).setHorizontalAlignment("center").setVerticalAlignment("middle");
    rr[5].merge().setValue(r.max).setNumberFormat('"￥"#,##0')
      .setHorizontalAlignment("right").setVerticalAlignment("middle");
    // 1件しかないものは「平均」と書かない
    rr[6].merge().setValue(r.n === 1 ? ("1件 ￥" + r.max.toLocaleString())
                                     : ("￥" + r.avg.toLocaleString()))
      .setHorizontalAlignment("right").setVerticalAlignment("middle");

    if (r.huge > 0)      rr[1].setBackground("#f4cccc");
    else if (r.big >= 3) rr[1].setBackground("#fff2cc");
    sheet.setRowHeight(row, 24);
    row++;
  });
  sheet.getRange(row - list.length - 1, 1, list.length + 1, 26)
    .setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID);
  row++;

  // --- まだ取れていない大物 ---
  sheet.getRange(row, 1, 1, 26).merge()
    .setValue("🎯 オプチャだけが知っている大物（自社の大物0件 / オプチャには大物あり）")
    .setFontWeight("bold").setBackground("#f4cccc");
  row++;

  const uSpans = [6, 4, 4, 4, 8];
  const uHeads = ["乗り場", "オプチャ大物", "最高額", "自社の実績", "いつ出たか"];
  rngs = getGridRange(sheet, row, 1, 1, uSpans);
  for (let i = 0; i < uHeads.length; i++) {
    rngs[i].merge().setValue(uHeads[i]).setBackground("#cccccc").setFontWeight("bold")
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
  }
  sheet.setRowHeight(row, 30);
  row++;

  const un = bm.untapped;
  if (!un.length) {
    getGridRange(sheet, row, 1, 1, uSpans)[0].merge().setValue("該当なし");
    sheet.setRowHeight(row, 24);
    return row + 1;
  }
  un.forEach(function (r) {
    const rr = getGridRange(sheet, row, 1, 1, uSpans);
    const bigs = r.opu.filter(function (x) { return x.money >= BM_BIG_MIN; })
      .sort(function (a, b) { return b.money - a.money; });
    const when = bigs.slice(0, 3).map(function (x) {
      return fmtDate_(x.date) + " " + x.time;
    }).join(" / ");

    rr[0].merge().setValue(r.name).setHorizontalAlignment("left").setVerticalAlignment("middle")
      .setWrap(true).setFontWeight("bold");
    rr[1].merge().setValue(r.opuBig).setHorizontalAlignment("center").setVerticalAlignment("middle")
      .setFontColor("#b45f06").setFontWeight("bold");
    rr[2].merge().setValue(r.max).setNumberFormat('"￥"#,##0')
      .setHorizontalAlignment("right").setVerticalAlignment("middle")
      .setBackground("#f4cccc").setFontColor("#990000").setFontWeight("bold");
    rr[3].merge().setValue(r.own.length ? (r.own.length + "件（大物0）") : "実績なし")
      .setHorizontalAlignment("center").setVerticalAlignment("middle").setFontColor("#666666");
    rr[4].merge().setValue(when).setHorizontalAlignment("left").setVerticalAlignment("middle")
      .setWrap(true).setFontSize(9);
    sheet.setRowHeight(row, 24);
    row++;
  });
  sheet.getRange(row - un.length - 1, 1, un.length + 1, 26)
    .setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID);

  return row + 1;
}

/* ============ 入口 ============ */

/** 大物マップのデータを作る。レポート側からはこれを呼ぶ */
function buildBigMap(startD, endD) {
  const c = bmCollect_(startD, endD);
  const groups = bmGroup_(c.rows);
  const ranked = bmRank_(groups);
  return {
    rows: c.rows, ownCount: c.ownCount, opuCount: c.opuCount,
    groups: groups, ranked: ranked, untapped: bmUntapped_(ranked)
  };
}

/* ============ メニュー（レポートに組み込む前に、単体で確認できる） ============ */

function menuBigMap() {
  const html = '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:sans-serif;padding:15px;color:#333;font-size:13px}' +
    'h3{font-size:15px;margin:0 0 8px;border-bottom:2px solid #b45f06;padding-bottom:6px}' +
    '.d{font-size:12px;color:#666;margin-bottom:10px;line-height:1.7}' +
    'select,input[type=date]{width:100%;font-size:14px;padding:8px;margin-bottom:10px;' +
    'box-sizing:border-box;border:1px solid #ccc;border-radius:4px}' +
    '.rg{display:flex;gap:14px;margin-bottom:10px}' +
    '.cu{display:none;gap:8px;align-items:center}.cu input{width:46%}' +
    'button{width:100%;padding:12px;margin-top:8px;background:#b45f06;color:#fff;border:none;' +
    'border-radius:5px;font-weight:bold;font-size:15px;cursor:pointer}' +
    '#r{width:100%;height:260px;font-size:11px;font-family:monospace;margin-top:10px;box-sizing:border-box}' +
    '</style></head><body>' +
    '<h3>🗺️ 大物マップ（オプチャ込み）</h3>' +
    '<div class="d">どこで大物が出ているかを、オプチャ情報も含めて出します。<br>' +
    '<b>スプシもLINEも変更しません。</b>まず中身を確認してください。</div>' +
    '<div class="rg">' +
    '<label><input type="radio" name="m" value="s" checked onchange="tg()"> 📅 期間選択</label>' +
    '<label><input type="radio" name="m" value="c" onchange="tg()"> ✍️ 日付指定</label></div>' +
    '<div id="sa"><select id="ps"></select></div>' +
    '<div id="ca" class="cu"><input type="date" id="sd"><span>～</span><input type="date" id="ed"></div>' +
    '<button id="b" onclick="go()">大物マップを見る</button>' +
    progressWidget_() +
    '<textarea id="r" readonly></textarea>' +
    '<button onclick="cp()" style="background:#666">📋 結果をコピー</button>' +
    '<script>' +
    'function tg(){var m=document.querySelector(\'input[name="m"]:checked\').value;' +
    'document.getElementById("sa").style.display=m==="s"?"block":"none";' +
    'document.getElementById("ca").style.display=m==="c"?"flex":"none";}' +
    '(function(){var s=document.getElementById("ps"),t=new Date();' +
    'var cY=t.getFullYear(),cM=t.getMonth()+1,cD=t.getDate();' +
    'var sY=cY,sM=cM; if(cD<=15){sM--; if(sM===0){sM=12;sY--;}}' +
    's.add(new Option(sY+"/"+("0"+sM).slice(-2)+"/16 ～ "+("0"+cM).slice(-2)+"/"+("0"+cD).slice(-2)+" (今期)",' +
    'sY+"/"+sM+"/16-"+cY+"/"+cM+"/"+cD));' +
    'for(var i=0;i<12;i++){var eY=sY,eM=sM,hM=eM-1,hY=eY; if(hM===0){hM=12;hY--;}' +
    's.add(new Option(hY+"/"+("0"+hM).slice(-2)+"/16 ～ "+("0"+eM).slice(-2)+"/15",' +
    'hY+"/"+hM+"/16-"+eY+"/"+eM+"/15")); sY=hY;sM=hM;}' +
    's.add(new Option("全期間","all"));})();' +
    'function go(){var m=document.querySelector(\'input[name="m"]:checked\').value;' +
    'var v=m==="s"?document.getElementById("ps").value:' +
    '(document.getElementById("sd").value.replace(/-/g,"/")+"-"+document.getElementById("ed").value.replace(/-/g,"/"));' +
    'document.getElementById("b").disabled=true;progShow();' +
    'google.script.run.withSuccessHandler(function(t){document.getElementById("r").value=t;' +
    'progDone("完了しました");document.getElementById("b").disabled=false;})' +
    '.withFailureHandler(function(e){progFail(e.message);document.getElementById("b").disabled=false;})' +
    '.runBigMapPreview(v);}' +
    'function cp(){var t=document.getElementById("r");t.select();' +
    'try{document.execCommand("copy");alert("コピーしました");}catch(e){alert("長押しで選択してコピー");}}' +
    '</scr' + 'ipt></body></html>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(560).setHeight(660), "🗺️ 大物マップ");
}

/** "2026/8/16-2026/9/15" または "all" を受けて、テキストで結果を返す */
function runBigMapPreview(val) {
  progClear_();
  progSet_(10, "記録を読み込んでいます");

  let startD = null, endD = null, label = "全期間";
  if (val && val !== "all") {
    const p = String(val).split("-");
    const s = p[0].split("/"), e = p[1].split("/");
    startD = new Date(+s[0], +s[1] - 1, +s[2], 0, 0, 0);
    endD   = new Date(+e[0], +e[1] - 1, +e[2], 23, 59, 59);
    label = fmtDate_(startD) + " 〜 " + fmtDate_(endD);
  }

  const bm = buildBigMap(startD, endD);
  progSet_(70, "集計しています");

  if (!bm.rows.length) return "この期間に集計できる乗車がありませんでした。";

  let out = "■ 期間: " + label + "\n";
  out += "■ 全 " + bm.rows.length + "件 = 自社 " + bm.ownCount +
         "件 + オプチャ " + bm.opuCount + "件\n";
  out += "■ 大物 = ￥" + BM_BIG_MIN.toLocaleString() + "以上\n";
  out += "──────────────────────\n";
  out += "【大物マップ】大物の多い順\n";
  out += "乗り場               大物  自社 ｵﾌﾟﾁｬ  全件   最高額\n";

  const list = bm.ranked.filter(function (r) { return r.big > 0; });
  if (!list.length) out += "  （この期間に大物はありません）\n";
  list.forEach(function (r) {
    const nm = (r.name.length > 16) ? r.name.slice(0, 15) + "…" : r.name;
    out += "  " + nm + Array(Math.max(1, 18 - nm.length)).join(" ") +
           String(r.big) + "件" +
           "  " + r.ownBig + "  " + r.opuBig +
           "   " + r.n + "件" +
           "  ￥" + r.max.toLocaleString() + "\n";
  });

  out += "\n──────────────────────\n";
  out += "【🎯 オプチャだけが知っている大物】\n";
  out += "自社の大物0件 / オプチャには大物あり ＝ まだ取れていない場所\n\n";
  if (!bm.untapped.length) {
    out += "  該当なし\n";
  } else {
    bm.untapped.forEach(function (r) {
      out += "  ● " + r.name + "\n";
      out += "      最高￥" + r.max.toLocaleString() +
             " / オプチャ大物" + r.opuBig + "件 / 自社は" +
             (r.own.length ? r.own.length + "件（大物0）" : "実績なし") + "\n";
      const bigs = r.opu.filter(function (x) { return x.money >= BM_BIG_MIN; })
        .sort(function (a, b) { return b.money - a.money; }).slice(0, 3);
      bigs.forEach(function (x) {
        out += "      " + fmtDate_(x.date) + " " + x.time + " ￥" + x.money.toLocaleString() + "\n";
      });
    });
  }

  out += "\n──────────────────────\n";
  out += "【判定について】\n";
  out += "「個人タブに同じ乗車があるか」で自社/オプチャを分けています。\n";
  out += "A列の空白では判定していません（空白には自社の写しが混ざっているため）。\n";

  progSet_(100, "完了");
  return out;
}
