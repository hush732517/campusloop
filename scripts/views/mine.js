/**
 * 我的 —— 核心功能 B：参与管理
 * ------------------------------------------------------------------
 * 收藏、报名、我发布的、我的上报、浏览足迹全部来自 localStorage，
 * 页面刷新或重新打开后完整保留（基础要求 6）。
 * 支持导出 .ics，让「参与」真正落地到手机日历，而不是只留一个按钮。
 */

import { allMerged, computeStatus, actionLine, mergeView, rawById } from '../model.js';
import { SOURCES } from '../../data/events.js';
import { store } from '../store.js';
import { nowISO, parse, smartDay, fmtTime, fmtDate, relTime } from '../util.js';
import { esc, badge, toast, confirmDialog, emptyState } from '../ui.js';
import { exportICS } from './detail.js';

let tab = 'fav';

const TABS = {
  fav: { label: '收藏', icon: '★' },
  signup: { label: '我报名的', icon: '✓' },
  mine: { label: '我发布的', icon: '📣' },
  report: { label: '我的上报', icon: '🗳' }
};

const REPORT_LABELS = {
  still: '仍可参加', closed: '已截止', changed: '时间/地点有变', suspicious: '疑似广告或虚假'
};

export function renderMine(root, ctx) {
  const now = nowISO();
  const merged = allMerged();
  const byId = new Map(merged.map((m) => [m.id, m]));

  const favs = store.get('favorites').map((id) => byId.get(id)).filter(Boolean);
  const signs = store.get('signups').map((id) => byId.get(id)).filter(Boolean);
  const mine = store.get('published');
  const reports = store.get('reports');
  const history = store.get('history').map((id) => byId.get(id)).filter(Boolean);

  // 截止提醒：已报名 / 收藏中 48 小时内截止的活动
  const alerts = [...new Set([...signs, ...favs])].filter((m) => {
    if (!m.time.deadline) return false;
    const diff = parse(m.time.deadline) - parse(now);
    return diff > 0 && diff <= 48 * 3600 * 1000;
  });

  const listFor = (arr, emptyIcon, emptyTitle, emptyHint, action = '') =>
    arr.length === 0
      ? emptyState({ icon: emptyIcon, title: emptyTitle, hint: emptyHint, action })
      : `<div class="cards">${arr.map((m) => rowHtml(m, now)).join('')}</div>`;

  root.innerHTML = `
    ${alerts.length ? `
    <section class="section">
      <div class="notice notice--gap">
        <span class="notice__icon">⏳</span>
        <div class="notice__body">
          <div class="notice__title">${alerts.length} 个你关注的活动将在 48 小时内截止</div>
          ${alerts.map((m) => `${esc(m.title)} · ${esc(fmtDate(m.time.deadline))} ${esc(fmtTime(m.time.deadline))} 截止（${esc(relTime(m.time.deadline, now))}）`).join('<br>')}
        </div>
      </div>
    </section>` : ''}

    <section class="section">
      <div class="section__head">
        <h2 class="section__title">🙋 我的校园圈</h2>
        <span class="section__hint">所有记录保存在本机浏览器，刷新后仍会保留</span>
      </div>

      <div class="stats">
        <div class="stat"><div class="stat__num">${favs.length}</div><div class="stat__label">收藏</div></div>
        <div class="stat"><div class="stat__num stat__num--ok">${signs.length}</div><div class="stat__label">已报名 / 日程</div></div>
        <div class="stat"><div class="stat__num stat__num--warn">${mine.length}</div><div class="stat__label">我发布的</div></div>
        <div class="stat"><div class="stat__num">${reports.length}</div><div class="stat__label">我的上报</div></div>
      </div>

      <div class="chips" role="tablist" style="margin-top:16px">
        ${Object.entries(TABS).map(([k, v]) =>
          `<button class="chip" role="tab" data-tab="${k}" aria-pressed="${tab === k}">${v.icon} ${esc(v.label)}</button>`).join('')}
      </div>
    </section>

    <section class="section">
      ${tab === 'fav' ? `
        <div class="toolbar" style="margin-bottom:12px">
          <button class="btn btn--soft btn--sm" data-act="ics-fav" ${favs.length ? '' : 'disabled'}>📅 导出收藏到日历</button>
          ${favs.length ? '<button class="btn btn--ghost btn--sm" data-act="clear-fav">清空收藏</button>' : ''}
        </div>
        ${listFor(favs, '★', '还没有收藏任何活动',
          '在发现页点开感兴趣的活动，点击「收藏」即可在这里统一管理。',
          '<button class="btn btn--soft" data-act="go-discover">去发现活动</button>')}
      ` : ''}

      ${tab === 'signup' ? `
        <div class="toolbar" style="margin-bottom:12px">
          <button class="btn btn--soft btn--sm" data-act="ics-sign" ${signs.length ? '' : 'disabled'}>📅 导出到日历（.ics）</button>
        </div>
        ${listFor(signs, '✓', '还没有报名记录',
          '在活动详情页点击「我要报名」，记录会保存在本机，刷新后依然在。',
          '<button class="btn btn--soft" data-act="go-discover">去发现活动</button>')}
      ` : ''}

      ${tab === 'mine' ? `
        <div class="toolbar" style="margin-bottom:12px">
          <button class="btn btn--primary btn--sm" data-act="go-publish">＋ 发布新活动</button>
        </div>
        ${mine.length === 0
          ? emptyState({
              icon: '📣', title: '你还没有发布过活动',
              hint: '约球、组队、学习小组都可以发布。发布后会和官方信息一起出现在发现页，并带有「同学发布」标识。',
              action: '<button class="btn btn--soft" data-act="go-publish">去发布</button>'
            })
          : `<div class="cards">${mine.map((e) => mineRowHtml(e, now)).join('')}</div>`}
      ` : ''}

      ${tab === 'report' ? `
        ${reports.length === 0
          ? emptyState({ icon: '🗳', title: '还没有上报记录', hint: '在活动详情页底部可以上报「已截止 / 时间地点有变 / 疑似广告」。' })
          : `<div class="cards">${reports.map((r) => reportRowHtml(r, byId.get(r.eventId), now)).join('')}</div>`}
      ` : ''}
    </section>

    ${history.length ? `
    <section class="section">
      <div class="panel">
        <div class="panel__title">👣 最近浏览</div>
        <div class="cards">
          ${history.slice(0, 5).map((m) => rowHtml(m, now, true)).join('')}
        </div>
      </div>
    </section>` : ''}

    <section class="section">
      <div class="panel">
        <div class="panel__title">⚙ 数据管理</div>
        <p class="form__hint" style="margin-bottom:12px">
          本作品没有后端，所有个人数据只存在你的浏览器里。
          ${store.get('onboard') ? `你的新生偏好：${esc(gradeText(store.get('onboard')))}${store.get('onboard').interests.length ? ' · 兴趣 ' + esc(store.get('onboard').interests.join('、')) : ''}。` : ''}
        </p>
        <div class="toolbar">
          <button class="btn btn--ghost btn--sm" data-act="redo-onboard">重新设置我的情况</button>
          <button class="btn btn--ghost btn--sm" data-act="export-json">导出我的数据</button>
          <button class="btn btn--ghost btn--sm" data-act="clear-all">清空全部本地数据</button>
        </div>
      </div>
    </section>
  `;

  bind(root, ctx, { favs, signs, mine });
}

/* --------------------------- 行渲染 --------------------------- */

function rowHtml(m, now, compact = false) {
  const st = computeStatus(m, now);
  const isFav = store.has('favorites', m.id);
  const isSign = store.has('signups', m.id);
  return `
  <article class="card card--${m.source}" data-card="${esc(m.id)}" tabindex="0" role="button">
    <div class="card__top">
      <h3 class="card__title">${esc(m.title)}</h3>
      <span class="badge badge--${st.tone}">${esc(st.label)}</span>
    </div>
    <p class="card__concl">${esc(actionLine(m, now))}</p>
    <div class="card__meta">
      ${m.time.deadline ? `<span><i>⏳</i> ${esc(fmtDate(m.time.deadline))} ${esc(fmtTime(m.time.deadline))} 截止</span>` : ''}
      ${m.location?.raw ? `<span><i>📍</i> ${esc(m.location.raw)}</span>` : ''}
      <span>${SOURCES[m.source].icon} ${esc(SOURCES[m.source].short)}</span>
    </div>
    ${compact ? '' : `
    <div class="card__flags">
      ${isFav ? badge('★ 已收藏', 'blue') : ''}
      ${isSign ? badge('✓ 已报名', 'ok') : ''}
      <div class="toolbar" style="margin-left:auto" onclick="event.stopPropagation()">
        <button class="btn btn--ghost btn--sm" data-unfav="${esc(m.id)}" title="取消收藏">取消收藏</button>
        ${isSign ? `<button class="btn btn--ghost btn--sm" data-unsign="${esc(m.id)}">移除报名</button>` : ''}
      </div>
    </div>`}
  </article>`;
}

function mineRowHtml(e, now) {
  const m = mergeView(e.id) || e;
  const check = e.checkup;
  return `
  <article class="card card--student" data-card="${esc(e.id)}" tabindex="0" role="button">
    <div class="card__top">
      <h3 class="card__title">${esc(e.title)}</h3>
      <span class="badge badge--${(m.risk && m.risk.level !== 'none') ? 'risk' : 'ok'}">
        ${(m.risk && m.risk.level !== 'none') ? '含风险提示' : '已发布'}</span>
    </div>
    <p class="card__concl">${esc(actionLine(m, now))}</p>
    <div class="card__meta">
      <span><i>📅</i> ${esc(e.start ? `${fmtDate(e.start)} ${fmtTime(e.start)}` : '时间待定')}</span>
      <span><i>📍</i> ${esc(e.location || '地点待定')}</span>
      ${check ? `<span><i>📊</i> 发布时完整度 ${check.score} 分</span>` : ''}
    </div>
    <div class="card__flags">
      ${badge('同学发布', 'accent')}
      <div class="toolbar" style="margin-left:auto" onclick="event.stopPropagation()">
        <button class="btn btn--ghost btn--sm" data-del-pub="${esc(e.id)}">下架</button>
      </div>
    </div>
  </article>`;
}

function reportRowHtml(r, m, now) {
  return `
  <article class="card ${m ? `card--${m.source}` : ''}" ${m ? `data-card="${esc(m.id)}" tabindex="0" role="button"` : ''}>
    <div class="card__top">
      <h3 class="card__title">${esc(m ? m.title : '（已下架的内容）')}</h3>
      <span class="badge badge--accent">${esc(REPORT_LABELS[r.status] || r.status)}</span>
    </div>
    <div class="card__meta">
      <span><i>🕐</i> 上报于 ${esc(new Date(r.at).toLocaleString('zh-CN', { hour12: false }))}</span>
    </div>
    <div class="card__flags">
      ${badge('你的判断会展示在这条信息的可信度中', 'muted')}
    </div>
  </article>`;
}

function gradeText(ob) {
  const g = ['大一', '大二', '大三', '大四'][Number(ob.grade || 1) - 1];
  return `${g} · 每周约 ${ob.hours} 小时`;
}

/* --------------------------- 绑定 --------------------------- */

function bind(root, ctx, data) {
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    renderMine(root, ctx);
  }));

  root.querySelectorAll('[data-card]').forEach((el) => {
    const go = () => ctx.go(`#/event/${el.dataset.card}`);
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });

  root.querySelectorAll('[data-unfav]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    store.remove('favorites', b.dataset.unfav);
    toast('已取消收藏');
    renderMine(root, ctx); ctx.refreshChrome();
  }));

  root.querySelectorAll('[data-unsign]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    store.remove('signups', b.dataset.unsign);
    toast('已移除报名记录');
    renderMine(root, ctx); ctx.refreshChrome();
  }));

  root.querySelectorAll('[data-del-pub]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = b.dataset.delPub;
    const ok = await confirmDialog({
      title: '确认下架这条发布？',
      body: '下架后它将从发现页和日历中移除，此操作不可撤销。',
      confirmText: '确认下架', tone: 'risk'
    });
    if (!ok) return;
    const list = store.get('published').filter((x) => x.id !== id);
    store.set('published', list);
    toast('已下架');
    renderMine(root, ctx); ctx.refreshChrome();
  }));

  const acts = {
    'go-discover': () => ctx.go('#/discover'),
    'go-publish': () => ctx.go('#/publish'),
    'ics-fav': () => exportICS(data.favs),
    'ics-sign': () => exportICS(data.signs),
    'clear-fav': async () => {
      const ok = await confirmDialog({ title: '清空全部收藏？', body: `将移除 ${data.favs.length} 条收藏记录。`, confirmText: '清空', tone: 'risk' });
      if (!ok) return;
      store.set('favorites', []); toast('已清空收藏'); renderMine(root, ctx); ctx.refreshChrome();
    },
    'redo-onboard': () => { store.set('onboard', null); toast('已重置，回到发现页重新设置'); ctx.go('#/discover'); },
    'export-json': () => {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = '校园圈-我的数据.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('已导出我的数据（JSON）', 'ok');
    },
    'clear-all': async () => {
      const ok = await confirmDialog({
        title: '清空全部本地数据？',
        body: '将删除收藏、报名、我发布的内容与上报记录。此操作不可撤销。',
        confirmText: '全部清空', tone: 'risk'
      });
      if (!ok) return;
      store.clearAll();
      tab = 'fav';
      toast('已清空全部本地数据', 'ok');
      renderMine(root, ctx); ctx.refreshChrome();
    }
  };
  root.querySelectorAll('[data-act]').forEach((b) => {
    const fn = acts[b.dataset.act];
    if (fn) b.addEventListener('click', fn);
  });
}
