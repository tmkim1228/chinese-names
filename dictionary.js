(async () => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
  const D = await (window.__DICT__ ? Promise.resolve(window.__DICT__) : fetch("data/dictionary.json").then((r) => r.json()));
  const dictView = document.createElement("main");
  dictView.className = "view";
  dictView.id = "view-dictionary";
  dictView.hidden = true;
  $("#view-review").before(dictView);
  const overlay = document.createElement("div");
  overlay.className = "dict-overlay";
  overlay.hidden = true;
  overlay.innerHTML = '<div class="dict-detail"><div class="dict-heading"><h2>옥편</h2><button class="ghost" data-close>← 돌아가기</button></div><div id="detail-body"></div></div>';
  document.body.append(overlay);

  let mode = "search", forced = false, detailChar = "", results = [], expanded = false, filter = "";
  const toneMap = {};
  ["āáǎà", "ēéěè", "īíǐì", "ōóǒò", "ūúǔù", "ǖǘǚǜ"].forEach((s, i) => [...s].forEach((c, j) => { toneMap[c] = ["aeiouü"[i], j + 1]; }));
  const Y_VOWELS = new Set([2, 3, 6, 7, 12, 17, 20]);

  function pyNorm(s) {
    let b = "", t = null;
    for (const c of s.toLowerCase().normalize("NFC").replace(/u:/g, "ü").replace(/v/g, "ü")) {
      if (toneMap[c]) { b += toneMap[c][0]; t = toneMap[c][1]; }
      else if (/[1-5]/.test(c)) t = +c;
      else if (/[a-zü]/.test(c)) b += c;
    }
    return { b, t };
  }
  function han(s) { return /\p{Script=Han}/u.test(s); }
  function isHangulChar(ch) {
    const cp = ch.codePointAt(0);
    return cp >= 0xAC00 && cp <= 0xD7A3;
  }
  function decomposeHangul(ch) {
    const cp = ch.codePointAt(0);
    if (cp < 0xAC00 || cp > 0xD7A3) return null;
    const x = cp - 0xAC00;
    return { cho: Math.floor(x / 588), jung: Math.floor((x % 588) / 28), jong: x % 28 };
  }
  function composeHangul(cho, jung, jong) {
    return String.fromCodePoint(0xAC00 + cho * 588 + jung * 28 + jong);
  }
  function dueumVariants(syl) {
    const out = new Set([syl]);
    if ([...syl].length !== 1) return out;
    const d = decomposeHangul(syl);
    if (!d) return out;
    const { cho, jung, jong } = d;
    const y = Y_VOWELS.has(jung);
    if (cho === 5) out.add(composeHangul(y ? 11 : 2, jung, jong));
    else if (cho === 2) out.add(composeHangul(y ? 11 : 5, jung, jong));
    else if (cho === 11 && y) {
      out.add(composeHangul(5, jung, jong));
      out.add(composeHangul(2, jung, jong));
    }
    return out;
  }
  function syllable(s) {
    const n = pyNorm(s);
    return !/\s/.test(s.trim()) && Object.values(D).some((r) => r.p.some((p) => pyNorm(p).b === n.b));
  }
  function unique(a) {
    const seen = new Set();
    return a.filter((r) => {
      if (seen.has(r.c)) return false;
      seen.add(r.c);
      return true;
    });
  }
  const all = unique(Object.values(D)).sort((a, b) => a.f - b.f);
  const eumSet = new Set();
  for (const r of all) for (const e of r.e) if (e) eumSet.add(e);
  const eumList = [...eumSet];

  function isKnownEum(syl) {
    for (const v of dueumVariants(syl)) if (eumSet.has(v)) return true;
    return false;
  }
  function eumsOf(ch) {
    const r = D[ch] || all.find((x) => x.c === ch || x.t === ch);
    return r ? r.e.slice() : [];
  }
  function findByEum(syl) {
    const vars = dueumVariants(syl);
    return all.filter((r) => r.e.some((e) => vars.has(e)));
  }

  function hangulSyllablesOfTokens(q) {
    const tokens = q.trim().split(/\s+/).filter(Boolean);
    const syls = [];
    for (const t of tokens) {
      const chars = [...t];
      if (!chars.length || chars.some((ch) => !isHangulChar(ch))) return null;
      if (!chars.every((ch) => isKnownEum(ch))) return null;
      syls.push(...chars);
    }
    return syls;
  }
  function looksLikeHun(q) {
    const tokens = q.trim().split(/\s+/).filter(Boolean);
    if (tokens.length >= 2 && all.some((r) => r.h.some((h) => h.includes(q)))) return true;
    const syls = [...q].filter(isHangulChar);
    if (syls.length && !syls.every((ch) => isKnownEum(ch)) && all.some((r) => r.h.some((h) => h.includes(q)))) return true;
    return false;
  }

  const PLACEHOLDER = {
    search: "예: 명 / 밝을 명 / 왕소명 / jing / 峣",
    han: "예: 峣 / 王小明 / 菁",
    pinyin: "예: jing / yao2 / ming",
    hangul: "예: 명 / 밝을 명 / 이 / 높을 요",
  };
  const HINT = {
    search: "한글 독음(명)·훈음(밝을 명)·한국식 이름(왕소명, 왕 소명, 구양)도 찾습니다. 두음법칙(이/리, 유/류, 임/림, 노/로)과 복성(구양→欧阳, 제갈→诸葛)을 반영합니다.",
    han: "한자를 입력하면 뜻·음·병음·부수를 보여 줍니다. 여러 글자면 이름처럼 이어서 읽습니다.",
    pinyin: "병음 한 음절을 입력하세요. 성조 숫자·기호를 쓰면 그 성조만 보여 줍니다.",
    hangul: "한국 독음(명, 이)이나 훈음(밝을, 밝을 명)으로 한자를 찾습니다. 두음법칙(이/리, 유/류, 임/림, 노/로)을 반영합니다. 1800자 밖 글자도 포함합니다.",
  };

  function entry(r) {
    const py = r.p[0] || "", eum = r.e[0] || "?";
    return {
      id: `${r.c}|${py}`, date: new Date().toISOString(), simp: r.c, trad: r.t, py, ko: eum,
      hun: r.h.join(" / "), chars: [{ c: r.c, t: r.t, py, eum, hun: r.h.join(" / ") }],
      known: null, query: $("#name-input").value,
    };
  }
  function speak(s) { window.nameAppBridge?.speak(s); }
  function save(r) {
    window.nameAppBridge.save(entry(r));
    $("#detail-note")?.replaceChildren(document.createTextNode("✓ 복습 목록에 저장됨"));
  }
  function radical(r) {
    const v = r.rs.split(" ")[0], m = v.match(/^(\d+)('?)[.](\d+)/);
    if (!m) return "정보 없음";
    const n = +m[1];
    return `${String.fromCodePoint(0x2f00 + n - 1)} · 제${n}부수${m[2] ? " (간화 부수)" : ""} · 나머지 ${m[3]}획`;
  }
  function content(r, detail = false) {
    return `<div><span class="dict-glyph" data-detail="${esc(r.c)}">${esc(r.c)}</span>${r.t ? `정자 <b data-detail="${esc(r.t)}">${esc(r.t)}</b>` : ""} ${r.v.length ? "이체 " + r.v.map(esc).join(" · ") : ""}</div><p class="dict-py">${r.p.map(esc).join(" · ")}</p><p><b>${esc(r.h.join(" / ") || "훈음 자료 없음")}</b></p><p>한자음 · ${esc(r.e.join(" · ") || "자료 없음")}</p>${detail ? `<p>부수 · ${radical(r)}<br>총획 · ${esc(r.st || "정보 없음")}</p>` : ""}<p class="dict-small">${r.sur ? "성씨 사용 · " : ""}이름 말뭉치 ${r.g.toLocaleString()}회 · ${r.edu ? "교육 1800 · " : ""}${r.hsk ? "HSK " + esc(r.hsk) + " · " : ""}${r.f < 999999 ? "일반 빈도 #" + r.f : "일반 빈도 미상"}</p>`;
  }
  function showDetail(ch) {
    const r = D[ch] || all.find((x) => x.c === ch || x.t === ch);
    if (!r) return;
    detailChar = ch;
    $("#detail-body").innerHTML = content(r, true) + `<div class="dict-tools"><button class="primary" data-savechar>글자 저장</button><button class="ghost" data-audio="${esc(r.c)}">▶ 중국어 듣기</button></div><p id="detail-note"></p><p class="dict-small">Unihan · libhangul · Jun Da · Chinese-Names-Corpus. 다독음·간번 변환은 문맥에 따라 달라집니다.</p>`;
    overlay.hidden = false;
  }
  function selectMode(m) {
    mode = m;
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === m);
      b.setAttribute("aria-selected", b.dataset.tab === m ? "true" : "false");
    });
    $("#view-search").hidden = m !== "search";
    $("#view-review").hidden = m !== "review";
    const docView = $("#view-document");
    if (docView) docView.hidden = m !== "document";
    const gsearch = document.querySelector(".global-search");
    if (gsearch) gsearch.hidden = m === "document";
    dictView.hidden = !(m === "han" || m === "pinyin" || m === "hangul");
    const input = $("#name-input");
    if (input && PLACEHOLDER[m]) input.placeholder = PLACEHOLDER[m];
    const hint = $("#search-hint");
    if (hint && HINT[m]) hint.textContent = HINT[m];
  }
  function combined(chars) {
    const rs = chars.map((c) => D[c]).filter(Boolean);
    if (!rs.length) return "";
    const simp = rs.map((r) => r.c).join("");
    const trad = rs.map((r) => r.t || r.c).join("");
    const py = rs.map((r) => r.p[0]).join(" ");
    const ko = rs.map((r) => r.e[0] || "?").join("");
    return `<section class="panel"><h2>${esc(simp)}${simp !== trad ? " / " + esc(trad) : ""}</h2><p>${esc(py)} · <b>${esc(ko)}</b></p><p>${rs.map((r) => esc(r.h[0] || "훈음 없음")).join(" · ")}</p><button class="primary" data-savename="${esc(chars.join(""))}">이름 저장</button> <button class="ghost" data-audio="${esc(simp)}">▶ 듣기</button><p class="dict-small">문맥 없는 기본 독음입니다. 다독음은 각 글자 옥편에서 확인하세요.</p></section>`;
  }
  function card(r) {
    return `<article class="dict-result" data-detail="${esc(r.c)}">${content(r)}<button class="ghost" data-audio="${esc(r.c)}">▶</button></article>`;
  }
  function searchHangul(q) {
    const qn = q.trim();
    const single = /^[가-힣]$/.test(qn);
    const vars = single ? dueumVariants(qn) : null;
    const scored = [];
    for (const r of all) {
      let score = 0;
      if (single) {
        if (r.e.some((e) => e === qn)) score = 4;
        else if (r.e.some((e) => vars.has(e))) score = 3;
        else if (r.h.some((h) => h.split(/\s+/).some((tok) => vars.has(tok)))) score = 1;
      } else {
        if (r.h.some((h) => h === qn)) score = 4;
        else if (r.h.some((h) => h.includes(qn))) score = 3;
        else if (r.e.some((e) => e.includes(qn))) score = 2;
      }
      if (score) scored.push({ r, score });
    }
    scored.sort((a, b) => b.score - a.score || a.r.f - b.r.f);
    return unique(scored.map((x) => x.r));
  }
  function render() {
    const q = $("#name-input").value.trim();
    let head = "";
    if (mode === "han" && han(q)) {
      const chars = [...q].filter((c) => D[c]);
      head = chars.length > 1 ? combined(chars) : "";
    }
    const matched = results.filter((r) => !filter || [r.c, r.t, ...r.e, ...r.h].join(" ").includes(filter));
    const shown = expanded || filter ? matched : matched.slice(0, 40);
    let body = "";
    if (mode === "pinyin") {
      const n = pyNorm(q);
      for (let t = 1; t <= 5; t++) {
        const group = shown.filter((r) => r.p.some((p) => {
          const a = pyNorm(p);
          return a.b === n.b && (a.t || 5) === t && (!n.t || n.t === t);
        }));
        if (group.length) body += `<h3 class="dict-group">${t === 5 ? "경성" : t + "성"}</h3>` + group.map(card).join("");
      }
    } else body = shown.map(card).join("");
    const kind = mode === "hangul" ? "한국 독음·훈음" : "글자를 눌러 옥편 열기";
    dictView.innerHTML = head + `<p>${matched.length}자 · ${kind}</p><div class="dict-tools"><input class="dict-results-filter" value="${esc(filter)}" placeholder="결과 필터: 한자·독음·훈"></div><div class="dict-grid">${body || "<p>결과가 없습니다.</p>"}</div>${!expanded && !filter && matched.length > 40 ? `<button class="more-btn" data-dictmore>더 보기 (나머지 ${matched.length - 40}개)</button>` : ""}`;
  }
  function detectMode(q) {
    if (han(q)) return "han";
    if (/[가-힣]/.test(q)) {
      if (looksLikeHun(q)) return "hangul";
      const nameSyls = hangulSyllablesOfTokens(q);
      if (nameSyls && nameSyls.length >= 2) return "search";
      return "hangul";
    }
    if (syllable(q)) return "pinyin";
    return "search";
  }
  function search() {
    clearTimeout(inputTimer);
    const q = $("#name-input").value.trim();
    if (!q) return;
    expanded = false;
    filter = "";
    let m = mode;
    if (!forced) m = detectMode(q);
    selectMode(m);
    if (m === "search") { window.nameAppBridge.search(q); return; }
    if (m === "review") return;
    if (han(q)) results = unique([...q].filter((c) => D[c]).map((c) => D[c]));
    else if (/[가-힣]/.test(q)) results = searchHangul(q);
    else {
      const n = pyNorm(q);
      results = all.filter((r) => r.p.some((p) => {
        const a = pyNorm(p);
        return a.b === n.b && (!n.t || (a.t || 5) === n.t);
      }));
    }
    render();
  }

  $("#parse-btn").addEventListener("click", (e) => { e.stopImmediatePropagation(); search(); }, true);
  $("#name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.stopImmediatePropagation(); search(); }
  }, true);
  let inputTimer;
  $("#name-input").addEventListener("input", () => {
    forced = false;
    clearTimeout(inputTimer);
    inputTimer = setTimeout(search, 450);
  });
  document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => {
    forced = true;
    selectMode(btn.dataset.tab);
    if (btn.dataset.tab !== "review" && btn.dataset.tab !== "document") search();
  }));
  document.querySelectorAll(".ex").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopImmediatePropagation();
    forced = false;
    $("#name-input").value = btn.dataset.q;
    search();
  }, true));
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { overlay.hidden = true; return; }
    if (e.target.closest("[data-savechar]")) { save(D[detailChar]); return; }
    const a = e.target.closest("[data-audio]");
    if (a) { e.stopPropagation(); speak(a.dataset.audio); return; }
    if (e.target.closest("[data-dictmore]")) { expanded = true; render(); return; }
    const sn = e.target.closest("[data-savename]");
    if (sn) {
      const rs = [...sn.dataset.savename].map((c) => D[c]);
      const it = entry(rs[0]);
      it.simp = rs.map((r) => r.c).join("");
      it.trad = rs.map((r) => r.t || r.c).join("");
      it.py = rs.map((r) => r.p[0]).join(" ");
      it.ko = rs.map((r) => r.e[0] || "?").join("");
      it.hun = rs.map((r) => r.h.join(" / ")).join(" · ");
      it.id = it.simp + "|" + it.py;
      it.chars = rs.map((r) => entry(r).chars[0]);
      window.nameAppBridge.save(it);
      sn.textContent = "✓ 저장됨";
      return;
    }
    const d = e.target.closest("[data-detail]");
    if (d) showDetail(d.dataset.detail);
    else if (e.target.classList.contains("cand-char")) showDetail(e.target.textContent);
    else if (e.target.classList.contains("hist-simp")) showDetail([...e.target.textContent.trim()][0]);
  });
  dictView.addEventListener("input", (e) => {
    if (e.target.classList.contains("dict-results-filter")) {
      filter = e.target.value;
      render();
      const x = $(".dict-results-filter");
      x.focus();
    }
  });
  const kind = document.createElement("select");
  kind.id = "review-kind";
  kind.innerHTML = '<option value="all">전체</option><option value="name">이름</option><option value="char">글자</option><option value="word">단어</option>';
  document.querySelector(".review-toolbar .toolbar-actions").before(kind);
  function applyKind() {
    document.querySelectorAll(".hist-card").forEach((c) => { c.hidden = kind.value !== "all" && c.dataset.kind !== kind.value; });
  }
  kind.addEventListener("change", applyKind);
  new MutationObserver(applyKind).observe($("#review-list"), { childList: true });

  function lookup(ch) {
    return D[ch] || all.find((x) => x.c === ch || x.t === ch) || null;
  }
  window.dictionaryApp = {
    ready: true,
    showDetail,
    search,
    lookup,
    eumList,
    eumSet,
    eumsOf,
    findByEum,
    dueumVariants,
    isKnownEum,
    detectMode,
  };
})();
