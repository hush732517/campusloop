/**
 * 通用工具与全局时钟
 * ------------------------------------------------------------------
 * 所有日期解析与格式化集中在此，避免各视图重复实现导致不一致。
 */

/** 考核基准时间：题目要求「以 2026 年 9 月 19 日考核当日为时间背景」 */
export const EXAM_NOW = '2026-09-19T14:00';

let _now = EXAM_NOW;

/**
 * 全局「当前时间」。
 * 之所以做成可注入而非直接 new Date()，是为了让状态计算成为纯函数，
 * 从而可以测试 9/18、9/19、9/21、9/25 等不同时点下的表现（见 docs/测试用例.md）。
 */
export function nowISO() { return _now; }
export function setNow(v) { _now = v; }
export function resetNow() { _now = EXAM_NOW; }
export function isSimulated() { return _now !== EXAM_NOW; }

export function nowMs() { return parse(_now); }

/** 'YYYY-MM-DDTHH:mm' → 毫秒时间戳；非法输入返回 NaN */
export function parse(iso) {
  if (!iso || typeof iso !== 'string') return NaN;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return NaN;
  return new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] || 0), Number(m[5] || 0), 0, 0
  ).getTime();
}

export function toDate(iso) { return new Date(parse(iso)); }

/** 日期键 'YYYY-MM-DD'，用于按日分组 */
export function dateKey(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function minutesOf(iso) {
  const d = toDate(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function fromParts(dayKey, minutes) {
  const d = new Date(parse(dayKey + 'T00:00'));
  d.setMinutes(minutes);
  return toISO(d);
}

export function toISO(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function addDays(iso, days) {
  const d = toDate(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function diffMinutes(a, b) { return Math.round((parse(a) - parse(b)) / 60000); }
export function diffHours(a, b) { return diffMinutes(a, b) / 60; }
export function diffDays(a, b) { return diffMinutes(a, b) / 1440; }

const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** JS getDay() 0=周日 → 1=周一 … 7=周日 */
export function weekdayNum(iso) { const d = toDate(iso).getDay(); return d === 0 ? 7 : d; }
export function weekdayLabel(iso) { return WD[toDate(iso).getDay()]; }

export function fmtDate(iso, withWeekday = true) {
  if (!iso) return '时间待确认';
  const d = toDate(iso);
  const base = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return withWeekday ? `${base}（${WD[d.getDay()]}）` : base;
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = toDate(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDateTime(iso) { return iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : '时间待确认'; }

/** 相对时间：用于倒计时与「多久前」 */
export function relTime(iso, from = nowISO()) {
  const mins = diffMinutes(iso, from);
  const abs = Math.abs(mins);
  const past = mins < 0;
  let text;
  if (abs < 1) text = '刚刚';
  else if (abs < 60) text = `${abs} 分钟`;
  else if (abs < 60 * 24) text = `${Math.floor(abs / 60)} 小时`;
  else text = `${Math.floor(abs / 1440)} 天`;
  if (text === '刚刚') return text;
  return past ? `${text}前` : `${text}后`;
}

/** 今日 / 明日 / 具体日期 */
export function smartDay(iso, from = nowISO()) {
  if (!iso) return '时间待确认';
  const a = dateKey(iso), b = dateKey(from);
  if (a === b) return '今天';
  if (a === addDays(b + 'T00:00', 1).slice(0, 10)) return '明天';
  if (a === addDays(b + 'T00:00', 2).slice(0, 10)) return '后天';
  return fmtDate(iso);
}

/** 同学可读的时长：'19:00—20:30' 或 '19:00 开始' */
export function fmtRange(start, end, durationMin) {
  if (!start) return '时间待确认';
  const s = fmtTime(start);
  if (end) return `${s}—${fmtTime(end)}`;
  if (durationMin) return `${s} 开始（约 ${durationMin} 分钟）`;
  return `${s} 开始`;
}

export function fmtDeadline(iso) {
  if (!iso) return '报名截止时间未注明';
  return `${fmtDate(iso)} ${fmtTime(iso)} 截止`;
}

/**
 * 相对「有效参考日」的完整星期标签，例如 09-24 → 「9 月 24 日（周四）」。
 * 用于核对「每周六 / 每周三」这类信息是否与实际日期自洽。
 */
export function weekdayConsistent(iso, weekday) {
  if (!iso || !weekday) return null;
  return weekdayNum(iso) === weekday;
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function uniq(arr) { return Array.from(new Set(arr)); }

export function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
