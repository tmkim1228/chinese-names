(() => {
  "use strict";

  const $ = (s, root) => (root || document).querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const HAN_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/g;

  let DATA = null;
  let byHan = new Map();
  let partIndex = new Map();
  let loadPromise = null;

  function extractHans(text) {
    return String(text || "").match(HAN_RE) || [];
  }

  function indexData(payload) {
    DATA = payload;
    byHan = new Map();
    partIndex = new Map();
    for (const c of payload.cards || []) {
      if (!c || !c.han) continue;
      const list = byHan.get(c.han) || [];
      list.push(c);
      byHan.set(c.han, list);
      const parts = new Set(extractHans(c.parts));
      for (const p of parts) {
        const arr = partIndex.get(p) || [];
        arr.push(c);
        partIndex.set(p, arr);
      }
    }
  }

  async function fetchJson(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  async function fetchGz(url) {
    if (typeof DecompressionStream !== "function") throw new Error("no DecompressionStream");
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error(url + " " + r.status);
    const stream = r.body.pipeThrough(new DecompressionStream("gzip"));
    const text = await new Response(stream).text();
    return JSON.parse(text);
  }

  async function ensure() {
    if (DATA) return DATA;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (window.__HANZIDAILY__) {
        indexData(window.__HANZIDAILY__);
        return DATA;
      }
      let payload = null;
      try { payload = await fetchGz("data/hanzidaily.json.gz"); } catch (err) { console.warn("hanzidaily.json.gz", err); }
      if (!payload) payload = await fetchJson("data/hanzidaily.json");
      indexData(payload);
      return DATA;
    })();
    try {
      return await loadPromise;
    } catch (err) {
      loadPromise = null;
      throw err;
    }
  }

  function resolveHan(ch) {
    const s = String(ch || "");
    if (!s) return "";
    if (byHan.has(s)) return s;
    const r = window.dictionaryApp && window.dictionaryApp.lookup && window.dictionaryApp.lookup(s);
    if (r) {
      if (r.c && byHan.has(r.c)) return r.c;
      if (r.t && byHan.has(r.t)) return r.t;
    }
    return s;
  }

  function cardsFor(ch) {
    if (!DATA) return [];
    const key = resolveHan(ch);
    return (byHan.get(key) || []).slice();
  }

  function cardsWithPart(part) {
    if (!DATA) return [];
    const key = resolveHan(part) === part || !partIndex.has(part) ? part : part;
    const seen = new Set();
    const out = [];
    for (const c of partIndex.get(part) || []) {
      if (seen.has(c.id || c.han)) continue;
      seen.add(c.id || c.han);
      out.push(c);
    }
    // also try simplified/traditional of the part
    const r = window.dictionaryApp && window.dictionaryApp.lookup && window.dictionaryApp.lookup(part);
    if (r) {
      for (const alt of [r.c, r.t]) {
        if (!alt || alt === part) continue;
        for (const c of partIndex.get(alt) || []) {
          if (seen.has(c.id || c.han)) continue;
          seen.add(c.id || c.han);
          out.push(c);
        }
      }
    }
    return out;
  }

  function yeonsangText(c) {
    const raw = String(c && c.yeonsang || "").trim();
    if (!raw) return "";
    if (/^\[연상\]/.test(raw) || /^［연상］/.test(raw)) return raw;
    return "[연상] " + raw;
  }

  function linkifyParts(parts) {
    const s = String(parts || "");
    if (!s) return "";
    let out = "", last = 0;
    s.replace(HAN_RE, (ch, i) => {
      out += esc(s.slice(last, i));
      out += `<button type="button" class="hd-part" data-hd-part="${esc(ch)}" title="${esc(ch)}이 들어간 글자 보기">${esc(ch)}</button>`;
      last = i + ch.length;
      return ch;
    });
    out += esc(s.slice(last));
    return out;
  }

  function examplesHTML(c) {
    const ex = (c && c.examples) || [];
    if (!ex.length) return "";
    return `<ul class="hd-examples">${ex.map((e) =>
      `<li><span class="hd-ex-han" lang="zh-CN">${esc(e.text)}</span> <span class="hd-ex-py">${esc(e.pinyin)}</span><span class="hd-ex-m"> ${esc(e.meaning)}</span></li>`
    ).join("")}</ul>`;
  }

  function meaningHTML(c) {
    const ko = esc(c.meaning || "");
    const en = c.english ? `<span class="hd-en">${esc(c.english)}</span>` : "";
    const poly = c.poly ? `<span class="hd-poly">다음자</span>` : "";
    return `<div class="hd-meaning">${poly}<span class="hd-ko">${ko}</span>${en}</div>`;
  }

  function cardHTML(c, opts) {
    const compact = !!(opts && opts.compact);
    const story = String(c.story || "").trim();
    const yeon = yeonsangText(c);
    const storyToggle = story
      ? `<button type="button" class="hd-story-toggle ghost" data-hd-story="1" aria-pressed="false">이전 기억 문장 보기</button>`
      : "";
    const storyBlock = story
      ? `<p class="hd-story" hidden>${esc(story)}</p>`
      : "";
    return `<section class="hd-card${compact ? " is-compact" : ""}" data-hd-id="${esc(c.id || "")}" data-hd-han="${esc(c.han)}">
      <header class="hd-head">
        ${compact ? `<span class="hd-mini-han" lang="zh-CN">${esc(c.han)}</span><span class="hd-mini-py">${esc(c.pinyin)}</span>` : ""}
        <span class="hd-source">HANZI DAILY</span>
      </header>
      ${meaningHTML(c)}
      ${examplesHTML(c)}
      <dl class="hd-rows">
        <div class="hd-row hd-row-parts"><dt>구성</dt><dd>${linkifyParts(c.parts)}</dd></div>
        <div class="hd-row hd-row-bridge"><dt>연결</dt><dd>${esc(c.bridge)}</dd></div>
        <div class="hd-row hd-row-memory"><dt>기억</dt><dd>
          <p class="hd-yeonsang">${esc(yeon)}</p>
          ${storyToggle}${storyBlock}
        </dd></div>
      </dl>
    </section>`;
  }

  function cardsHTML(ch, opts) {
    const cards = cardsFor(ch);
    if (!cards.length) return "";
    return cards.map((c) => cardHTML(c, opts)).join("");
  }

  function charsHTML(text, opts) {
    const seen = new Set();
    const parts = [];
    for (const ch of extractHans(text)) {
      if (seen.has(ch)) continue;
      seen.add(ch);
      const html = cardsHTML(ch, Object.assign({ compact: true }, opts || {}));
      if (html) parts.push(html);
    }
    return parts.join("");
  }

  function fillMount(el) {
    if (!el || el.dataset.hdFilled === "1") return;
    const ch = el.dataset.hdHan || el.dataset.hdText;
    if (!ch) return;
    const compact = el.dataset.hdCompact === "1";
    const html = el.dataset.hdText ? charsHTML(el.dataset.hdText, { compact: true }) : cardsHTML(ch, { compact });
    if (!html) { el.hidden = true; el.innerHTML = ""; el.dataset.hdFilled = "1"; return; }
    el.hidden = false;
    el.innerHTML = html;
    el.dataset.hdFilled = "1";
  }

  async function mountAll(root) {
    try { await ensure(); } catch (err) { console.warn("hanzidaily", err); return; }
    const scope = root || document;
    const list = [];
    if (scope && scope.classList && scope.classList.contains("hd-mount")) list.push(scope);
    if (scope && scope.querySelectorAll) scope.querySelectorAll(".hd-mount").forEach((el) => list.push(el));
    list.forEach(fillMount);
  }

  function resetMounts(root) {
    (root || document).querySelectorAll(".hd-mount").forEach((el) => {
      el.dataset.hdFilled = "";
      el.innerHTML = "";
      el.hidden = false;
    });
  }

  function ensureOverlay() {
    let ov = document.getElementById("hd-parts-overlay");
    if (ov) return ov;
    ov = document.createElement("div");
    ov.id = "hd-parts-overlay";
    ov.className = "hd-overlay";
    ov.hidden = true;
    ov.innerHTML = `<div class="hd-overlay-card" role="dialog" aria-modal="true" aria-labelledby="hd-parts-title">
      <header class="modal-head">
        <h2 id="hd-parts-title">부품이 들어간 글자</h2>
        <button type="button" class="icon-x" data-hd-parts-close aria-label="닫기">×</button>
      </header>
      <div id="hd-parts-body"></div>
    </div>`;
    document.body.append(ov);
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.closest("[data-hd-parts-close]")) {
        ov.hidden = true;
        return;
      }
      const item = e.target.closest("[data-hd-open]");
      if (item) {
        const han = item.dataset.hdOpen;
        ov.hidden = true;
        if (han && window.dictionaryApp && window.dictionaryApp.showDetail) {
          window.dictionaryApp.showDetail(han);
        }
      }
    });
    return ov;
  }

  async function showPartList(part) {
    try { await ensure(); } catch (err) { console.warn("hanzidaily", err); return; }
    const ov = ensureOverlay();
    const body = $("#hd-parts-body", ov);
    const title = $("#hd-parts-title", ov);
    const list = cardsWithPart(part);
    const hun = (function () {
      // Prefer a short label from a parts string mention if present
      return part;
    })();
    title.textContent = `「${part}」이 들어간 글자 ${list.length}개`;
    if (!list.length) {
      body.innerHTML = `<p class="hint">이 부품이 들어간 다른 글자가 HANZI DAILY에 없습니다.</p>`;
    } else {
      body.innerHTML = `<ul class="hd-part-list">${list.map((c) =>
        `<li><button type="button" class="hd-part-item" data-hd-open="${esc(c.han)}"><span class="hd-part-han" lang="zh-CN">${esc(c.han)}</span><span class="hd-part-meta">${esc(c.pinyin)} · ${esc(c.meaning)}</span></button></li>`
      ).join("")}</ul>`;
    }
    ov.hidden = false;
  }

  document.addEventListener("click", (e) => {
    const partBtn = e.target.closest("[data-hd-part]");
    if (partBtn) {
      e.preventDefault();
      e.stopPropagation();
      showPartList(partBtn.dataset.hdPart);
      return;
    }
    const toggle = e.target.closest("[data-hd-story]");
    if (toggle) {
      e.preventDefault();
      e.stopPropagation();
      const card = toggle.closest(".hd-card");
      if (!card) return;
      const story = card.querySelector(".hd-story");
      const yeon = card.querySelector(".hd-yeonsang");
      const on = toggle.getAttribute("aria-pressed") === "true";
      if (on) {
        toggle.setAttribute("aria-pressed", "false");
        toggle.textContent = "이전 기억 문장 보기";
        if (story) story.hidden = true;
        if (yeon) yeon.hidden = false;
      } else {
        toggle.setAttribute("aria-pressed", "true");
        toggle.textContent = "[연상]으로 보기";
        if (story) story.hidden = false;
        if (yeon) yeon.hidden = true;
      }
    }
  }, true);

  window.hanziDaily = {
    ensure,
    cardsFor,
    cardsWithPart,
    yeonsangText,
    cardHTML,
    cardsHTML,
    charsHTML,
    mountAll,
    resetMounts,
    showPartList,
    extractHans,
    get ready() { return !!DATA; },
    get count() { return DATA ? (DATA.cards || []).length : 0; },
    get source() { return DATA ? DATA.source : ""; },
    get data() { return DATA; },
  };

  if (window.__HANZIDAILY__) {
    try { indexData(window.__HANZIDAILY__); } catch (err) { console.warn(err); }
  }
})();
