/**
 * 日历页 —— 自主创新功能 3：时间轴与撞车检测
 * ------------------------------------------------------------------
 * 题目材料里存在真实的撞车（9/19 晚 19:00 与 19:30、9/21 晚 19:00—20:30 与 19:30），
 * 但题目完全没有提示。合并到「按天 + 时间轴」视图后，冲突一眼可见。
 */

import {
  allMerged, computeStatus, findClashes, occurrences, actionLine, visibleMerged
} from '../model.js';
import { SOURCES } from '../../data/events.js';
import { store } from '../store.js';
import { nowISO, parse, dateKey, fmtDate, fmtTime, weekdayLabel, smartDay, addDays, toDate, fmtRange } from '../util.js';
import { esc, badge, toast, emptyState } from '../ui.js';
import { exportICS } from './detail.js';

let rangeDays = 7;

export function renderCalendar(root, ctx) {
  const now = nowISO();
  const merged = allMerged();
  const clashes = findClashes(merged, now, rangeDays);
  const clashKeys = new Set();
  clashes.forEach((c) => {
    clashKeys.add(`${c.day}|${c.a.id}`);
    clashKeys.add(`${c.day}|${c.b.id}`);
  });

  // 收集窗口内每一天的活动（已被补充通知覆盖的原始条目不重复展示）
  const days = [];
  for (let i = 0; i < rangeDays; i++) {
    const dk = addDays(now, i).slice(0, 10);
    days.push({ key: dk, items: [] });
  }
  const dayIndex = new Map(days.map((d) => [d.key, d]));

  visibleMerged().forEach((m) => {
    if (m.risk && m.risk.level === 'high') return;
    if (m.time.kind === 'recurring') {
      occurrences(m, addDays(now, rangeDays)).forEach((s) => {
        const d = dayIndex.get(dateKey(s));
        if (d) d.items.push({ m, start: s, recurring: true });
      });
    } else if (m.time.start) {
      const d = dayIndex.get(dateKey(m.time.start));
      if (d) d.items.push({ m, start: m.time.start });
    }
    // 截止日期也作为一个「事件」提示
    if (m.time.deadline) {
      const d = dayIndex.get(dateKey(m.time.deadline));
      if (d && m.time.kind !== 'recurring') {
        d.items.push({ m, start: m.time.deadline, isDeadline: true });
      }
    }
  });

  days.forEach((d) => d.items.sort((a, b) => parse(a.start) - parse(b.start)));
  const activeDays = days.filter((d) => d.items.length);
  const emptyDayCount = rangeDays - activeDays.length;

  root.innerHTML = `
    <section class="section">
      <div class="section__head">
        <h2 class="section__title">🗓 时间轴（未来 ${rangeDays} 天）</h2>
        <span class="section__hint">按开始时间排列 · 冲突场次已高亮</span>
      </div>

      <div class="chips" role="group" aria-label="时间范围">
        ${[3, 7, 14].map((n) => `<button class="chip" data-range="${n}" aria-pressed="${rangeDays === n}">未来 ${n} 天</button>`).join('')}
        <button class="chip" data-act="export-all">📅 导出我的日程</button>
      </div>

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
        : `<div class="cal">${activeDays.map((d) => dayHtml(d, clashKeys, now)).join('')}</div>`}
      ${emptyDayCount ? `<p class="form__hint" style="margin-top:12px">另有 ${emptyDayCount} 天暂无活动安排。</p>` : ''}
    </section>
  `;

  bind(root, ctx, clashes);
}

function dayHtml(d, clashKeys, now) {
  const isToday = d.key === dateKey(now);
  return `
  <div class="day${isToday ? ' day--today' : ''}">
    <div class="day__head">
      <span class="day__date">${esc(fmtDate(d.key + 'T00:00', false))}</span>
      <span class="day__wd">${esc(weekdayLabel(d.key + 'T00:00'))}${isToday ? ' · 今天' : ''}</span>
      <span class="day__count">${d.items.length} 项</span>
    </div>
    <div class="day__body">
      ${d.items.map((it) => {
        const clash = clashKeys.has(`${d.key}|${it.m.id}`);
        const st = computeStatus(it.m, now);
        const timeLabel = it.isDeadline ? '截止' : fmtTime(it.start);
        return `
        <div class="slot${clash ? ' slot--clash' : ''}" data-card="${esc(it.m.id)}" tabindex="0" role="button">
          <div class="slot__time">${esc(timeLabel)}</div>
          <div>
            <div class="slot__title">
              ${clash ? '<span title="时间冲突" aria-label="时间冲突">⚠ </span>' : ''}${esc(it.m.title)}
              ${it.recurring ? '<span class="tag" style="margin-left:6px">周期场次</span>' : ''}
            </div>
            <div class="slot__sub">
              ${esc(SOURCES[it.m.source].short)} ·
              ${it.isDeadline ? '报名截止' : (it.m.location?.raw ? esc(it.m.location.raw) : '地点待确认')}
              · <span class="badge badge--${st.tone}" style="padding:0 6px">${esc(st.label)}</span>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function bind(root, ctx, clashes) {
  root.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    rangeDays = Number(b.dataset.range);
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
