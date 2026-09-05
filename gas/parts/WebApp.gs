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
  const gate = wbGate_();

  let data;
  if (gate.mode !== "ok") {
    // 見せてよい相手か決まるまで、記録は1件も渡さない
    data = { ok: false, gate: gate.mode, error: gate.msg, who: gate.who || "" };
  } else {
    try {
      data = wbCollect_(all);
    } catch (err) {
      data = { ok: false, error: (err && err.message) || String(err) };
      try { logErr_("webapp", err); } catch (e2) {}
    }
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

/**
 * 合言葉を入れてもらったときに、ページから呼ばれる。
 * 合っていれば記録を返す。合っていなければ何も返さない。
 */
function wbFetch(code, all) {
  const pass = String(wbCfg_("ページの合言葉", "")).trim();
  if (!pass) return JSON.stringify({ ok: false, error: "合言葉は設定されていません" });
  if (String(code || "").trim() !== pass) {
    return JSON.stringify({ ok: false, gate: "pass", error: "合言葉がちがいます" });
  }
  try {
    return JSON.stringify(wbCollect_(!!all));
  } catch (err) {
    try { logErr_("webapp", err); } catch (e2) {}
    return JSON.stringify({ ok: false, error: (err && err.message) || String(err) });
  }
}

/** 「設定」タブの値。001-Code.gs が無いときのために既定値も受け取る */
function wbCfg_(key, def) {
  try {
    if (typeof cfg_ === "function") {
      const v = cfg_(key);
      return (v === undefined || v === null) ? def : v;
    }
  } catch (e) {}
  return def;
}

/**
 * 見せてよい相手かを決める。
 *   ok    … 見せる
 *   pass  … 合言葉を聞く
 *   deny  … このメールは許していない
 *   setup … メールで制限したいのに、デプロイの設定がそれに向いていない
 *
 * メールでの制限は、デプロイの「実行するユーザー」を
 * 「ウェブアプリにアクセスしているユーザー」にしていないと、
 * 相手のメールが取れないので効かない。そのときは合言葉に切り替える。
 */
function wbGate_() {
  const emails = String(wbCfg_("ページを見られるメール", "")).trim();
  const pass   = String(wbCfg_("ページの合言葉", "")).trim();
  if (!emails && !pass) return { mode: "ok" };            // 鍵なし

  if (emails) {
    const allow = emails.split(/[,、\s]+/)
      .map(function (x) { return x.trim().toLowerCase(); })
      .filter(String);
    let who = "";
    try { who = String(Session.getActiveUser().getEmail() || "").toLowerCase(); } catch (e) {}

    if (who) {
      if (allow.indexOf(who) !== -1) return { mode: "ok" };
      return { mode: "deny", who: who,
               msg: "このアカウントでは開けません。管理者に連絡してください。" };
    }
    // メールが取れなかった
    if (!pass) {
      return { mode: "setup",
               msg: "メールでの制限を効かせるには、デプロイの設定を直す必要があります。" };
    }
  }

  if (pass) return { mode: "pass", msg: "合言葉を入れてください" };
  return { mode: "ok" };
}

/** 公開されているページのURL。まだなら空 */
function wbUrl_() {
  try { return ScriptApp.getService().getUrl() || ""; } catch (e) { return ""; }
}

/** いまの鍵の状態を、ひとことで */
function wbLockText_() {
  const g = wbGate_();
  if (g.mode === "pass")  return "🔒 合言葉あり";
  if (g.mode === "setup") return "⚠️ メール制限を入れていますが、デプロイ設定が合っていません";
  if (g.mode === "deny" || g.mode === "ok") {
    const em = String(wbCfg_("ページを見られるメール", "")).trim();
    const pw = String(wbCfg_("ページの合言葉", "")).trim();
    if (em) return "🔒 メールで制限中";
    if (pw) return "🔒 合言葉あり";
  }
  return "🔓 鍵なし（URLを知っている人は誰でも見られます）";
}

/**
 * ページのURLを出す。
 * 前は ui.alert に文字で出していたが、それだとコピーもタップもできなかった。
 * リンクとコピーボタンを置いた画面にする。
 */
function menuWebAppUrl() {
  const ui = SpreadsheetApp.getUi();
  const url = wbUrl_();

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

  const lock = wbLockText_();
  const html =
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;' +
      'font-size:13px;padding:14px;margin:0;color:#202124}' +
    'a.u{display:block;word-break:break-all;background:#e8f0fe;border:1px solid #c6dafc;' +
      'border-radius:10px;padding:12px;color:#1155cc;text-decoration:none;font-size:12px;' +
      'line-height:1.6}' +
    'button{width:100%;margin-top:9px;border:0;border-radius:10px;padding:12px;' +
      'font-size:14px;font-weight:700;color:#fff;background:#1a73e8}' +
    'button.g{background:#06c755}button.w{background:#5f6368}' +
    '.lock{background:#f1f3f4;border-radius:9px;padding:9px 11px;margin:11px 0;font-size:12px}' +
    '.ok{color:#188038;font-weight:700;min-height:18px;margin-top:8px;text-align:center}' +
    '.note{color:#5f6368;font-size:11px;margin-top:11px;line-height:1.7}' +
    '</style>' +
    '<a class="u" href="' + wbEsc_(url) + '" target="_blank" rel="noopener">' +
      wbEsc_(url) + '</a>' +
    '<button onclick="cp()">📋 URLをコピー</button>' +
    '<button class="g" onclick="toLine()">💬 このURLをグループLINEに送る</button>' +
    '<div class="ok" id="ok"></div>' +
    '<div class="lock">' + wbEsc_(lock) + '</div>' +
    '<div class="note">・上のURLをタップすると、別のタブで開きます。<br>' +
      '・古い記録まで全部見たいときは、うしろに <b>?all=1</b> を付けます。<br>' +
      '・エラーが出るときは、Apps Script で「デプロイ」→「デプロイを管理」→ 鉛筆 →' +
      ' バージョン「新バージョン」→ デプロイ、をしてください。' +
      'ファイルを足したあとは、これをしないと反映されません。</div>' +
    '<script>' +
    'var U=' + JSON.stringify(url) + ';' +
    'function say(t){document.getElementById("ok").textContent=t;}' +
    'function cp(){' +
      'if(navigator.clipboard&&navigator.clipboard.writeText){' +
        'navigator.clipboard.writeText(U).then(function(){say("コピーしました");},' +
        'function(){fb();});}else{fb();}}' +
    'function fb(){var t=document.createElement("textarea");t.value=U;document.body.appendChild(t);' +
      't.select();try{document.execCommand("copy");say("コピーしました");}' +
      'catch(e){say("コピーできませんでした。URLを長押しして選んでください");}' +
      'document.body.removeChild(t);}' +
    'function toLine(){say("送信中…");' +
      'google.script.run.withSuccessHandler(function(m){say(m);})' +
      '.withFailureHandler(function(e){say("送れませんでした："+(e&&e.message?e.message:e));})' +
      '.wbSendUrlToLine();}' +
    '</script>';

  ui.showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(400).setHeight(430),
    "📱 みんなの記録ページ");
}

function wbEsc_(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 公開されているURLを、実際に開いてみて確かめる。
 * 推測で原因を当てにいくより、1回叩いたほうが早い。
 *
 * ここからの取得はログインしていない状態なので、
 * 「アクセスできるユーザー：全員」でなければ、みんなと同じように弾かれる。
 * つまり、メンバーが見る状態をそのまま再現できる。
 */
function wbSelfTest_() {
  const url = wbUrl_();
  if (!url) {
    return { ok: false, url: "",
      title: "まだ公開されていません",
      how: "「デプロイ」→「新しいデプロイ」→ 種類：ウェブアプリ で公開してください。" };
  }

  let code = 0, body = "";
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    code = res.getResponseCode();
    body = String(res.getContentText() || "").slice(0, 4000);
  } catch (e) {
    return { ok: false, url: url,
      title: "URLを開けませんでした",
      how: (e && e.message) || String(e) };
  }

  if (body.indexOf("wbapp-ok") !== -1) {
    return { ok: true, url: url,
      title: "ページはちゃんと開けます（" + WB_VERSION + "）",
      how: "スマホで開けないなら、ブラウザに残っている古い中身が原因かもしれません。" +
           "画面を引き下げて読み込み直すか、別のブラウザで試してください。" };
  }

  // 目印が無い ＝ うちのページが返っていない。中身から理由を見分ける
  let title = "うちのページが返ってきていません（" + code + "）";
  let how = "";

  if (body.indexOf("doGet") !== -1 ||
      body.indexOf("スクリプト関数が見つかりません") !== -1 ||
      body.indexOf("Script function not found") !== -1) {
    how = "公開されているバージョンに doGet がありません。\n" +
          "004-WebApp を貼る前にデプロイした状態です。\n" +
          "→「デプロイ」→「デプロイを管理」→ 鉛筆 → バージョン「新バージョン」→ デプロイ";
  } else if (code === 401 || code === 403 ||
             body.indexOf("accounts.google.com") !== -1 ||
             body.indexOf("ServiceLogin") !== -1) {
    title = "ログインを求められています（" + code + "）";
    how = "「アクセスできるユーザー」が「全員」になっていません。\n" +
          "→「デプロイを管理」→ 鉛筆 → アクセスできるユーザー：全員 → デプロイ";
  } else if (code === 404 ||
             body.indexOf("ファイルを開くことができません") !== -1 ||
             body.indexOf("Sorry, unable to open the file") !== -1) {
    how = "そのURLのデプロイが見つかりません。消したか、URLが古いかです。\n" +
          "→「デプロイ」→「新しいデプロイ」で作り直し、出てきた新しいURLを使ってください。\n" +
          "　この画面の上に出ているURLが、いま正しいURLです。";
  } else {
    how = "原因を絞りきれませんでした。\n" +
          "→ まず「デプロイを管理」→ 鉛筆 → バージョン「新バージョン」→ デプロイ を試してください。";
  }
  return { ok: false, url: url, title: title, how: how, peek: body.slice(0, 200) };
}

/** 画面から呼ぶ用 */
function wbSelfTest() { return JSON.stringify(wbSelfTest_()); }

/**
 * ページのURLをグループLINEに送る。
 * LINEのトーク上ではリンクになるので、みんなタップするだけで開ける。
 */
function wbSendUrlToLine() {
  const url = wbUrl_();
  if (!url) return "まだ公開されていません";

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const info = ss.getSheetByName("説明");
  const to = info ? String(info.getRange("Z1").getValue() || "").trim() : "";
  if (!to) {
    // 送信先が無いときに全員配信へ落ちないよう、ここで止める
    return "送信先が未設定です（メニュー「👥 グループIDを設定」）";
  }
  const token = PropertiesService.getScriptProperties().getProperty("LINE_TOKEN") || "";
  if (!token) return "LINEトークンが未設定です（メニュー「🔑 LINEトークンを設定」）";

  const pass = String(wbCfg_("ページの合言葉", "")).trim();
  const text = "📱 みんなの記録ページ\n" + url +
    (pass ? "\n\n合言葉は各自に伝えます（このメッセージには書きません）" : "");

  const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    payload: JSON.stringify({ to: to, messages: [{ type: "text", text: text }] }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    return "送れませんでした（" + res.getResponseCode() + "）";
  }
  return "グループLINEに送りました";
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
