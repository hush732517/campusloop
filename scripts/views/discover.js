/**
 * 发现页 —— 核心功能 A：浏览、定位并理解信息
 * ------------------------------------------------------------------
 * 设计要点：
 *  1. 搜索 + 多维筛选（分类 / 来源 / 状态）+ 5 种排序，满足基础要求 3。
 *  2. 卡片采用「来源色条 + 状态徽标 + 一句话结论」三段式，降低新生判断成本。
 *  3. 信息质量与可信度问题在列表层就被暴露：
 *     - 缺信息的条目标「待确认」，不会伪装成完整信息；
 *     - 高风险内容默认折叠，需用户主动展开（创新 4 的展示侧）。
 */

import {
  STATUS, computeStatus, completenessScore, missingFields, actionLine,
  freshmanFit, sortEvents, groupByUrgency, allMerged, visibleMerged, SORTS
} from '../model.js';
import { CATEGORIES, SOURCES } from '../../data/events.js';
import { store } from '../store.js';
import { nowISO, dateKey, fmtTime, fmtDate, weekdayLabel, smartDay, relTime, parse } from '../util.js';
import { esc, badge, sourceTag, emptyState, toast } from '../ui.js';

/** 视图局部状态（筛选条件），每次重渲染后由 render 恢复 */
const ui = {
  q: '',
  category: 'all',
  source: 'all',
  quick: 'all',
  sort: 'smart',
  showRisk: false,
  scrollY: 0
};

export function resetDiscoverState() {
  ui.q = ''; ui.category = 'all'; ui.source = 'all';
  ui.quick = 'all'; ui.sort = 'smart'; ui.showRisk = false;
}

/* --------------------------- 筛选逻辑 --------------------------- */

const QUICK = {
  all: { label: '全部', test: () => true },
  today: { label: '今天能去', test: (m, now) => {
    const k = computeStatus(m, now).key;
    return k === 'today' || k === 'ongoing';
  } },
  nosignup: { label: '不用报名', test: (m) => m.participation.needSignup === false },
  student: { label: '同学发起', test: (m) => m.source === 'student' },
  fitting: { label: '适合新生', test: (m, now, onboard) =>
    m.eligibility.grades[0] === 'all' || m.eligibility.grades.includes(Number(onboard?.grade || 1)) },
  gap: { label: '信息待确认', test: (m) => missingFields(m).length > 0 },
  changed: { label: '信息有更新', test: (m) => (m.changeCount || 0) > 0 || !!m.amendedBy }
};

function applyFilters(list, now, onboard) {
  const q = ui.q.trim().toLowerCase();
  return list.filter((m) => {
    if (m.risk && m.risk.level === 'high' && !ui.showRisk) return false;
    if (ui.category !== 'all' && m.category !== ui.category) return false;
    if (ui.source !== 'all' && m.source !== ui.source) return false;

    const quick = QUICK[ui.quick] || QUICK.all;
    if (!quick.test(m, now, onboard)) return false;

    if (q) {
      const hay = `${m.title} ${m.raw} ${(m.keywords || []).join(' ')} ${m.publisher || ''} ${CATEGORIES[m.category]?.label || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* --------------------------- 卡片渲染 --------------------------- */

function cardHtml(m, now, onboard, opts = {}) {
  const st = computeStatus(m, now);
  const score = completenessScore(m);
  const gap = missingFields(m);
  const fit = freshmanFit(m, onboard, now);
  const favorited = store.has('favorites', m.id);
  const signed = store.has('signups', m.id);
  const changed = (m.changeCount || 0) > 0 || !!m.amendedBy;
  const isRisk = m.risk && m.risk.level !== 'none';
  const mutedCls = (st.key === 'finished' || st.key === 'passed') ? ' card--muted' : '';
  const riskCls = m.risk && m.risk.level === 'high' ? ' card--risk' : '';

  const meta = [];
  if (m.location && m.location.raw) meta.push(`<span><i>📍</i> ${esc(m.location.raw)}</span>`);
  if (m.time.deadline) {
    const passed = parse(m.time.deadline) < parse(now);
    meta.push(`<span${passed ? '' : ' class="meta-urgent"'}><i>⏳</i> ${passed ? '报名已截止' : `${smartDay(m.time.deadline, now)} ${fmtTime(m.time.deadline)} 截止 · ${relTime(m.time.deadline, now)}`}</span>`);
  } else if (m.participation.needSignup) {
    meta.push('<span><i>⏳</i> 报名截止未注明</span>');
  }
  if (m.participation.commitment) meta.push(`<span><i>🕐</i> ${esc(m.participation.commitment)}</span>`);
  if (m.eligibility.limit) meta.push(`<span><i>👥</i> 限 ${m.eligibility.limit} 人</span>`);

  const flags = [];
  if (changed) flags.push(badge('🔄 信息已更新', 'accent'));
  if (gap.length && !opts.compact) flags.push(badge(`⚠ ${gap.length} 项待确认`, 'pending'));
  else if (gap.length) flags.push(badge('待确认', 'pending'));
  if (isRisk) flags.push(badge(m.risk.level === 'high' ? '高风险' : '疑似推广', 'risk'));
  if (m.recruitNote) flags.push(badge('开发岗已满', 'warn'));
  if (signed) flags.push(badge('✓ 已报名', 'ok'));
  if (favorited) flags.push(badge('★ 已收藏', 'blue'));

  return `
  <article class="card card--${m.source}${mutedCls}${riskCls}"
           data-card="${esc(m.id)}" tabindex="0" role="button"
           aria-label="${esc(m.title)}，${esc(st.label)}">
    <div class="card__top">
      <h3 class="card__title">${esc(m.title)}</h3>
      <span class="badge badge--${st.tone}">${esc(st.label)}</span>
    </div>
    <p class="card__concl">${esc(actionLine(m, now))}</p>
    <div class="card__meta">${meta.join('')}</div>
    ${flags.length ? `<div class="card__flags">${flags.join('')}</div>` : ''}
    ${opts.showFit && fit.reasons.length ? `<div class="fit">${fit.reasons.map((r) => `<span class="fit__reason">${esc(r)}</span>`).join('')}${fit.blockers.map((r) => `<span class="fit__block">✕ ${esc(r)}</span>`).join('')}</div>` : ''}
  </article>`;
}

/** 高风险内容的折叠占位：不隐藏问题，而是让用户知情后自行决定 */
function riskFoldHtml(list) {
  return `
  <div class="panel">
    <div class="notice notice--risk">
      <span class="notice__icon">⚠</span>
      <div class="notice__body">
        <div class="notice__title">${list.length} 条内容已被折叠（可能不是真实校园活动）</div>
        这些内容来自学生自主发布，但缺少可核实信息，或带有推广、引流特征。
        平台不删除它们，但默认不展示，避免同学被误导。
      </div>
    </div>
    <div style="margin-top:12px">
      <button class="btn btn--ghost btn--sm" data-act="show-risk">我了解风险，仍要查看（${list.length} 条）</button>
    </div>
  </div>`;
}

/* --------------------------- 主渲染 --------------------------- */

export function renderDiscover(root, ctx) {
  const now = nowISO();
  const onboard = store.get('onboard');
  // 注意：这里用 visibleMerged()，已被补充通知覆盖的原始条目不再单独出现，
  // 因此「同一件事只占一张卡片」，用户不会照着过期信息行动。
  const all = visibleMerged();

  const highRisk = all.filter((m) => m.risk && m.risk.level === 'high');
  if (ui.showRisk) highRisk.forEach((m) => { /* 已展开则参与正常列表 */ });

  const filtered = applyFilters(all, now, onboard);
  const sorted = sortEvents(filtered, ui.sort, onboard, now);
  const visible = sorted.filter((m) => !(m.risk && m.risk.level === 'high') || ui.showRisk);
  const foldedRisk = ui.showRisk ? [] : highRisk;

  // 今日精选：只在当天有活动时展示
  const todayList = all
    .filter((m) => {
      const s = m.time.start;
      if (s && dateKey(s) === dateKey(now)) return true;
      if (m.time.kind === 'recurring' && m.time.recurrence) {
        return (m.time.recurrence.startDate === dateKey(now));
      }
      return false;
    })
    .filter((m) => !(m.risk && m.risk.level === 'high') || ui.showRisk)
    .sort((a, b) => parse(a.time.start || '2026-09-19T23:59') - parse(b.time.start || '2026-09-19T23:59'));

  const groups = groupByUrgency(visible, now);

  const sec = (title, hint, list, opts = {}) => list.length === 0 ? '' : `
    <section class="section">
      <div class="section__head">
        <h2 class="section__title">${esc(title)}</h2>
        <span class="section__hint">${esc(hint)}</span>
      </div>
      <div class="cards">${list.map((m) => cardHtml(m, now, onboard, opts)).join('')}</div>
    </section>`;

  root.innerHTML = `
    ${ctx.clockAlert || ''}

    ${onboard ? '' : onboardBlock()}

    <section class="section">
      <div class="search">
        <span class="search__icon" aria-hidden="true">🔍</span>
        <input class="search__input" id="q" type="search" placeholder="搜活动、招募、竞赛、关键词…"
               value="${esc(ui.q)}" aria-label="搜索校园活动">
        ${ui.q ? '<button class="search__clear" data-act="clear-q" aria-label="清空搜索">✕</button>' : ''}
      </div>

      <div class="chips" role="group" aria-label="快捷筛选" style="margin-top:12px">
        ${Object.entries(QUICK).map(([k, v]) =>
          `<button class="chip" data-quick="${k}" aria-pressed="${ui.quick === k}">${esc(v.label)}</button>`).join('')}
      </div>

      <div class="chips" role="group" aria-label="按分类筛选">
        <button class="chip" data-cat="all" aria-pressed="${ui.category === 'all'}">全部分类</button>
        ${Object.entries(CATEGORIES).map(([k, v]) =>
          `<button class="chip" data-cat="${k}" aria-pressed="${ui.category === k}">${v.icon} ${esc(v.label)}</button>`).join('')}
      </div>

      <div class="chips" role="group" aria-label="按来源筛选">
        <button class="chip" data-src="all" aria-pressed="${ui.source === 'all'}">全部来源</button>
        ${Object.entries(SOURCES).map(([k, v]) =>
          `<button class="chip chip--${k}" data-src="${k}" aria-pressed="${ui.source === k}">${v.icon} ${esc(v.label)}</button>`).join('')}
      </div>

      <div class="filterbar">
        <label class="field-inline">排序
          <select class="select" id="sort" aria-label="排序方式">
            ${Object.entries(SORTS).map(([k, v]) =>
              `<option value="${k}"${ui.sort === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </label>
        <span class="field-inline">共 <b id="resultCount">${visible.length}</b> 条结果</span>
        ${(ui.q || ui.category !== 'all' || ui.source !== 'all' || ui.quick !== 'all')
          ? '<button class="btn btn--ghost btn--sm" data-act="reset">清空筛选</button>' : ''}
      </div>
    </section>

    ${todayList.length ? `
    <section class="section">
      <div class="section__head">
        <h2 class="section__title">📌 今天（${fmtDate(now, false)} ${weekdayLabel(now)}）有 ${todayList.length} 场</h2>
        <span class="section__hint">按开始时间排序 · 注意时间是否冲突</span>
      </div>
      <div class="cards">${todayList.map((m) => cardHtml(m, now, onboard, { compact: true })).join('')}</div>
      ${todayClashHint(todayList, now)}
    </section>` : ''}

    ${visible.length === 0 ? emptyState({
      icon: '🔍',
      title: '没有符合条件的活动',
      hint: '试试更换关键词，或清空筛选条件查看全部 26 条校园信息。',
      action: '<button class="btn btn--soft" data-act="reset">清空筛选条件</button>'
    }) : `
      ${sec('⚡ 需要你现在处理', '今天开始 / 24 小时内截止 / 正在进行', groups.act)}
      ${sec('📝 报名进行中', '还有时间考虑，但别错过截止', groups.soon, { showFit: true })}
      ${sec('🌿 随时可以参与', '无需报名或长期开放', groups.anytime)}
      ${sec('🗄 已结束 / 已截止', '可查看回放或等待下次', groups.done)}
    `}

    ${foldedRisk.length ? `<section class="section">${riskFoldHtml(foldedRisk)}</section>` : ''}

    <section class="section">
      ${dataNote(all)}
    </section>
  `;

  bind(root, ctx);
  restoreFocus(root);
  window.scrollTo(0, ui.scrollY);
}

/* ------------------------ 今日冲突提示（创新 3） ------------------------ */

function todayClashHint(list, now) {
  const tips = [];
  const timed = list.filter((m) => m.time.start && m.time.kind === 'onetime');
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const A = timed[i], B = timed[j];
      const ae = A.time.end || new Date(parse(A.time.start) + (A.time.durationMin || 90) * 60000).toISOString().slice(0, 16);
      const be = B.time.end || new Date(parse(B.time.start) + (B.time.durationMin || 90) * 60000).toISOString().slice(0, 16);
      if (Math.min(parse(ae), parse(be)) > Math.max(parse(A.time.start), parse(B.time.start))) {
        tips.push(`${A.title}（${fmtTime(A.time.start)}）与 ${B.title}（${fmtTime(B.time.start)}）时间重叠`);
      }
    }
  }
  if (!tips.length) return '';
  return `
    <div class="clash-tip" style="margin-top:12px">
      <span aria-hidden="true">⚠</span>
      <div>
        <b>时间冲突提醒</b>
        <ul style="margin-top:4px">
          ${tips.map((t) => `<li>· ${esc(t)}</li>`).join('')}
        </ul>
        <div style="margin-top:4px">建议二选一，避免报名后无法到场。</div>
      </div>
    </div>`;
}

/* --------------------------- 数据说明 --------------------------- */

function dataNote(all) {
  const official = all.filter((m) => m.source === 'official').length;
  const org = all.filter((m) => m.source === 'org').length;
  const student = all.filter((m) => m.source === 'student').length;
  const gap = all.filter((m) => missingFields(m).length > 0).length;
  const risk = all.filter((m) => m.risk && m.risk.level !== 'none').length;
  const merged = all.filter((m) => (m.changeCount || 0) > 0).length;
  return `
    <div class="panel">
      <div class="panel__title">📊 本平台信息体检</div>
      <div class="stats">
        <div class="stat"><div class="stat__num">${all.length}</div><div class="stat__label">有效信息</div></div>
        <div class="stat"><div class="stat__num stat__num--ok">${official + org}</div><div class="stat__label">官方 / 赛事发布</div></div>
        <div class="stat"><div class="stat__num stat__num--warn">${student}</div><div class="stat__label">同学自主发布</div></div>
        <div class="stat"><div class="stat__num stat__num--risk">${risk}</div><div class="stat__label">可信度待核实</div></div>
      </div>
      <p class="form__hint" style="margin-top:12px">
        题目提供的 26 条材料中，有 <b>${merged}</b> 条已被后续补充通知更新，这里只展示<b>合并后的最新版本</b>；
        另有 <b>${gap}</b> 条存在未注明信息（时间、地点、截止时间或费用），一律标注「待确认」，
        <b>不代替主办方补全任何信息</b>。数据为考核模拟信息，不代表学校真实通知。
      </p>
    </div>`;
}

/* --------------------------- 新生引导 --------------------------- */

function onboardBlock() {
  return `
  <section class="section">
    <div class="onboard" id="onboard">
      <div class="onboard__title">👋 第一次来？30 秒告诉我们你的情况</div>
      <div class="onboard__hint">我们会优先推荐你<b>确实能参加</b>的活动，并给出推荐理由。信息只保存在本机。</div>

      <div class="onboard__field">
        <span class="onboard__label">你的年级</span>
        <div class="radiogroup" data-group="grade">
          ${['1', '2', '3', '4'].map((g) =>
            `<button class="radio-pill" data-grade="${g}" aria-pressed="${g === '1'}">${['大一', '大二', '大三', '大四'][Number(g) - 1]}</button>`).join('')}
        </div>
      </div>

      <div class="onboard__field">
        <span class="onboard__label">感兴趣的方向 <small style="font-weight:400;color:var(--ink-3)">可多选</small></span>
        <div class="radiogroup" data-group="interests">
          ${['AI', '前端', '算法', '网络安全', '科研', '志愿', '竞赛', '羽毛球'].map((k) =>
            `<button class="radio-pill" data-interest="${k}" aria-pressed="false">${k}</button>`).join('')}
        </div>
      </div>

      <div class="onboard__field">
        <span class="onboard__label">每周可投入时间</span>
        <div class="radiogroup" data-group="hours">
          ${['2', '5', '10'].map((h, i) =>
            `<button class="radio-pill" data-hours="${h}" aria-pressed="${i === 1}">${['2 小时以内', '5 小时左右', '10 小时以上'][i]}</button>`).join('')}
        </div>
      </div>

      <div class="toolbar">
        <button class="btn btn--primary" data-act="save-onboard">开始使用</button>
        <button class="btn btn--ghost" data-act="skip-onboard">先随便看看</button>
      </div>
    </div>
  </section>`;
}

/* --------------------------- 事件绑定 --------------------------- */

function bind(root, ctx) {
  // 打开详情
  root.querySelectorAll('[data-card]').forEach((el) => {
    const go = () => { ui.scrollY = window.scrollY; ctx.go(`#/event/${el.dataset.card}`); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  // 搜索（保留焦点与光标位置）
  const q = root.querySelector('#q');
  if (q) {
    q.addEventListener('input', () => {
      ui.q = q.value;
      rerender(root, ctx, () => {
        const nq = root.querySelector('#q');
        if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); }
      });
    });
  }

  root.querySelector('#sort')?.addEventListener('change', (e) => {
    ui.sort = e.target.value; rerender(root, ctx);
  });

  root.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    ui.category = ui.category === b.dataset.cat ? 'all' : b.dataset.cat; rerender(root, ctx);
  }));
  root.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => {
    ui.source = ui.source === b.dataset.src ? 'all' : b.dataset.src; rerender(root, ctx);
  }));
  root.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => {
    ui.quick = ui.quick === b.dataset.quick ? 'all' : b.dataset.quick; rerender(root, ctx);
  }));

  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'clear-q') { ui.q = ''; rerender(root, ctx); }
    if (act === 'reset') { resetDiscoverState(); rerender(root, ctx); toast('已清空筛选条件'); }
    if (act === 'show-risk') { ui.showRisk = true; rerender(root, ctx); }
    if (act === 'skip-onboard') {
      store.set('onboard', { grade: 1, interests: [], hours: 5, skipped: true, doneAt: nowISO() });
      rerender(root, ctx); ctx.refreshChrome();
    }
    if (act === 'save-onboard') saveOnboard(root, ctx);
  }));

  // 新生引导的选项状态（本地暂存于 dataset，避免每次点击都整页重渲染）
  const onboard = root.querySelector('#onboard');
  if (onboard) {
    onboard.dataset.grade = '1';
    onboard.dataset.hours = '5';
    onboard.dataset.interests = '';
    onboard.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', () => {
      onboard.querySelectorAll('[data-grade]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      onboard.dataset.grade = b.dataset.grade;
    }));
    onboard.querySelectorAll('[data-hours]').forEach((b) => b.addEventListener('click', () => {
      onboard.querySelectorAll('[data-hours]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      onboard.dataset.hours = b.dataset.hours;
    }));
    onboard.querySelectorAll('[data-interest]').forEach((b) => b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', String(!on));
      const cur = new Set((onboard.dataset.interests || '').split(',').filter(Boolean));
      if (on) cur.delete(b.dataset.interest); else cur.add(b.dataset.interest);
      onboard.dataset.interests = Array.from(cur).join(',');
    }));
  }
}

function saveOnboard(root, ctx) {
  const ob = root.querySelector('#onboard');
  const interests = (ob.dataset.interests || '').split(',').filter(Boolean);
  store.set('onboard', {
    grade: Number(ob.dataset.grade || 1),
    hours: Number(ob.dataset.hours || 5),
    interests,
    doneAt: nowISO()
  });
  toast('已按你的情况重新排序，推荐理由会显示在卡片上', 'ok');
  rerender(root, ctx);
  ctx.refreshChrome();
}

/** 重渲染并可选地在之后执行回调（用于恢复焦点） */
function rerender(root, ctx, after) {
  ui.scrollY = window.scrollY;
  renderDiscover(root, ctx);
  if (after) after();
}

function restoreFocus() { /* 焦点由各交互自行恢复，这里保留钩子 */ }
