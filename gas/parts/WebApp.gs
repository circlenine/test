/**
 * ================================================================
 *  みんなの記録ページ（ウェブアプリ）
 *
 *  スプレッドシートは「データの置き場所」に徹してもらい、
 *  見るのはこのページ、という分け方にするためのもの。
 *  スマホのブラウザで開くだけ。インストールもログインも要らない。
 *
 *  ・doGet が呼ばれたら、記録を集めて HTML に埋め込んで返す
 *  ・画面の切り替え・並べ替え・集計は、ぜんぶブラウザ側でやる
 *    （Apps Script を何度も呼ぶと、そのたび数秒待つことになるため）
 *
 *  001-Code.gs と同じプロジェクトに置く前提。
 *  金額の区分は「設定」タブの値を使う（読めないときは既定値）。
 * ================================================================
 */

/** 何日ぶんを持っていくか。古い記録まで全部見たいときは URL に ?all=1 を付ける */
const WB_DAYS = 190;

/** ブラウザからページを開いたとき */
function doGet(e) {
  const all = !!(e && e.parameter && e.parameter.all);
  let data;
  try {
    data = wbCollect_(all);
  } catch (err) {
    data = { ok: false, error: (err && err.message) || String(err) };
    try { logErr_("webapp", err); } catch (e2) {}
  }

  // < を逃がしておく。乗り場名などに </script> が混ざってもページが壊れないように
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  // 差し込みは関数で返す。文字列で渡すと $& などが特別扱いされて中身が化ける
  const html = WB_HTML.replace("/*__DATA__*/null", function () { return json; });

  return HtmlService.createHtmlOutput(html)
    .setTitle("僕はグールだ｜みんなの記録")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** ページのURLを出す（メニューから見られるように） */
function menuWebAppUrl() {
  const ui = SpreadsheetApp.getUi();
  let url = "";
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  if (!url) {
    ui.alert("📱 みんなの記録ページ",
      "まだ公開されていません。\n\n" +
      "Apps Script の画面で\n" +
      "　右上「デプロイ」→「新しいデプロイ」\n" +
      "　種類：ウェブアプリ\n" +
      "　次のユーザーとして実行：自分\n" +
      "　アクセスできるユーザー：全員\n" +
      "で公開すると、ここにURLが出ます。", ui.ButtonSet.OK);
    return;
  }
  ui.alert("📱 みんなの記録ページ",
    "このURLをLINEグループに貼ってください。\n\n" + url +
    "\n\n古い記録まで全部見たいときは、うしろに ?all=1 を付けます。",
    ui.ButtonSet.OK);
}

/* ============ 記録を集める ============ */

/** 「設定」タブがあればそれを、無ければ既定値を使う */
function wbShortMax_() { return (typeof cfgShortMax_ === "function") ? cfgShortMax_() : 4999; }
function wbLongMin_()  { return (typeof cfgLongMin_  === "function") ? cfgLongMin_()  : 10000; }
function wbBizStart_() { return (typeof cfgBizStart_ === "function") ? cfgBizStart_() : 17; }

/** 平日 / 金曜 / 土曜 / 日祝 */
function wbDayType_(d) {
  const w = d.getDay();
  const hol = (typeof isHoliday_ === "function") ? isHoliday_(d) : false;
  if (w === 0 || hol) return "日祝";
  if (w === 6) return "土曜";
  if (w === 5) return "金曜";
  return "平日";
}

/** 17時起点の枠。00:30 は 24、05:00 は 29 になる */
function wbSlot_(hh) { return hh < wbBizStart_() ? hh + 24 : hh; }

/**
 * 個人タブ＝自社の記録、エリアタブと関空・ﾊﾞﾗｼの「ｵﾌﾟﾁｬ」行＝オプチャ情報。
 * エリアタブには個人タブの写しも入っているので、同じ乗車を二度数えないようにする。
 */
function wbCollect_(all) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const since = all ? null : new Date(Date.now() - WB_DAYS * 86400000);

  const own = [], opu = [];
  const seen = {};
  let minD = null, maxD = null;

  const read = function (name, personal) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const last = sh.getLastRow();
    if (last < START_ROW) return;

    sh.getRange(START_ROW, 1, last - START_ROW + 1, LAST_COL).getValues().forEach(function (r) {
      const d = r[C_DATE - 1];
      if (!(d instanceof Date)) return;

      const who = String(r[C_SENDER - 1]).trim();
      const isOpu = (typeof toFullKana_ === "function")
        ? toFullKana_(who).replace(/[\s　]/g, "").indexOf("オプチャ") !== -1
        : who.indexOf("ｵﾌﾟﾁｬ") !== -1 || who.indexOf("オプチャ") !== -1;

      // 個人タブは自社ぶんだけ、それ以外のタブはオプチャぶんだけ拾う。
      // こうすると、エリアタブに入っている写しを数えずに済む。
      if (personal ? isOpu : !isOpu) return;

      if (minD === null || d < minD) minD = d;
      if (maxD === null || d > maxD) maxD = d;
      if (since && d < since) return;

      const money = parseInt(String(r[C_MONEY - 1]).replace(/[^0-9]/g, ""), 10);
      if (isNaN(money) || money <= 0) return;

      const tm = String(r[C_TIME - 1]).match(/(\d{1,2}):(\d{2})/);
      if (!tm) return;

      const place = String(r[C_PLACE - 1]).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      const key = (isOpu ? "O" : "S") + "|" + wbYmd_(d) + "|" + tm[0] + "|" + money + "|" + place;
      if (seen[key]) return;
      seen[key] = true;

      const w = String(r[C_WAIT - 1]).replace(/[^0-9]/g, "");
      const rec = {
        w: isOpu ? "ｵﾌﾟﾁｬ" : who,
        d: wbYmd_(d),
        t: tm[0],
        m: money,
        p: place,
        o: String(r[C_OTHER - 1]).replace(/\n/g, " ").trim().slice(0, 60),
        k: String(r[C_MARK - 1]).trim(),
        wt: w === "" ? null : parseInt(w, 10),
        y: wbDayType_(d),
        s: wbSlot_(parseInt(tm[1], 10))
      };
      (isOpu ? opu : own).push(rec);
    });
  };

  PERSONAL_TABS.forEach(function (n) { read(n, true); });
  AREA_TABS.concat(FLAG_TABS).forEach(function (n) { read(n, false); });

  return {
    ok: true,
    updated: wbNow_(),
    all: !!all,
    days: WB_DAYS,
    shortMax: wbShortMax_(),
    longMin: wbLongMin_(),
    members: PERSONAL_TABS.slice(),
    periods: wbPeriods_(minD, maxD),
    own: own,
    opu: opu
  };
}

function wbYmd_(d) {
  return d.getFullYear() + "-" + pad2_(d.getMonth() + 1) + "-" + pad2_(d.getDate());
}

function wbNow_() {
  const n = new Date();
  const w = ["日", "月", "火", "水", "木", "金", "土"];
  return (n.getMonth() + 1) + "/" + n.getDate() + "(" + w[n.getDay()] + ") " +
         pad2_(n.getHours()) + ":" + pad2_(n.getMinutes());
}

/**
 * 期間の一覧（16日〜翌15日）。新しいものが先。
 * レポートの期間プルダウンと同じ区切りにそろえてある。
 */
function wbPeriods_(minD, maxD) {
  const out = [];
  const today = maxD && maxD > new Date() ? maxD : new Date();
  const start = function (d) {
    return d.getDate() >= 16 ? new Date(d.getFullYear(), d.getMonth(), 16)
                             : new Date(d.getFullYear(), d.getMonth() - 1, 16);
  };
  const lab = function (a, b) {
    const w = ["日", "月", "火", "水", "木", "金", "土"];
    return (a.getMonth() + 1) + "/" + a.getDate() + "(" + w[a.getDay()] + ")〜" +
           (b.getMonth() + 1) + "/" + b.getDate() + "(" + w[b.getDay()] + ")";
  };

  let s = start(today);
  out.push({ from: wbYmd_(s), to: wbYmd_(today), label: lab(s, today) + "（今期）" });

  const limit = minD ? start(minD) : new Date(today.getFullYear(), today.getMonth() - 11, 16);
  let guard = 0;
  while (s.getTime() > limit.getTime() && guard++ < 60) {
    const ps = new Date(s.getFullYear(), s.getMonth() - 1, 16);
    const pe = new Date(s.getFullYear(), s.getMonth(), 15);
    out.push({ from: wbYmd_(ps), to: wbYmd_(pe), label: lab(ps, pe) });
    s = ps;
  }
  return out;
}
