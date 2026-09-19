/**
 * localStorage 持久化层
 * ------------------------------------------------------------------
 * 对应基础要求 6「重要的用户操作结果在刷新或重新打开后应能够合理保留」。
 * 单一命名空间 + 版本号，便于日后结构升级时迁移。
 */

const KEY = 'campusloop.v1';

const EMPTY = {
  version: 1,
  favorites: [],   // 收藏的活动 id
  signups: [],     // 已报名的活动 id
  published: [],   // 用户自己发布的活动（完整对象）
  reports: [],     // 状态众包上报 [{ eventId, status, at }]
  onboard: null,   // 新生三问结果 { grade, interests[], hours, doneAt }
  history: [],     // 浏览足迹 id
  seeded: false
};

let cache = null;

function read() {
  if (cache) { ensureShapes(cache); return cache; }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { cache = { ...EMPTY, favorites: [], signups: [], published: [], reports: [], history: [] }; return cache; }
    const parsed = JSON.parse(raw);
    cache = { ...EMPTY, ...parsed };
  } catch (e) {
    console.warn('[store] 本地数据读取失败，已重置', e);
    cache = { ...EMPTY };
  }
  ensureShapes(cache);
  return cache;
}

/** 数组字段兜底，避免手工篡改 localStorage 或旧版本数据结构导致崩溃 */
function ensureShapes(obj) {
  ['favorites', 'signups', 'published', 'reports', 'history'].forEach((k) => {
    if (!Array.isArray(obj[k])) obj[k] = [];
  });
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
    return true;
  } catch (e) {
    console.warn('[store] 本地数据写入失败（可能是隐私模式或空间已满）', e);
    return false;
  }
}

export const store = {
  all() { return read(); },

  get(key) { return read()[key]; },

  set(key, value) { read()[key] = value; return write(); },

  has(listKey, id) { return read()[listKey].includes(id); },

  /** 切换收藏，返回切换后的状态 */
  toggle(listKey, id) {
    const list = read()[listKey];
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.unshift(id);
    write();
    return i < 0;
  },

  add(listKey, id) {
    const list = read()[listKey];
    if (!list.includes(id)) { list.unshift(id); write(); return true; }
    return false;
  },

  remove(listKey, id) {
    const list = read()[listKey];
    const i = list.indexOf(id);
    if (i >= 0) { list.splice(i, 1); write(); return true; }
    return false;
  },

  /** 浏览足迹：最多保留 20 条 */
  touchHistory(id) {
    const list = read().history;
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    list.unshift(id);
    if (list.length > 20) list.length = 20;
    write();
  },

  /** 我发布的活动 */
  addPublished(ev) { read().published.unshift(ev); write(); return ev; },

  updatePublished(id, patch) {
    const list = read().published;
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return false;
    list[i] = { ...list[i], ...patch };
    write();
    return true;
  },

  /** 状态上报：同一活动保留最新一次上报 */
  addReport(eventId, status, note) {
    const list = read().reports;
    const i = list.findIndex((r) => r.eventId === eventId);
    const entry = { eventId, status, note: note || '', at: new Date().toISOString() };
    if (i >= 0) list[i] = entry; else list.unshift(entry);
    write();
    return entry;
  },

  getReport(eventId) {
    return read().reports.find((r) => r.eventId === eventId) || null;
  },

  /** 导出为 JSON 文本，供备份或跨设备迁移 */
  exportJSON() { return JSON.stringify(read(), null, 2); },

  importJSON(text) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') return false;
      const d = read();
      Object.assign(d, EMPTY, parsed);
      ensureShapes(d);
      // 就地替换数组内容，保持引用稳定，避免外部持有的数组变成孤儿
      ['favorites', 'signups', 'published', 'reports', 'history'].forEach((k) => {
        const incoming = Array.isArray(parsed[k]) ? parsed[k] : [];
        d[k] = Array.isArray(d[k]) ? d[k] : [];
        d[k].length = 0;
        incoming.forEach((x) => d[k].push(x));
      });
      return write();
    } catch { return false; }
  },

  /**
   * 清空全部本地数据。
   * 注意：必须**就地清空数组**（length = 0）而不是换成新数组。
   * 视图层可能已经通过 get('favorites') 等拿到了数组引用并缓存在闭包里，
   * 若替换成新数组，那些引用会继续指向旧数据，出现「清空后旧数据又回来」的问题。
   */
  clearAll() {
    const d = read();
    Object.assign(d, EMPTY);
    ['favorites', 'signups', 'published', 'reports', 'history'].forEach((k) => {
      if (Array.isArray(d[k])) d[k].length = 0;
      else d[k] = [];
    });
    write();
  },

  /** 丢弃内存缓存，强制下次读取重新解析 localStorage */
  refresh() { cache = null; }
};
