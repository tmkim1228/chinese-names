(() => {
  "use strict";

  const STORAGE_KEY = "chinese-name-app.history.v1";
  const TONE_MARK_MAP = {
    ā: ["a", 1], á: ["a", 2], ǎ: ["a", 3], à: ["a", 4],
    ē: ["e", 1], é: ["e", 2], ě: ["e", 3], è: ["e", 4],
    ī: ["i", 1], í: ["i", 2], ǐ: ["i", 3], ì: ["i", 4],
    ō: ["o", 1], ó: ["o", 2], ǒ: ["o", 3], ò: ["o", 4],
    ū: ["u", 1], ú: ["u", 2], ǔ: ["u", 3], ù: ["u", 4],
    ǖ: ["ü", 1], ǘ: ["ü", 2], ǚ: ["ü", 3], ǜ: ["ü", 4],
  };
  const TONE_LABEL = { 1: "1성", 2: "2성", 3: "3성", 4: "4성", 5: "경성" };

  const els = {
    input: document.getElementById("name-input"),
    parseBtn: document.getElementById("parse-btn"),
    status: document.getElementById("status"),
    slots: document.getElementById("slots"),
    assembled: document.getElementById("assembled"),
    asmSimp: document.getElementById("asm-simp"),
    asmTrad: document.getElementById("asm-trad"),
    asmPy: document.getElementById("asm-py"),
    asmKo: document.getElementById("asm-ko"),
    asmHun: document.getElementById("asm-hun"),
    asmSpeak: document.getElementById("asm-speak"),
    asmSave: document.getElementById("asm-save"),
    asmSaved: document.getElementById("asm-saved"),
    viewSearch: document.getElementById("view-search"),
    viewReview: document.getElementById("view-review"),
    histCount: document.getElementById("hist-count"),
    reviewList: document.getElementById("review-list"),
    reviewEmpty: document.getElementById("review-empty"),
    reviewSearch: document.getElementById("review-search"),
    credits: document.getElementById("credits"),
    flashModal: document.getElementById("flash-modal"),
    flashCard: document.getElementById("flash-card"),
    flashFront: document.getElementById("flash-front"),
    flashBack: document.getElementById("flash-back"),
    flashProgress: document.getElementById("flash-progress"),
  };

  let DATA = null;
  let syllableSet = new Set();
  /** @type {{role:'sur'|'given', bare:string, tone:number|null, selected:object|null, compound?:object|null}[]} */
  let slots = [];
  let history = loadHistory();
  let flash = { mode: "py2han", i: 0, revealed: false, deck: [] };

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  const EXPORT_KEY = "chinese-name-app.lastExport.v1";
  const DISMISS_KEY = "chinese-name-app.backupDismiss.v1";
  const BACKUP_MIN_ITEMS = 5;
  const BACKUP_MS = 7 * 24 * 60 * 60 * 1000;

  function saveHistory() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    els.histCount.textContent = String(history.length);
    updateBackupBanner();
  }

  function hideStartGuideIfNeeded() {
    const g = document.getElementById("start-guide");
    if (g) g.hidden = slots.length > 0;
  }

  function shouldShowBackupBanner() {
    if (history.length < BACKUP_MIN_ITEMS) return false;
    const now = Date.now();
    try {
      const dismissed = Date.parse(localStorage.getItem(DISMISS_KEY) || "") || 0;
      if (dismissed && now - dismissed < BACKUP_MS) return false;
      const exported = Date.parse(localStorage.getItem(EXPORT_KEY) || "") || 0;
      if (exported && now - exported < BACKUP_MS) return false;
    } catch { /* ignore quota / private mode */ }
    return true;
  }
  function updateBackupBanner() {
    const banner = document.getElementById("backup-banner");
    if (banner) banner.hidden = !shouldShowBackupBanner();
  }
  function recordExport() {
    try { localStorage.setItem(EXPORT_KEY, new Date().toISOString()); } catch {}
    updateBackupBanner();
  }
  async function exportHistory() {
    const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: history }, null, 2);
    const defaultName = `chinese-names-history-${new Date().toISOString().slice(0, 10)}.json`;
    if (window.electronAPI?.exportJson) {
      const res = await window.electronAPI.exportJson(defaultName, payload);
      if (res?.ok) {
        recordExport();
        alert(`저장됨: ${res.filePath}`);
      }
      return;
    }
    const blob = new Blob([payload], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(a.href);
    recordExport();
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function normalizeToken(raw) {
    let s = (raw || "").trim().toLowerCase().replace(/u:/g, "ü").replace(/v/g, "ü");
    let tone = null;
    const bareChars = [];
    for (const ch of s) {
      if (TONE_MARK_MAP[ch]) {
        const [b, t] = TONE_MARK_MAP[ch];
        bareChars.push(b);
        tone = t;
      } else if ("12345".includes(ch)) {
        tone = Number(ch);
      } else if (/[a-zü]/.test(ch)) {
        bareChars.push(ch);
      }
    }
    return { bare: bareChars.join(""), tone };
  }

  /** Segment unspaced pinyin into valid Mandarin syllables (DP, prefer fewer longer syllables). */
  function segmentPinyin(joined) {
    const s = joined.toLowerCase().replace(/u:/g, "ü").replace(/v/g, "ü").replace(/[^a-zü]/g, "");
    if (!s) return [];
    // If already a single valid syllable
    if (syllableSet.has(s)) return [s];
    const n = s.length;
    const prev = Array(n + 1).fill(null);
    const cost = Array(n + 1).fill(Infinity);
    cost[0] = 0;
    for (let i = 0; i < n; i++) {
      if (cost[i] === Infinity) continue;
      for (let len = 1; len <= 6 && i + len <= n; len++) {
        const piece = s.slice(i, i + len);
        if (!syllableSet.has(piece)) continue;
        // prefer longer syllables slightly: cost += 1, minus length bonus
        const c = cost[i] + 10 - len;
        if (c < cost[i + len]) {
          cost[i + len] = c;
          prev[i + len] = i;
        }
      }
    }
    if (cost[n] === Infinity) {
      // fallback: greedy from left
      const out = [];
      let i = 0;
      while (i < n) {
        let found = null;
        for (let len = Math.min(6, n - i); len >= 1; len--) {
          const piece = s.slice(i, i + len);
          if (syllableSet.has(piece)) { found = piece; break; }
        }
        if (!found) return [s]; // give up
        out.push(found);
        i += found.length;
      }
      return out;
    }
    const parts = [];
    for (let i = n; i > 0; ) {
      const p = prev[i];
      parts.push(s.slice(p, i));
      i = p;
    }
    return parts.reverse();
  }

  const Y_VOWELS = new Set([2, 3, 6, 7, 12, 17, 20]);
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
    const helper = window.dictionaryApp?.dueumVariants;
    if (helper) return helper(syl);
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

  let koIndexReady = false;
  let eumSetKo = new Set();
  let eumsByChar = new Map();
  let compoundKo = [];

  function ensureKoIndex() {
    if (koIndexReady || !DATA) return;
    koIndexReady = true;
    eumsByChar = new Map();
    for (const r of DATA.records) {
      if (!r.eum) continue;
      eumSetKo.add(r.eum);
      if (!eumsByChar.has(r.c)) eumsByChar.set(r.c, new Set());
      eumsByChar.get(r.c).add(r.eum);
      if (r.t) {
        if (!eumsByChar.has(r.t)) eumsByChar.set(r.t, new Set());
        eumsByChar.get(r.t).add(r.eum);
      }
    }
    if (window.dictionaryApp?.eumList) {
      for (const e of window.dictionaryApp.eumList) eumSetKo.add(e);
    }
    compoundKo = (DATA.compounds || []).map((c) => {
      const chars = [...c.s];
      const parts = chars.map((ch) => {
        const s = new Set();
        const fromRec = eumsByChar.get(ch);
        if (fromRec) fromRec.forEach((e) => dueumVariants(e).forEach((v) => s.add(v)));
        if (window.dictionaryApp?.eumsOf) {
          for (const e of window.dictionaryApp.eumsOf(ch)) dueumVariants(e).forEach((v) => s.add(v));
        }
        return [...s];
      });
      const keys = [];
      const rec = (i, acc) => {
        if (i === parts.length) { keys.push(acc); return; }
        for (const part of parts[i]) rec(i + 1, acc + part);
      };
      if (parts.every((part) => part.length)) rec(0, "");
      return { compound: c, keys };
    }).filter((x) => x.keys.length);
    compoundKo.sort((a, b) => (b.compound.tf || 0) - (a.compound.tf || 0));
  }

  function isKnownEum(syl) {
    if (window.dictionaryApp?.isKnownEum) return window.dictionaryApp.isKnownEum(syl);
    ensureKoIndex();
    for (const v of dueumVariants(syl)) if (eumSetKo.has(v)) return true;
    return false;
  }

  function dictRecordToCand(r, fallbackEum) {
    const py = (r.p && r.p[0]) || "";
    const nt = normalizeToken(py);
    return {
      c: r.c,
      t: r.t || "",
      py,
      bare: nt.bare,
      tone: nt.tone,
      eum: (r.e && r.e[0]) || fallbackEum || "",
      hun: (r.h && r.h[0]) || "",
      edu: !!r.edu,
      g: r.g || 0,
      s: r.sur ? 1 : 0,
      isSur: !!r.sur,
      freq: r.f || 999999,
    };
  }

  function sortKoCands(a, b, role) {
    if (role === "sur") {
      const as = (a.s || 0) + (a.isSur ? 0.1 : 0);
      const bs = (b.s || 0) + (b.isSur ? 0.1 : 0);
      if (bs !== as) return bs - as;
    } else {
      if ((b.g || 0) !== (a.g || 0)) return (b.g || 0) - (a.g || 0);
    }
    const af = a.freq ?? a.f ?? 999999;
    const bf = b.freq ?? b.f ?? 999999;
    return af - bf;
  }

  function candidatesForKorean(syl, role) {
    ensureKoIndex();
    const vars = dueumVariants(syl);
    const seen = new Set();
    const out = [];
    for (const r of DATA.records) {
      if (!r.eum || !vars.has(r.eum)) continue;
      const sig = `${r.c}|${r.py}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(r);
    }
    if (window.dictionaryApp?.findByEum) {
      for (const r of window.dictionaryApp.findByEum(syl)) {
        const already = [...seen].some((sig) => sig.startsWith(`${r.c}|`));
        if (already) continue;
        const cand = dictRecordToCand(r, syl);
        const sig = `${cand.c}|${cand.py}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push(cand);
      }
    }
    out.sort((a, b) => sortKoCands(a, b, role));
    return out;
  }

  function parseKoreanName(raw) {
    ensureKoIndex();
    const tokens = (raw || "").trim().split(/\s+/).filter(Boolean);
    const syllables = [];
    for (const tok of tokens) {
      const chars = [...tok];
      if (!chars.length || chars.some((ch) => !isHangulChar(ch))) return null;
      if (!chars.every((ch) => isKnownEum(ch))) return null;
      syllables.push(...chars);
    }
    if (!syllables.length) return null;

    const joined = syllables.join("");
    let compound = null;
    for (const item of compoundKo) {
      for (const key of item.keys) {
        if (!joined.startsWith(key)) continue;
        const ks = [...key];
        if (syllables.length < ks.length) continue;
        let ok = true;
        for (let i = 0; i < ks.length; i++) {
          if (syllables[i] !== ks[i]) { ok = false; break; }
        }
        if (ok) { compound = item.compound; break; }
      }
      if (compound) break;
    }

    if (compound) {
      const need = [...compound.s].length;
      return {
        surSlots: [...compound.s].map((ch, i) => ({
          role: "sur",
          bare: syllables[i],
          tone: null,
          selected: null,
          compound,
          compoundIndex: i,
        })),
        givenTokens: syllables.slice(need).map((s) => ({ bare: s, tone: null })),
        compound,
      };
    }
    return {
      surSlots: [{ role: "sur", bare: syllables[0], tone: null, selected: null }],
      givenTokens: syllables.slice(1).map((s) => ({ bare: s, tone: null })),
      compound: null,
    };
  }

  function looksLikeKoreanNameQuery(raw) {
    const s = (raw || "").trim();
    if (!s || ![...s].some(isHangulChar)) return false;
    if ([...s].some((ch) => isHanChar(ch))) return false;
    if (/[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(s)) return false;
    return true;
  }

  /** All candidates for a syllable (no hard cap). Caller decides how many to show. */
  function candidatesFor(bare, tone, role) {
    if (!DATA || !bare) return [];
    if ([...bare].length === 1 && isHangulChar(bare)) return candidatesForKorean(bare, role);
    const key = tone ? `${bare}${tone}` : bare;
    const ids = (role === "sur" ? DATA.indexSur : DATA.indexGiven)[key] || [];
    const out = [];
    const seen = new Set();
    for (const i of ids) {
      const r = DATA.records[i];
      const sig = `${r.c}|${r.py}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(r);
    }
    return out;
  }

  const INITIAL_CANDS = 40;
  /** @type {Record<number, {expanded:boolean, filter:string}>} */
  let slotUI = {};

  function getSlotUI(si) {
    if (!slotUI[si]) slotUI[si] = { expanded: false, filter: "" };
    return slotUI[si];
  }

  function isHanChar(ch) {
    const cp = ch.codePointAt(0);
    return (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0x20000 && cp <= 0x2fa1f);
  }

  function candMatchesFilter(c, q) {
    if (!q) return true;
    const s = q.trim();
    if (!s) return true;
    const lower = s.toLowerCase();
    const hanChars = [...s].filter(isHanChar);
    if (hanChars.length) {
      return hanChars.some((ch) => c.c.includes(ch) || (c.t && c.t.includes(ch)));
    }
    const hay = `${c.c} ${c.t || ""} ${c.py} ${c.bare || ""} ${c.eum || ""} ${c.hun || ""}`.toLowerCase();
    return hay.includes(lower);
  }

  function renderCandButton(c, si, selected) {
    const badges = [];
    if (c.isSur || c.s > 0) badges.push('<span class="badge sur">성씨 흔함</span>');
    if (c.g > 0) badges.push('<span class="badge given">이름 흔함</span>');
    if (c.edu) badges.push('<span class="badge edu">교육 1800</span>');
    return `<button type="button" class="cand ${selected ? "selected" : ""}" data-si="${si}" data-c="${esc(c.c)}" data-py="${esc(c.py)}">
      <div class="cand-char">${esc(c.c)}</div>
      <div class="cand-trad">${c.t ? `정자 <b>${esc(c.t)}</b>` : "&nbsp;"}</div>
      <div class="cand-py">${esc(c.py)} <span style="font-size:.7rem;opacity:.7">${TONE_LABEL[c.tone] || ""}</span></div>
      <div class="cand-hun">${esc(c.hun || "훈음 없음")}</div>
      <div class="cand-eum">${c.eum ? `음 · ${esc(c.eum)}` : ""}</div>
      <div class="badges">${badges.join("")}</div>
    </button>`;
  }

  function parseNameInput(raw) {
    const tokens = (raw || "").trim().split(/\s+/).filter(Boolean).map(normalizeToken).filter((t) => t.bare);
    if (!tokens.length) return null;

    // Flatten for compound detection at start
    // Strategy:
    // 1) If first token's bare matches a compound key OR first two tokens join to compound
    // 2) Else first syllable(s) = surname

    let surSlots = [];
    let givenTokens = [];

    const allBares = [];
    // Expand each token: if multi-syllable unspaced, segment
    const expanded = [];
    for (const t of tokens) {
      if (syllableSet.has(t.bare)) {
        expanded.push(t);
      } else {
        const parts = segmentPinyin(t.bare);
        if (parts.length > 1) {
          for (const p of parts) expanded.push({ bare: p, tone: null });
        } else {
          expanded.push(t);
        }
      }
    }

    // Try compound surnames (2+ syllables) against start of expanded
    let compound = null;
    const joined = expanded.map((t) => t.bare).join("");
    for (const c of DATA.compounds) {
      const key = c.key;
      if (joined.startsWith(key)) {
        // verify syllable alignment
        const need = c.bare.length;
        if (expanded.length >= need) {
          let ok = true;
          for (let i = 0; i < need; i++) {
            if (expanded[i].bare !== c.bare[i]) { ok = false; break; }
          }
          if (ok) {
            compound = c;
            break;
          }
        }
      }
    }
    // Also try first original token as compound key (ouyang)
    if (!compound && tokens.length >= 1) {
      const k = tokens[0].bare;
      compound = DATA.compounds.find((c) => c.key === k) || null;
      if (compound) {
        // re-expand: first token consumed as compound, rest expand
        const rest = tokens.slice(1);
        const expRest = [];
        for (const t of rest) {
          if (syllableSet.has(t.bare)) expRest.push(t);
          else {
            const parts = segmentPinyin(t.bare);
            for (const p of parts) expRest.push({ bare: p, tone: null });
          }
        }
        surSlots = compound.bare.map((b, i) => ({
          role: "sur",
          bare: b,
          tone: null,
          selected: null,
          compound,
          compoundIndex: i,
        }));
        givenTokens = expRest;
        return { surSlots, givenTokens, compound };
      }
    }

    if (compound) {
      const need = compound.bare.length;
      surSlots = compound.bare.map((b, i) => ({
        role: "sur",
        bare: b,
        tone: expanded[i].tone,
        selected: null,
        compound,
        compoundIndex: i,
      }));
      givenTokens = expanded.slice(need);
      return { surSlots, givenTokens, compound };
    }

    // Single-char surname = first syllable
    if (!expanded.length) return null;
    surSlots = [{ role: "sur", bare: expanded[0].bare, tone: expanded[0].tone, selected: null }];
    givenTokens = expanded.slice(1);
    return { surSlots, givenTokens, compound: null };
  }

  function autoSelect(slot) {
    if (slot.compound && slot.compoundIndex != null) {
      const ch = slot.compound.s[slot.compoundIndex];
      const py = slot.compound.py[slot.compoundIndex];
      // find matching record or synthesize
      const cands = candidatesFor(slot.bare, slot.tone, "sur");
      const hit = cands.find((c) => c.c === ch) || cands[0];
      if (hit) return hit;
      return {
        c: ch,
        t: slot.compound.t ? slot.compound.t[slot.compoundIndex] : "",
        py: py,
        bare: slot.bare,
        tone: stripToneLocal(py).tone,
        eum: "",
        hun: "",
        edu: false,
        g: 0,
        s: slot.compound.tf,
        isSur: true,
      };
    }
    const cands = candidatesFor(slot.bare, slot.tone, slot.role);
    return cands[0] || null;
  }

  function stripToneLocal(py) {
    return normalizeToken(py);
  }

  function buildSlotsFromParse(parsed) {
    const list = [];
    for (const s of parsed.surSlots) {
      const slot = { ...s, role: "sur" };
      slot.selected = autoSelect(slot);
      list.push(slot);
    }
    for (const t of parsed.givenTokens) {
      const slot = { role: "given", bare: t.bare, tone: t.tone, selected: null };
      slot.selected = autoSelect(slot);
      list.push(slot);
    }
    // Re-rank given-name sequence using full given-name string frequencies
    optimizeGivenSequence(list);
    return list;
  }

  /** Pick given-name combo by scanning corpus givenNames for matching pinyin. */
  function optimizeGivenSequence(list) {
    const givenIdx = list.map((s, i) => (s.role === "given" ? i : -1)).filter((i) => i >= 0);
    if (givenIdx.length < 1 || givenIdx.length > 3) return;
    const bares = givenIdx.map((i) => list[i].bare);
    const tones = givenIdx.map((i) => list[i].tone);
    const pools = givenIdx.map((i) => candidatesFor(list[i].bare, list[i].tone, "given"));
    const poolSets = pools.map((p) => new Set(p.map((c) => c.c)));
    const names = DATA.givenNames || {};
    let best = null;
    let bestScore = -1;
    for (const [name, score] of Object.entries(names)) {
      if (name.length !== givenIdx.length || score <= bestScore) continue;
      let ok = true;
      for (let j = 0; j < name.length; j++) {
        if (!poolSets[j].has(name[j])) { ok = false; break; }
      }
      if (!ok) continue;
      const picks = [];
      for (let j = 0; j < name.length; j++) {
        const hit = pools[j].find((c) => c.c === name[j]);
        if (!hit) { ok = false; break; }
        picks.push(hit);
      }
      if (ok) { bestScore = score; best = picks; }
    }
    if (best && bestScore > 0) {
      givenIdx.forEach((si, j) => { list[si].selected = best[j]; });
    }
  }

  function renderSlots() {
    if (!slots.length) {
      els.slots.hidden = true;
      els.assembled.hidden = true;
      return;
    }
    els.slots.hidden = false;
    // Preserve focus/filter values across re-render via slotUI
    els.slots.innerHTML = slots.map((slot, si) => {
      const all = candidatesFor(slot.bare, slot.tone, slot.role);
      const ui = getSlotUI(si);
      const filtered = all.filter((c) => candMatchesFilter(c, ui.filter));
      const shown = ui.expanded || ui.filter
        ? filtered
        : filtered.slice(0, INITIAL_CANDS);
      const hiddenN = Math.max(0, filtered.length - shown.length);
      const roleLabel = slot.role === "sur"
        ? (slot.compound ? `성씨 (복성 ${esc(slot.compound.s)})` : "성씨")
        : "이름";
      const candHtml = shown.map((c) => {
        const selected = slot.selected && slot.selected.c === c.c && slot.selected.py === c.py;
        return renderCandButton(c, si, selected);
      }).join("");
      const moreBtn = (!ui.filter && !ui.expanded && hiddenN > 0)
        ? `<button type="button" class="more-btn" data-more="${si}">더 보기 (나머지 ${hiddenN}개)</button>`
        : (ui.expanded && !ui.filter && all.length > INITIAL_CANDS
          ? `<button type="button" class="more-btn" data-less="${si}">접기</button>`
          : "");
      return `<div class="slot" data-slot="${si}">
        <div class="slot-head">
          <div class="slot-title">${esc(slot.bare)}${slot.tone ? slot.tone : ""}</div>
          <div class="slot-role ${slot.role}">${roleLabel} · 후보 ${filtered.length}${ui.filter ? ` / 전체 ${all.length}` : ""}</div>
        </div>
        <div class="slot-filter-row">
          <input type="search" class="slot-filter" data-filter="${si}"
            placeholder="한자·독음·훈으로 찾기 (예: 요, 높을, 峣)"
            value="${esc(ui.filter)}" />
        </div>
        <div class="cands">${candHtml || "<p class='no-cands'>맞는 후보가 없습니다. 필터를 지워 보세요.</p>"}</div>
        ${moreBtn}
      </div>`;
    }).join("");
    updateAssembled();
    hideStartGuideIfNeeded();
  }

  function updateAssembled() {
    if (!slots.length || slots.some((s) => !s.selected)) {
      els.assembled.hidden = true;
      return;
    }
    els.assembled.hidden = false;
    const chars = slots.map((s) => s.selected);
    const simp = chars.map((c) => c.c).join("");
    const tradParts = chars.map((c) => c.t || c.c);
    const trad = tradParts.join("");
    const same = trad === simp;
    const py = chars.map((c) => c.py).join(" ");
    const ko = chars.map((c) => c.eum || "?").join("");
    const hun = chars.map((c) => c.hun || `${c.c}?`).join(" · ");

    els.asmSimp.textContent = simp;
    els.asmTrad.innerHTML = same ? "" : `정자 <b>${esc(trad)}</b>`;
    els.asmPy.textContent = py;
    els.asmKo.textContent = ko;
    els.asmHun.textContent = hun;
    // Do NOT auto-save on every candidate tweak — user confirms with 저장
    els.asmSaved.hidden = true;
    if (els.asmSave) els.asmSave.disabled = false;
  }

  function currentAssembledEntry() {
    if (!slots.length || slots.some((s) => !s.selected)) return null;
    const chars = slots.map((s) => s.selected);
    const simp = chars.map((c) => c.c).join("");
    const tradParts = chars.map((c) => c.t || c.c);
    const trad = tradParts.join("");
    const same = trad === simp;
    const py = chars.map((c) => c.py).join(" ");
    const ko = chars.map((c) => c.eum || "?").join("");
    const hun = chars.map((c) => c.hun || `${c.c}?`).join(" · ");
    return {
      id: `${simp}|${py}`,
      date: new Date().toISOString(),
      simp,
      trad: same ? "" : trad,
      py,
      ko,
      hun,
      chars: chars.map((c) => ({ c: c.c, t: c.t || "", py: c.py, eum: c.eum || "", hun: c.hun || "", edu: !!c.edu })),
      known: null,
      query: els.input.value.trim(),
    };
  }

  function confirmSaveToHistory() {
    const entry = currentAssembledEntry();
    if (!entry) return;
    upsertHistory(entry);
    els.asmSaved.hidden = false;
    if (els.asmSave) {
      els.asmSave.disabled = true;
      setTimeout(() => { if (els.asmSave) els.asmSave.disabled = false; }, 800);
    }
  }

  function upsertHistory(entry) {
    const i = history.findIndex((h) => h.id === entry.id);
    if (i >= 0) {
      const prev = history[i];
      history[i] = { ...entry, known: prev.known, date: entry.date };
    } else {
      history.unshift(entry);
    }
    // cap
    if (history.length > 500) history = history.slice(0, 500);
    saveHistory();
    if (!els.viewReview.hidden) renderReviewList();
  }

  function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const zh = voices.find((v) => /zh[-_]CN/i.test(v.lang)) || voices.find((v) => /^zh/i.test(v.lang));
    if (zh) u.voice = zh;
    window.speechSynthesis.speak(u);
  }

  function runParse() {
    if (!DATA) return;
    const raw = els.input.value.trim();
    if (!raw) {
      els.status.textContent = "병음을 입력하세요.";
      slots = [];
      renderSlots();
      return;
    }
    let parsed = null;
    let viaKorean = false;
    if (looksLikeKoreanNameQuery(raw)) {
      parsed = parseKoreanName(raw);
      viaKorean = !!parsed;
      if (!parsed) {
        els.status.textContent = "한글 독음으로 이름을 나누지 못했습니다. 훈음은 한글 탭에서 찾아 보세요.";
        slots = [];
        renderSlots();
        return;
      }
    } else {
      parsed = parseNameInput(raw);
    }
    if (!parsed || (!parsed.surSlots.length && !parsed.givenTokens.length)) {
      els.status.textContent = "음절을 해석하지 못했습니다.";
      slots = [];
      renderSlots();
      return;
    }
    slots = buildSlotsFromParse(parsed);
    slotUI = {};
    const surLabel = parsed.compound
      ? `복성 ${parsed.compound.s}`
      : (slots.find((s) => s.role === "sur")?.bare || "");
    const givenN = slots.filter((s) => s.role === "given").length;
    const koNote = viaKorean ? " · 한국 독음(두음법칙 반영)" : "";
    els.status.textContent = `성씨: ${surLabel} · 이름 음절 ${givenN}개${koNote} · 후보를 탭해 고르세요 (기본값=빈도 상위)`;
    renderSlots();
  }

  // Tabs
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      const tab = btn.dataset.tab;
      els.viewSearch.hidden = tab !== "search";
      els.viewReview.hidden = tab !== "review";
      if (tab === "review") renderReviewList();
    });
  });

  els.parseBtn.addEventListener("click", runParse);
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runParse();
  });
  document.querySelectorAll(".ex").forEach((btn) => {
    btn.addEventListener("click", () => {
      els.input.value = btn.dataset.q;
      runParse();
    });
  });

  els.slots.addEventListener("click", (e) => {
    const more = e.target.closest("[data-more]");
    if (more) {
      const si = Number(more.dataset.more);
      getSlotUI(si).expanded = true;
      renderSlots();
      return;
    }
    const less = e.target.closest("[data-less]");
    if (less) {
      const si = Number(less.dataset.less);
      getSlotUI(si).expanded = false;
      renderSlots();
      return;
    }
    const btn = e.target.closest(".cand");
    if (!btn) return;
    const si = Number(btn.dataset.si);
    const c = btn.dataset.c;
    const py = btn.dataset.py;
    const cands = candidatesFor(slots[si].bare, slots[si].tone, slots[si].role);
    const hit = cands.find((x) => x.c === c && x.py === py);
    if (hit) {
      slots[si].selected = hit;
      renderSlots();
    }
  });

  els.slots.addEventListener("input", (e) => {
    const inp = e.target.closest(".slot-filter");
    if (!inp) return;
    const si = Number(inp.dataset.filter);
    getSlotUI(si).filter = inp.value;
    // Keep expanded when filtering so all matches show
    if (inp.value.trim()) getSlotUI(si).expanded = true;
    renderSlots();
    const again = els.slots.querySelector(`.slot-filter[data-filter="${si}"]`);
    if (again) {
      again.focus();
      const len = again.value.length;
      try { again.setSelectionRange(len, len); } catch (_) {}
    }
  });

  els.asmSpeak.addEventListener("click", () => {
    const t = els.asmSimp.textContent;
    if (t) speak(t);
  });
  if (els.asmSave) {
    els.asmSave.addEventListener("click", () => confirmSaveToHistory());
  }

  // Review list
  function renderReviewList() {
    const q = (els.reviewSearch.value || "").trim().toLowerCase();
    let items = history;
    if (q) {
      items = history.filter((h) =>
        [h.simp, h.trad, h.py, h.ko, h.hun, h.query, ...(h.defs || [])].join(" ").toLowerCase().includes(q)
      );
    }
    els.histCount.textContent = String(history.length);
    if (!items.length) {
      els.reviewList.innerHTML = "";
      els.reviewEmpty.hidden = false;
      els.reviewEmpty.textContent = history.length
        ? "검색 결과가 없습니다."
        : "아직 저장된 항목이 없습니다. 이름·글자·단어를 고른 뒤 저장 버튼을 누르세요.";
      return;
    }
    els.reviewEmpty.hidden = true;
    els.reviewList.innerHTML = items.map((h) => {
      const d = new Date(h.date);
      const dateStr = isNaN(d) ? h.date : d.toLocaleString("ko-KR", { timeZone: "Asia/Singapore" });
      const know = h.known === true ? '<span class="known-tag">알았음</span>'
        : h.known === false ? '<span class="unknown-tag">모름</span>' : "";
      const kind = h.kind || ([...h.simp].length === 1 ? "char" : "name");
      const kindLabel = kind === "word" ? '<span class="kind-tag">단어</span> ' : kind === "char" ? '<span class="kind-tag">글자</span> ' : '<span class="kind-tag">이름</span> ';
      const defs = (h.defs && h.defs.length) ? `<div class="hist-defs">영어 뜻 · ${esc(h.defs.join(" · "))}</div>` : "";
      return `<article class="hist-card" data-kind="${kind}" data-id="${esc(h.id)}">
        <div>
          <div class="hist-simp">${kindLabel}${esc(h.simp)}${h.trad ? ` <span style="font-size:.95rem;color:var(--muted)">/ ${esc(h.trad)}</span>` : ""}</div>
          <div class="hist-meta">${esc(h.py)} · ${esc(dateStr)} ${know}</div>
          <div class="hist-ko">${esc(h.ko)}</div>
          <div class="hist-hun">${esc(h.hun)}</div>
          ${defs}
        </div>
        <div class="hist-actions">
          <button type="button" class="ghost hist-speak" data-speak="${esc(h.simp)}">▶</button>
          <button type="button" class="ghost hist-know" data-id="${esc(h.id)}">알았음</button>
          <button type="button" class="danger hist-del" data-id="${esc(h.id)}">삭제</button>
        </div>
      </article>`;
    }).join("");
  }

  els.reviewSearch.addEventListener("input", renderReviewList);
  els.reviewList.addEventListener("click", (e) => {
    const speakBtn = e.target.closest(".hist-speak");
    if (speakBtn) { speak(speakBtn.dataset.speak); return; }
    const del = e.target.closest(".hist-del");
    if (del) {
      history = history.filter((h) => h.id !== del.dataset.id);
      saveHistory();
      renderReviewList();
      return;
    }
    const know = e.target.closest(".hist-know");
    if (know) {
      const h = history.find((x) => x.id === know.dataset.id);
      if (h) { h.known = true; saveHistory(); renderReviewList(); }
    }
  });

  function mergeImportedItems(items) {
    let added = 0;
    for (const it of items) {
      if (!it || !it.simp || !it.py) continue;
      const entry = {
        id: it.id || `${it.simp}|${it.py}`,
        date: it.date || new Date().toISOString(),
        simp: it.simp,
        trad: it.trad || "",
        py: it.py,
        ko: it.ko || "",
        hun: it.hun || "",
        chars: it.chars || [],
        known: it.known ?? null,
        query: it.query || "",
        kind: it.kind || "",
        defs: it.defs || [],
      };
      const idx = history.findIndex((h) => h.id === entry.id);
      if (idx >= 0) history[idx] = { ...history[idx], ...entry };
      else { history.unshift(entry); added++; }
    }
    saveHistory();
    renderReviewList();
    return added;
  }

  // Export / Import (Electron native dialogs when available)
  document.getElementById("btn-export").addEventListener("click", () => { exportHistory(); });
  const backupExport = document.getElementById("backup-export");
  const backupDismiss = document.getElementById("backup-dismiss");
  if (backupExport) backupExport.addEventListener("click", () => { exportHistory(); });
  if (backupDismiss) backupDismiss.addEventListener("click", () => {
    try { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch {}
    updateBackupBanner();
  });
  document.getElementById("btn-import").addEventListener("click", async () => {
    if (window.electronAPI?.importJson) {
      const res = await window.electronAPI.importJson();
      if (!res) return;
      if (!res.ok) { alert(res.error || "JSON을 읽지 못했습니다."); return; }
      try {
        const data = JSON.parse(res.text);
        const items = Array.isArray(data) ? data : data.items;
        if (!Array.isArray(items)) throw new Error("invalid");
        const added = mergeImportedItems(items);
        alert(`가져오기 완료 (신규 ${added}개, 전체 ${history.length}개)`);
      } catch {
        alert("JSON을 읽지 못했습니다.");
      }
      return;
    }
    document.getElementById("import-file").click();
  });
  document.getElementById("import-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(items)) throw new Error("invalid");
      const added = mergeImportedItems(items);
      alert(`가져오기 완료 (신규 ${added}개, 전체 ${history.length}개)`);
    } catch {
      alert("JSON을 읽지 못했습니다.");
    }
    e.target.value = "";
  });

  // Flashcards
  function openFlash() {
    if (!history.length) { alert("복습할 이름이 없습니다."); return; }
    flash.deck = [...history];
    // prefer unknown first
    flash.deck.sort((a, b) => Number(a.known === true) - Number(b.known === true));
    flash.i = 0;
    flash.revealed = false;
    els.flashModal.hidden = false;
    renderFlash();
  }
  function renderFlash() {
    if (!flash.deck.length) {
      els.flashFront.innerHTML = "끝! 모든 카드를 봤습니다.";
      els.flashBack.hidden = true;
      els.flashProgress.textContent = "";
      return;
    }
    if (flash.i >= flash.deck.length) flash.i = 0;
    const h = flash.deck[flash.i];
    els.flashProgress.textContent = `${flash.i + 1} / ${flash.deck.length}` + (h.known === true ? " · 알았음" : h.known === false ? " · 모름" : "");
    els.flashBack.hidden = !flash.revealed;
    document.querySelector(".flash-tap").hidden = flash.revealed;
    const defLine = (h.defs && h.defs.length) ? `<div style="font-size:.9rem;margin-top:.4rem">영어 뜻 · ${esc(h.defs.join(" · "))}</div>` : "";
    if (flash.mode === "py2han") {
      els.flashFront.innerHTML = `<div>${esc(h.py)}</div>`;
      els.flashBack.innerHTML = `<span class="big">${esc(h.simp)}</span><div>${esc(h.ko)}</div><div style="font-size:.95rem;margin-top:.4rem">${esc(h.hun)}</div>${defLine}`;
    } else if (flash.mode === "han2py") {
      els.flashFront.innerHTML = `<span class="big">${esc(h.simp)}</span>`;
      els.flashBack.innerHTML = `<div>${esc(h.py)}</div><div>${esc(h.ko)}</div><div style="font-size:.95rem;margin-top:.4rem">${esc(h.hun)}</div>${defLine}`;
    } else {
      els.flashFront.innerHTML = `<div>${esc(h.py)}</div>`;
      els.flashBack.innerHTML = `<div style="font-size:1.2rem">${esc(h.hun)}</div><span class="big">${esc(h.simp)}</span><div>${esc(h.ko)}</div>${defLine}`;
    }
  }
  document.getElementById("btn-flash").addEventListener("click", openFlash);
  document.getElementById("flash-close").addEventListener("click", () => { els.flashModal.hidden = true; });
  els.flashCard.addEventListener("click", () => {
    flash.revealed = !flash.revealed;
    renderFlash();
  });
  document.querySelectorAll(".flash-mode .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".flash-mode .chip").forEach((b) => b.classList.toggle("active", b === btn));
      flash.mode = btn.dataset.mode;
      flash.revealed = false;
      renderFlash();
    });
  });
  document.getElementById("flash-speak").addEventListener("click", () => {
    const h = flash.deck[flash.i];
    if (h) speak(h.simp);
  });
  function markFlash(known) {
    const h = flash.deck[flash.i];
    if (!h) return;
    const item = history.find((x) => x.id === h.id);
    if (item) item.known = known;
    h.known = known;
    saveHistory();
    flash.i = (flash.i + 1) % flash.deck.length;
    flash.revealed = false;
    renderFlash();
    renderReviewList();
  }
  document.getElementById("flash-known").addEventListener("click", () => markFlash(true));
  document.getElementById("flash-unknown").addEventListener("click", () => markFlash(false));

  window.nameAppBridge = {
    search: (q) => { els.input.value=q; runParse(); },
    searchKorean: (q) => { els.input.value=q; runParse(); },
    save: (entry) => { upsertHistory(entry); },
    getHistory: () => history,
    exportHistory,
    ready: () => !!DATA,
    speak,
    parseKoreanName: (q) => { ensureKoIndex(); return parseKoreanName(q); },
  };

  (function setupInstall() {
    const btn = document.getElementById("btn-install");
    if (!btn) return;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    if (standalone) { btn.hidden = true; return; }
    let deferred = null;
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferred = e;
      btn.hidden = false;
    });
    window.addEventListener("appinstalled", () => { deferred = null; btn.hidden = true; });
    btn.addEventListener("click", async () => {
      if (deferred) {
        deferred.prompt();
        try { await deferred.userChoice; } catch { /* user dismissed */ }
        deferred = null;
        return;
      }
      alert("Chrome 또는 Edge에서 이 사이트를 연 다음, 주소창의 설치 아이콘이나 브라우저 메뉴의 \"앱 설치\" / \"홈 화면에 추가\"를 선택하세요.");
    });
  })();

  // Init
  els.histCount.textContent = String(history.length);
  updateBackupBanner();
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  Promise.all([
    window.__NAMES__ ? Promise.resolve(window.__NAMES__) : fetch("data/names.json").then((r) => r.json()),
    window.__META__ ? Promise.resolve(window.__META__) : fetch("data/meta.json").then((r) => r.json()).catch(() => null),
  ]).then(([data, meta]) => {
    DATA = data;
    syllableSet = new Set(data.syllables || []);
    els.status.textContent = `준비 완료 · 한자 ${meta?.stats?.unique_chars ?? "?"}자 · 성씨 ${meta?.stats?.surnames ?? "?"} · 복성 ${meta?.stats?.compounds ?? "?"}`;
    if (meta) {
      els.credits.innerHTML = `
        <p>수록 ${meta.stats.unique_chars}자 · 훈음 ${meta.stats.with_hun} · 이름용 글자빈도 ${meta.stats.given_chars_with_freq}</p>
        <ul>${(meta.sources || []).map((s) => `<li><strong>${esc(s.name)}</strong> — ${esc(s.license)}<br/><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></li>`).join("")}</ul>`;
    }
  }).catch((err) => {
    console.error(err);
    els.status.textContent = "데이터를 불러오지 못했습니다. 로컬 서버로 열어 주세요.";
  });
})();
