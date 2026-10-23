// ==UserScript==
// @name         FN tracker site 連携
// @namespace    fn-tracker-site
// @version      1.6
// @description  FN tracker site の「全員を更新」で、Fortnite Tracker の Epic Events の数字(PR・PR順位・賞金・最新大会の順位)を自動で読み取ります
// @match        https://fortnitetracker.com/*
// @match        https://tracker.gg/fortnite/*
// @match        https://*.github.io/*
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /*PARSE_START*/
  function parseTracker(text) {
    text = String(text).replace(/\r/g, "");
    var i = text.indexOf("Power Ranking");
    if (i < 0) return null;
    var head = text.slice(0, i);
    var m = text.slice(i).match(/([\d,]+)\s+#([\d,]+)\s+([A-Za-z_ ]{2,14}?)\s*\(([^)]+)\)/);
    if (!m) return null;
    var num = function (s) { return Number(String(s).replace(/,/g, "")); };
    var o = {
      pr: num(m[1]),
      prRank: num(m[2]),
      region: m[3].trim(),
      platform: /console|xbox|play ?station|gamepad|\bcs\b|switch/i.test(m[4]) ? "console" : /mobile|touch|phone/i.test(m[4]) ? "mobile" : /\bpc\b|kbm|keyboard|mouse/i.test(m[4]) ? "pc" : null,
      gm: /Zero Build/i.test(head) ? "zb" : "br"
    };
    var s = text.match(/This Season\s+([\d,]+)/);
    o.seasonPr = s ? num(s[1]) : null;
    var e = text.match(/Event Totals\s+Earnings\s+\$([\d,.]+)/) || text.match(/Earnings\s+\$([\d,.]+)/);
    o.earn = e ? num(e[1]) : null;
    var k = text.indexOf("K/D");
    var t = text.slice(Math.max(k, i));
    var ev = t.match(/([^\n]+)\n\s*([^\n]+)\n\s*([A-Z][a-z]{2} \d{1,2}, \d{4})\s*\n\s*#([\d,]+)/);
    o.event = ev ? (ev[1].trim() + " " + ev[2].trim()) : "";
    o.eventDate = ev ? ev[3] : "";
    o.latest = ev ? num(ev[4]) : null;
    return o;
  }
  /*PARSE_END*/

  // ---------- ① Tracker のページ側: 頼まれた選手のページなら、数字を読み取って保存 ----------
  var pm = location.pathname.match(/\/profile\/epic\/([^\/]+)\/epic-events/);
  if (pm && typeof GM_getValue === "function") {
    var nameKey;
    try { nameKey = decodeURIComponent(pm[1]).toLowerCase(); } catch (e) { nameKey = pm[1].toLowerCase(); }
    var qs = new URLSearchParams(location.search);
    var plat = qs.get("platform") || "kbm", reg = (qs.get("region") || "").toUpperCase();
    var tw = (qs.get("timeWindow") || "all").toLowerCase();
    var baseReg = reg.replace(/^ZB_/, "");
    var expect = plat === "gamepad" ? "console" : plat === "touch" ? "mobile" : "pc";
    nameKey = nameKey + "|" + plat + "|" + reg + "|" + tw;
    var pending = GM_getValue("pending", {}) || {};
    if (pending[nameKey]) {
      var tries = 0, seenAt = 0;
      var iv = setInterval(function () {
        tries++;
        var text = document.body ? document.body.innerText : "";
        var parsed = parseTracker(text);
        if (parsed) {
          if (!seenAt) { seenAt = tries; return; }          // 表の読み込みを少し待つ
          if (tries - seenAt < 3) return;
          clearInterval(iv);
          if (parsed.platform && parsed.platform !== expect) {
            GM_setValue("res:" + nameKey, { ok: false, t: Date.now(), error: "この端末のデータがありません(別の端末のデータが表示されました)。" });
          } else if (baseReg && parsed.region && parsed.region.toUpperCase().indexOf(baseReg) < 0) {
            GM_setValue("res:" + nameKey, { ok: false, t: Date.now(), error: "地域が違います(Trackerの表示: " + parsed.region + ")。" });
          } else {
            GM_setValue("res:" + nameKey, { ok: true, data: parsed, t: Date.now() });
          }
        } else if (tries > 40) {                              // 約20秒待っても数字が出ない
          clearInterval(iv);
          var none = /No Power Ranking|no events|not found/i.test(text);
          GM_setValue("res:" + nameKey, {
            ok: false, t: Date.now(),
            error: none ? "この選手のPRデータがありません。" : "この端末・モードのデータがないか、Trackerのページを読み取れませんでした(確認画面が出ていないか、ページを直接開いて確認してください)。"
          });
        }
      }, 500);
    }
    return;
  }

  // ---------- ② サイト側: FN tracker site からの依頼を受けて、Trackerのタブを開く ----------
  if (!document.querySelector('meta[name="fn-tracker-site"]')) return;

  var seen = {};
  // サイトとの連絡は2系統(window.postMessage と DOMイベント)で行い、どちらかが通れば動くようにする
  function post(o) {
    o.fnTo = "page";
    try { window.postMessage(o, "*"); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent("fn-to-page", { detail: JSON.stringify(o) })); } catch (e) {}
  }

  var PLAT = { pc: "kbm", console: "gamepad", mobile: "touch" };
  function fetchPlayer(name, mode, region, gm, tw) {
    var plat = PLAT[mode] || "kbm";
    var regParam = ((gm === "zb" ? "ZB_" : "") + (region || "ASIA")).toUpperCase();
    tw = tw === "season" ? "season" : "all";
    var nameKey = name.toLowerCase() + "|" + plat + "|" + regParam + "|" + tw;
    var jobs = GM_getValue("pending", {}) || {};
    jobs[nameKey] = { t: Date.now() };
    GM_setValue("pending", jobs);
    GM_setValue("res:" + nameKey, null);
    var url = "https://fortnitetracker.com/fortnite/profile/epic/" + encodeURIComponent(name) +
      "/epic-events/overview?" + (tw === "season" ? "timeWindow=season&" : "") + "region=" + encodeURIComponent(regParam) + "&platform=" + plat;
    var done = false, tab = null, lid = null, timer = null;
    function finish(r) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { GM_removeValueChangeListener(lid); } catch (e) {}
      try { if (tab && tab.close) tab.close(); } catch (e) {}
      var j = GM_getValue("pending", {}) || {};
      delete j[nameKey];
      GM_setValue("pending", j);
      var out = r && r.ok ? { ok: true, data: r.data } : { ok: false, error: (r && r.error) || "取得できませんでした。" };
      out.type = "result"; out.name = name; out.mode = mode; out.gm = gm; out.tw = tw;
      post(out);
    }
    lid = GM_addValueChangeListener("res:" + nameKey, function (k, o, n) { if (n) finish(n); });
    timer = setTimeout(function () { finish({ ok: false, error: "時間切れです(Trackerのページが開けなかった可能性があります)。" }); }, 50000);
    tab = GM_openInTab(url, { active: false, insert: true, setParent: true });
  }

  function onMsg(m) {
    if (!m || m.fnTo !== "script") return;
    if (m.type === "ping") post({ type: "pong", version: 3 });
    if (m.type === "fetch" && m.name) {
      if (m.rid != null) { if (seen[m.rid]) return; seen[m.rid] = 1; }   // 2系統で届いても1回だけ処理
      fetchPlayer(String(m.name), String(m.mode || "pc"), String(m.region || "ASIA"), String(m.gm || "br"), String(m.tw || "all"));
    }
  }
  window.addEventListener("message", function (e) { onMsg(e.data); });
  document.addEventListener("fn-to-script", function (e) { try { onMsg(JSON.parse(e.detail)); } catch (x) {} });
  try { document.documentElement.setAttribute("data-fn-helper", "3"); } catch (e) {}   // 「このページで起動している」目印
  post({ type: "pong", version: 3 });

  // 画面の右下に「動作中」の目印を10秒だけ出す(補助スクリプトがこのページで動いているかが目で見て分かる)
  try {
    var badge = document.createElement("div");
    badge.textContent = "✓ 補助スクリプト 動作中 (v1.6)";
    badge.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#1f9d55;color:#fff;font:600 13px/1 sans-serif;padding:9px 12px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.4)";
    document.body.appendChild(badge);
    setTimeout(function () { badge.remove(); }, 10000);
  } catch (e) {}
})();
