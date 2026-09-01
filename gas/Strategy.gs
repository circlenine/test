/**
 * ================================================================
 *  立ち回り分析（Strategy.gs）
 *
 *  ★記録用スプシの Apps Script プロジェクトに別ファイルとして追加。
 *    統合スクリプト（v223/v232）の定数・関数を使う。
 *
 *  「何曜日の、何時に、どの乗り場に着ければ良いか」を記録から出す。
 *
 *  【金額の区分】
 *    ショート … ￥4,999以下
 *    ミドル   … ￥5,000〜￥9,999
 *    ロング   … ￥10,000以上
 *
 *  【自社 / オプチャ の見分け方】
 *    Opucha.gs の印（メニュー「🏷 オプチャ印を付ける／外す」で指定したもの）で判定する。
 *    タブや列からは機械的に判定できないため。
 *      ・LINE連携前の記録は A列が空のまま個人タブに入っている（自社実績）
 *      ・過去にLINEのメッセージで送ったオプチャ情報も個人タブに入っている
 *      ・関空タブにも自社の乗車が混ざっている
 *    Opucha.gs が無い場合は、全件を自社として扱う。
 * ================================================================
 */

const ST_SHORT_MAX = 4999;    // これ以下がショート
const ST_LONG_MIN  = 10000;   // これ以上がロング
const ST_HOURS = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29];  // 20時〜翌5時
const ST_MIN_N = 3;           // 立ち回り候補として出す最低件数
const ST_SHRINK_K = 4;        // 件数が少ない枠を全体平均へ寄せる強さ

/* ============ 区分 ============ */

function stBand_(money) {
  if (money >= ST_LONG_MIN) return "ロング";
  if (money > ST_SHORT_MAX) return "ミドル";
  return "ショート";
}

/** 営業時間の並び。20〜29（29 = 翌5時台） */
function stSlot_(hh) { return hh < 17 ? hh + 24 : hh; }
function stHourLabel_(slot) { return (slot < 24 ? slot : slot - 24) + "時"; }

/** 平日 / 金曜 / 土曜 / 日祝 */
function stDayType_(date) {
  const w = date.getDay();
  if (w === 0 || isHoliday_(date)) return "日祝";
  if (w === 6) return "土曜";
  if (w === 5) return "金曜";
  return "平日";
}
const ST_DAY_TYPES = ["平日", "金曜", "土曜", "日祝"];
const ST_WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 件数が少ない枠の平均を、全体平均へ寄せる。
 * 1件だけの￥25,000がいきなり1位に来ると、立ち回りの判断を誤るため。
 * 件数が増えるほど実際の平均に近づく。
 */
function stShrink_(sum, n, globalAvg) {
  return (sum + ST_SHRINK_K * globalAvg) / (n + ST_SHRINK_K);
}

/* ============ 集計 ============ */

/** 期間内の乗車を集める。startD/endD 省略で全期間 */
function stCollect_(startD, endD) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rows = [];
  const seen = {};
  // Opucha.gs の印を使う。無ければ全件を自社として扱う
  const hasMark = (typeof opuIsOpucha_ === "function");
  const marks = hasMark ? opuMarks_() : {};

  const read = function (name, isPersonal) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const last = sh.getLastRow();
    if (last < START_ROW) return;

    sh.getRange(START_ROW, 1, last - START_ROW + 1, LAST_COL).getValues().forEach(function (r) {
      const date = r[C_DATE - 1];
      if (!(date instanceof Date)) return;
      if (startD && date < startD) return;
      if (endD && date > endD) return;

      const money = parseInt(String(r[C_MONEY - 1]).replace(/[^0-9]/g, ""), 10);
      if (isNaN(money) || money <= 0) return;

      const tm = String(r[C_TIME - 1]).match(/(\d{1,2}):(\d{2})/);
      if (!tm) return;                                   // 時刻不明は時間帯に置けない
      const hh = parseInt(tm[1], 10);

      const place = String(r[C_PLACE - 1]).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      const rideKey = ymdOf_(date) + "|" + tm[0] + "|" + money;
      const dupKey = rideKey + "|" + normalizePlace_(place);
      if (seen[dupKey]) return;
      seen[dupKey] = true;

      const w = String(r[C_WAIT - 1]).replace(/[^0-9]/g, "");
      const who = String(r[C_SENDER - 1]).trim();
      rows.push({
        date: date, hh: hh, time: tm[0], money: money, place: place,
        wait: w === "" ? null : parseInt(w, 10),
        tab: name, rideKey: rideKey, who: who,
        isOpu: hasMark ? opuIsOpucha_(who, rideKey, marks) : false,
        slot: stSlot_(hh), band: stBand_(money),
        dayType: stDayType_(date), dow: ST_WEEKDAYS[date.getDay()]
      });
    });
  };

  PERSONAL_TABS.forEach(function (n) { read(n, true); });
  ALL_TABS.forEach(function (n) { if (PERSONAL_TABS.indexOf(n) === -1) read(n, false); });

  const own = [], opu = [];
  rows.forEach(function (x) { (x.isOpu ? opu : own).push(x); });

  return { all: rows, own: own, opu: opu, hasMark: hasMark };
}

function stSum_(list) { return list.reduce(function (a, x) { return a + x.money; }, 0); }
function stAvg_(list) { return list.length ? Math.round(stSum_(list) / list.length) : 0; }
function stCount_(list, band) {
  return list.filter(function (x) { return x.band === band; }).length;
}

/* ============ 立ち回り候補（曜日区分 × 時間帯 × 乗り場） ============ */

function stTachimawari_(own) {
  if (!own.length) return [];
  const globalAvg = stSum_(own) / own.length;

  const g = {};
  own.forEach(function (x) {
    const k = x.dayType + "|" + x.slot + "|" + (normalizePlace_(x.place) || "?");
    if (!g[k]) g[k] = { dayType: x.dayType, slot: x.slot, names: {}, list: [] };
    g[k].names[x.place] = (g[k].names[x.place] || 0) + 1;
    g[k].list.push(x);
  });

  const out = [];
  Object.keys(g).forEach(function (k) {
    const v = g[k];
    if (v.list.length < ST_MIN_N) return;
    const names = Object.keys(v.names).sort(function (a, b) { return v.names[b] - v.names[a]; });
    const waits = v.list.filter(function (x) { return x.wait !== null; });
    out.push({
      dayType: v.dayType, slot: v.slot, place: names[0],
      n: v.list.length,
      avg: stAvg_(v.list),
      score: Math.round(stShrink_(stSum_(v.list), v.list.length, globalAvg)),
      long: stCount_(v.list, "ロング"),
      mid: stCount_(v.list, "ミドル"),
      short: stCount_(v.list, "ショート"),
      wait: waits.length ? Math.round(waits.reduce(function (a, x) { return a + x.wait; }, 0) / waits.length) : null,
      waitN: waits.length
    });
  });
  return out.sort(function (a, b) { return b.score - a.score || b.n - a.n; });
}

/* ============ 待ち時間あたりの効率（乗り場別） ============ */

/**
 * 「平均売上が高い乗り場 ＝ 良い乗り場」とは限らない。
 * 待ち時間が長ければ、1晩に取れる本数が減る。
 * 待ち1時間あたりいくらになるかで並べ直す。
 * 待ち時間が記録されている行だけが対象。
 */
function stEfficiency_(own, minN) {
  const g = {};
  own.forEach(function (x) {
    if (x.wait === null) return;
    const k = normalizePlace_(x.place) || "?";
    if (!g[k]) g[k] = { names: {}, list: [] };
    g[k].names[x.place] = (g[k].names[x.place] || 0) + 1;
    g[k].list.push(x);
  });

  const out = [];
  Object.keys(g).forEach(function (k) {
    const v = g[k];
    if (v.list.length < (minN || 5)) return;
    const names = Object.keys(v.names).sort(function (a, b) { return v.names[b] - v.names[a]; });
    const totalWait = v.list.reduce(function (a, x) { return a + x.wait; }, 0);
    out.push({
      place: names[0], n: v.list.length,
      avg: stAvg_(v.list),
      wait: Math.round(totalWait / v.list.length),
      // 待ち0分ばかりだと割り算が壊れるので、最低1分として扱う
      perHour: Math.round(stSum_(v.list) / Math.max(totalWait, v.list.length) * 60),
      long: stCount_(v.list, "ロング")
    });
  });
  return out.sort(function (a, b) { return b.perHour - a.perHour; });
}

/* ============ 曜日ごと（木曜など特定曜日の癖を見る） ============ */

function stByWeekday_(own) {
  const g = {};
  ST_WEEKDAYS.forEach(function (d) { g[d] = []; });
  own.forEach(function (x) { g[x.dow].push(x); });

  return ST_WEEKDAYS.map(function (d) {
    const v = g[d];
    const waits = v.filter(function (x) { return x.wait !== null; });
    return {
      dow: d, n: v.length, avg: stAvg_(v),
      long: stCount_(v, "ロング"),
      longRate: v.length ? stCount_(v, "ロング") / v.length : 0,
      wait: waits.length ? Math.round(waits.reduce(function (a, x) { return a + x.wait; }, 0) / waits.length) : null
    };
  }).filter(function (r) { return r.n > 0; });
}

/** ある曜日を時間帯で割る（木曜の医師関係のような動きを探す） */
function stWeekdayHours_(own, dow) {
  const v = own.filter(function (x) { return x.dow === dow; });
  return ST_HOURS.map(function (h) {
    const s = v.filter(function (x) { return x.slot === h; });
    const names = {};
    s.forEach(function (x) { names[x.place] = (names[x.place] || 0) + 1; });
    const top = Object.keys(names).sort(function (a, b) { return names[b] - names[a]; });
    return { slot: h, n: s.length, avg: stAvg_(s), long: stCount_(s, "ロング"),
             top: top.slice(0, 2).map(function (p) { return p + "×" + names[p]; }).join(" / ") };
  }).filter(function (r) { return r.n > 0; });
}

/* ============ ロングマップ（オプチャ込み） ============ */

function stLongMap_(all) {
  const g = {};
  all.forEach(function (x) {
    const k = normalizePlace_(x.place) || "?";
    if (!g[k]) g[k] = { names: {}, own: [], opu: [] };
    g[k].names[x.place] = (g[k].names[x.place] || 0) + 1;
    (x.isOpu ? g[k].opu : g[k].own).push(x);
  });

  return Object.keys(g).map(function (k) {
    const v = g[k];
    const names = Object.keys(v.names).sort(function (a, b) { return v.names[b] - v.names[a]; });
    const list = v.own.concat(v.opu);
    return {
      place: names[0], n: list.length,
      ownLong: stCount_(v.own, "ロング"),
      opuLong: stCount_(v.opu, "ロング"),
      long: stCount_(list, "ロング"),
      max: list.length ? Math.max.apply(null, list.map(function (x) { return x.money; })) : 0,
      avg: stAvg_(list)
    };
  }).filter(function (r) { return r.long > 0; })
    .sort(function (a, b) { return b.long - a.long || b.max - a.max; });
}

/* ============ 入口 ============ */

function buildStrategy(startD, endD) {
  const c = stCollect_(startD, endD);
  return {
    all: c.all, own: c.own, opu: c.opu, hasMark: c.hasMark,
    tachimawari: stTachimawari_(c.own),
    efficiency: stEfficiency_(c.own, 5),
    byWeekday: stByWeekday_(c.own),
    longMap: stLongMap_(c.all)
  };
}

/* ============ メニュー ============ */

function menuStrategy() {
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
    '#r{width:100%;height:300px;font-size:11px;font-family:monospace;margin-top:10px;box-sizing:border-box}' +
    '</style></head><body>' +
    '<h3>🎯 立ち回り分析</h3>' +
    '<div class="d">何曜日の何時に、どの乗り場が良いかを記録から出します。<br>' +
    '<b>スプシもLINEも変更しません。</b></div>' +
    '<div class="rg">' +
    '<label><input type="radio" name="m" value="s" checked onchange="tg()"> 📅 期間選択</label>' +
    '<label><input type="radio" name="m" value="c" onchange="tg()"> ✍️ 日付指定</label></div>' +
    '<div id="sa"><select id="ps"></select></div>' +
    '<div id="ca" class="cu"><input type="date" id="sd"><span>～</span><input type="date" id="ed"></div>' +
    '<button id="b" onclick="go()">立ち回りを見る</button>' +
    progressWidget_() +
    '<textarea id="r" readonly></textarea>' +
    '<button onclick="cp()" style="background:#666">📋 結果をコピー</button>' +
    '<script>' +
    'function tg(){var m=document.querySelector(\'input[name="m"]:checked\').value;' +
    'document.getElementById("sa").style.display=m==="s"?"block":"none";' +
    'document.getElementById("ca").style.display=m==="c"?"flex":"none";}' +
    '(function(){var s=document.getElementById("ps"),t=new Date();' +
    's.add(new Option("全期間（おすすめ）","all"));' +
    'var cY=t.getFullYear(),cM=t.getMonth()+1,cD=t.getDate();' +
    'var sY=cY,sM=cM; if(cD<=15){sM--; if(sM===0){sM=12;sY--;}}' +
    's.add(new Option(sY+"/"+("0"+sM).slice(-2)+"/16 ～ "+("0"+cM).slice(-2)+"/"+("0"+cD).slice(-2)+" (今期)",' +
    'sY+"/"+sM+"/16-"+cY+"/"+cM+"/"+cD));' +
    'for(var i=0;i<12;i++){var eY=sY,eM=sM,hM=eM-1,hY=eY; if(hM===0){hM=12;hY--;}' +
    's.add(new Option(hY+"/"+("0"+hM).slice(-2)+"/16 ～ "+("0"+eM).slice(-2)+"/15",' +
    'hY+"/"+hM+"/16-"+eY+"/"+eM+"/15")); sY=hY;sM=hM;}})();' +
    'function go(){var m=document.querySelector(\'input[name="m"]:checked\').value;' +
    'var v=m==="s"?document.getElementById("ps").value:' +
    '(document.getElementById("sd").value.replace(/-/g,"/")+"-"+document.getElementById("ed").value.replace(/-/g,"/"));' +
    'document.getElementById("b").disabled=true;progShow();' +
    'google.script.run.withSuccessHandler(function(t){document.getElementById("r").value=t;' +
    'progDone("完了しました");document.getElementById("b").disabled=false;})' +
    '.withFailureHandler(function(e){progFail(e.message);document.getElementById("b").disabled=false;})' +
    '.runStrategy(v);}' +
    'function cp(){var t=document.getElementById("r");t.select();' +
    'try{document.execCommand("copy");alert("コピーしました");}catch(e){alert("長押しで選択してコピー");}}' +
    '</scr' + 'ipt></body></html>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(580).setHeight(700), "🎯 立ち回り分析");
}

function stPad_(s, n) {
  s = String(s);
  let w = 0;
  for (let i = 0; i < s.length; i++) w += /[\x00-\x7F｡-ﾟ]/.test(s.charAt(i)) ? 1 : 2;
  return s + Array(Math.max(1, n - w + 1)).join(" ");
}
function stYen_(n) { return "¥" + Number(n).toLocaleString(); }

function runStrategy(val) {
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

  const S = buildStrategy(startD, endD);
  progSet_(60, "集計しています");
  if (!S.own.length) return "この期間に集計できる乗車がありませんでした。";

  const own = S.own;
  let out = "■ 期間: " + label + "\n";
  out += "■ 自社 " + own.length + "件 ／ オプチャ " + S.opu.length + "件\n";
  out += "■ ショート≦" + stYen_(ST_SHORT_MAX) + " ／ ミドル〜" + stYen_(ST_LONG_MIN - 1) +
         " ／ ロング≧" + stYen_(ST_LONG_MIN) + "\n";
  out += "  全体 平均" + stYen_(stAvg_(own)) +
         "  ショート" + stCount_(own, "ショート") +
         " ミドル" + stCount_(own, "ミドル") +
         " ロング" + stCount_(own, "ロング") +
         "（ロング率 " + (stCount_(own, "ロング") / own.length * 100).toFixed(1) + "%）\n";

  // ---- 1. 立ち回り候補 ----
  out += "\n══════════════════════\n";
  out += "【1】立ち回り候補（曜日区分 × 時間帯 × 乗り場）\n";
  out += ST_MIN_N + "件以上ある枠だけ。補正後の高い順\n\n";
  out += stPad_("曜日", 6) + stPad_("時", 6) + stPad_("乗り場", 16) +
         stPad_("件数", 6) + stPad_("実平均", 10) + stPad_("補正後", 10) + "ロング\n";
  S.tachimawari.slice(0, 20).forEach(function (r) {
    out += stPad_(r.dayType, 6) + stPad_(stHourLabel_(r.slot), 6) +
           stPad_(r.place.length > 7 ? r.place.slice(0, 7) + "…" : r.place, 16) +
           stPad_(r.n + "件", 6) + stPad_(stYen_(r.avg), 10) + stPad_(stYen_(r.score), 10) +
           r.long + "件" + (r.wait !== null ? "  待ち" + r.wait + "分" : "") + "\n";
  });
  out += "\n  ※補正後 = 件数が少ない枠を全体平均へ寄せた値。\n";
  out += "    1件だけの高額が上位に来ないようにするため。件数も必ず見てください。\n";

  // ---- 2. 待ち時間あたりの効率 ----
  out += "\n══════════════════════\n";
  out += "【2】待ち時間あたりの効率（乗り場別・5件以上）\n";
  out += "平均売上が高くても、待ちが長ければ1晩の本数が減ります\n\n";
  out += stPad_("乗り場", 16) + stPad_("件数", 6) + stPad_("平均売上", 10) +
         stPad_("平均待ち", 9) + "待ち1時間あたり\n";
  S.efficiency.slice(0, 12).forEach(function (r) {
    out += stPad_(r.place.length > 7 ? r.place.slice(0, 7) + "…" : r.place, 16) +
           stPad_(r.n + "件", 6) + stPad_(stYen_(r.avg), 10) +
           stPad_(r.wait + "分", 9) + stYen_(r.perHour) + "\n";
  });
  out += "\n  ※待ち時間が記録されている行だけが対象です。\n";

  // ---- 3. 曜日ごと ----
  out += "\n══════════════════════\n";
  out += "【3】曜日ごと（特定曜日の癖を見る）\n\n";
  out += stPad_("曜", 4) + stPad_("件数", 7) + stPad_("平均", 10) +
         stPad_("ロング", 8) + stPad_("ロング率", 10) + "平均待ち\n";
  S.byWeekday.forEach(function (r) {
    out += stPad_(r.dow, 4) + stPad_(r.n + "件", 7) + stPad_(stYen_(r.avg), 10) +
           stPad_(r.long + "件", 8) + stPad_((r.longRate * 100).toFixed(1) + "%", 10) +
           (r.wait !== null ? r.wait + "分" : "-") + "\n";
  });

  // 一番ロング率の高い曜日を時間帯で割ってみせる
  let best = null;
  S.byWeekday.forEach(function (r) {
    if (r.n >= 20 && (!best || r.longRate > best.longRate)) best = r;
  });
  if (best) {
    out += "\n  ── " + best.dow + "曜（ロング率" + (best.longRate * 100).toFixed(1) +
           "%）を時間帯で割ると ──\n";
    stWeekdayHours_(own, best.dow).forEach(function (h) {
      out += "   " + stPad_(stHourLabel_(h.slot), 6) + stPad_(h.n + "件", 6) +
             stPad_(stYen_(h.avg), 10) + stPad_("ロング" + h.long, 9) + h.top + "\n";
    });
  }

  // ---- 4. ロングマップ ----
  out += "\n══════════════════════\n";
  out += "【4】ロングマップ（オプチャ込み）\n\n";
  out += stPad_("乗り場", 18) + stPad_("ロング", 8) + stPad_("自社", 6) +
         stPad_("ｵﾌﾟﾁｬ", 7) + stPad_("全件", 7) + "最高額\n";
  S.longMap.slice(0, 15).forEach(function (r) {
    out += stPad_(r.place.length > 8 ? r.place.slice(0, 8) + "…" : r.place, 18) +
           stPad_(r.long + "件", 8) + stPad_(r.ownLong, 6) + stPad_(r.opuLong, 7) +
           stPad_(r.n + "件", 7) + stYen_(r.max) + "\n";
  });

  const untapped = S.longMap.filter(function (r) { return r.ownLong === 0 && r.opuLong > 0; });
  if (untapped.length) {
    out += "\n  ── オプチャにしか無いロング（＝まだ自社で取れていない）──\n";
    untapped.forEach(function (r) {
      out += "   " + stPad_(r.place, 22) + "最高" + stYen_(r.max) + "\n";
    });
  }

  out += "\n══════════════════════\n";
  out += "【判定について】\n";
  if (S.hasMark) {
    out += "オプチャ = メニュー「🏷 オプチャ印を付ける／外す」で指定した乗車。\n";
    out += "印が0件のうちは、全件が自社として集計されます。\n";
  } else {
    out += "Opucha.gs が入っていないため、全件を自社として集計しました。\n";
  }

  progSet_(100, "完了");
  return out;
}
