/**
 * 详情页 —— 信息理解的核心承载页
 * ------------------------------------------------------------------
 * 这里集中体现三项自主创新：
 *  创新 1  通知合并视图：变更提示条 + 变更前/后对比 + 通知记录时间线
 *  创新 2  信息缺口引擎：把原文确实未提供的信息显式标注「待确认」，
 *          并给出「去哪里确认」的建议，绝不编造
 *  创新 3  撞车检测：与本活动时间冲突的活动直接在此提醒
 * 同时提供状态众包上报（用户可以主动操作信息）。
 */

import {
  mergeView, computeStatus, completenessScore, missingFields, missingText,
  confirmAdvice, actionLine, clashesFor, allMerged, freshmanFit, rawById
} from '../model.js';
import { CATEGORIES, SOURCES, GRADE_LABELS } from '../../data/events.js';
import { store } from '../store.js';
import {
  nowISO, parse, relTime, fmtDate, fmtTime, fmtRange, fmtDeadline
} from '../util.js';
import { esc, toast, confirmDialog, badge, sourceTag } from '../ui.js';

/**
 * 把「补充通知」的 id 规范化为它修订的那场活动的 id。
 * 例如 09（程序设计训练营补充通知）→ 01（“蓝桥杯”程序设计校内训练营）。
 * 其它情况原样返回。
 */
function canonicalId(id) {
  const raw = rawById(id);
  const first = raw && raw.amendments && raw.amendments[0];
  return first && first.fromId ? first.fromId : id;
}

export function renderDetail(root, ctx, id) {
  // 补充通知本身不是一场可参加的活动：如果直接访问它的详情页，
  // 统一规范化为「它修订的那场活动」的完整视图，避免用户只看到
  // 「因场地调整……」这类片段而误以为这是一场新活动。
  const canonical = canonicalId(id);
  const m = mergeView(canonical);
  if (!m) {
    root.innerHTML = `<div class="empty"><div class="empty__icon">🧭</div>
      <p class="empty__title">没有找到这条信息</p>
      <p class="empty__hint">它可能已被下架，或链接不正确。</p>
      <button class="btn btn--soft" data-act="back">返回发现页</button></div>`;
    root.querySelector('[data-act="back"]')?.addEventListener('click', () => ctx.go('#/discover'));
    return;
  }
  id = canonical;

  const now = nowISO();
  store.touchHistory(id);

  const st = computeStatus(m, now);
  const score = completenessScore(m);
  const gap = missingFields(m);
  const fit = freshmanFit(m, store.get('onboard'), now);
  const favorited = store.has('favorites', id);
  const signed = store.has('signups', id);
  const report = store.getReport(id);
  const changed = (m.changeCount || 0) > 0 || !!m.amendedBy;
  const clashes = clashesFor(id, allMerged(), now);
  const related = (m.relatesTo || []).map((rid) => rawById(rid)).filter(Boolean);
  const tips = confirmAdvice(m);

  root.innerHTML = `
    <div class="toolbar" style="margin-bottom:16px">
      <button class="btn btn--ghost btn--sm" data-act="back">← 返回</button>
    </div>

    <div class="detail__head">
      <div class="detail__tags">
        ${sourceTag(m.source, SOURCES)}
        ${badge(`${CATEGORIES[m.category]?.icon || ''} ${CATEGORIES[m.category]?.label || m.category}`, 'muted')}
        <span class="badge badge--${st.tone}">${esc(st.label)}</span>
        ${st.note ? `<span class="tag">${esc(st.note)}</span>` : ''}
        <span class="tag">编号 ${esc(m.code || '—')}</span>
      </div>
      <h1 class="detail__title">${esc(m.title)}</h1>
      <div class="detail__concl">
        <span aria-hidden="true">💡</span>
        <span>${esc(actionLine(m, now))}</span>
      </div>
    </div>

    ${changed ? changeNotice(m) : ''}
    ${m.risk && m.risk.level !== 'none' ? riskNotice(m) : ''}
    ${clashes.length ? clashNotice(clashes, id) : ''}

    <section class="section">
      <div class="panel">
        <div class="panel__title">📋 活动信息</div>
        <div class="kv">
          ${kv('时间', timeText(m), !m.time.start && !m.time.recurrence)}
          ${kv('报名截止', m.time.deadline ? fmtDeadline(m.time.deadline) : (m.participation.needSignup ? null : '无需报名'), false, !!m.participation.needSignup && !m.time.deadline)}
          ${kv('地点', m.location?.raw || null, false, !m.location?.raw)}
          ${m.location?.note ? kv('地点说明', m.location.note) : ''}
          ${kv('适合谁', eligibilityText(m))}
          ${kv('要不要报名', participationText(m))}
          ${kv('费用', feeText(m), false, m.participation.fee == null)}
          ${kv('投入时间', m.participation.commitment || null, false, false, '未注明')}
          ${kv('人数', m.eligibility.limit ? `限 ${m.eligibility.limit} 人` : (m.eligibility.minPeople ? `计划 ${m.eligibility.minPeople}—${m.eligibility.limit} 人` : null), false, false, '未注明')}
          ${kv('主办方', m.publisher || null, false, !m.publisher)}
          ${m.publisherNote ? `<div class="kv__row"><span class="kv__k"></span><span class="form__hint">${esc(m.publisherNote)}</span></div>` : ''}
          ${m.recruitNote ? kv('招募方向', m.recruitRoles.join('、') + '（' + m.recruitNote + '）', false, false) : ''}
        </div>
      </div>
    </section>

    ${m.time.milestones && m.time.milestones.length ? `
    <section class="section">
      <div class="panel">
        <div class="panel__title">🗓 关键节点</div>
        <div class="timeline">
          ${m.time.milestones.slice().sort((a, b) => parse(a.at) - parse(b.at)).map((ms) => {
            const done = parse(ms.at) < parse(now);
            return `<div class="timeline__item${done ? '' : ' timeline__item--latest'}">
              <div class="timeline__time">${esc(fmtDate(ms.at))} ${esc(fmtTime(ms.at))} · ${done ? '已过' : relTime(ms.at, now)}</div>
              <div class="timeline__title">${esc(ms.label)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </section>` : ''}

    ${gap.length ? `
    <section class="section">
      <div class="panel">
        <div class="panel__title">⚠ 以下信息原文没有提供（待确认）</div>
        <div class="notice notice--gap">
          <span class="notice__icon">🕳</span>
          <div class="notice__body">
            <div class="notice__title">本平台不会替主办方补全这些信息</div>
            缺失项只做标注，不猜测、不编造。以下内容请以主办方后续通知为准。
          </div>
        </div>
        <ul class="checklist" style="margin-top:12px">
          ${gap.map((g) => `<li class="check check--no"><span class="check__mark">?</span><span>${esc(missingText(m, g))}</span></li>`).join('')}
        </ul>
        ${tips.length ? `
          <div style="margin-top:14px">
            <div class="form__hint" style="font-weight:600;margin-bottom:6px">建议这样确认：</div>
            <ul class="checklist">
              ${tips.map((t) => `<li class="check check--ok"><span class="check__mark">→</span><span>${esc(t)}</span></li>`).join('')}
            </ul>
          </div>` : ''}
      </div>
    </section>` : `
    <section class="section">
      <div class="notice notice--ok">
        <span class="notice__icon">✓</span>
        <div class="notice__body"><div class="notice__title">信息完整度 100</div>
        时间、地点、费用与参与方式都已说明，可直接按上面的结论行动。</div>
      </div>
    </section>`}

    <section class="section">
      <div class="panel">
        <div class="panel__title">🔎 信息可信度</div>
        <div class="scorehead">
          ${scoreRingHtml(score)}
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:var(--f-sm)">完整度 ${score} 分</div>
            <div class="form__hint" style="margin-top:4px">
              ${gap.length ? `缺少 ${gap.length} 项关键信息，判断成本较高。` : '关键信息齐全，判断成本低。'}
              来源：${esc(SOURCES[m.source].label)}${m.publisher ? ' · ' + esc(m.publisher) : ' · 未提供主办方'}
            </div>
            <div style="margin-top:8px">
              ${progressBarHtml(score, score >= 80 ? 'ok' : score >= 55 ? 'warn' : 'risk')}
            </div>
          </div>
        </div>
        ${fit.reasons.length || fit.blockers.length ? `
          <div class="fit" style="margin-top:14px">
            ${fit.reasons.map((r) => `<span class="fit__reason">✓ ${esc(r)}</span>`).join('')}
            ${fit.blockers.map((r) => `<span class="fit__block">✕ ${esc(r)}</span>`).join('')}
          </div>` : ''}
      </div>
    </section>

    ${changed ? `
    <section class="section">
      <div class="panel">
        <div class="panel__title">🔄 通知记录（含补充通知）</div>
        <p class="form__hint" style="margin-bottom:12px">
          这条信息存在后续补充通知。上面的内容已是<b>合并后的最新有效版本</b>，报名截止时间等未变更项保持原样。
        </p>
        <div class="timeline">
          ${(m.amendedBy || []).slice().reverse().map((am) => {
            const src = rawById(am.id);
            return `<div class="timeline__item timeline__item--latest">
              <div class="timeline__time">补充通知 · 编号 ${esc(am.code)}</div>
              <div class="timeline__title">${esc(am.title)}</div>
              ${src ? `<div class="rawquote rawquote--amend">${esc(src.raw)}</div>` : ''}
            </div>`;
          }).join('')}
          <div class="timeline__item">
            <div class="timeline__time">原始通知 · 编号 ${esc(m.code)}</div>
            <div class="timeline__title">${esc(m.title === '程序设计训练营补充通知' ? '“蓝桥杯”程序设计校内训练营' : (rawById(m.id)?.title || m.title))}</div>
            <div class="rawquote">${esc(rawById(m.id)?.raw || m.raw)}</div>
          </div>
        </div>
      </div>
    </section>` : ''}

    ${changed && m.changes.length ? `
    <section class="section">
      <div class="panel">
        <div class="panel__title">↔ 变更详情</div>
        <div class="diff">
          ${m.changes.map((c) => `<div class="diff__row">
            <span class="diff__label">${esc(pathLabel(c.path))}</span>
            <span><span class="diff__from">${esc(c.from == null ? '未提供' : displayVal(c.path, c.from))}</span>
            <span aria-hidden="true"> → </span>
            <span class="diff__to">${esc(displayVal(c.path, c.to))}</span></span>
          </div>`).join('')}
        </div>
      </div>
    </section>` : ''}

    <section class="section">
      <div class="panel">
        <div class="panel__title">📄 原文（逐字保留，便于核对）</div>
        <div class="rawquote">${esc(rawById(m.id)?.raw || m.raw)}</div>
        <p class="form__hint" style="margin-top:10px">
          以上为题目提供的模拟信息原文，未经改写。产品对它的所有解读都可以在这里被核对。
        </p>
      </div>
    </section>

    ${related.length ? `
    <section class="section">
      <div class="panel">
        <div class="panel__title">🔗 相关信息</div>
        <div class="cards">
          ${related.map((r) => {
            const rm = mergeView(r.id);
            const rst = computeStatus(rm, now);
            return `<article class="card card--${rm.source}" data-card="${esc(rm.id)}" tabindex="0" role="button">
              <div class="card__top">
                <h3 class="card__title">${esc(rm.title)}</h3>
                <span class="badge badge--${rst.tone}">${esc(rst.label)}</span>
              </div>
              <p class="card__concl">${esc(actionLine(rm, now))}</p>
            </article>`;
          }).join('')}
        </div>
      </div>
    </section>` : ''}

    <section class="section">
      <div class="panel">
        <div class="panel__title">🗳 这条信息还准吗？</div>
        <p class="form__hint" style="margin-bottom:12px">
          线下情况随时可能变化。你的一次点击，能帮后面的同学少跑一趟。上报只保存在你的设备上。
        </p>
        ${report ? `<div class="notice notice--info">
          <span class="notice__icon">✓</span>
          <div class="notice__body"><div class="notice__title">你已上报：${esc(reportLabel(report.status))}</div>
          感谢反馈。可重新选择以更新你的判断。</div></div>` : ''}
        <div class="radiogroup" data-group="report" style="margin-top:12px">
          ${Object.entries(REPORT_TYPES).map(([k, v]) =>
            `<button class="radio-pill" data-report="${k}" aria-pressed="${report?.status === k}">${esc(v)}</button>`).join('')}
        </div>
      </div>
    </section>

    <div style="height:72px"></div>

    <div class="actionbar">
      <div class="actionbar__inner">
        <button class="btn ${favorited ? 'btn--soft' : 'btn--ghost'}" data-act="fav" aria-pressed="${favorited}">
          ${favorited ? '★ 已收藏' : '☆ 收藏'}
        </button>
        ${m.participation.needSignup
          ? `<button class="btn btn--primary btn--lg" data-act="signup" style="flex:1" aria-pressed="${signed}">
              ${signed ? '✓ 已记录我要报名' : '我要报名（记录到我的）'}</button>`
          : `<button class="btn btn--soft btn--lg" data-act="interest" style="flex:1" aria-pressed="${signed}">
              ${signed ? '✓ 已加入我的日程' : '加入我的日程'}</button>`}
        <button class="btn btn--ghost" data-act="ics" title="导出为日历文件">📅</button>
      </div>
    </div>
  `;

  bind(root, ctx, m);
}

/* --------------------------- 片段 --------------------------- */

function kv(k, v, pending = false, missing = false, fallback = null) {
  let cls = 'kv__v', text;
  if (v == null || v === '') {
    if (missing) { cls += ' kv__v--unknown'; text = '⚠ 原文未提供，待确认'; }
    else { cls += ' kv__v--unknown'; text = fallback || '—'; }
  } else {
    text = v;
  }
  return `<div class="kv__row"><span class="kv__k">${esc(k)}</span><span class="${cls}">${esc(text)}</span></div>`;
}

function timeText(m) {
  const t = m.time;
  if (t.kind === 'recurring' && t.recurrence) {
    const wd = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][t.recurrence.weekday];
    const intervalWeeks = t.recurrence.intervalWeeks || 1;
    const every = intervalWeeks > 1 ? `每 ${intervalWeeks} 周${wd}` : `每${wd}`;
    const clock = t.start ? fmtTime(t.start) : '';
    const first = t.start && t.start !== t.recurrence.startDate + 'T' + clock
      ? `（首次 ${fmtDate(t.start)} ${fmtTime(t.start)}）` : '';
    return `${fmtDate(t.recurrence.startDate)} 起，${every} ${clock}，共 ${t.recurrence.weeks} 周${first}`;
  }
  if (t.kind === 'replay') return `${fmtDate(t.start)} ${fmtTime(t.start)} 已直播结束${t.replayAt ? `，回放预计 ${fmtDate(t.replayAt)} 上传` : ''}`;
  if (t.kind === 'resource') return '资料长期开放';
  if (!t.start) return null;
  return `${fmtDate(t.start)} ${fmtRange(t.start, t.end, t.durationMin)}`;
}

function eligibilityText(m) {
  const el = m.eligibility;
  const parts = [];
  if (el.grades[0] === 'all') parts.push('全校学生');
  else parts.push(el.grades.map((g) => GRADE_LABELS[g]).join('、'));
  if (el.preferFreshman) parts.push('主要面向大一新生');
  if (el.preferEquipment) parts.push('有摄影设备者优先（非硬性要求）');
  if (/\u96f6\u57fa\u7840|\u4e0d\u9650\u57fa\u7840/.test((m.keywords || []).join('') + m.raw)) parts.push('零基础可参加');
  return parts.join(' · ');
}

function participationText(m) {
  const p = m.participation;
  if (p.needSignup === false) return '无需报名，直接参加';
  const parts = ['需要报名'];
  if (p.audit) parts.push('提交报名表不代表最终录取，以审核通知为准');
  if (p.waitlist) parts.push('报名已截止，如现场仍有余位可候补入场');
  if (p.needSignup == null) parts.push('报名方式待确认');
  return parts.join(' · ');
}

function feeText(m) {
  const f = m.participation.fee;
  if (f === 'free') return '免费';
  if (f === 'AA') return '费用 AA 制';
  if (f == null) return null;
  return String(f);
}

function scoreRingHtml(score) {
  const tone = score >= 80 ? 'ok' : score >= 55 ? 'warn' : 'risk';
  return `<div class="score score--${tone}" role="img" aria-label="完整度 ${score} 分">
    <span class="score__num">${score}</span><span class="score__unit">分</span></div>`;
}
function progressBarHtml(pct, tone) {
  return `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <span class="bar__fill bar__fill--${tone}" style="width:${pct}%"></span></div>`;
}

function changeNotice(m) {
  return `
  <div class="notice notice--change" style="margin-top:16px">
    <span class="notice__icon">🔄</span>
    <div class="notice__body">
      <div class="notice__title">这条信息已被补充通知更新（共 ${m.changeCount} 处变更）</div>
      ${m.changes.map((c) => `：${esc(pathLabel(c.path))} 由「${esc(displayVal(c.path, c.from) || '未提供')}」改为「${esc(displayVal(c.path, c.to))}」`).join('<br>')}
      <div style="margin-top:4px">下面显示的是<b>合并后的最新版本</b>，未变更的内容保持原样。</div>
    </div>
  </div>`;
}

function riskNotice(m) {
  const high = m.risk.level === 'high';
  return `
  <div class="notice notice--risk" style="margin-top:16px">
    <span class="notice__icon">⚠</span>
    <div class="notice__body">
      <div class="notice__title">${high ? '高风险：这条内容可能不是真实校园活动' : '提示：这条内容可能带有推广性质'}</div>
      <ul style="margin-top:4px">
        ${m.risk.reasons.map((r) => `<li>· ${esc(r)}</li>`).join('')}
      </ul>
      ${m.risk.advice ? `<div style="margin-top:6px"><b>建议：</b>${esc(m.risk.advice)}</div>` : ''}
    </div>
  </div>`;
}

function clashNotice(clashes, currentId) {
  return clashes.map((c) => {
    const other = c.a.id === currentId ? c.b : c.a;
    return `
    <div class="notice notice--gap" style="margin-top:12px">
      <span class="notice__icon">⚠</span>
      <div class="notice__body">
        <div class="notice__title">时间冲突：${esc(c.day)} ${esc(c.overlapText)} 与另一场活动重叠约 ${c.overlapMin} 分钟</div>
        冲突活动：<b>${esc(other.title)}</b>
        <div style="margin-top:4px">${esc(c.advice)}</div>
      </div>
    </div>`;
  }).join('');
}

const REPORT_TYPES = {
  still: '仍可参加',
  closed: '报名/活动已截止',
  changed: '时间或地点有变',
  suspicious: '疑似广告或虚假'
};
function reportLabel(k) { return REPORT_TYPES[k] || k; }

function pathLabel(path) {
  return {
    'time.start': '活动时间',
    'location.raw': '活动地点',
    'recruitRoles': '招募方向'
  }[path] || path;
}
function displayVal(path, val) {
  if (val == null) return '未提供';
  if (path === 'time.start') return `${fmtDate(val)} ${fmtTime(val)}`;
  if (Array.isArray(val)) return val.join('、');
  return String(val);
}

/* --------------------------- 绑定 --------------------------- */

function bind(root, ctx, m) {
  root.querySelector('[data-act="back"]')?.addEventListener('click', () => ctx.back());
  root.querySelectorAll('[data-card]').forEach((el) => {
    const go = () => ctx.go(`#/event/${el.dataset.card}`);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });

  root.querySelector('[data-act="fav"]')?.addEventListener('click', (e) => {
    const on = store.toggle('favorites', m.id);
    e.currentTarget.classList.add('is-pop');
    toast(on ? '已收藏，可在「我的」中查看' : '已取消收藏', on ? 'ok' : 'default');
    ctx.rerender();
  });

  const signup = root.querySelector('[data-act="signup"]');
  if (signup) signup.addEventListener('click', async () => {
    if (store.has('signups', m.id)) {
      const yes = await confirmDialog({
        title: '取消报名记录？',
        body: `将从「我的报名」中移除「${m.title}」。这不会影响你向主办方提交的真实报名。`,
        confirmText: '取消记录', cancelText: '保留'
      });
      if (!yes) return;
      store.remove('signups', m.id);
      toast('已从我的报名中移除');
    } else {
      store.add('signups', m.id);
      toast(m.participation.audit
        ? '已记录。提醒：提交报名表不代表最终录取，以审核通知为准'
        : '已记录到「我的报名」，刷新后仍会保留', 'ok');
    }
    ctx.rerender();
  });

  const interest = root.querySelector('[data-act="interest"]');
  if (interest) interest.addEventListener('click', () => {
    const on = store.toggle('signups', m.id);
    toast(on ? '已加入我的日程' : '已从日程移除', on ? 'ok' : 'default');
    ctx.rerender();
  });

  root.querySelector('[data-act="ics"]')?.addEventListener('click', () => exportICS([m]));

  root.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', () => {
    store.addReport(m.id, b.dataset.report);
    toast('已记录你的判断，感谢帮助后面的同学', 'ok');
    ctx.rerender();
  }));
}

/* --------------------------- .ics 导出 --------------------------- */
/* 真实产出文件，而不是只有视觉效果的按钮 —— 对应「不应存在无效按钮」 */

export function exportICS(list) {
  const events = list.filter((m) => m.time.start || (m.time.recurrence && m.time.recurrence.startDate));
  if (!events.length) {
    toast('该内容没有明确时间，无法导出到日历', 'warn');
    return;
  }
  const p = (n) => String(n).padStart(2, '0');
  const stamp = (iso) => {
    const d = new Date(parse(iso));
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  };
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CampusLoop//ZH//',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'
  ];
  events.forEach((m) => {
    const start = m.time.start || `${m.time.recurrence.startDate}T19:00`;
    const end = m.time.end || new Date(parse(start) + (m.time.durationMin || 90) * 60000).toISOString().slice(0, 16);
    const desc = [
      `来源：${SOURCES[m.source].label}`,
      `一句话结论：${actionLine(m)}`,
      m.time.deadline ? `报名截止：${fmtDate(m.time.deadline)} ${fmtTime(m.time.deadline)}` : '',
      `地点：${m.location?.raw || '待确认'}`,
      `原文：${(rawById(m.id)?.raw || m.raw || '').replace(/\n/g, ' ')}`
    ].filter(Boolean).join('\\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${m.id}@campusloop`,
      `DTSTAMP:${stamp(nowISO())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${icsEscape(m.title)}`,
      `LOCATION:${icsEscape(m.location?.raw || '待确认')}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `校园圈-${events.length}个活动.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`已导出 ${events.length} 个活动到日历文件`, 'ok');
}

function icsEscape(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
