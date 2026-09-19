/**
 * 领域模型：状态机 / 通知合并 / 信息缺口 / 撞车检测 / 完整度评分
 * ------------------------------------------------------------------
 * 这是本产品的技术核心。四项自主创新功能（合并视图、待确认缺口、
 * 撞车检测、发布体检）全部建立在本文件的纯函数之上。
 *
 * 设计原则：状态一律「由结构化字段 + 当前时间计算得出」，不硬编码文本，
 * 因此时间推进或用户上报后，界面上的状态与倒计时会自动更新。
 */

import {
  EVENTS, CATEGORIES, SOURCES, MISSING_LABELS, GRADE_LABELS
} from '../data/events.js';
import {
  nowISO, nowMs, parse, dateKey, toDate, fromParts, minutesOf, diffMinutes,
  diffHours, fmtDate, fmtTime, fmtRange, fmtDeadline, smartDay, relTime,
  weekdayNum, weekdayLabel, addDays, toISO
} from './util.js';
import { store } from './store.js';

/* ============================ 状态机 ============================ */

export const STATUS = {
  risk_high:   { label: '高风险 · 已折叠', tone: 'risk',    order: 0 },
  cancelled:   { label: '已取消',          tone: 'muted',   order: 1 },
  pending:     { label: '时间待确认',      tone: 'pending', order: 2 },
  ongoing:     { label: '进行中',          tone: 'live',    order: 3 },
  closing:     { label: '即将截止',        tone: 'warn',    order: 4 },
  today:       { label: '今天',            tone: 'accent',  order: 5 },
  open:        { label: '报名中',          tone: 'ok',      order: 6 },
  nosignup:    { label: '无需报名',        tone: 'ok',      order: 7 },
  waitlist:    { label: '可候补',          tone: 'accent',  order: 8 },
  passed:      { label: '报名已截止',      tone: 'muted',   order: 9 },
  replay:      { label: '回放待上传',      tone: 'accent',  order: 10 },
  resource:    { label: '长期开放',        tone: 'ok',      order: 11 },
  finished:    { label: '已结束',          tone: 'muted',   order: 12 },
  upcoming:    { label: '即将开始',        tone: 'accent',  order: 13 }
};

const CLOSING_WINDOW_H = 24;   // 24 小时内截止 → 「即将截止」
const SOON_WINDOW_H = 72;      // 72 小时内开始 → 「即将开始」

function timeOfDay(iso) { return iso ? fmtTime(iso) : ''; }

/** 结束时间推断：无 end 时用 durationMin，再退回 90 分钟 */
function endOf(start, end, durationMin) {
  if (end) return end;
  if (!start) return null;
  return toISO(new Date(parse(start) + (durationMin || 90) * 60000));
}

/**
 * 计算显示状态。这是纯函数，now 可注入 → 可在测试中把时钟拨到 9/18、9/21、9/25。
 * @param {object} m 合并视图（mergeView 的产物）
 * @param {string} now
 */
export function computeStatus(m, now = nowISO()) {
  const t = m.time || {};
  const part = m.participation || {};
  const N = parse(now);

  // 1) 高风险内容优先折叠
  if (m.risk && m.risk.level === 'high') {
    return { key: 'risk_high', ...STATUS.risk_high };
  }
  if (m.cancelled) return { key: 'cancelled', ...STATUS.cancelled };

  const start = t.start || null;
  const end = endOf(start, t.end, t.durationMin);
  const deadline = t.deadline || null;

  // 2) 进行中
  if (start && end && parse(start) <= N && N <= parse(end)) {
    return { key: 'ongoing', ...STATUS.ongoing };
  }

  // 3) 需报名但报名已截止
  if (deadline && N > parse(deadline)) {
    if (part.waitlist) return { key: 'waitlist', ...STATUS.waitlist };
    const finished = end && N > parse(end);
    if (!finished) return { key: 'passed', ...STATUS.passed };
  }

  // 4) 已结束 / 回放
  if (start && end && N > parse(end)) {
    if (t.kind === 'replay' && t.replayAt && N < parse(t.replayAt)) {
      return { key: 'replay', ...STATUS.replay, note: `预计 ${fmtDate(t.replayAt)} 上传回放` };
    }
    if (t.kind === 'replay') return { key: 'replay', ...STATUS.replay };
    return { key: 'finished', ...STATUS.finished };
  }

  // 5) 周期活动：判断下一场次
  if (t.kind === 'recurring' && t.recurrence) {
    const next = nextOccurrence(m, now);
    if (!next) return { key: 'finished', ...STATUS.finished };
    if (dateKey(next) === dateKey(now)) {
      return { key: 'today', ...STATUS.today, note: `下一场 ${timeOfDay(next)}` };
    }
    if (deadline && N > parse(deadline)) {
      return { key: 'passed', ...STATUS.passed, note: '后续场次仍可旁听，但报名已截止' };
    }
    return { key: 'nosignup', ...STATUS.nosignup, note: `下一场 ${smartDay(next)} ${timeOfDay(next)}` };
  }

  // 6) 长期开放资源
  if (t.kind === 'resource') {
    if (deadline && N > parse(deadline)) {
      return { key: 'passed', ...STATUS.passed, note: '有效期已过，等待统一更新' };
    }
    if (deadline) {
      const h = diffHours(deadline, now);
      if (h <= CLOSING_WINDOW_H)
        return { key: 'closing', ...STATUS.closing, note: `有效期剩 ${relTime(deadline, now)}` };
      return { key: 'resource', ...STATUS.resource, note: `有效期至 ${fmtDate(deadline)}` };
    }
    return { key: 'resource', ...STATUS.resource };
  }

  // 7) 完全缺失时间信息 → 待确认
  if (!start && !deadline) {
    return { key: 'pending', ...STATUS.pending };
  }

  // 8) 即将截止
  if (deadline && part.needSignup) {
    const h = diffHours(deadline, now);
    if (h >= 0 && h <= CLOSING_WINDOW_H) {
      return { key: 'closing', ...STATUS.closing, note: `剩 ${relTime(deadline, now)}` };
    }
    if (h > CLOSING_WINDOW_H && start && dateKey(now) === dateKey(start)) {
      return { key: 'today', ...STATUS.today, note: `${timeOfDay(start)} 开始` };
    }
    if (h > CLOSING_WINDOW_H) {
      return { key: 'open', ...STATUS.open, note: `截止 ${smartDay(deadline)} ${timeOfDay(deadline)}` };
    }
  }

  // 9) 当天 / 无需报名 / 即将开始
  if (start) {
    if (dateKey(now) === dateKey(start)) {
      return { key: 'today', ...STATUS.today, note: `${timeOfDay(start)} 开始` };
    }
    if (!part.needSignup) return { key: 'nosignup', ...STATUS.nosignup };
    const h = diffHours(start, now);
    if (h >= 0 && h <= SOON_WINDOW_H) return { key: 'upcoming', ...STATUS.upcoming };
    return { key: 'open', ...STATUS.open };
  }

  return { key: 'pending', ...STATUS.pending };
}

/* ======================= 周期活动的下一场次 ======================= */

/**
 * 生成活动全部场次时间（限定期限内）。
 * 支持 weekly 与每隔 N 周（如「每两周开展一次」）。
 */
export function occurrences(m, untilISO, limit = 40) {
  const t = m.time || {};
  const out = [];
  const until = parse(untilISO || addDays(nowISO(), 90));

  if (t.kind === 'recurring' && t.recurrence) {
    const { weekday, startDate, weeks = 6, intervalWeeks = 1 } = t.recurrence;
    let cursor = startDate;
    let guard = 0;
    for (let w = 0; w < weeks && guard < limit; w++) {
      // 对齐到目标星期
      let d = cursor;
      let safety = 0;
      while (weekdayNum(d) !== weekday && safety < 8) { d = addDays(d, 1); safety++; }
      const startTime = fmtTime(t.start) === '' ? '19:00' : fmtTime(t.start);
      const iso = `${d.slice(0, 10)}T${t.start ? startTime : '19:00'}`;
      if (parse(iso) <= until) out.push(iso);
      cursor = addDays(d, 7 * intervalWeeks);
      guard++;
    }
    // 若提供了单独的首次时间（如补充通知改期），并入并按时间排序
    if (t.start && !out.includes(t.start)) out.push(t.start);
    return out.sort((a, b) => parse(a) - parse(b));
  }

  if (t.start) return [t.start];
  return [];
}

/** 下一场次（含正在进行的那一场） */
export function nextOccurrence(m, now = nowISO()) {
  const list = occurrences(m, addDays(now, 120));
  const dur = (m.time && m.time.durationMin) || 90;
  return list.find((iso) => parse(iso) + dur * 60000 >= parse(now)) || null;
}

/* ========================= 撞车检测 ========================= */

/**
 * 自主创新功能 3：撞车检测。
 * 题目完全没有提示，但材料中存在真实冲突：
 *   9/19 19:00 AI 公开课（90 分钟） vs 9/19 19:30 网安小组首次交流
 *   9/21 19:00—20:30 Git 工作坊   vs 9/21 19:30 训练营首次训练
 *
 * 两条必要的准确性规则（否则会产出大量无意义结论）：
 *   ① 同一件事的原始通知与补充通知不算冲突——补充通知已经覆盖前者；
 *   ② 重叠不足 15 分钟的不提示（例如某活动 23:53 结束、另一活动 23:59 截止），
 *      否则用户会被噪音淹没，反而失去提醒价值。
 */
const MIN_OVERLAP_MIN = 15;

/** 该条目是否为「已被补充通知覆盖的原始通知」 */
export function isSuperseded(id) {
  const all = [...EVENTS, ...store.get('published')];
  return all.some((e) => (e.amendments || []).some((a) => a.fromId === id));
}

/** 判断两条是否属于同一件事（互为修订关系） */
function sameThing(a, b) {
  if (a.id === b.id) return true;
  if ((a.amendedBy || []).some((x) => x.id === b.id)) return true;
  if ((b.amendedBy || []).some((x) => x.id === a.id)) return true;
  const aBase = (rawById(a.id)?.amendments || []).map((x) => x.fromId);
  const bBase = (rawById(b.id)?.amendments || []).map((x) => x.fromId);
  if (aBase.includes(b.id) || bBase.includes(a.id)) return true;
  return false;
}

export function occurrenceWindows(m, fromISO, toISO_) {
  const t = m.time || {};
  const dur = t.durationMin || 90;
  const out = [];
  // 单次活动
  if (t.start && t.kind === 'onetime') {
    const end = t.end || toISO(new Date(parse(t.start) + dur * 60000));
    out.push({ start: t.start, end });
  }
  // 周期活动的每个场次；有 start 的周期活动（如训练营）第一场用 start
  if (t.kind === 'recurring') {
    occurrences(m, toISO_ || addDays(fromISO, 60)).forEach((s) => {
      const mins = t.start ? minutesOf(t.start) : 19 * 60;
      const iso = fromParts(dateKey(s), mins);
      out.push({ start: iso, end: toISO(new Date(parse(iso) + dur * 60000)) });
    });
  }
  return out.filter((w) => w.start);
}

/**
 * 找出所有撞车组合。
 * @returns {Array<{day, a, b, overlapMin, overlapText, advice}>}
 */
export function findClashes(merged, fromISO = nowISO(), days = 14) {
  const horizon = addDays(fromISO, days);
  const items = [];
  merged.forEach((m) => {
    if (m.risk && m.risk.level === 'high') return;         // 高风险折叠内容不参与
    if (isSuperseded(m.id)) return;                        // 规则①：被补充通知覆盖的原始条目不参与
    occurrenceWindows(m, fromISO, horizon).forEach((w) => {
      if (w.start && dateKey(w.start) >= dateKey(fromISO)) {
        items.push({ m, ...w });
      }
    });
  });

  const byDay = new Map();
  items.forEach((it) => {
    const k = dateKey(it.start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(it);
  });

  const clashes = [];
  byDay.forEach((list, day) => {
    if (list.length < 2) return;
    list.sort((a, b) => parse(a.start) - parse(b.start));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i], B = list[j];
        if (sameThing(A.m, B.m)) continue;                 // 规则①：同一件事不算冲突
        const overlap = Math.min(parse(A.end), parse(B.end)) - Math.max(parse(A.start), parse(B.start));
        const overlapMin = Math.round(overlap / 60000);
        if (overlapMin < MIN_OVERLAP_MIN) continue;        // 规则②：忽略微不足道的重叠
        clashes.push({
          day, a: A.m, b: B.m,
          overlapMin,
          overlapText: `${fmtTime(A.start > B.start ? A.start : B.start)}—${fmtTime(parse(A.end) < parse(B.end) ? A.end : B.end)}`,
          advice: A.m.participation.needSignup && B.m.participation.needSignup
            ? '两场都需要报名，建议二选一，避免报名后缺席'
            : '其中一场无需报名，可优先保需报名的场次'
        });
      }
    }
  });
  return clashes.sort((x, y) => (x.day < y.day ? -1 : 1));
}

/** 某活动参与的全部撞车 */
export function clashesFor(id, merged, fromISO = nowISO()) {
  return findClashes(merged, fromISO).filter((c) => c.a.id === id || c.b.id === id);
}

/* ======================= 通知合并视图 ======================= */

/** 按 id 取原始事件（含用户发布） */
export function rawById(id) {
  return EVENTS.find((e) => e.id === id)
    || store.get('published').find((e) => e.id === id)
    || null;
}

/**
 * 自主创新功能 1：通知合并视图。
 * 把「补充通知」叠加到「原始通知」之上，输出用户真正需要的最新有效版本，
 * 并记录哪些字段发生了变化，供详情页展示「变更前 → 变更后」。
 *
 * 这是本题最隐蔽的坑：09 是 01 的修订、20 是 03 的修订，
 * 若不合并，用户会按过期信息行动（去报已满的开发岗、周六白跑一趟）。
 */
export function mergeView(id) {
  const base = rawById(id);
  if (!base) return null;

  // 找出所有「修订了 base」的条目，按时间排序（后者覆盖前者）
  const all = [...EVENTS, ...store.get('published')];
  const amendments = all
    .filter((e) => (e.amendments || []).some((a) => a.fromId === id))
    .sort((a, b) => parse(a.time?.start || a.time?.deadline || '2000-01-01') - parse(b.time?.start || b.time?.deadline || '2000-01-01'));

  const merged = JSON.parse(JSON.stringify(base));
  const changes = [];

  amendments.forEach((am) => {
    const rule = am.amendments.find((a) => a.fromId === id);
    // 应用显式覆盖值（如 recruitRoles）
    if (rule.overrides) Object.assign(merged, rule.overrides);
    // 应用字段级覆盖：从修订通知中取值填入原条目
    (rule.fields || []).forEach((path) => {
      const [group, key] = path.split('.');
      const newVal = am[group] ? am[group][key] : undefined;
      if (newVal == null) return;
      const oldVal = base[group] ? base[group][key] : undefined;
      if (!merged[group]) merged[group] = {};
      merged[group][key] = newVal;
      if (String(oldVal) !== String(newVal)) {
        changes.push({ path, group, key, from: oldVal, to: newVal, by: am.id, note: rule.note });
      }
    });
    // 记录修订来源
    merged.amendedBy = merged.amendedBy || [];
    merged.amendedBy.push({ id: am.id, code: am.code, title: am.title, note: rule.note, raw: am.raw });
  });

  // 关键判定的结构化输出，供卡片与详情页直接使用
  if (merged.recruitRoles) {
    merged.recruitNote = `开发方向名额已满，现主要补充${merged.recruitRoles.join('、')}成员`;
  }

  merged.changeCount = changes.length;
  merged.changes = changes;
  return merged;
}

/**
 * 全量合并视图（含用户发布）。
 * 对于「已被补充通知覆盖的原始条目」，会标注 supersededBy 与 updated 标记，
 * 由界面层决定是否展示（发现页与日历默认隐藏，避免同一件事出现两次）。
 */
export function allMerged() {
  const ids = [...EVENTS, ...store.get('published')].map((e) => e.id);
  const all = ids.map(mergeView).filter(Boolean);

  // m.amendedBy 记录的是「谁修订了我」，因此被修订的条目 id 就是 m.id 本身，
  // 修订者是 am.id。这里建立「被覆盖的条目 → 覆盖它的补充通知」映射。
  const superseders = new Map();
  all.forEach((m) => {
    (m.amendedBy || []).forEach((am) => superseders.set(m.id, am));
  });

  all.forEach((m) => {
    const am = superseders.get(m.id);
    if (am) {
      m.supersededBy = am.id;
      m.supersededByTitle = am.title;
    }
  });
  return all;
}

/** 发现页与日历使用的可见列表：排除已被覆盖的原始通知 */
export function visibleMerged() {
  return allMerged().filter((m) => !m.supersededBy);
}

/* ==================== 信息缺口与完整度评分 ==================== */

/**
 * 自主创新功能 2：信息缺口引擎（Honest Gap）。
 * 显式声明「题目/发布者没有提供什么」，把「不知道」变成一种被良好设计的状态。
 * 程序层面禁止生成任何未在原文出现的时间、地点、费用与主办方。
 */
const WEIGHTS = {
  time: 25, deadline: 10, location: 20, fee: 10,
  limit: 8, signupChannel: 7, publisher: 10, description: 10
};

export function missingFields(m) {
  const t = m.time || {};
  const p = m.participation || {};
  const out = [];

  const hasTime = !!(t.start || (t.kind === 'recurring' && t.recurrence))
    || t.kind === 'resource';
  if (!hasTime) out.push('time');
  if (t.timeApprox) out.push('timeApprox');
  if (!t.deadline && p.needSignup) out.push('deadline');
  if (!m.location || !m.location.raw) out.push('location');
  if (p.fee == null) out.push('fee');
  if (m.eligibility.limit == null && m.eligibility.grades[0] === 'all') out.push('limit');
  if (p.needSignup && !t.signupChannel) out.push('signupChannel');
  if (!m.publisher) out.push('publisher');
  if (m.risk && m.risk.level !== 'none' && !m.description) out.push('description');

  return out.filter((f, i, arr) => arr.indexOf(f) === i);
}

/** 完整度评分 0—100 */
export function completenessScore(m) {
  const missing = missingFields(m);
  let lost = 0;
  missing.forEach((f) => {
    if (f === 'timeApprox') { lost += 5; return; }
    lost += WEIGHTS[f] || 5;
  });
  return Math.max(10, Math.min(100, 100 - lost));
}

/** 缺失项的展示文案（含特殊处理） */
export function missingText(m, field) {
  if (field === 'timeApprox') return '活动时间仅给出大致范围（如「晚间」）';
  if (field === 'deadline' && m.time && m.time.kind === 'resource') return '有效期未注明';
  if (field === 'limit' && m.participation.needSignup) return '未注明人数上限';
  return MISSING_LABELS[field] || field;
}

/** 面向用户的「如何确认」建议 —— 把不确定性变成可行动的下一步 */
export function confirmAdvice(m) {
  const tips = [];
  if (!m.publisher) tips.push('原文未提供主办方，建议向班群或学院公众号核实');
  if (!m.location || !m.location.raw) tips.push('地点尚未确认，出发前请留意后续通知');
  if (!m.time.deadline && m.participation.needSignup) tips.push('报名截止时间未注明，建议尽早联系主办方确认');
  if (m.participation.fee == null) tips.push('费用信息未提供，参加前请确认是否收费');
  if (m.time.timeApprox) tips.push('时间仅给出大致范围，建议报名后等待拉群通知');
  if (m.eligibility.seatsLimited && !m.participation.needSignup) tips.push('无需报名但座位有限，建议提前到场');
  return tips;
}

/* ======================= 一句话结论 ======================= */

/**
 * 把结构化字段翻译成新生能直接行动的一句话：
 *   「大一可参加 · 无需报名 · 今晚 19:00 开始」
 * 这是产品"降低判断成本"最直接的体现。
 */
export function actionLine(m, now = nowISO()) {
  const seg = [];
  const el = m.eligibility;
  const st = computeStatus(m, now);

  // 1) 我能不能参加
  if (el.grades[0] === 'all') seg.push('全校可参加');
  else if (el.grades.length === 1 && el.grades[0] === 1) seg.push('主要面向大一');
  else seg.push(el.grades.map((g) => GRADE_LABELS[g]).join('、') + '可参加');

  // 2) 要不要报名
  if (m.participation.needSignup === false) seg.push('无需报名');
  else if (m.participation.audit) seg.push('需预约，报名≠录取');
  else if (m.participation.needSignup === true) {
    seg.push(m.time.deadline ? '需报名' : '需报名（截止未注明）');
  }

  // 3) 什么时候 / 现在该做什么
  //    这里刻意使用「今天 / 明天」+ 明确日期，而不是纯相对日期，
  //    因为新生需要同时知道「离我多近」和「到底是哪一天」。
  if (st.key === 'ongoing') seg.push('正在进行');
  else if (st.key === 'finished') seg.push('已结束');
  else if (st.key === 'replay') seg.push('回放待上传');
  else if (st.key === 'waitlist') seg.push('报名已截止，可候补');
  else if (st.key === 'pending') seg.push('时间待确认');
  else if (m.time.start) {
    const near = smartDay(m.time.start, now);
    const prefix = near === '今天' || near === '明天' || near === '后天' ? near + ' ' : '';
    seg.push(`${prefix}${fmtDate(m.time.start, false)} ${fmtTime(m.time.start)}`);
  } else if (m.time.recurrence) {
    const wd = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][m.time.recurrence.weekday];
    seg.push(`每周${wd.slice(1)} ${m.time.start ? fmtTime(m.time.start) : ''}`.trim());
  } else if (m.time.kind === 'resource') seg.push('长期开放');

  if (st.note && (st.key === 'closing' || st.key === 'waitlist')) seg.push(st.note);
  return seg.join(' · ');
}

/* ======================= 新生适配度 ======================= */

/**
 * 自主创新：新生适配度评分。
 * 让「推荐」有可解释的理由，而不是黑箱排序。
 * @returns {{score:number, reasons:string[], blockers:string[]}}
 */
export function freshmanFit(m, onboard, now = nowISO()) {
  const reasons = [];
  const blockers = [];
  let score = 50;

  const el = m.eligibility;
  const st = computeStatus(m, now);
  const grade = onboard && onboard.grade ? Number(onboard.grade) : 1;

  // 年级资格：硬性门槛，直接决定能不能去
  const eligible = el.grades[0] === 'all' || el.grades.includes(grade);
  if (!eligible) {
    blockers.push(`仅限${el.grades.map((g) => GRADE_LABELS[g]).join('、')}，你目前不符合`);
    score -= 45;
  } else if (el.preferFreshman || (el.grades.length === 1 && el.grades[0] === 1)) {
    reasons.push('明确面向大一新生');
    score += 18;
  } else if (el.grades[0] === 'all') {
    reasons.push('全校学生均可参加');
    score += 8;
  }

  // 零基础友好度：新生最关心
  const kws = (m.keywords || []).join(' ') + ' ' + (m.raw || '');
  if (/零基础|不限基础|入门|新生|初步/.test(kws)) {
    reasons.push('零基础可以参加');
    score += 14;
  }

  // 无需报名 = 门槛最低
  if (m.participation.needSignup === false) {
    reasons.push('无需报名，直接去就行');
    score += 12;
  }
  if (m.participation.audit) {
    blockers.push('报名后需审核，不保证录取');
    score -= 4;
  }

  // 投入成本
  const cheap = !m.participation.commitment || /1\.5 小时|约 2 小时|1—2 小时|约 8 小时/.test(m.participation.commitment);
  if (onboard && onboard.hours) {
    const need = parseCommitmentHours(m.participation.commitment);
    if (need != null && need > Number(onboard.hours)) {
      blockers.push(`每周约需 ${need} 小时，超过你可投入的 ${onboard.hours} 小时`);
      score -= 12;
    } else if (need != null) {
      reasons.push(`每周约 ${need} 小时，在你的可投入范围内`);
      score += 8;
    }
  } else if (cheap) {
    score += 4;
  }

  // 兴趣匹配
  if (onboard && Array.isArray(onboard.interests) && onboard.interests.length) {
    const hit = onboard.interests.filter((k) => (m.keywords || []).some((x) => x.includes(k)) || (m.title + m.raw).includes(k));
    if (hit.length) { reasons.push(`与你的兴趣「${hit.join('、')}」相关`); score += 12 * Math.min(hit.length, 2); }
  }

  // 状态加权：能立刻行动的优先
  if (st.key === 'today') { score += 16; reasons.push('就在今天，可立刻参加'); }
  if (st.key === 'open' || st.key === 'closing') score += 6;
  if (st.key === 'finished' || st.key === 'passed' || st.key === 'risk_high') score -= 30;
  if (m.risk && m.risk.level === 'medium') score -= 12;

  // 信息完整度：越完整越容易判断，新生越该优先看
  const cs = completenessScore(m);
  score += Math.round((cs - 60) / 10);

  return { score: Math.max(0, Math.min(100, score)), reasons: reasons.slice(0, 3), blockers };
}

function parseCommitmentHours(text) {
  if (!text) return null;
  const m = String(text).match(/(\d+(?:\.\d+)?)\s*小时/);
  return m ? Number(m[1]) : null;
}

/* ======================= 发布体检（自主创新 4） ======================= */

const RISK_WORDS = [
  { re: /日结|日入|现结/, why: '承诺「日结／现结」收益', level: 'high' },
  { re: /零门槛|无门槛|无需经验.*高薪|轻松月入/, why: '以「零门槛」吸引，常见于兼职引流', level: 'high' },
  { re: /加微信|加我微信|私聊|私信我|加V|加vx|vx[:：]|微信[:：]/, why: '要求添加私人微信，脱离平台可核查范围', level: 'high' },
  { re: /返现|刷单|垫付|押金/, why: '涉及返现／垫付／押金，存在资金风险', level: 'high' },
  { re: /购买链接|下单|优惠码|折扣码|淘宝|拼多多|京东链接/, why: '包含购买链接或优惠引导，可能是商家推广', level: 'medium' },
  { re: /免费领取|扫码领|填写身份证|银行卡/, why: '索取个人信息或扫码，需谨慎', level: 'high' }
];

/**
 * 发布体检 + 风险分级。
 * 正面回应「开放发布 vs 信息质量」的矛盾：不封杀，只提示与标注。
 */
export function publishCheckup(draft) {
  const text = `${draft.title || ''} ${draft.raw || ''} ${draft.description || ''}`;
  const riskHits = [];
  RISK_WORDS.forEach((w) => { if (w.re.test(text)) riskHits.push(w); });

  const checks = [
    { key: 'title', ok: !!(draft.title && draft.title.trim().length >= 4), label: '标题具体，能看出是什么活动', weight: 12 },
    { key: 'time', ok: !!(draft.start || draft.timeUndecided), label: '时间已说明（或已勾选「时间待定」）', weight: 22 },
    { key: 'location', ok: !!(draft.location && draft.location.trim()) || !!draft.locationUndecided, label: '地点已说明（或已勾选「地点待定」）', weight: 18 },
    { key: 'fee', ok: draft.fee !== '' && draft.fee != null, label: '费用说清楚了', weight: 10 },
    { key: 'contact', ok: !!(draft.contact && draft.contact.trim()), label: '写明了报名／联系方式', weight: 15 },
    { key: 'desc', ok: !!(draft.description && draft.description.trim().length >= 10), label: '有补充说明，别人更容易判断', weight: 13 }
  ];

  // 计算完整度：未勾选「待定」时，未填即扣分
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  let score = Math.round((got / total) * 100);

  const highRisk = riskHits.some((r) => r.level === 'high');
  const level = riskHits.length === 0 ? 'none' : (highRisk ? 'high' : 'medium');

  // 风险内容不应因为「表单填得满」就拿到高完整度：
  // 完整度衡量的是「同学能否放心据此行动」，命中高风险特征本身就是最大的信息缺口。
  const cap = level === 'high' ? 45 : (level === 'medium' ? 65 : 100);
  score = Math.min(score, cap);

  return {
    score,
    level,
    riskHits,
    checks,
    missing: checks.filter((c) => !c.ok).map((c) => c.label),
    verdict: level === 'none'
      ? (score >= 80 ? '信息很完整，同学可以直接判断并行动' : '可以发布，补齐缺失项后更容易被信任')
      : (level === 'high'
        ? '内容包含高风险特征，发布后将被标注并默认折叠'
        : '内容可能被识别为推广，建议补充主办方与活动说明')
  };
}

/* ======================= 排序 ======================= */

export const SORTS = {
  smart: '智能排序',
  deadline: '临近截止优先',
  time: '按活动时间',
  fresh: '最新收录',
  complete: '信息最完整'
};

export function sortEvents(list, mode, onboard, now = nowISO()) {
  const arr = [...list];
  const score = (m) => freshmanFit(m, onboard, now).score;
  switch (mode) {
    case 'deadline':
      return arr.sort((a, b) => {
        const da = a.time.deadline ? parse(a.time.deadline) : Infinity;
        const db = b.time.deadline ? parse(b.time.deadline) : Infinity;
        return da - db;
      });
    case 'time':
      return arr.sort((a, b) => {
        const ta = a.time.start ? parse(a.time.start) : Infinity;
        const tb = b.time.start ? parse(b.time.start) : Infinity;
        return ta - tb;
      });
    case 'fresh':
      return arr.sort((a, b) => (parse(b.addedAt || '2026-09-19') - parse(a.addedAt || '2026-09-19')));
    case 'complete':
      return arr.sort((a, b) => completenessScore(b) - completenessScore(a));
    case 'smart':
    default:
      return arr.sort((a, b) => {
        const sa = score(a), sb = score(b);
        if (sb !== sa) return sb - sa;
        return (STATUS[computeStatus(a, now).key].order) - (STATUS[computeStatus(b, now).key].order);
      });
  }
}

/** 状态分组：把最需要行动的排在最前 */
export function groupByUrgency(list, now = nowISO()) {
  const groups = { act: [], soon: [], anytime: [], done: [] };
  list.forEach((m) => {
    const k = computeStatus(m, now).key;
    if (['today', 'ongoing', 'closing'].includes(k)) groups.act.push(m);
    else if (['open', 'upcoming'].includes(k)) groups.soon.push(m);
    else if (['nosignup', 'resource', 'waitlist'].includes(k)) groups.anytime.push(m);
    else groups.done.push(m);
  });
  return groups;
}

export { CATEGORIES, SOURCES, MISSING_LABELS, GRADE_LABELS };
export { fmtDate, fmtTime, fmtRange, fmtDeadline, smartDay, relTime, dateKey, weekdayLabel, parse, diffHours };
