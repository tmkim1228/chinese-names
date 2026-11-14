(() => {
  "use strict";

  const HISTORY_KEY = "chinese-name-app.history.v1";
  const STATS_KEY = "chinese-name-app.stats.v1";
  const INTERVALS = [0, 1, 3, 7, 14, 30, 60];
  const BOX_MIN = 1;
  const BOX_MAX = 6;
  const DEFAULT_GOAL = 20;
  const EXCERPT_LEN = 80;

  const TONE_MARK = {
    ā: ["a", 1], á: ["a", 2], ǎ: ["a", 3], à: ["a", 4],
    ē: ["e", 1], é: ["e", 2], ě: ["e", 3], è: ["e", 4],
    ī: ["i", 1], í: ["i", 2], ǐ: ["i", 3], ì: ["i", 4],
    ō: ["o", 1], ó: ["o", 2], ǒ: ["o", 3], ò: ["o", 4],
    ū: ["u", 1], ú: ["u", 2], ǔ: ["u", 3], ù: ["u", 4],
    ǖ: ["ü", 1], ǘ: ["ü", 2], ǚ: ["ü", 3], ǜ: ["ü", 4],
  };

  let nowFn = () => new Date();
  function setNow(d) {
    if (d == null) nowFn = () => new Date();
    else if (typeof d === "function") nowFn = d;
    else nowFn = () => new Date(d);
  }
  function now() { return nowFn(); }

  function pad(n) { return String(n).padStart(2, "0"); }
  function todayStr(d) {
    const x = d ? new Date(d) : now();
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }
  function parseYmd(s) {
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  function addDays(ymd, n) {
    const d = parseYmd(ymd) || parseYmd(todayStr());
    d.setDate(d.getDate() + Number(n) || 0);
    return todayStr(d);
  }
  function cmpDate(a, b) {
    return String(a || "").localeCompare(String(b || ""));
  }
  function hashStr(s) {
    let h = 2166136261;
    for (const c of String(s || "")) {
      h ^= c.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function defaultStats() {
    return { version: 1, goal: DEFAULT_GOAL, days: {} };
  }
  function loadStats() {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (!raw) return defaultStats();
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return defaultStats();
      const goal = Math.max(1, Number(obj.goal) || DEFAULT_GOAL);
      const days = obj.days && typeof obj.days === "object" ? obj.days : {};
      return { version: 1, goal, days };
    } catch {
      return defaultStats();
    }
  }
  function saveStats(stats) {
    const s = stats || defaultStats();
    localStorage.setItem(STATS_KEY, JSON.stringify({
      version: 1,
      goal: Math.max(1, Number(s.goal) || DEFAULT_GOAL),
      days: s.days || {},
    }));
    return s;
  }
  function recordReview(stats, today) {
    const s = stats || loadStats();
    const day = today || todayStr();
    s.days = s.days || {};
    s.days[day] = (Number(s.days[day]) || 0) + 1;
    return saveStats(s);
  }
  function streak(stats, today) {
    const s = stats || loadStats();
    const day = today || todayStr();
    const has = (d) => (Number(s.days && s.days[d]) || 0) > 0;
    let cursor = has(day) ? day : addDays(day, -1);
    if (!has(cursor)) return 0;
    let n = 0;
    while (has(cursor)) {
      n += 1;
      cursor = addDays(cursor, -1);
    }
    return n;
  }

  function needsMigrate(item) {
    if (!item || typeof item !== "object") return false;
    return item.box == null && item.due == null;
  }
  function migrateItem(item, today) {
    if (!item || typeof item !== "object") return item;
    if (!needsMigrate(item)) {
      if (item.box != null) item.box = Math.min(BOX_MAX, Math.max(BOX_MIN, Number(item.box) || BOX_MIN));
      if (item.due && !/^\d{4}-\d{2}-\d{2}/.test(String(item.due))) {
        const d = new Date(item.due);
        item.due = isNaN(d) ? todayStr(today) : todayStr(d);
      }
      return item;
    }
    const day = today || todayStr();
    if (item.known === true) {
      const spread = 1 + (hashStr(item.id || item.simp || item.han || "") % 3);
      item.box = 2;
      item.due = addDays(day, spread);
    } else {
      item.box = 1;
      item.due = day;
    }
    return item;
  }
  function migrateHistory(items, today) {
    const list = Array.isArray(items) ? items : [];
    let changed = false;
    for (const it of list) {
      if (needsMigrate(it)) {
        migrateItem(it, today);
        changed = true;
      } else {
        migrateItem(it, today);
      }
    }
    return { items: list, changed };
  }

  function isDue(item, today) {
    if (!item) return false;
    const day = today || todayStr();
    const due = item.due || day;
    return cmpDate(due, day) <= 0;
  }
  function dueItems(items, today) {
    return (items || []).filter((it) => isDue(it, today));
  }
  function intervalFor(box) {
    const b = Math.min(BOX_MAX, Math.max(BOX_MIN, Number(box) || BOX_MIN));
    return INTERVALS[b];
  }
  function applyKnown(item, today) {
    const day = today || todayStr();
    const prev = Math.min(BOX_MAX, Math.max(BOX_MIN, Number(item.box) || BOX_MIN));
    const box = Math.min(BOX_MAX, prev + 1);
    item.box = box;
    item.due = addDays(day, intervalFor(box));
    item.known = true;
    item.lastReviewed = now().toISOString();
    return item;
  }
  function applyUnknown(item, today) {
    const day = today || todayStr();
    item.box = 1;
    item.due = day;
    item.known = false;
    item.lastReviewed = now().toISOString();
    return item;
  }
  function applyUnsure(item, today) {
    const day = today || todayStr();
    item.box = Math.min(BOX_MAX, Math.max(BOX_MIN, Number(item.box) || BOX_MIN));
    item.due = addDays(day, 1);
    item.lastReviewed = now().toISOString();
    return item;
  }

  function levelOf(item) {
    const box = Number(item && item.box) || 0;
    const reviewed = !!(item && item.lastReviewed);
    if (box >= 5) return "mastered";
    if (box >= 3) return "learned";
    if (box >= 2 || (box === 1 && reviewed) || (item && item.known === true)) return "learning";
    return "new";
  }
  const LEVEL_LABEL = { new: "새로", learning: "학습", learned: "익힘", mastered: "숙달" };
  const LEVEL_MARK = { new: "신", learning: "학", learned: "익", mastered: "완" };

  function totals(items) {
    const list = items || [];
    let learned = 0, mastered = 0;
    for (const it of list) {
      const box = Number(it.box) || 0;
      if (box >= 5) mastered += 1;
      if (box >= 3) learned += 1;
    }
    return { saved: list.length, learned, mastered };
  }

  function barePinyin(s) {
    let out = "";
    const t = String(s || "").trim().toLowerCase().normalize("NFC").replace(/u:/g, "ü").replace(/v/g, "ü");
    for (const ch of t) {
      if (TONE_MARK[ch]) out += TONE_MARK[ch][0];
      else if (/[a-zü]/.test(ch)) out += ch;
    }
    return out;
  }
  function toneSeq(s) {
    const t = String(s || "").trim().toLowerCase().normalize("NFC").replace(/u:/g, "ü").replace(/v/g, "ü");
    const tones = [];
    for (const ch of t) {
      if (TONE_MARK[ch]) tones.push(TONE_MARK[ch][1]);
      else if (/[1-5]/.test(ch)) tones.push(Number(ch));
    }
    return tones;
  }
  function gradePinyin(input, expected) {
    const exp = String(expected || "");
    const got = String(input || "");
    const bExp = barePinyin(exp);
    const bGot = barePinyin(got);
    if (!bGot) return { ok: false, partial: false, message: "병음을 입력해 주세요." };
    if (bExp !== bGot) return { ok: false, partial: false, message: "병음이 다릅니다." };
    const tExp = toneSeq(exp);
    const tGot = toneSeq(got);
    if (!tGot.length) {
      return { ok: false, partial: true, message: "성조만 틀렸어요" };
    }
    const same = tExp.length === tGot.length && tExp.every((n, i) => n === tGot[i]);
    if (same) return { ok: true, partial: false, message: "정답입니다." };
    return { ok: false, partial: true, message: "성조만 틀렸어요" };
  }

  function excerpt(sentence, word, max) {
    const limit = max || EXCERPT_LEN;
    const s = String(sentence || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    const w = String(word || "");
    const i = w ? s.indexOf(w) : -1;
    if (i < 0) {
      const cut = s.slice(0, limit);
      return s.length > limit ? cut + "…" : cut;
    }
    const extra = Math.max(0, limit - w.length);
    const left = Math.floor(extra / 2);
    let start = Math.max(0, i - left);
    let end = Math.min(s.length, start + limit);
    start = Math.max(0, end - limit);
    let out = s.slice(start, end);
    if (start > 0) out = "…" + out;
    if (end < s.length) out += "…";
    return out;
  }
  function mergeExample(item, text) {
    const ex = String(text || "").trim();
    if (!ex) return item;
    item.examples = Array.isArray(item.examples) ? item.examples.slice() : [];
    if (!item.examples.includes(ex)) {
      item.examples.push(ex);
      if (item.examples.length > 8) item.examples = item.examples.slice(-8);
    }
    return item;
  }

  function buildExport(items, stats) {
    return {
      version: 2,
      exportedAt: now().toISOString(),
      items: items || [],
      stats: stats || loadStats(),
    };
  }
  function parseImport(data) {
    const obj = typeof data === "string" ? JSON.parse(data) : data;
    const items = Array.isArray(obj) ? obj : (obj && obj.items);
    if (!Array.isArray(items)) throw new Error("invalid");
    const stats = obj && obj.stats && typeof obj.stats === "object" ? obj.stats : null;
    return { items, stats, version: (obj && obj.version) || 1 };
  }
  function mergeStats(local, incoming) {
    const a = local || defaultStats();
    if (!incoming) return a;
    const days = Object.assign({}, a.days || {});
    const incDays = incoming.days || {};
    for (const [k, v] of Object.entries(incDays)) {
      days[k] = Math.max(Number(days[k]) || 0, Number(v) || 0);
    }
    const goal = Math.max(1, Number(incoming.goal) || Number(a.goal) || DEFAULT_GOAL);
    return { version: 1, goal, days };
  }
  function chartSeries(stats, days, today) {
    const s = stats || loadStats();
    const n = days === 30 ? 30 : 14;
    const end = today || todayStr();
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(end, -i);
      out.push({ date: d, count: Number(s.days && s.days[d]) || 0 });
    }
    return out;
  }

  window.NameSrs = {
    HISTORY_KEY,
    STATS_KEY,
    INTERVALS,
    BOX_MIN,
    BOX_MAX,
    DEFAULT_GOAL,
    LEVEL_LABEL,
    LEVEL_MARK,
    setNow,
    now,
    todayStr,
    addDays,
    cmpDate,
    hashStr,
    defaultStats,
    loadStats,
    saveStats,
    recordReview,
    streak,
    needsMigrate,
    migrateItem,
    migrateHistory,
    isDue,
    dueItems,
    intervalFor,
    applyKnown,
    applyUnknown,
    applyUnsure,
    levelOf,
    totals,
    barePinyin,
    toneSeq,
    gradePinyin,
    excerpt,
    mergeExample,
    buildExport,
    parseImport,
    mergeStats,
    chartSeries,
  };
})();
