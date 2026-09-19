/**
 * 发布向导 —— 自主创新功能 4：发布体检
 * ------------------------------------------------------------------
 * 正面回应题目的核心矛盾：既要「降低开放发布的门槛」，又要处理
 * 「多来源信息质量不一、可能夹杂推广」。做法不是封杀，而是：
 *   1. 三步向导降低发布门槛（基础要求 5）；
 *   2. 实时体检：计算完整度、列出缺失项、检测风险词；
 *   3. 有风险不阻断，但发布后会被标注并在列表中默认折叠，
 *      发布者也能看到「怎么写才更容易被同学信任」。
 * 发布完成后进入与官方信息完全相同的列表、筛选与详情流程。
 */

import { CATEGORIES } from '../../data/events.js';
import { publishCheckup } from '../model.js';
import { store } from '../store.js';
import { nowISO, fmtDate, fmtTime } from '../util.js';
import { esc, toast, badge } from '../ui.js';

let step = 1;
let draft = blankDraft();

function blankDraft() {
  return {
    title: '', category: 'meetup', categoryKind: '',
    publisher: '', description: '',
    start: '', timeUndecided: false,
    location: '', locationUndecided: false,
    deadline: '',
    needSignup: true, contact: '', fee: 'free', limit: ''
  };
}

export function resetPublish() { step = 1; draft = blankDraft(); }

export function renderPublish(root, ctx) {
  const check = publishCheckup(draft);

  root.innerHTML = `
    <section class="section">
      <div class="section__head">
        <h2 class="section__title">📣 发布活动 / 招募</h2>
        <span class="section__hint">发布后会和官方信息一起出现在发现页</span>
      </div>

      <div class="notice notice--info">
        <span class="notice__icon">i</span>
        <div class="notice__body">
          <div class="notice__title">为了让同学敢来，请尽量把信息写清楚</div>
          校园圈不审核内容，但会为每条发布标注<b>完整度</b>与<b>可信度</b>。
          写得越具体，同学越容易判断，也越不容易被当成推广信息。
        </div>
      </div>

      <div class="steps" style="margin-top:16px">
        ${[1, 2, 3].map((n) => `<div class="step${step === n ? ' step--active' : ''}${step > n ? ' step--done' : ''}"
          ${step === n ? 'aria-current="step"' : ''}>${step > n ? '✓ ' : ''}${['① 基本信息', '② 时间地点', '③ 参与方式'][n - 1]}</div>`).join('')}
      </div>
    </section>

    <section class="section">
      <div class="panel">
        <div class="form">
          ${step === 1 ? step1() : ''}
          ${step === 2 ? step2() : ''}
          ${step === 3 ? step3() : ''}

          <div class="toolbar" style="margin-top:4px">
            ${step > 1 ? '<button class="btn btn--ghost" data-act="prev">← 上一步</button>' : ''}
            ${step < 3
              ? '<button class="btn btn--primary" data-act="next" style="flex:1">下一步</button>'
              : '<button class="btn btn--primary" data-act="submit" style="flex:1">发布到校园圈</button>'}
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="panel">
        <div class="panel__title">🩺 发布体检（实时）</div>
        <div class="scorehead" style="margin-bottom:14px">
          <div class="score score--${check.score >= 80 ? 'ok' : check.score >= 55 ? 'warn' : 'risk'}"
               role="img" aria-label="完整度 ${check.score} 分">
            <span class="score__num">${check.score}</span><span class="score__unit">分</span>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:var(--f-sm)">信息完整度</div>
            <div class="form__hint" style="margin-top:4px">${esc(check.verdict)}</div>
            <div class="bar" style="margin-top:8px">
              <span class="bar__fill bar__fill--${check.score >= 80 ? 'ok' : check.score >= 55 ? 'warn' : 'risk'}"
                    style="width:${Math.max(4, check.score)}%"></span>
            </div>
          </div>
        </div>

        <ul class="checklist">
          ${check.checks.map((c) => `
            <li class="check ${c.ok ? 'check--ok' : 'check--no'}">
              <span class="check__mark">${c.ok ? '✓' : '○'}</span>
              <span>${esc(c.label)}</span>
            </li>`).join('')}
        </ul>

        ${check.riskHits.length ? `
        <div class="notice notice--risk" style="margin-top:14px">
          <span class="notice__icon">⚠</span>
          <div class="notice__body">
            <div class="notice__title">检测到 ${check.riskHits.length} 处可能被判定为推广／风险的表述</div>
            <ul style="margin-top:4px">
              ${check.riskHits.map((r) => `<li>· ${esc(r.why)}</li>`).join('')}
            </ul>
            <div style="margin-top:6px">
              ${check.level === 'high'
                ? '这类内容发布后会被标注「高风险」并在发现页默认折叠，同学需要主动展开才能看到。建议删除相关表述，改为说明活动本身。'
                : '这类内容会被标注「疑似推广」。建议补充主办方与活动说明，让同学更容易信任。'}
            </div>
          </div>
        </div>` : ''}
      </div>
    </section>

    <section class="section">
      <div class="panel">
        <div class="panel__title">👀 同学会看到什么（实时预览）</div>
        ${previewHtml()}
      </div>
    </section>
  `;

  bind(root, ctx);
}

/* --------------------------- 三个步骤 --------------------------- */

function step1() {
  return `
    <div class="form__row">
      <label class="form__label" for="p-title">活动标题 <span class="form__req">*</span></label>
      <input class="input" id="p-title" maxlength="40" placeholder="例如：周末羽毛球约球（缺 2 人）"
             value="${esc(draft.title)}">
      <span class="form__hint">写清楚「做什么 + 有什么条件」，比只写「约球」更容易找到人。</span>
    </div>

    <div class="form__row">
      <span class="form__label">活动类型</span>
      <div class="radiogroup">
        ${Object.entries(CATEGORIES).map(([k, v]) =>
          `<button class="radio-pill" data-cat="${k}" aria-pressed="${draft.category === k}">${v.icon} ${esc(v.label)}</button>`).join('')}
      </div>
    </div>

    <div class="form__row">
      <label class="form__label" for="p-pub">发起人 / 组织</label>
      <input class="input" id="p-pub" maxlength="30" placeholder="例如：计算机学院 2026 级 张三 / 羽毛球社"
             value="${esc(draft.publisher)}">
      <span class="form__hint">填了会显示在详情页，能明显提升可信度。</span>
    </div>

    <div class="form__row">
      <label class="form__label" for="p-desc">活动说明</label>
      <textarea class="textarea" id="p-desc" maxlength="300"
        placeholder="想做什么、希望什么人来、需要自带什么。写得越具体越容易被信任。">${esc(draft.description)}</textarea>
    </div>
  `;
}

function step2() {
  const today = nowISO().slice(0, 10);
  return `
    <div class="switch-row">
      <div>
        <div style="font-weight:600;font-size:var(--f-sm)">时间还没定</div>
        <div class="form__hint">勾选后会标注「时间待确认」，比随便填一个时间更负责任</div>
      </div>
      <label class="switch"><input type="checkbox" id="p-timeund" ${draft.timeUndecided ? 'checked' : ''}>
        <span class="switch__track"></span></label>
    </div>

    ${draft.timeUndecided ? '' : `
    <div class="form__row">
      <label class="form__label" for="p-start">活动时间 <span class="form__req">*</span></label>
      <input class="input" id="p-start" type="datetime-local" value="${esc(draft.start)}" min="${today}T00:00">
    </div>`}

    <div class="switch-row">
      <div>
        <div style="font-weight:600;font-size:var(--f-sm)">地点还没定</div>
        <div class="form__hint">勾选后会标注「地点待最终确认」</div>
      </div>
      <label class="switch"><input type="checkbox" id="p-locund" ${draft.locationUndecided ? 'checked' : ''}>
        <span class="switch__track"></span></label>
    </div>

    ${draft.locationUndecided ? '' : `
    <div class="form__row">
      <label class="form__label" for="p-loc">活动地点 <span class="form__req">*</span></label>
      <input class="input" id="p-loc" maxlength="40" placeholder="例如：实验楼 A402 / 体育馆 3 号场"
             value="${esc(draft.location)}">
    </div>`}

    <div class="form__row">
      <label class="form__label" for="p-deadline">报名截止时间 <small>可留空</small></label>
      <input class="input" id="p-deadline" type="datetime-local" value="${esc(draft.deadline)}">
      <span class="form__hint">留空会显示「报名截止时间未注明」，不会有倒计时提醒。</span>
    </div>
  `;
}

function step3() {
  return `
    <div class="form__row">
      <span class="form__label">需要报名吗</span>
      <div class="radiogroup">
        <button class="radio-pill" data-need="1" aria-pressed="${draft.needSignup === true}">需要报名</button>
        <button class="radio-pill" data-need="0" aria-pressed="${draft.needSignup === false}">直接来就行</button>
      </div>
    </div>

    <div class="form__row">
      <label class="form__label" for="p-contact">怎么报名 / 怎么联系 <span class="form__req">*</span></label>
      <input class="input" id="p-contact" maxlength="60" placeholder="例如：群号 123456789 / 在本平台留言 / 直接到场"
             value="${esc(draft.contact)}">
      <span class="form__hint">建议用群号或公开渠道，避免只留私人微信。</span>
    </div>

    <div class="form__grid2">
      <div class="form__row">
        <label class="form__label" for="p-fee">费用</label>
        <select class="select" id="p-fee" style="width:100%">
          <option value="free"${draft.fee === 'free' ? ' selected' : ''}>免费</option>
          <option value="AA"${draft.fee === 'AA' ? ' selected' : ''}>AA 制</option>
          <option value="other"${draft.fee === 'other' ? ' selected' : ''}>需要付费（在说明中写清）</option>
          <option value=""${draft.fee === '' ? ' selected' : ''}>暂不确定</option>
        </select>
      </div>
      <div class="form__row">
        <label class="form__label" for="p-limit">人数上限 <small>可留空</small></label>
        <input class="input" id="p-limit" type="number" min="1" max="999" placeholder="例如：8"
               value="${esc(draft.limit)}">
      </div>
    </div>

    <div class="notice notice--ok">
      <span class="notice__icon">✓</span>
      <div class="notice__body">
        <div class="notice__title">发布后会发生什么</div>
        内容会立刻出现在「发现页」，带有<b>同学发布</b>标识，同样支持筛选、搜索、收藏与日历导出。
        你可以在「我的 → 我发布的」中随时下架。
      </div>
    </div>
  `;
}

/* --------------------------- 预览 --------------------------- */

function previewHtml() {
  const hasAny = draft.title || draft.start || draft.location;
  if (!hasAny) {
    return `<p class="form__hint">填写左侧内容后，这里会实时显示同学看到的卡片样式。</p>`;
  }
  const check = publishCheckup(draft);
  const st = {
    label: check.level === 'high' ? '高风险 · 已折叠' : (draft.timeUndecided ? '时间待确认' : '同学发布'),
    tone: check.level === 'high' ? 'risk' : 'accent'
  };
  return `
    <article class="card card--student" style="cursor:default">
      <div class="card__top">
        <h3 class="card__title">${esc(draft.title || '（未填写标题）')}</h3>
        <span class="badge badge--${st.tone}">${esc(st.label)}</span>
      </div>
      <p class="card__concl">${esc(previewLine())}</p>
      <div class="card__meta">
        <span><i>📍</i> ${esc(draft.locationUndecided ? '地点待确认' : (draft.location || '地点未填写'))}</span>
        ${draft.deadline ? `<span><i>⏳</i> ${esc(fmtDate(draft.deadline))} ${esc(fmtTime(draft.deadline))} 截止</span>` : ''}
        ${draft.limit ? `<span><i>👥</i> 限 ${esc(draft.limit)} 人</span>` : ''}
      </div>
      <div class="card__flags">
        ${badge(`完整度 ${check.score} 分`, check.score >= 80 ? 'ok' : 'pending')}
        ${check.riskHits.length ? badge(check.level === 'high' ? '含高风险表述' : '疑似推广', 'risk') : ''}
      </div>
    </article>`;
}

function previewLine() {
  const seg = [];
  seg.push(draft.needSignup ? '需报名' : '无需报名');
  if (draft.timeUndecided) seg.push('时间待确认');
  else if (draft.start) seg.push(`${fmtDate(draft.start)} ${fmtTime(draft.start)}`);
  if (draft.fee === 'free') seg.push('免费');
  else if (draft.fee === 'AA') seg.push('费用 AA');
  return seg.join(' · ');
}

/* --------------------------- 构建发布对象 --------------------------- */

function buildDraft() {
  const id = 'u' + Date.now().toString(36);
  const needSignup = draft.needSignup;
  return {
    id,
    code: 'U' + (store.get('published').length + 1),
    title: draft.title.trim() || '（未命名活动）',
    source: 'student',
    category: draft.category,
    publisher: draft.publisher.trim() || null,
    raw: [
      draft.description.trim(),
      draft.timeUndecided ? '时间待确认' : (draft.start ? `时间：${fmtDate(draft.start)} ${fmtTime(draft.start)}` : ''),
      draft.locationUndecided ? '地点待最终确认' : (draft.location ? `地点：${draft.location}` : ''),
      draft.contact ? `报名方式：${draft.contact}` : ''
    ].filter(Boolean).join('；') || '（发布者未填写说明）',
    description: draft.description.trim(),
    time: {
      kind: 'onetime',
      start: draft.timeUndecided ? null : (draft.start || null),
      deadline: draft.deadline || null
    },
    eligibility: {
      grades: ['all'],
      limit: draft.limit ? Number(draft.limit) : null
    },
    participation: {
      needSignup,
      fee: draft.fee === '' ? null : draft.fee,
      audit: false
    },
    location: {
      raw: draft.locationUndecided ? null : (draft.location.trim() || null),
      certainty: draft.locationUndecided ? 'pending' : (draft.location ? 'confirmed' : 'unknown')
    },
    completeness: { missing: [] },
    risk: { level: 'none', reasons: [] },
    keywords: [draft.category],
    addedAt: nowISO(),
    isUserPost: true
  };
}

/** 把体检结果写回已发布对象，使其在列表与详情中同样被标注 */
function attachCheckup(ev, check) {
  ev.checkup = { score: check.score, level: check.level };
  if (check.riskHits.length) {
    ev.risk = {
      level: check.level,
      reasons: check.riskHits.map((r) => r.why),
      advice: check.level === 'high'
        ? '这条内容由同学发布，包含可能涉及引流或推广的表述，请自行核实后再决定是否联系。'
        : '这条内容由同学发布，包含购买引导或推广性质表述，请谨慎对待。'
    };
  }
  return ev;
}

/* --------------------------- 绑定 --------------------------- */

function readForm(root) {
  const get = (id) => root.querySelector('#' + id);
  if (get('p-title')) draft.title = get('p-title').value;
  if (get('p-pub')) draft.publisher = get('p-pub').value;
  if (get('p-desc')) draft.description = get('p-desc').value;
  if (get('p-timeund')) draft.timeUndecided = get('p-timeund').checked;
  if (get('p-start')) draft.start = get('p-start').value;
  if (get('p-locund')) draft.locationUndecided = get('p-locund').checked;
  if (get('p-loc')) draft.location = get('p-loc').value;
  if (get('p-deadline')) draft.deadline = get('p-deadline').value;
  if (get('p-contact')) draft.contact = get('p-contact').value;
  if (get('p-fee')) draft.fee = get('p-fee').value;
  if (get('p-limit')) draft.limit = get('p-limit').value;
}

/** 边输入边更新体检结果，不整页重渲染，避免输入框失焦 */
function bindLive(root) {
  root.querySelectorAll('input, textarea, select').forEach((el) => {
    const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      readForm(root);
      if (el.type === 'checkbox') { renderPublish(root, window.__ctx); return; }
      refreshCheckup(root);
    });
  });

  root.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    draft.category = b.dataset.cat;
    root.querySelectorAll('[data-cat]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true');
    refreshCheckup(root);
  }));

  root.querySelectorAll('[data-need]').forEach((b) => b.addEventListener('click', () => {
    draft.needSignup = b.dataset.need === '1';
    root.querySelectorAll('[data-need]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true');
    refreshCheckup(root);
  }));
}

/** 只更新体检区与预览区，保持输入焦点 */
function refreshCheckup(root) {
  const check = publishCheckup(draft);
  const panel = root.querySelectorAll('.panel')[1];
  if (!panel) return;
  const scoreEl = panel.querySelector('.score');
  const numEl = panel.querySelector('.score__num');
  const verdictEl = panel.querySelector('.form__hint');
  const barEl = panel.querySelector('.bar__fill');
  const cls = check.score >= 80 ? 'ok' : check.score >= 55 ? 'warn' : 'risk';
  if (scoreEl) scoreEl.className = `score score--${cls}`;
  if (numEl) numEl.textContent = check.score;
  if (verdictEl) verdictEl.textContent = check.verdict;
  if (barEl) { barEl.className = `bar__fill bar__fill--${cls}`; barEl.style.width = Math.max(4, check.score) + '%'; }

  const list = panel.querySelector('.checklist');
  if (list) {
    list.innerHTML = check.checks.map((c) => `
      <li class="check ${c.ok ? 'check--ok' : 'check--no'}">
        <span class="check__mark">${c.ok ? '✓' : '○'}</span><span>${esc(c.label)}</span></li>`).join('');
  }

  const oldNotice = panel.querySelector('.notice--risk');
  if (oldNotice) oldNotice.remove();
  if (check.riskHits.length) {
    const div = document.createElement('div');
    div.className = 'notice notice--risk';
    div.style.marginTop = '14px';
    div.innerHTML = `<span class="notice__icon">⚠</span><div class="notice__body">
      <div class="notice__title">检测到 ${check.riskHits.length} 处可能被判定为推广／风险的表述</div>
      <ul style="margin-top:4px">${check.riskHits.map((r) => `<li>· ${esc(r.why)}</li>`).join('')}</ul></div>`;
    panel.appendChild(div);
  }

  const previewPanel = root.querySelectorAll('.panel')[2];
  if (previewPanel) previewPanel.innerHTML = `<div class="panel__title">👀 同学会看到什么（实时预览）</div>${previewHtml()}`;
}

function bind(root, ctx) {
  window.__ctx = ctx;
  bindLive(root);

  root.querySelector('[data-act="prev"]')?.addEventListener('click', () => {
    readForm(root); step = Math.max(1, step - 1); renderPublish(root, ctx);
  });

  root.querySelector('[data-act="next"]')?.addEventListener('click', () => {
    readForm(root);
    const err = validate(step);
    if (err) { toast(err, 'warn'); return; }
    step += 1;
    renderPublish(root, ctx);
  });

  root.querySelector('[data-act="submit"]')?.addEventListener('click', () => {
    readForm(root);
    const err = validate(1) || validate(2) || validate(3);
    if (err) { toast(err, 'warn'); return; }
    const check = publishCheckup(draft);
    const ev = attachCheckup(buildDraft(), check);
    store.addPublished(ev);
    const wasHigh = check.level === 'high';
    resetPublish();
    toast(wasHigh
      ? '已发布。内容包含风险表述，已被标注并在列表中默认折叠'
      : '发布成功！已出现在发现页，带「同学发布」标识', wasHigh ? 'warn' : 'ok', 3200);
    ctx.go('#/discover');
    ctx.refreshChrome();
  });
}

function validate(s) {
  if (s === 1) {
    if (!draft.title.trim()) return '请填写活动标题';
    if (draft.title.trim().length < 4) return '标题太短了，写清楚一点同学才看得懂';
    return null;
  }
  if (s === 2) {
    if (!draft.timeUndecided && !draft.start) return '请填写活动时间，或勾选「时间还没定」';
    if (!draft.locationUndecided && !draft.location.trim()) return '请填写活动地点，或勾选「地点还没定」';
    return null;
  }
  if (s === 3) {
    if (!draft.contact.trim()) return '请写明报名或联系方式';
    return null;
  }
  return null;
}
