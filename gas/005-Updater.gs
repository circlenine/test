/**
 * ================================================================
 *  コードの自動更新（005-Updater.gs）
 *
 *  ★★★  U001ver  （2026/09/06）  ★★★
 *
 *  ファイル記号: C=001-Code / E=002-Extras / L=003-LineReport
 *               W=004-WebApp / U=005-Updater
 *
 *  やること:
 *    ① 新しいコードを読む（GitHub から、または Googleドライブから）
 *    ② いまのプロジェクトの中身をドライブに保存する（もどせるように）
 *    ③ Apps Script API を使って、自分自身を書き換える
 *    ④ ウェブアプリのデプロイも新しい版にやり直す
 *
 *  つまり、スマホでボタンを1つ押すだけで更新が終わる。
 *  貼り替えもデプロイのやり直しも要らなくなる。
 *
 *  ── 使えるようにするまで（最初の1回だけ）──
 *   1. ブラウザで script.google.com/home/usersettings を開き、
 *      「Google Apps Script API」を ON にする
 *   2. このファイルと 001-Code を貼る
 *   3. appsscript.json に権限を書き足す（README を見てください）
 *   4. メニュー「🔑 GitHubの鍵を設定」で、置き場所と鍵を入れる
 *      （ドライブから読ませたいときは、この手順は要らない）
 *   5. メニュー「🔄 コードを更新する」を1回押して、承認画面を通す
 *
 *  ── 壊れたときは ──
 *   メニュー「⏪ 前のコードに戻す」で、書き換える直前の状態に戻せる。
 *   それも効かないときは、ドライブの「taxi-gas/backup」に
 *   日時つきで全ファイルが残っているので、そこから手で貼り直す。
 * ================================================================
 */

const UPD_VERSION = "U001ver";

/** ドライブ上の置き場所（GitHubを使わないときの読み元） */
const UPD_FOLDER  = "taxi-gas";
/** 書き換える前の保存先。ここは GitHub を使うときも使う */
const UPD_BACKUP  = "backup";

/** Apps Script API の入口 */
const UPD_API = "https://script.googleapis.com/v1/projects/";

/** 拡張子 → Apps Script 上の種類 */
function updType_(name) {
  if (/\.html$/i.test(name)) return "HTML";
  if (/\.json$/i.test(name)) return "JSON";
  return "SERVER_JS";
}
/** ファイル名から拡張子を落とす（Apps Script 上の名前にする） */
function updBase_(name) { return String(name).replace(/\.(gs|js|html|json)$/i, ""); }


/* ============ 読み元（GitHub か ドライブか） ============ */
/*
 * GitHub の鍵を入れてあれば GitHub から、無ければドライブから読む。
 * 鍵は ScriptProperties にしまう。コードにもシートにも書かない。
 */

function updProps_() { return PropertiesService.getScriptProperties(); }
function updRepo_()   { return updProps_().getProperty("GH_REPO")   || ""; }
function updBranch_() { return updProps_().getProperty("GH_BRANCH") || "main"; }
function updPath_()   { return updProps_().getProperty("GH_PATH")   || "gas"; }
function updToken_()  { return updProps_().getProperty("GH_TOKEN")  || ""; }

/** いまどこから読むか */
function updSource_() { return (updRepo_() && updToken_()) ? "github" : "drive"; }

/** GitHub を叩く */
function updGh_(url, raw) {
  const res = UrlFetchApp.fetch(url, {
    headers: {
      "Authorization": "Bearer " + updToken_(),
      "Accept": raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "taxi-gas-updater"
    },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    let why = res.getContentText().slice(0, 200);
    try { why = JSON.parse(res.getContentText()).message; } catch (e) {}
    if (code === 401) why = "鍵が違うか、期限切れです（" + why + "）";
    if (code === 404) why = "置き場所が見つかりません。" +
      "リポジトリ名・ブランチ・フォルダ名と、鍵にそのリポジトリの読み取り権限があるかを見てください（" + why + "）";
    throw new Error("GitHub (" + code + ") " + why);
  }
  return res.getContentText();
}

/** GitHub のフォルダから、コードのファイルを読む */
function updReadGitHub_() {
  const base = "https://api.github.com/repos/" + updRepo_() + "/contents/";
  const dir = JSON.parse(updGh_(
    base + encodeURI(updPath_()) + "?ref=" + encodeURIComponent(updBranch_()), false));
  if (!Array.isArray(dir)) throw new Error("フォルダではありませんでした：" + updPath_());

  const out = [];
  dir.forEach(function (e) {
    if (e.type !== "file") return;
    if (!/\.(gs|html|json)$/i.test(e.name)) return;
    out.push({
      name: updBase_(e.name),
      type: updType_(e.name),
      source: updGh_(base + encodeURI(e.path) + "?ref=" +
                     encodeURIComponent(updBranch_()), true)
    });
  });
  return out;
}

/** 新しいコードを読む。読み元は自動で決まる */
function updReadNew_() {
  return updSource_() === "github" ? updReadGitHub_() : updReadDrive_();
}

/** GitHub の置き場所と鍵を入れる */
function menuSetGitHub() {
  const ui = SpreadsheetApp.getUi();
  const ask = function (title, msg, cur) {
    const r = ui.prompt(title, msg + (cur ? "\n\nいま：" + cur : ""), ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return null;
    return r.getResponseText().trim();
  };

  const repo = ask("🔑 GitHub 1/4", "リポジトリ名（例：circlenine/test）", updRepo_());
  if (repo === null) return;
  const branch = ask("🔑 GitHub 2/4", "ブランチ名", updBranch_());
  if (branch === null) return;
  const path = ask("🔑 GitHub 3/4", "コードが入っているフォルダ（例：gas）", updPath_());
  if (path === null) return;
  const token = ask("🔑 GitHub 4/4",
    "アクセストークン（github_pat_… で始まるもの）\n" +
    "空のままにすると、いまの鍵をそのまま使います。", updToken_() ? "設定済み" : "未設定");
  if (token === null) return;

  const pr = updProps_();
  if (repo)   pr.setProperty("GH_REPO", repo);
  if (branch) pr.setProperty("GH_BRANCH", branch);
  if (path)   pr.setProperty("GH_PATH", path);
  if (token)  pr.setProperty("GH_TOKEN", token);

  // ちゃんと読めるか、その場で試す
  try {
    const n = updReadGitHub_();
    updTell_("✅ GitHub につながりました",
      "見つかったファイル：" + n.map(function (f) { return f.name; }).join("、"));
  } catch (e) {
    updTell_("❌ つながりませんでした", e.message);
  }
}


/* ============ メニューから呼ぶもの ============ */

/**
 * ドライブに置いてある新しいコードで、このプロジェクトを更新する。
 * 何を入れ替えるかを見せて、確認してから書き込む。
 */
function menuUpdateCode() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  const where = updSource_() === "github"
    ? "GitHub（" + updRepo_() + " / " + updBranch_() + " / " + updPath_() + "）"
    : "ドライブ（" + UPD_FOLDER + "）";

  let neu;
  try {
    neu = updReadNew_();
  } catch (e) {
    return updTell_("❌ " + where + " を読めませんでした", e.message);
  }
  if (!neu.length) {
    return updTell_("📂 新しいコードがありません",
      where + " に .gs のファイルが見つかりませんでした。");
  }

  // いまの中身を取る（ここで API が使えるかどうかも分かる）
  let cur;
  try {
    cur = updGetProject_();
  } catch (e) {
    return updTell_("❌ Apps Script API を使えませんでした",
      e.message + "\n\n" +
      "ブラウザで script.google.com/home/usersettings を開き、\n" +
      "「Google Apps Script API」を ON にしてください。");
  }

  // 何が変わるかを数える
  const byName = {};
  cur.files.forEach(function (f) { byName[f.name] = f; });
  const add = [], mod = [], same = [];
  neu.forEach(function (f) {
    const old = byName[f.name];
    if (!old) add.push(f.name);
    else if (String(old.source) !== String(f.source)) mod.push(f.name);
    else same.push(f.name);
  });

  if (!add.length && !mod.length) {
    return updTell_("✅ すでに最新です", "入れ替えるものはありませんでした。");
  }

  if (ui) {
    const a = ui.alert("🔄 コードを更新する",
      "入れ替える：" + (mod.join("、") || "なし") + "\n" +
      "新しく足す：" + (add.join("、") || "なし") + "\n" +
      "そのまま　：" + (same.join("、") || "なし") + "\n\n" +
      "書き換える前に、いまのコードをドライブに保存します。\n" +
      "進めますか？", ui.ButtonSet.YES_NO);
    if (a !== ui.Button.YES) return;
  }

  ss.toast("いまのコードを保存しています…", "🔄 更新中", 60);

  // ① まず今の中身を保存する。戻せないまま壊すのがいちばん困る
  let backupName = "";
  try {
    backupName = updBackup_(cur);
  } catch (e) {
    return updTell_("❌ バックアップできませんでした",
      "危ないので中止しました。\n" + e.message);
  }

  // ② 差し替える。ドライブに無いファイルはそのまま残す
  const merged = cur.files.map(function (f) {
    for (let i = 0; i < neu.length; i++) {
      if (neu[i].name === f.name) return neu[i];
    }
    return f;
  });
  neu.forEach(function (f) {
    if (!byName[f.name]) merged.push(f);
  });

  ss.toast("コードを書き込んでいます…", "🔄 更新中", 60);
  try {
    updPutProject_(merged);
  } catch (e) {
    return updTell_("❌ 書き込めませんでした",
      e.message + "\n\nコードは元のままです。（保存：" + backupName + "）");
  }

  // ③ ウェブアプリのデプロイもやり直す
  let dep = "";
  try {
    dep = updRedeploy_();
  } catch (e) {
    dep = "デプロイのやり直しは失敗しました（" + e.message + "）";
  }

  updTell_("✅ 更新しました（" + (mod.length + add.length) + "件）",
    "入れ替え：" + (mod.join("、") || "なし") + "\n" +
    "追加　　：" + (add.join("、") || "なし") + "\n" +
    dep + "\n\n" +
    "戻すときはメニュー「⏪ 前のコードに戻す」。\n" +
    "保存：" + UPD_FOLDER + "/" + UPD_BACKUP + "/" + backupName);
}

/** 書き換える直前の状態に戻す */
function menuRestoreCode() {
  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  let files, from;
  try {
    const b = updLatestBackup_();
    files = b.files; from = b.name;
  } catch (e) {
    return updTell_("❌ 戻せませんでした", e.message);
  }

  if (ui) {
    const a = ui.alert("⏪ 前のコードに戻す",
      from + "\nの状態に戻します。よろしいですか？", ui.ButtonSet.YES_NO);
    if (a !== ui.Button.YES) return;
  }
  try {
    updPutProject_(files);
  } catch (e) {
    return updTell_("❌ 戻せませんでした", e.message);
  }
  updTell_("⏪ 戻しました", from + " の状態にしました。");
}

/** いまのコードを、ドライブに保存しておくだけ */
function menuBackupCode() {
  let name = "";
  try {
    name = updBackup_(updGetProject_());
  } catch (e) {
    return updTell_("❌ 保存できませんでした", e.message);
  }
  updTell_("💾 保存しました", UPD_FOLDER + "/" + UPD_BACKUP + "/" + name);
}

/** いまの状態を見る（APIが使えるか、ドライブに何があるか） */
function menuUpdateStatus() {
  const L = [];
  L.push("このファイル：" + UPD_VERSION);

  try {
    const cur = updGetProject_();
    L.push("✅ Apps Script API：使えます");
    L.push("　いまのファイル：" +
      cur.files.map(function (f) { return f.name; }).join("、"));
  } catch (e) {
    L.push("❌ Apps Script API：使えません");
    L.push("　" + e.message);
    L.push("　script.google.com/home/usersettings で ON にしてください");
  }

  L.push("");
  L.push(updSource_() === "github"
    ? "読み元：GitHub　" + updRepo_() + " / " + updBranch_() + " / " + updPath_()
    : "読み元：Googleドライブ　" + UPD_FOLDER +
      "\n　（GitHubから読ませたいなら「🔑 GitHubの鍵を設定」）");

  try {
    const neu = updReadNew_();
    L.push(neu.length
      ? "　見つかったファイル：" + neu.map(function (f) { return f.name; }).join("、")
      : "　.gs のファイルが見つかりません");
  } catch (e) {
    L.push("　読めません：" + e.message);
  }

  updTell_("🔧 自動更新の状態", L.join("\n"));
}


/* ============ 中身 ============ */

/** 結果を、出せる場所ぜんぶに出す（スマホだとダイアログが出ないことがある） */
function updTell_(title, body) {
  try { SpreadsheetApp.getActiveSpreadsheet().toast(String(body).slice(0, 400), title, 30); } catch (e) {}
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("説明");
    if (sh) {
      sh.getRange("Y5").setValue("最後の更新");
      sh.getRange("Z5").setValue(title + "\n" + body);
    }
  } catch (e) {}
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(title, body, ui.ButtonSet.OK);
  } catch (e) {}
}

/** ドライブの「taxi-gas」フォルダ。無ければ作る */
function updFolder_() {
  const it = DriveApp.getFoldersByName(UPD_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(UPD_FOLDER);
}

/** その中の「backup」フォルダ。無ければ作る */
function updBackupFolder_() {
  const parent = updFolder_();
  const it = parent.getFoldersByName(UPD_BACKUP);
  return it.hasNext() ? it.next() : parent.createFolder(UPD_BACKUP);
}

/**
 * ドライブから新しいコードを読む。
 * 同じ名前が何個かあったら、いちばん新しいものを使う。
 * （ドライブは同名ファイルを何個でも置けてしまうため）
 */
function updReadDrive_() {
  const folder = updFolder_();
  const best = {};
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const nm = f.getName();
    if (!/\.(gs|html|json)$/i.test(nm)) continue;
    const base = updBase_(nm);
    const t = f.getLastUpdated().getTime();
    if (!best[base] || t > best[base].t) best[base] = { t: t, f: f, nm: nm };
  }
  return Object.keys(best).map(function (base) {
    return {
      name: base,
      type: updType_(best[base].nm),
      source: best[base].f.getBlob().getDataAsString("UTF-8")
    };
  });
}

/** Apps Script API を叩く */
function updApi_(path, method, payload) {
  const opt = {
    method: method,
    headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
    contentType: "application/json",
    muteHttpExceptions: true
  };
  if (payload) opt.payload = JSON.stringify(payload);

  const res = UrlFetchApp.fetch(UPD_API + ScriptApp.getScriptId() + path, opt);
  const code = res.getResponseCode();
  const txt = res.getContentText();
  if (code < 200 || code >= 300) {
    let why = txt.slice(0, 200);
    try { why = JSON.parse(txt).error.message; } catch (e) {}
    throw new Error("(" + code + ") " + why);
  }
  return JSON.parse(txt);
}

/** いまのプロジェクトの中身を取る */
function updGetProject_() {
  const r = updApi_("/content", "get", null);
  return { files: r.files || [] };
}

/** プロジェクトの中身を書き換える */
function updPutProject_(files) {
  if (!files || !files.length) throw new Error("書き込む中身がありません");
  // appsscript.json を落とすとプロジェクトが壊れるので、必ず入っているか確かめる
  let hasManifest = false;
  files.forEach(function (f) { if (f.name === "appsscript") hasManifest = true; });
  if (!hasManifest) throw new Error("appsscript が入っていません（危ないので中止）");

  const body = files.map(function (f) {
    return { name: f.name, type: f.type, source: f.source };
  });
  updApi_("/content", "put", { files: body });
}

/** いまの中身を、日時つきでドライブに保存する */
function updBackup_(cur) {
  const folder = updBackupFolder_();
  const now = new Date();
  const stamp = now.getFullYear() + pad2_(now.getMonth() + 1) + pad2_(now.getDate()) + "_" +
                pad2_(now.getHours()) + pad2_(now.getMinutes()) + pad2_(now.getSeconds());
  const sub = folder.createFolder(stamp);
  cur.files.forEach(function (f) {
    const ext = f.type === "HTML" ? ".html" : (f.type === "JSON" ? ".json" : ".gs");
    sub.createFile(f.name + ext, f.source, "text/plain");
  });
  // 古いものを増やしすぎない（10個まで残す）
  try { updTrimBackups_(folder, 10); } catch (e) {}
  return stamp;
}

/** バックアップは新しいほうから n 個だけ残す */
function updTrimBackups_(folder, n) {
  const list = [];
  const it = folder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    list.push({ f: f, t: f.getDateCreated().getTime() });
  }
  list.sort(function (a, b) { return b.t - a.t; });
  list.slice(n).forEach(function (x) { x.f.setTrashed(true); });
}

/** いちばん新しいバックアップを読む */
function updLatestBackup_() {
  const folder = updBackupFolder_();
  let best = null;
  const it = folder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    const t = f.getDateCreated().getTime();
    if (!best || t > best.t) best = { t: t, f: f };
  }
  if (!best) throw new Error("保存されたコードがありません");

  const files = [];
  const fi = best.f.getFiles();
  while (fi.hasNext()) {
    const f = fi.next();
    files.push({
      name: updBase_(f.getName()),
      type: updType_(f.getName()),
      source: f.getBlob().getDataAsString("UTF-8")
    });
  }
  if (!files.length) throw new Error("保存されたコードが空でした");
  return { name: best.f.getName(), files: files };
}

/**
 * ウェブアプリのデプロイを、新しい版でやり直す。
 * これをしないと、コードを直してもページは古いままになる。
 */
function updRedeploy_() {
  const deps = updApi_("/deployments", "get", null).deployments || [];
  // @HEAD（作業中の版）は触らない。公開しているものだけ相手にする
  const live = deps.filter(function (d) {
    const c = d.deploymentConfig || {};
    return c.versionNumber;
  });
  if (!live.length) {
    return "デプロイがまだありません（ウェブページを使うなら「新しいデプロイ」を1回してください）";
  }

  const ver = updApi_("/versions", "post",
    { description: "自動更新 " + new Date().toISOString() });

  let n = 0;
  live.forEach(function (d) {
    updApi_("/deployments/" + d.deploymentId, "put", {
      deploymentConfig: {
        scriptId: ScriptApp.getScriptId(),
        versionNumber: ver.versionNumber,
        manifestFileName: "appsscript",
        description: d.deploymentConfig.description || ""
      }
    });
    n++;
  });
  return "デプロイもやり直しました（版 " + ver.versionNumber + " / " + n + "件）";
}


/* ================================================================
 *  そうさパネル
 *
 *  スマホの「Googleスプレッドシート」アプリでは、
 *  この手のメニューが最初から出ない。ボタン（図形）も押せない。
 *  でも「セルにチェックを入れる」ことはできる。
 *
 *  そこで、チェックを入れたら動く形にする。
 *  　・チェックした瞬間に動く（onEdit のトリガー）
 *  　・それが効かない機種のために、1分おきの見張りも置く
 *  どちらか片方でも効けば動く。二重に動かないよう鍵をかけてある。
 * ================================================================ */

const PANEL_TAB   = "そうさ";
const PANEL_TOP   = 3;    // ボタンが始まる行

/** 上から順に並べるボタン。fn は無ければ出さない */
function panelItems_() {
  return [
    { label: "🔄 コードを更新する",            fn: "menuUpdateCode",
      note: "GitHubの新しいコードを取り込み、デプロイもやり直します" },
    { label: "🔧 更新できる状態か調べる",      fn: "menuUpdateStatus",
      note: "APIが使えるか、どこから読むかを見ます" },
    { label: "💬 ページのURLをLINEに送る",     fn: "menuWebAppSendLine",
      note: "グループLINEにリンクを送ります" },
    { label: "🩺 ページが開けるか調べる",      fn: "menuWebAppCheck",
      note: "みんなの記録ページが本当に開けるか、実際に試します" },
    { label: "🧹 全タブをまとめて整形する",    fn: "menuFormatAll",
      note: "並び順・色・行の高さを整えます" },
    { label: "⏪ 前のコードに戻す",            fn: "menuRestoreCode",
      note: "更新で壊れたとき用。直前の状態に戻します" }
  ].filter(function (x) { return panelHas_(x.fn); });
}

/** その関数がこのプロジェクトに入っているか */
function panelHas_(name) {
  try { return eval("typeof " + name) === "function"; }
  catch (e) { return false; }
}

/** 「そうさ」タブを作る／作り直す */
function menuMakePanel() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PANEL_TAB);
  if (!sh) sh = ss.insertSheet(PANEL_TAB, 0);   // いちばん左に置く
  sh.clear();
  try { sh.getRange(1, 1, sh.getMaxRows(), 1).removeCheckboxes(); } catch (e) {}

  const items = panelItems_();

  sh.getRange("A1").setValue("チェックを入れると動きます（終わると自動で外れます）");
  sh.getRange("A1:D1").merge().setFontWeight("bold").setBackground("#e8eaed")
    .setVerticalAlignment("middle");

  const rows = items.map(function (x) { return ["", x.label, x.note]; });
  if (rows.length) {
    sh.getRange(PANEL_TOP, 1, rows.length, 3).setValues(rows);
    sh.getRange(PANEL_TOP, 1, rows.length, 1).insertCheckboxes();
    sh.getRange(PANEL_TOP, 2, rows.length, 1).setFontWeight("bold").setFontSize(13);
    sh.getRange(PANEL_TOP, 3, rows.length, 1).setFontSize(9).setFontColor("#5f6368");
    sh.getRange(PANEL_TOP, 1, rows.length, 3).setVerticalAlignment("middle").setWrap(true);
    sh.setRowHeights(PANEL_TOP, rows.length, 44);
  }

  const rRow = PANEL_TOP + rows.length + 1;
  sh.getRange(rRow, 2).setValue("結果").setFontWeight("bold");
  sh.getRange(rRow + 1, 2).setValue("（まだ何も動かしていません）")
    .setFontSize(10).setVerticalAlignment("top").setWrap(true);
  sh.getRange(rRow + 1, 2, 1, 2).merge();
  sh.setRowHeight(rRow + 1, 140);

  sh.setColumnWidth(1, 46).setColumnWidth(2, 260).setColumnWidth(3, 300);
  sh.setFrozenRows(1);

  const locked = panelProtect_(sh);
  panelInstall_();

  updTell_("🧰 そうさタブを作りました",
    "スマホのスプレッドシートアプリからは、このタブのチェックで動かせます。\n" +
    "（アプリではメニューが出ないため）\n\n" +
    "チェックを入れると動き、終わると自動でチェックが外れて、下に結果が出ます。\n\n" +
    (locked
      ? "🔒 このタブは、あなただけが触れるように保護しました。\n" +
        "　　ほかの編集者は見えますが、チェックは入れられません。\n" +
        "　　誰かに使わせたいときは、Googleスプレッドシートの\n" +
        "　　「データ → シートと範囲を保護」から、その人を足してください。"
      : "⚠️ 保護をかけられませんでした。\n" +
        "　　このままだと、編集できる人なら誰でもチェックを押せます。\n" +
        "　　「データ → シートと範囲を保護」で手動でかけてください。"));
}

/**
 * 「そうさ」タブを、自分だけが触れるようにする。
 *
 * ここのチェックは、コードの更新や巻き戻しを走らせるスイッチなので、
 * 編集できる人なら誰でも押せる状態にしておきたくない。
 * スクリプト自身は所有者として動くので、保護があっても書き込める。
 */
function panelProtect_(sh) {
  try {
    // 前にかけた保護が残っていたら、いったん外す
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) {
      try { if (p.canEdit()) p.remove(); } catch (e) {}
    });
    const p = sh.protect().setDescription("そうさタブ（作った人だけが押せます）");
    // 自分以外の編集者を外す。所有者は外せないので、結果として自分だけになる
    const others = p.getEditors();
    if (others && others.length) p.removeEditors(others);
    if (p.canDomainEdit()) p.setDomainEdit(false);
    return true;
  } catch (e) {
    logErr_("panelProtect", e);
    return false;
  }
}

/** いま保護がかかっているかを見る */
function panelIsProtected_(sh) {
  try {
    const ps = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    return ps.length > 0;
  } catch (e) { return false; }
}

/** チェックを見張るしくみを入れる（すでにあれば入れ直す） */
function panelInstall_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const f = t.getHandlerFunction();
    if (f === "panelOnEdit" || f === "panelWatch") ScriptApp.deleteTrigger(t);
  });
  // ① チェックした瞬間に動く
  ScriptApp.newTrigger("panelOnEdit").forSpreadsheet(ss).onEdit().create();
  // ② ①が効かない機種向けの保険。1分おきに見にいく
  ScriptApp.newTrigger("panelWatch").timeBased().everyMinutes(1).create();
}

/** 見張りを止める（1分おきの実行が気になるとき用） */
function menuPanelWatchOff() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "panelWatch") { ScriptApp.deleteTrigger(t); n++; }
  });
  updTell_("⏸ 1分おきの見張りを止めました（" + n + "件）",
    "チェックした瞬間に動くほう（onEdit）は残っています。\n" +
    "スマホアプリから効かなくなったら、「🧰 そうさタブを作る」で入れ直してください。");
}

/** チェックされた瞬間に呼ばれる */
function panelOnEdit(e) {
  try {
    if (!e || !e.range) return;
    if (e.range.getSheet().getName() !== PANEL_TAB) return;
    if (e.range.getColumn() !== 1) return;
    if (String(e.value).toUpperCase() !== "TRUE") return;
    panelRun_(e.range.getRow());
  } catch (err) { logErr_("panelOnEdit", err); }
}

/** 1分おきの見張り。onEdit が効かない機種のための保険 */
function panelWatch() {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PANEL_TAB);
    if (!sh) return;
    const n = panelItems_().length;
    if (!n) return;
    const vals = sh.getRange(PANEL_TOP, 1, n, 1).getValues();
    for (let i = 0; i < n; i++) {
      if (vals[i][0] === true) { panelRun_(PANEL_TOP + i); return; }   // 1回に1つだけ
    }
  } catch (err) { logErr_("panelWatch", err); }
}

/**
 * その行のボタンを実行する。
 * onEdit と見張りの両方から呼ばれるので、二重に動かないよう鍵をかける。
 */
function panelRun_(row) {
  const items = panelItems_();
  const idx = row - PANEL_TOP;
  if (idx < 0 || idx >= items.length) return;
  const item = items[idx];

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;      // だれかが動かしている最中

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PANEL_TAB);
  try {
    // 先にチェックを外す。ここで外しておかないと、
    // 見張りが同じものをもう一度動かしてしまう
    if (sh) sh.getRange(row, 1).setValue(false);

    panelSay_(sh, "⏳ " + item.label + " を実行中…");
    let out = "";
    try {
      const fn = eval(item.fn);
      fn();
      out = "✅ " + item.label + " が終わりました";
    } catch (err) {
      logErr_("panel:" + item.fn, err);
      out = "❌ " + item.label + " に失敗しました\n" + (err && err.message ? err.message : err);
    }
    panelSay_(sh, out);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** 結果らんに書く */
function panelSay_(sh, text) {
  if (!sh) return;
  try {
    const n = panelItems_().length;
    const row = PANEL_TOP + n + 2;
    const now = new Date();
    sh.getRange(row, 2).setValue(
      pad2_(now.getHours()) + ":" + pad2_(now.getMinutes()) + "  " + text);
    SpreadsheetApp.flush();
  } catch (e) {}
}
