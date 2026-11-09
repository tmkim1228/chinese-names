(async () => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  /*
   * Pinyin → 한자음 for 다음자 (multiple Korean readings).
   * Only characters whose dictionary.json `e` list contains the target 독음 are mapped.
   * Sources (not invented readings):
   *  - Unihan kHangul lists the permitted Korean readings (e.g. 行 항/행, 樂 락/악, 降 강/항).
   *  - libhangul hun labels in dictionary.json tag each sense with its 독음
   *    (행: "다닐 행"; 항: "시장 항"/"항렬 항"; 악: "풍류 악"; 락: "즐길 락";
   *     강: "내릴 강"; 항: "항복할 항"; 차/거: "수레 차"/"수레 거";
   *     악/오: "나쁠 악"/"미워할 오"; 수/삭: "헤아릴 수"/"자주 삭";
   *     참/삼: "간여할 참"/"석 삼"; 률/솔: "헤아릴 률"/"거느릴 솔";
   *     건/간: "하늘 건"/"마를 간").
   *  - Which Mandarin reading takes which listed 독음 follows standard 한자음
   *    (행←xíng walk, 항←háng row/firm; 악←yuè music, 락←lè joy; etc.).
   * Characters with a single listed 독음 are mapped automatically at runtime.
   * If a character has several 독음 and is not in this table, all readings are shown.
   */
  const PINYIN_EUM = {
    行: { xing: "행", hang: "항", heng: "행" },
    乐: { le: "락", yue: "악", yao: "요" },
    樂: { le: "락", yue: "악", yao: "요" },
    降: { jiang: "강", xiang: "항" },
    车: { che: "차", ju: "거" },
    車: { che: "차", ju: "거" },
    恶: { e: "악", wu: "오" },
    惡: { e: "악", wu: "오" },
    率: { lv: "률", lü: "률", shuai: "솔" },
    参: { can: "참", shen: "삼", cen: "참" },
    參: { can: "참", shen: "삼", cen: "참" },
    数: { shu: "수", shuo: "삭" },
    數: { shu: "수", shuo: "삭" },
    乾: { qian: "건", gan: "간" },
  };

  const TONE_MARK = {
    ā: "a", á: "a", ǎ: "a", à: "a", ē: "e", é: "e", ě: "e", è: "e",
    ī: "i", í: "i", ǐ: "i", ì: "i", ō: "o", ó: "o", ǒ: "o", ò: "o",
    ū: "u", ú: "u", ǔ: "u", ù: "u", ǖ: "ü", ǘ: "ü", ǚ: "ü", ǜ: "ü",
  };
  function barePy(s) {
    let out = "";
    for (const c of String(s || "").normalize("NFC").toLowerCase()) {
      if (TONE_MARK[c]) out += TONE_MARK[c];
      else if (/[a-züv]/.test(c)) out += c === "v" ? "ü" : c;
    }
    return out;
  }

  let DATA = null;
  let index = new Map();
  let maxLen = 8;
  let loadPromise = null;
  let GLOSS = null;
  let glossMeta = null;
  let glossPromise = null;

  async function fetchWords() {
    if (window.__WORDS__) return window.__WORDS__;
    if (typeof DecompressionStream === "function") {
      try {
        const r = await fetch("data/words.json.gz");
        if (r.ok) {
          const stream = r.body.pipeThrough(new DecompressionStream("gzip"));
          return JSON.parse(await new Response(stream).text());
        }
      } catch (err) { console.warn("words.json.gz", err); }
    }
    const r = await fetch("data/words.json");
    if (!r.ok) throw new Error("words.json " + r.status);
    return r.json();
  }

  function buildGlosses(data) {
    glossMeta = (data && data.meta) || null;
    GLOSS = (data && data.g) ? data.g : (data || {});
  }

  async function fetchGlosses() {
    if (window.__KOGLOSSES__) return window.__KOGLOSSES__;
    if (typeof DecompressionStream === "function") {
      try {
        const r = await fetch("data/ko-glosses.json.gz");
        if (r.ok) {
          const stream = r.body.pipeThrough(new DecompressionStream("gzip"));
          return JSON.parse(await new Response(stream).text());
        }
      } catch (err) { console.warn("ko-glosses.json.gz", err); }
    }
    const r = await fetch("data/ko-glosses.json");
    if (!r.ok) throw new Error("ko-glosses.json " + r.status);
    return r.json();
  }

  async function ensureGlosses() {
    if (GLOSS) return GLOSS;
    if (glossPromise) return glossPromise;
    glossPromise = fetchGlosses().then((data) => {
      buildGlosses(data);
      return GLOSS;
    }).catch((err) => {
      glossPromise = null;
      GLOSS = {};
      console.warn("ko-glosses", err);
      return GLOSS;
    });
    return glossPromise;
  }

  function buildIndex(data) {
    DATA = data;
    maxLen = data.maxLen || 8;
    index = new Map();
    for (const row of data.e) {
      const rec = { s: row[0], t: row[1], p: row[2], d: row[3] };
      const add = (key) => {
        if (!key) return;
        const arr = index.get(key);
        if (arr) arr.push(rec);
        else index.set(key, [rec]);
      };
      add(rec.s);
      if (rec.t && rec.t !== rec.s) add(rec.t);
    }
  }

  function setLoading(on, msg) {
    const el = $("#doc-loading");
    if (!el) return;
    el.hidden = !on;
    if (msg) el.textContent = msg;
  }

  async function ensureWords() {
    if (DATA) return DATA;
    if (loadPromise) return loadPromise;
    setLoading(true, "단어 사전(CC-CEDICT)을 불러오는 중… 처음 한 번만 내려받으면 이후에는 오프라인에서도 쓸 수 있습니다.");
    loadPromise = Promise.all([
      fetchWords(),
      ensureGlosses(),
    ]).then(([data]) => {
      buildIndex(data);
      setLoading(false);
      return DATA;
    }).catch((err) => {
      loadPromise = null;
      setLoading(true, "단어 사전을 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.");
      throw err;
    });
    return loadPromise;
  }

  function isHan(ch) {
    const cp = ch.codePointAt(0);
    return (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xF900 && cp <= 0xFAFF)
      || (cp >= 0x20000 && cp <= 0x2FA1F);
  }
  function isSurnamePy(p) {
    return /(?:^| )[A-ZĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ]/.test(p || "");
  }
  function scoreEntry(rec, q) {
    let n = 0;
    if (!isSurnamePy(rec.p)) n += 10;
    if (rec.s === q) n += 5;
    if (rec.t === q) n += 3;
    if (q === rec.t && rec.s !== rec.t) n += 20;
    if (rec.s !== rec.t) n += 1;
    n += Math.min((rec.d || []).join("").length, 80) / 80;
    return n;
  }
  function lookup(q) {
    return index.get(q) || null;
  }
  function pick(q, entries) {
    if (!entries || !entries.length) return null;
    let best = entries[0], bestN = scoreEntry(best, q);
    for (let i = 1; i < entries.length; i++) {
      const n = scoreEntry(entries[i], q);
      if (n > bestN) { best = entries[i]; bestN = n; }
    }
    return best;
  }
  function charInfo(ch) {
    return window.dictionaryApp?.lookup?.(ch) || null;
  }

  function mappedEum(ch, info, syl) {
    const eums = [...new Set((info && info.e) || [])];
    if (!eums.length) return "";
    if (eums.length === 1) return eums[0];
    const bare = barePy(syl);
    if (!bare) return eums.join("·");
    const table = PINYIN_EUM[ch] || PINYIN_EUM[info.c] || PINYIN_EUM[info.t];
    if (!table) return eums.join("·");
    let hit = table[bare];
    if (!hit && bare.includes("ü")) hit = table[bare.replace(/ü/g, "v")];
    if (hit && eums.includes(hit)) return hit;
    return eums.join("·");
  }

  function eumForChar(ch, syl) {
    return mappedEum(ch, charInfo(ch), syl);
  }

  function hunsForEum(info, eum) {
    const all = (info && info.h) || [];
    if (!eum || eum.includes("·")) return all;
    const matched = all.filter((h) => h.split(/\s+/).pop() === eum);
    return matched.length ? matched : all;
  }

  function alignedPair(surface, wordPy) {
    const chars = [...surface];
    const syls = String(wordPy || "").trim().split(/\s+/).filter(Boolean);
    const aligned = syls.length === chars.length;
    return chars.map((ch, i) => ({ ch, syl: aligned ? syls[i] : null }));
  }

  function makeTok(piece, entries) {
    return { type: "word", text: piece, entries, rec: pick(piece, entries) };
  }
  function matchRun(chars, reverse) {
    const out = [];
    if (!reverse) {
      let i = 0;
      while (i < chars.length) {
        const limit = Math.min(maxLen, chars.length - i);
        let found = null;
        for (let len = limit; len >= 1; len--) {
          const piece = chars.slice(i, i + len).join("");
          const entries = lookup(piece);
          if (entries) { found = makeTok(piece, entries); i += len; break; }
        }
        if (!found) { out.push(makeTok(chars[i], null)); i++; }
        else out.push(found);
      }
    } else {
      let i = chars.length;
      while (i > 0) {
        const limit = Math.min(maxLen, i);
        let found = null;
        for (let len = limit; len >= 1; len--) {
          const piece = chars.slice(i - len, i).join("");
          const entries = lookup(piece);
          if (entries) { found = makeTok(piece, entries); i -= len; break; }
        }
        if (!found) { out.unshift(makeTok(chars[i - 1], null)); i--; }
        else out.unshift(found);
      }
    }
    return out;
  }
  function quality(toks) {
    let n = 0;
    for (const t of toks) {
      if (t.text.length >= 2) n += 50;
      if (t.rec && t.rec.d) n += t.rec.d.join("").length;
    }
    return n;
  }
  function chooseSeg(a, b) {
    if (a.length !== b.length) return a.length < b.length ? a : b;
    const singles = (toks) => toks.filter((t) => t.text.length === 1).length;
    if (singles(a) !== singles(b)) return singles(a) < singles(b) ? a : b;
    const qa = quality(a), qb = quality(b);
    return qb > qa ? b : a;
  }
  function segmentHan(str) {
    const chars = [...str];
    const f = matchRun(chars, false);
    const r = matchRun(chars, true);
    let same = f.length === r.length;
    if (same) {
      for (let i = 0; i < f.length; i++) if (f[i].text !== r[i].text) { same = false; break; }
    }
    return same ? f : chooseSeg(f, r);
  }
  function tokenize(text) {
    const chars = [...text];
    const tokens = [];
    let i = 0;
    while (i < chars.length) {
      const ch = chars[i];
      if (ch === "\n") { tokens.push({ type: "br", text: "\n" }); i++; continue; }
      if (!isHan(ch)) {
        let j = i + 1;
        while (j < chars.length && !isHan(chars[j]) && chars[j] !== "\n") j++;
        tokens.push({ type: "other", text: chars.slice(i, j).join("") });
        i = j;
        continue;
      }
      let j = i + 1;
      while (j < chars.length && isHan(chars[j])) j++;
      tokens.push(...segmentHan(chars.slice(i, j).join("")));
      i = j;
    }
    return tokens;
  }

  const input = $("#doc-input");
  const output = $("#doc-output");
  const unknownBox = $("#doc-unknown");
  const unknownList = $("#doc-unknown-list");
  const overlay = document.createElement("div");
  overlay.className = "dict-overlay doc-overlay";
  overlay.hidden = true;
  overlay.innerHTML = '<div class="dict-detail" id="doc-panel-body"></div>';
  document.body.append(overlay);

  let tokens = [];

  function reviewSets() {
    const hist = window.nameAppBridge?.getHistory?.() || [];
    const words = new Set();
    const chars = new Set();
    for (const h of hist) {
      if (h.kind === "word") {
        if (h.simp) words.add(h.simp);
        if (h.trad) words.add(h.trad);
      } else if (h.simp && [...h.simp].length === 1) {
        chars.add(h.simp);
        if (h.trad) chars.add(h.trad);
      }
    }
    return { words, chars };
  }

  function tokenPinyin(tok) {
    if (tok.rec?.p) return tok.rec.p;
    if (tok.text.length === 1) {
      const r = charInfo(tok.text);
      return (r && r.p && r.p[0]) || "";
    }
    return "";
  }

  function koGlossFor(tok) {
    if (!GLOSS) return "";
    const rec = tok && tok.rec;
    const keys = [tok && tok.text, rec && rec.s, rec && rec.t];
    const seen = new Set();
    for (const k of keys) {
      if (!k || seen.has(k)) continue;
      seen.add(k);
      if (GLOSS[k]) return GLOSS[k];
    }
    return "";
  }

  function englishFallback(tok) {
    const rec = tok && tok.rec;
    if (rec && rec.d && rec.d.length) return rec.d[0];
    return "";
  }

  function tokenEum(tok) {
    const py = tokenPinyin(tok);
    return alignedPair(tok.text, py).map(({ ch, syl }) => eumForChar(ch, syl) || "?").join("");
  }

  function displayPinyin(tok) {
    return String(tokenPinyin(tok) || "").replace(/\s+/g, "");
  }

  function wordMeaning(tok) {
    return koGlossFor(tok) || englishFallback(tok) || "뜻 자료 없음";
  }

  function formatWordLine(tok) {
    const py = displayPinyin(tok) || "—";
    const eum = tokenEum(tok) || "?";
    return `${tok.text} ${py} (${eum}): ${wordMeaning(tok)}`;
  }

  function uniqueWordTokens() {
    const out = [];
    const seen = new Set();
    tokens.forEach((tok, i) => {
      if (tok.type !== "word") return;
      const sig = `${tok.text}|${tokenPinyin(tok)}`;
      if (seen.has(sig)) return;
      seen.add(sig);
      out.push({ tok, i });
    });
    return out;
  }

  function summaryText() {
    return uniqueWordTokens().map(({ tok }) => formatWordLine(tok)).join("\n");
  }

  function buildAiPrompt() {
    const src = (input.value || "").trim();
    const lines = uniqueWordTokens().map(({ tok }) => "- " + formatWordLine(tok));
    return [
      "다음 중국어 글을 설명해 주세요.",
      "",
      "원문:",
      src || "(비어 있음)",
      "",
      "1. 문장 전체를 자연스러운 한국어로 번역해 주세요.",
      "2. 이런 문구가 보통 어디서 쓰이는지(어떤 앱·화면·문서인지 등) 문맥을 알려 주세요.",
      "3. 단어별로 아래 형식으로 정리해 주세요. 한자, 성조 병음, 한국 독음, 뜻.",
      "   예: 快速 kuàisù (쾌속): 빠르게",
      "",
      "앱에서 나눈 단어와 초안 뜻입니다. 더 자연스럽게 다듬어 주세요.",
      ...(lines.length ? lines : ["- (분석된 단어가 없습니다)"]),
    ].join("\n");
  }

  function showToast(msg) {
    let t = document.getElementById("doc-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "doc-toast";
      t.className = "doc-toast";
      document.body.append(t);
    }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._tid);
    showToast._tid = setTimeout(() => { t.hidden = true; }, 2400);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { console.warn("clipboard", err); }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (err) {
      console.warn("copy", err);
      return false;
    }
  }

  function renderOutput() {
    if (!tokens.length) {
      output.hidden = true;
      output.innerHTML = "";
      unknownBox.hidden = true;
      return;
    }
    output.hidden = false;
    const known = reviewSets();
    output.innerHTML = tokens.map((tok, i) => {
      if (tok.type === "br") return '<span class="doc-br"></span>';
      if (tok.type === "other") return `<span class="doc-other">${esc(tok.text)}</span>`;
      const py = tokenPinyin(tok);
      const rec = tok.rec;
      const key = rec ? rec.s : tok.text;
      const isWordKnown = rec && (known.words.has(rec.s) || known.words.has(rec.t) || known.words.has(tok.text));
      const isCharKnown = tok.text.length === 1 && (known.chars.has(tok.text) || known.chars.has(rec?.s) || known.chars.has(rec?.t));
      const knownCls = (isWordKnown || isCharKnown) ? " is-known" : "";
      const pairs = alignedPair(tok.text, py);
      const chars = pairs.map(({ ch, syl }) => {
        const eum = eumForChar(ch, syl);
        return `<span class="doc-ch">${esc(ch)}<span class="doc-eum">${esc(eum || "·")}</span></span>`;
      }).join("");
      return `<button type="button" class="doc-word${knownCls}" data-tok="${i}" data-key="${esc(key)}" title="${esc(py)}">
        <span class="doc-py">${esc(py || " ")}</span>
        <span class="doc-han">${chars}</span>
      </button>`;
    }).join("");
    renderUnknown(known);
    renderSummary();
  }

  function renderSummary() {
    const box = $("#doc-summary");
    const list = $("#doc-summary-list");
    if (!box || !list) return;
    const rows = uniqueWordTokens();
    if (!rows.length) {
      box.hidden = true;
      list.innerHTML = "";
      return;
    }
    box.hidden = false;
    list.innerHTML = rows.map(({ tok, i }) => {
      const ko = koGlossFor(tok);
      const src = ko ? "한국어 뜻" : "English";
      return `<li><button type="button" class="doc-sum-item" data-tok="${i}"><span class="doc-sum-line">${esc(formatWordLine(tok))}</span> <small class="doc-sum-src">${src}</small></button></li>`;
    }).join("");
  }

  function renderUnknown(known) {
    const wordSeen = new Set();
    const charSeen = new Set();
    const wordBtns = [];
    const charBtns = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.type !== "word") continue;
      const rec = tok.rec;
      if (rec && [...tok.text].length >= 2) {
        const id = rec.s;
        if (!wordSeen.has(id) && !known.words.has(rec.s) && !known.words.has(rec.t) && !known.words.has(tok.text)) {
          wordSeen.add(id);
          wordBtns.push(`<button type="button" class="ex" data-tok="${i}">${esc(tok.text)} <small>${esc(rec.p)}</small></button>`);
        }
      }
      for (const ch of tok.text) {
        if (!isHan(ch) || charSeen.has(ch)) continue;
        charSeen.add(ch);
        const info = charInfo(ch);
        const simp = (info && info.c) || ch;
        if (!known.chars.has(ch) && !known.chars.has(simp) && !(info && info.t && known.chars.has(info.t))) {
          charBtns.push(`<button type="button" class="ex" data-detail="${esc(ch)}">${esc(ch)}</button>`);
        }
      }
    }
    if (!wordBtns.length && !charBtns.length) {
      unknownBox.hidden = true;
      unknownList.innerHTML = "";
      return;
    }
    unknownBox.hidden = false;
    unknownList.innerHTML =
      (wordBtns.length ? `<h3>아직 저장하지 않은 단어 ${wordBtns.length}개</h3><div class="doc-unknown-list">${wordBtns.join("")}</div>` : "")
      + (charBtns.length ? `<h3>아직 저장하지 않은 글자 ${charBtns.length}개</h3><div class="doc-unknown-list">${charBtns.join("")}</div>` : "");
  }

  function uniqueReadings(entries) {
    if (!entries) return [];
    const seen = new Set();
    const out = [];
    for (const rec of entries) {
      const sig = `${rec.p}|${(rec.d || []).join("/")}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(rec);
    }
    return out;
  }

  function makeSaveEntry(tok) {
    const rec = tok.rec;
    const surface = tok.text;
    const simp = rec?.s || surface;
    const trad = rec && rec.t && rec.t !== simp ? rec.t : (charInfo(surface)?.t && surface.length === 1 ? charInfo(surface).t : "");
    const py = tokenPinyin(tok);
    const pairs = alignedPair(rec?.s || surface, py);
    const shownChars = [...surface];
    const chars = pairs.map((pair, idx) => {
      const shown = shownChars[idx] || pair.ch;
      const info = charInfo(shown) || charInfo(pair.ch);
      const eum = mappedEum(shown, info, pair.syl);
      const hunList = hunsForEum(info, eum);
      return {
        c: (info && info.c) || pair.ch,
        t: (info && info.t) || "",
        py: pair.syl || (info && info.p && info.p[0]) || "",
        eum: eum || "",
        hun: hunList.join(" / "),
      };
    });
    return {
      id: `word|${simp}|${py}`,
      kind: "word",
      date: new Date().toISOString(),
      simp,
      trad: trad || "",
      py,
      ko: chars.map((c) => c.eum || "?").join(""),
      hun: chars.map((c) => c.hun || `${c.c}?`).join(" · "),
      defs: rec?.d ? rec.d.slice() : [],
      chars,
      known: null,
      query: (input.value || "").replace(/\s+/g, " ").slice(0, 80),
    };
  }

  function showPanel(tok) {
    const rec = tok.rec;
    const readings = uniqueReadings(tok.entries);
    const surface = tok.text;
    const simp = rec?.s || surface;
    const trad = rec?.t || "";
    const title = trad && trad !== simp ? `${simp} / ${trad}` : (surface !== simp ? `${surface} · ${simp}` : simp);
    const py = tokenPinyin(tok);
    const readingHtml = readings.length
      ? readings.map((r) => `<p class="doc-reading"><span class="dict-py">${esc(r.p)}</span>${r.s !== simp || (r.t && r.t !== trad) ? ` · ${esc(r.s)}${r.t && r.t !== r.s ? " / " + esc(r.t) : ""}` : ""}<br>${(r.d || []).map((d) => esc(d)).join("<br>")}</p>`).join("")
      : "<p>CC-CEDICT에 이 단어 항목이 없습니다.</p>";
    const ko = koGlossFor(tok);
    const koHtml = ko
      ? `<section class="doc-panel-defs doc-panel-ko">
        <h3>한국어 뜻 · 앱 작성</h3>
        <p class="doc-ko-gloss">${esc(ko)}</p>
        <p class="dict-small">앱 작성자가 직접 적은 뜻입니다. 기존 중한사전을 베끼지 않았습니다.</p>
      </section>`
      : `<section class="doc-panel-defs doc-panel-ko">
        <h3>한국어 뜻</h3>
        <p>이 단어의 한국어 뜻은 아직 없습니다. 아래 영어 뜻과 글자별 훈음을 참고하세요.</p>
      </section>`;
    const pairs = alignedPair(surface, py);
    const charHtml = pairs.map(({ ch, syl }) => {
      const info = charInfo(ch);
      const eum = mappedEum(ch, info, syl);
      const hunList = hunsForEum(info, eum);
      const hun = hunList.length ? hunList.join(" / ") : "훈음 자료 없음";
      const eumLabel = eum || ((info && info.e && info.e.length) ? info.e.join(" · ") : "자료 없음");
      const others = (info && info.e || []).filter((e) => eum && !eum.includes("·") && e !== eum);
      const otherNote = others.length ? ` · 다른 독음 ${esc(others.join(" · "))}` : "";
      const cpy = syl || ((info && info.p) ? info.p.join(" · ") : "");
      return `<div class="doc-panel-char">
        <button type="button" class="doc-glyph" data-detail="${esc(ch)}">${esc(ch)}</button>
        <div>
          <div>${esc(hun)}</div>
          <div class="dict-small">한자음 · ${esc(eumLabel)}${cpy ? ` · ${esc(barePy(syl) ? syl : cpy)}` : ""}${otherNote}</div>
        </div>
        <button type="button" class="ghost" data-detail="${esc(ch)}">옥편</button>
      </div>`;
    }).join("");
    const canSave = !!(rec || surface);
    $("#doc-panel-body").innerHTML = `
      <div class="dict-heading">
        <h2>${esc(title)}</h2>
        <button class="ghost" data-doc-close>← 돌아가기</button>
      </div>
      <p class="dict-py">${esc(py || "병음 자료 없음")}</p>
      ${koHtml}
      <section class="doc-panel-defs">
        <h3>영어 뜻 · CC-CEDICT</h3>
        ${readingHtml}
        <p class="dict-small">영어 뜻은 CC-CEDICT(CC BY-SA 4.0, MDBG, ${esc(DATA?.meta?.date || "")})입니다. 한국어 단어 뜻이 있으면 위에 앱 작성 주석으로 표시하고, 없으면 영어 뜻과 글자별 훈음으로 보완합니다.</p>
      </section>
      <h3 class="doc-sub">글자별 훈음 · 독음</h3>
      <div class="doc-panel-chars">${charHtml}</div>
      <div class="dict-tools">
        <button class="primary" data-saveword ${canSave ? "" : "disabled"}>★ 단어 저장</button>
        <button class="ghost" data-audio="${esc(simp)}">▶ 중국어 듣기</button>
      </div>
      <p id="doc-save-note"></p>`;
    overlay.hidden = false;
    overlay.dataset.tok = String(tokens.indexOf(tok));
  }

  async function analyze() {
    try {
      await ensureWords();
    } catch {
      return;
    }
    const text = input.value;
    if (!text.trim()) {
      tokens = [];
      renderOutput();
      return;
    }
    tokens = tokenize(text);
    renderOutput();
  }

  function applyToggles() {
    output.classList.toggle("hide-py", !$("#doc-toggle-py").checked);
    output.classList.toggle("hide-eum", !$("#doc-toggle-eum").checked);
    output.classList.toggle("emphasize", $("#doc-unknown-only").checked);
  }

  $("#doc-analyze").addEventListener("click", () => { analyze(); });
  $("#doc-ask-ai")?.addEventListener("click", async () => {
    const text = (input.value || "").trim();
    if (!text) {
      showToast("먼저 글을 붙여 넣으세요");
      return;
    }
    if (!tokens.length) await analyze();
    const ok = await copyText(buildAiPrompt());
    showToast(ok ? "복사됨 — AI 채팅에 붙여넣으세요" : "복사하지 못했습니다");
  });
  $("#doc-copy-summary")?.addEventListener("click", async () => {
    if (!tokens.length) {
      showToast("먼저 분석을 눌러 주세요");
      return;
    }
    const ok = await copyText(summaryText());
    showToast(ok ? "복사됨" : "복사하지 못했습니다");
  });
  $("#doc-summary-list")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tok]");
    if (!btn) return;
    const tok = tokens[Number(btn.dataset.tok)];
    if (tok) showPanel(tok);
  });
  $("#doc-speak").addEventListener("click", () => {
    const t = (input.value || "").replace(/\s+/g, "");
    if (t) window.nameAppBridge?.speak(input.value);
  });
  $("#doc-toggle-py").addEventListener("change", applyToggles);
  $("#doc-toggle-eum").addEventListener("change", applyToggles);
  $("#doc-unknown-only").addEventListener("change", applyToggles);
  document.querySelectorAll(".doc-ex").forEach((btn) => {
    btn.addEventListener("click", () => {
      input.value = btn.dataset.q;
      analyze();
    });
  });
  document.querySelector('.tab[data-tab="document"]')?.addEventListener("click", () => {
    ensureWords().catch(() => {});
  });
  output.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tok]");
    if (!btn) return;
    const tok = tokens[Number(btn.dataset.tok)];
    if (tok) showPanel(tok);
  });
  unknownList.addEventListener("click", (e) => {
    const tokBtn = e.target.closest("[data-tok]");
    if (tokBtn) {
      const tok = tokens[Number(tokBtn.dataset.tok)];
      if (tok) showPanel(tok);
    }
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest("[data-doc-close]")) {
      overlay.hidden = true;
      return;
    }
    if (e.target.closest("[data-saveword]")) {
      const i = Number(overlay.dataset.tok);
      const tok = tokens[i];
      if (!tok) return;
      window.nameAppBridge.save(makeSaveEntry(tok));
      const note = $("#doc-save-note");
      if (note) note.textContent = "✓ 복습 목록에 저장됨";
      e.target.closest("[data-saveword]").textContent = "✓ 저장됨";
      renderOutput();
      applyToggles();
    }
  });

  if (window.__WORDS__) {
    buildIndex(window.__WORDS__);
  }
  if (window.__KOGLOSSES__) {
    buildGlosses(window.__KOGLOSSES__);
  }

  window.documentApp = {
    get ready() { return true; },
    get wordsReady() { return !!DATA; },
    get glossReady() { return !!GLOSS; },
    get glossSize() { return GLOSS ? Object.keys(GLOSS).length : 0; },
    ensureWords,
    ensureGlosses,
    analyze,
    tokenize,
    lookup,
    pick,
    eumForChar,
    koGlossFor,
    formatWordLine,
    buildAiPrompt,
    get dataMeta() { return DATA && DATA.meta; },
    get glossMeta() { return glossMeta; },
    get size() { return DATA ? DATA.e.length : 0; },
  };
})();
