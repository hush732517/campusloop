/**
 * 日历页 —— 自主创新功能 3：时间轴与撞车检测
 * ------------------------------------------------------------------
 * 题目材料里存在真实的撞车（9/19 晚 19:00 与 19:30、9/21 晚 19:00—20:30 与 19:30），
 * 但题目完全没有提示。
 *
 * 可视化设计（三层，逐层回答不同的问题）：
 *   第一层「未来 N 天密度条」：一眼看出哪几天活动密集、哪天有冲突。
 *   第二层「甘特式时间轴」：横轴是时间，块的左右边界就是开始与结束，
 *     互相重叠的活动自动并排成两列，重叠的时间段用斜纹危险色带标出——
 *     撞车不再需要读文字，图形本身就是证据。
 *   第三层「列表视图」：保留逐条文字（含地点、状态、周期场次），
 *     供需要细节时切换，也保证小屏下的可读性。
 *
 * 图形与列表共用同一份布局数据（时间窗 / 列分配 / 重叠区间），
 * 因此两者永远不会互相矛盾。
 */

import {
  allMerged, computeStatus, findClashes, occurrences, actionLine, visibleMerged,
  windowForDay, axisBounds, overlapIntervals, assignColumns, minutesLabel
} from '../model.js';
import { SOURCES } from '../../data/events.js';
import { store } from '../store.js';
import {
  nowISO, parse, dateKey, fmtDate, fmtTime, weekdayLabel, smartDay,
  addDays, minutesOf, toDate, relTime
} from '../util.js';
import { esc, badge, toast, emptyState } from '../ui.js';
import { exportICS } from './detail.js';

let rangeDays = 7;
let mode = 'chart';          // chart 图形 | list 列表
// 默认「紧凑」：校园活动高度集中在 10:00—22:00，全天刻度会把大半天画成空白，
// 反而看不出信息。紧凑模式按「所有天的最早开始 / 最晚结束」自动收紧时间范围，
// 需要建立一天的整体时间感时再切回全天。
let zoom = 'compact';        // compact 紧凑 | full 全天 08:00—23:00（各天刻度对齐）

const AXIS_HOUR_PX = 30;     // 每小时对应的像素高度
const PAD_TOP = 12;          // 时间轴顶部留白，避免紧贴顶部的块被裁切

export function renderCalendar(root, ctx) {
  const now = nowISO();
  const merged = allMerged();
  const clashes = findClashes(merged, now, rangeDays);

  const clashKeys = new Set();
  clashes.forEach((c) => {
    clashKeys.add(`${c.day}|${c.a.id}`);
    clashKeys.add(`${c.day}|${c.b.id}`);
  });

  // ---- 收集窗口内每一天的日程 ----
  const days = [];
  for (let i = 0; i < rangeDays; i++) {
    days.push({ key: addDays(now, i).slice(0, 10), sessions: [], deadlines: [] });
  }
  const dayIndex = new Map(days.map((d) => [d.key, d]));

  visibleMerged().forEach((m) => {
    if (m.risk && m.risk.level === 'high') return;

    if (m.time.kind === 'recurring') {
      // 周期活动：每一次场次单独成块
      occurrences(m, addDays(now, rangeDays)).forEach((s) => {
        const d = dayIndex.get(dateKey(s));
        if (!d) return;
        const w = windowForDay({ ...m, time: { ...m.time, start: s, end: null } }, d.key);
        if (w) d.sessions.push({ m, startISO: s, ...w, recurring: true });
      });
    } else if (m.time.start) {
      const d = dayIndex.get(dateKey(m.time.start));
      const w = d ? windowForDay(m, d.key) : null;
      if (w) d.sessions.push({ m, startISO: m.time.start, ...w });
    }

    // 截止时间单独一行展示：它不是「要参加的活动」，画进时间轴会产生误导
    if (m.time.deadline) {
      const d = dayIndex.get(dateKey(m.time.deadline));
      if (d) {
        d.deadlines.push({
          m,
          atISO: m.time.deadline,
          startMin: minutesOf(m.time.deadline),
          isResourceExpiry: m.time.kind === 'resource'
        });
      }
    }
  });

  // 坐标轴：
  //  - 紧凑模式：每天按当天实际最早/最晚活动收紧（默认 08:00—23:00 封顶）。
  //    各天坐标轴不同，但每天的刻度都印在自己的卡片上，阅读时不存在歧义，
  //    换来的是「没有一分钟空白」，且不会出现无意义的裁切标记。
  //  - 全天模式：所有天共用 08:00—23:00，便于横向比较不同天的时间位置。
  const fullBounds = { lo: 8 * 60, hi: 23 * 60, span: 15 * 60 };

  days.forEach((d) => {
    d.sessions.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    d.cols = assignColumns(d.sessions);
    d.overlaps = overlapIntervals(d.sessions);
    d.deadlines.sort((a, b) => a.startMin - b.startMin);
    d.clashCount = clashes.filter((c) => c.day === d.key).length;
    // 今天额外把「当前时刻」纳入坐标轴：否则紧凑模式会把现在的时刻裁掉，
    // 用户就看不到「距离下一场活动还有多久」这段最重要的间隔。
    const dayWindows = d.key === dateKey(now)
      ? [...d.sessions, { startMin: minutesOf(now), endMin: minutesOf(now) + 1 }]
      : d.sessions;

    d.bounds = zoom === 'compact'
      ? axisBounds(dayWindows, 8 * 60, 23 * 60, false, 20)   // 不取整到整点，只留 20 分钟边距
      : fullBounds;
  });

  const activeDays = days.filter((d) => d.sessions.length || d.deadlines.length);
  const emptyDayCount = rangeDays - activeDays.length;

  root.innerHTML = `
    <section class="section">
      <div class="section__head">
        <h2 class="section__title">🗓 未来 ${rangeDays} 天日程</h2>
        <span class="section__hint">横轴为时间 · 重叠活动自动并排 · 斜纹处为真实冲突</span>
      </div>

      <div class="chips" role="group" aria-label="时间范围">
        ${[3, 7, 14].map((n) => `<button class="chip" data-range="${n}" aria-pressed="${rangeDays === n}">未来 ${n} 天</button>`).join('')}
        <button class="chip" data-act="export-all">📅 导出我的日程</button>
      </div>

      <div class="chips" role="group" aria-label="视图切换" style="margin-top:8px">
        <button class="chip" data-mode="chart" aria-pressed="${mode === 'chart'}">📊 时间轴图形</button>
        <button class="chip" data-mode="list" aria-pressed="${mode === 'list'}">📋 列表明细</button>
        ${mode === 'chart' ? `
          <button class="chip" data-zoom="compact" aria-pressed="${zoom === 'compact'}">紧凑（只看有安排的时段）</button>
          <button class="chip" data-zoom="full" aria-pressed="${zoom === 'full'}">全天 08:00–23:00</button>` : ''}
      </div>

      ${densityStrip(days, now)}

      ${clashes.length ? `
      <div class="clash-tip" style="margin-top:12px">
        <span aria-hidden="true">⚠</span>
        <div>
          <b>检测到 ${clashes.length} 组时间冲突</b>
          <ul style="margin-top:6px;display:grid;gap:6px">
            ${clashes.map((c) => `<li>
              <div><b>${esc(smartDay(c.day + 'T00:00', now))} ${esc(c.overlapText)}</b> 重叠约 ${c.overlapMin} 分钟</div>
              <div>${esc(c.a.title)} ⟷ ${esc(c.b.title)}</div>
              <div style="color:var(--ink-3)">${esc(c.advice)}</div>
            </li>`).join('')}
          </ul>
        </div>
      </div>` : `
      <div class="notice notice--ok" style="margin-top:12px">
        <span class="notice__icon">✓</span>
        <div class="notice__body"><div class="notice__title">未来 ${rangeDays} 天没有检测到时间冲突</div>
        你可以在这些活动里自由组合参加。</div>
      </div>`}
    </section>

    <section class="section">
      ${activeDays.length === 0
        ? emptyState({ icon: '🌤', title: `未来 ${rangeDays} 天没有安排活动`, hint: '试试把时间范围调大一些。' })
        : mode === 'chart'
          ? `<div class="tl-legend">${legendHtml()}</div>
             <div class="cal">${activeDays.map((d) => chartDayHtml(d, clashKeys, now)).join('')}</div>`
          : `<div class="cal">${activeDays.map((d) => listDayHtml(d, clashKeys, now)).join('')}</div>`}
      ${emptyDayCount ? `<p class="form__hint" style="margin-top:12px">另有 ${emptyDayCount} 天暂无安排。</p>` : ''}
    </section>
  `;

  bind(root, ctx, clashes);
}

/* ====================== 第一层：密度条 ====================== */

/**
 * 未来 N 天密度条：用柱高表示当天日程数量，冲突日用红色标示。
 * 解决「哪几天要提前安排」这个问题——翻 14 天列表时很难一眼看出来。
 */
function densityStrip(days, now) {
  const maxCount = Math.max(1, ...days.map((d) => d.sessions.length));
  return `
  <div class="density" role="img"
       aria-label="未来 ${days.length} 天每日活动数量与冲突情况">
    ${days.map((d) => {
      const n = d.sessions.length;
      const h = n ? Math.round((n / maxCount) * 100) : 0;
      const isToday = d.key === dateKey(now);
      const cls = [
        'density__col',
        isToday ? 'density__col--today' : '',
        d.clashCount ? 'density__col--clash' : ''
      ].filter(Boolean).join(' ');
      return `
      <div class="${cls}" title="${esc(fmtDate(d.key + 'T00:00'))}：${n} 场活动${d.clashCount ? `，${d.clashCount} 组冲突` : ''}">
        <span class="density__val">${n || ''}</span>
        <span class="density__bar" style="height:${h}%"></span>
        <span class="density__bar-spacer"></span>
        <span class="density__wd">${esc(weekdayLabel(d.key + 'T00:00').slice(1))}</span>
        <span class="density__day">${esc(d.key.slice(8))}</span>
      </div>`;
    }).join('')}
  </div>`;
}

/* ====================== 第二层：甘特时间轴 ====================== */

function legendHtml() {
  return `
    <span class="tl-legend__item"><i class="swatch swatch--official"></i>校／院官方</span>
    <span class="tl-legend__item"><i class="swatch swatch--org"></i>赛事／机构</span>
    <span class="tl-legend__item"><i class="swatch swatch--student"></i>同学发布</span>
    <span class="tl-legend__item"><i class="swatch swatch--hatch"></i>时间冲突区</span>
    <span class="tl-legend__item"><i class="swatch swatch--now"></i>当前时刻</span>`;
}

function chartDayHtml(d, clashKeys, now) {
  const isToday = d.key === dateKey(now);
  const bounds = d.bounds;
  const height = PAD_TOP + (bounds.span / 60) * AXIS_HOUR_PX;

  // 整点刻度：从 lo 之后的第一个整点开始。紧凑模式的 lo 可能落在 13:40 这种
  // 非整点位置，若直接从 lo 起算会得到 13:40 / 14:40 / 15:40 这类奇怪刻度，
  // 与用户对「时间轴按小时读」的预期不符。
  const ticks = [];
  for (let m = Math.ceil(bounds.lo / 60) * 60; m <= bounds.hi; m += 60) ticks.push(m);

  // 全天模式下顶部会留出「当天最早活动之前」的空白。
  // 用一条斜纹带明确标出这段被折叠的时间，避免空白被误读成「没有活动」。
  const trimTop = (zoom === 'full' && bounds.lo > 0) ? bounds.lo : 0;

  const nowLine = isToday ? nowMarker(bounds) : '';

  return `
  <div class="day${isToday ? ' day--today' : ''}">
    <div class="day__head">
      <span class="day__date">${esc(fmtDate(d.key + 'T00:00', false))}</span>
      <span class="day__wd">${esc(weekdayLabel(d.key + 'T00:00'))}${isToday ? ' · 今天' : ''}</span>
      ${d.clashCount ? `<span class="day__clash">⚠ ${d.clashCount} 组冲突</span>` : ''}
      <span class="day__count">${d.sessions.length} 场${d.deadlines.length ? ` · ${d.deadlines.length} 个截止` : ''}</span>
    </div>

    ${d.sessions.length ? `
    <div class="tl${trimTop ? ' tl--trimmed' : ''}" style="height:${height}px">
      <div class="tl__axis" aria-hidden="true">
        ${ticks.map((m) => `
          <div class="tl__tick" style="top:${pctToPx(m, bounds)}px">
            <span class="tl__tick-label">${minutesLabel(m)}</span>
          </div>`).join('')}
      </div>

      <div class="tl__lane">
        ${trimTop ? `<div class="tl__trim" aria-hidden="true"
            style="height:${(trimTop / 60) * AXIS_HOUR_PX}px"
            title="00:00—${minutesLabel(trimTop)} 无安排，已折叠"></div>` : ''}

        ${d.overlaps.map((iv) => `
          <div class="tl__overlap"
               style="top:${pctToPx(iv.start, bounds)}px;height:${Math.max(3, ((iv.end - iv.start) / 60) * AXIS_HOUR_PX)}px"
               title="冲突时段 ${minutesLabel(iv.start)}—${minutesLabel(iv.end)}"></div>`).join('')}

        ${d.sessions.map((s) => blockHtml(s, d, bounds, clashKeys, now)).join('')}
        ${nowLine}
      </div>
    </div>` : `
    <div class="day__body"><p class="form__hint" style="margin:0">
      ${d.deadlines.length
        ? '这一天没有需要参加的活动，但有报名截止，见下方。'
        : '这一天没有安排活动。'}
    </p></div>`}

    ${d.deadlines.length ? `<div class="dl-row">
      ${d.deadlines.map((x) => `
        <button class="dl-chip${x.isResourceExpiry ? ' dl-chip--soft' : ''}" data-card="${esc(x.m.id)}"
                title="${esc(x.m.title)}">
          <span>${x.isResourceExpiry ? '⌛' : '⏳'}</span>
          <span>${esc(minutesLabel(x.startMin))}</span>
          <span class="dl-chip__title">${esc(x.m.title)}</span>
          <span class="dl-chip__rel">${esc(relTime(x.atISO, now))}</span>
        </button>`).join('')}
    </div>` : ''}
  </div>`;
}

function pctToPx(min, bounds) {
  return PAD_TOP + ((min - bounds.lo) / 60) * AXIS_HOUR_PX;
}

/** 当前时刻的红色横线（仅当天显示），让「还剩多久」有直观参照 */
function nowMarker(bounds) {
  const m = minutesOf(nowISO());
  if (m < bounds.lo || m > bounds.hi) return '';
  return `<div class="tl__now" style="top:${pctToPx(m, bounds)}px">
    <span class="tl__now-dot"></span><span class="tl__now-label">现在 ${minutesLabel(m)}</span>
  </div>`;
}

function blockHtml(s, d, bounds, clashKeys, now) {
  const m = s.m;
  const st = computeStatus(m, now);
  const clash = clashKeys.has(`${d.key}|${m.id}`);
  const top = pctToPx(s.startMin, bounds);
  const h = Math.max(26, ((s.endMin - s.startMin) / 60) * AXIS_HOUR_PX - 3);
  const w = 100 / d.cols;
  const cutTop = s.startMin < bounds.lo;
  const cutBottom = s.endMin > bounds.hi;
  // 只有高度真的放不下两行时才并排显示（标题在左、时间在右）。
  // 阈值原先写成 44px，导致 42px 这种完全放得下两行的块也被并排，
  // 标题与时间被推到块的两端、中间留出大片空白，看起来像排版错乱。
  // 实测两行所需高度约 32px（标题 17px + 时间 13px + 内边距），故取 32。
  const shortCls = h < 32 ? ' tl-block--short' : '';

  const timeText = `${minutesLabel(s.startMin)}—${minutesLabel(s.endMin)}`;

  return `
  <div class="tl-block tl-block--${m.source}${clash ? ' tl-block--clash' : ''}${shortCls}"
       style="top:${top}px;height:${h}px;left:${s.col * w}%;width:calc(${w}% - 6px)"
       data-card="${esc(m.id)}" tabindex="0" role="button"
       aria-label="${esc(m.title)}，${esc(timeText)}${clash ? '，与其他活动时间冲突' : ''}，${esc(st.label)}">
    <span class="tl-block__title">${clash ? '⚠ ' : ''}${esc(m.title)}</span>
    <span class="tl-block__meta">${esc(timeText)}${shortCls ? '' : ` · ${esc(m.location?.raw || '地点待确认')}`}</span>
    ${s.recurring ? '<span class="tl-block__flag">周期</span>' : ''}
    ${cutTop ? '<span class="tl-block__cut tl-block__cut--top" title="开始时间早于显示范围"></span>' : ''}
    ${cutBottom ? '<span class="tl-block__cut tl-block__cut--bottom" title="结束时间晚于显示范围"></span>' : ''}
  </div>`;
}

/* ====================== 第三层：列表明细 ====================== */

function listDayHtml(d, clashKeys, now) {
  const isToday = d.key === dateKey(now);
  return `
  <div class="day${isToday ? ' day--today' : ''}">
    <div class="day__head">
      <span class="day__date">${esc(fmtDate(d.key + 'T00:00', false))}</span>
      <span class="day__wd">${esc(weekdayLabel(d.key + 'T00:00'))}${isToday ? ' · 今天' : ''}</span>
      ${d.clashCount ? `<span class="day__clash">⚠ ${d.clashCount} 组冲突</span>` : ''}
      <span class="day__count">${d.sessions.length} 场${d.deadlines.length ? ` · ${d.deadlines.length} 个截止` : ''}</span>
    </div>
    <div class="day__body">
      ${d.sessions.map((s) => {
        const m = s.m;
        const clash = clashKeys.has(`${d.key}|${m.id}`);
        const st = computeStatus(m, now);
        return `
        <div class="slot${clash ? ' slot--clash' : ''}" data-card="${esc(m.id)}" tabindex="0" role="button">
          <div class="slot__time">${esc(minutesLabel(s.startMin))}</div>
          <div>
            <div class="slot__title">
              ${clash ? '<span title="时间冲突" aria-label="时间冲突">⚠ </span>' : ''}${esc(m.title)}
              ${s.recurring ? '<span class="tag" style="margin-left:6px">周期场次</span>' : ''}
            </div>
            <div class="slot__sub">
              ${esc(SOURCES[m.source].short)} ·
              ${m.location?.raw ? esc(m.location.raw) : '地点待确认'}
              · ${esc(minutesLabel(s.startMin))}—${esc(minutesLabel(s.endMin))}
              · <span class="badge badge--${st.tone}" style="padding:0 6px">${esc(st.label)}</span>
            </div>
          </div>
        </div>`;
      }).join('')}
      ${d.deadlines.length ? `<div class="dl-row dl-row--inline">
        ${d.deadlines.map((x) => `
          <button class="dl-chip${x.isResourceExpiry ? ' dl-chip--soft' : ''}" data-card="${esc(x.m.id)}">
            <span>${x.isResourceExpiry ? '⌛' : '⏳'}</span>
            <span>${esc(minutesLabel(x.startMin))}</span>
            <span class="dl-chip__title">${esc(x.m.title)}</span>
          </button>`).join('')}
      </div>` : ''}
    </div>
  </div>`;
}

/* ====================== 绑定 ====================== */

function bind(root, ctx, clashes) {
  root.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    rangeDays = Number(b.dataset.range);
    renderCalendar(root, ctx);
  }));

  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    renderCalendar(root, ctx);
  }));

  root.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    zoom = b.dataset.zoom;
    renderCalendar(root, ctx);
  }));

  root.querySelectorAll('[data-card]').forEach((el) => {
    const go = () => ctx.go(`#/event/${el.dataset.card}`);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });

  root.querySelector('[data-act="export-all"]')?.addEventListener('click', () => {
    const ids = store.get('signups');
    const merged = allMerged();
    const list = merged.filter((m) => ids.includes(m.id));
    if (!list.length) {
      toast('「我的报名 / 日程」还是空的，先去收藏几个活动吧', 'warn');
      return;
    }
    exportICS(list);
  });
}
