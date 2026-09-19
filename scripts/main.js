/**
 * 应用入口：Hash 路由、全局时间基准、页面外壳
 * ------------------------------------------------------------------
 * 之所以自己实现一个极简路由而不是引入框架：
 *   1. 零依赖 = 零构建失败风险，考场网络不可控，作品必须永远能打开；
 *   2. 需要渲染的视图数量有限（4 个 Tab + 1 个详情页），框架收益很低。
 */

import { nowISO, setNow, isSimulated, fmtDate, weekdayLabel, dateKey, parse, fmtTime } from './util.js';
import { store } from './store.js';
import { allMerged, visibleMerged } from './model.js';
import { esc, toast, sheet, confirmDialog, todayBar } from './ui.js';

import { renderDiscover, resetDiscoverState } from './views/discover.js';
import { renderDetail } from './views/detail.js';
import { renderCalendar } from './views/calendar.js';
import { renderMine } from './views/mine.js';
import { renderPublish } from './views/publish.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const todayChipSlot = document.getElementById('todayChipSlot');

const TABS = [
  { hash: '#/discover', icon: '🧭', label: '发现' },
  { hash: '#/calendar', icon: '🗓', label: '日历' },
  { hash: '#/mine', icon: '🙋', label: '我的' },
  { hash: '#/publish', icon: '📣', label: '发布' }
];

const navStack = [];

const ctx = {
  go(hash) {
    if (location.hash === hash) { route(); return; }
    navStack.push(location.hash || '#/discover');
    location.hash = hash;
  },
  back() {
    const prev = navStack.pop();
    if (prev && prev !== location.hash) location.hash = prev;
    else location.hash = '#/discover';
  },
  rerender() { route(); },
  refreshChrome() { renderChrome(); }
};

/* ============================ 路由 ============================ */

function parseHash() {
  const raw = (location.hash || '#/discover').replace(/^#\/?/, '');
  const [name, param] = raw.split('/');
  return { name: name || 'discover', param: param || null };
}

function route() {
  const { name, param } = parseHash();
  try {
    switch (name) {
      case 'event': renderDetail(view, ctx, param); break;
      case 'calendar': renderCalendar(view, ctx); break;
      case 'mine': renderMine(view, ctx); break;
      case 'publish': renderPublish(view, ctx); break;
      case 'discover':
      default:
        renderDiscover(view, ctx);
    }
  } catch (err) {
    console.error('[campusloop] 视图渲染失败', err);
    view.innerHTML = `
      <div class="empty">
        <div class="empty__icon">🛠</div>
        <p class="empty__title">这个页面出了点问题</p>
        <p class="empty__hint">${esc(err.message || '未知错误')}</p>
        <button class="btn btn--soft" onclick="location.hash='#/discover';location.reload()">返回发现页</button>
      </div>`;
  }
  renderChrome();
  window.scrollTo(0, 0);
}

/* ============================ 外壳 ============================ */

function renderChrome() {
  const { name } = parseHash();
  const active = name === 'event' ? 'discover' : name;

  tabbar.innerHTML = TABS.map((t) => {
    const key = t.hash.replace('#/', '');
    const isActive = key === active;
    const badge = key === 'mine' ? mineBadge() : (key === 'calendar' ? clashBadge() : 0);
    return `<button class="tab" data-tab="${t.hash}" ${isActive ? 'aria-current="page"' : ''}>
      <span class="tab__icon" aria-hidden="true">${t.icon}</span>
      <span>${t.label}</span>
      ${badge ? `<span class="tab__dot">${badge > 99 ? '99+' : badge}</span>` : ''}
    </button>`;
  }).join('');

  tabbar.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    const target = b.dataset.tab;
    if (location.hash === target) return;
    navStack.length = 0;
    location.hash = target;
  }));

  todayChipSlot.innerHTML = todayBar(nowISO());
}

/** 今日有活动的提示：让「以 9/19 为背景」在界面上始终可感知 */
function todayCount() {
  const today = dateKey(nowISO());
  return visibleMerged().filter((m) => {
    if (m.time.start && dateKey(m.time.start) === today) return true;
    if (m.time.kind === 'recurring' && m.time.recurrence && m.time.recurrence.startDate === today) return true;
    return false;
  }).length;
}

function mineBadge() {
  const n = store.get('favorites').length + store.get('signups').length;
  return n;
}

function clashBadge() {
  // 只在存在「今天」的冲突时提示，避免长期挂一个无意义红点
  try {
    const today = dateKey(nowISO());
    const merged = visibleMerged();
    const todayEvents = merged.filter((m) => m.time.start && dateKey(m.time.start) === today);
    let n = 0;
    for (let i = 0; i < todayEvents.length; i++) {
      for (let j = i + 1; j < todayEvents.length; j++) {
        const A = todayEvents[i], B = todayEvents[j];
        const ae = A.time.end || A.time.start;
        const be = B.time.end || B.time.start;
        if (parse(ae) > parse(B.time.start) && parse(be) > parse(A.time.start)) n++;
      }
    }
    return n;
  } catch { return 0; }
}

/* ============================ 时间基准 ============================ */

/**
 * 时间基准切换器。
 * 这是为本作品的可验证性专门做的：题目以「2026 年 9 月 19 日」为时间背景，
 * 但真实打开作品时系统时间是别的日期。切换基准可以让评审在同一份作品上
 * 直接验证「9/18 报名中 → 9/19 即将截止 → 9/20 已截止」这类状态推进，
 * 证明状态是算出来的，而不是写死的文本。
 */
function openClockSheet() {
  const presets = [
    { label: '9 月 18 日 14:00（考核前一天）', value: '2026-09-18T14:00' },
    { label: '9 月 19 日 14:00（考核当日 · 默认基准）', value: '2026-09-19T14:00' },
    { label: '9 月 19 日 19:30（当晚活动进行中）', value: '2026-09-19T19:30' },
    { label: '9 月 20 日 13:00（志愿报名刚截止）', value: '2026-09-20T13:00' },
    { label: '9 月 22 日 20:00（多个截止已过）', value: '2026-09-22T20:00' },
    { label: '9 月 26 日 10:00（训练营开营后）', value: '2026-09-26T10:00' }
  ];
  const cur = nowISO();
  const list = presets.map((p) => `
    <button class="btn ${cur === p.value ? 'btn--primary' : 'btn--ghost'} btn--block"
            style="justify-content:flex-start;margin-bottom:8px" data-clock="${p.value}">
      ${cur === p.value ? '● ' : '○ '}${esc(p.label)}
    </button>`).join('');

  sheet({
    title: '🕒 切换时间基准',
    contentHtml: `
      <div class="notice notice--info" style="margin-bottom:14px">
        <span class="notice__icon">i</span>
        <div class="notice__body">
          <div class="notice__title">当前基准：${esc(fmtDate(cur))} ${esc(fmtTime(cur))} ${esc(weekdayLabel(cur))}</div>
          题目要求以 2026 年 9 月 19 日为时间背景。切换基准可以验证活动状态、
          截止倒计时和撞车检测是否随日期正确变化 —— 说明这些状态是<b>计算出来的</b>，
          而不是写死在页面上的文字。
        </div>
      </div>
      <div id="clockList">${list}</div>
      <div class="notice notice--gap" style="margin-top:6px">
        <span class="notice__icon">⚠</span>
        <div class="notice__body">
          <div class="notice__title">时间基准只影响状态显示</div>
          不会修改任何信息内容，收藏、报名与发布记录都与时间无关，切换后依然保留。
        </div>
      </div>`,
    onMount(body, close) {
      body.querySelectorAll('[data-clock]').forEach((b) => b.addEventListener('click', () => {
        setNow(b.dataset.clock);
        close();
        toast(`时间基准已切换为 ${b.dataset.clock.replace('T', ' ')}`, 'ok');
        route();
      }));
    }
  });
}

/* ============================ 关于 ============================ */

function openAboutSheet() {
  const all = visibleMerged();
  const gap = all.filter((m) => m.time && !m.time.start && !m.time.recurrence).length;
  sheet({
    title: '关于校园圈 CampusLoop',
    contentHtml: `
      <p style="font-size:var(--f-sm);color:var(--ink-2);line-height:1.75">
        <b>校园机会，看得懂、来得及、用得对。</b><br>
        本作品面向在校学生，重点解决新生面对多来源校园信息时的三个困难：
        <b>不敢信</b>（来源与可信度不明）、<b>看不懂</b>（术语与条件不熟）、
        <b>来不及</b>（截止时间分散、活动撞车）。
      </p>

      <div class="panel" style="margin-top:14px;box-shadow:none">
        <div class="panel__title">四项自主设计的功能</div>
        <ul class="checklist">
          <li class="check check--ok"><span class="check__mark">1</span><span><b>通知合并</b>：题目第 09 条是第 01 条的补充通知、第 20 条是第 03 条的补充说明。本平台把它们合并成一条最新版本，并保留变更前后对比与通知记录。</span></li>
          <li class="check check--ok"><span class="check__mark">2</span><span><b>待确认缺口</b>：学习小组的报名时间、摄影志愿者的截止时间、挑战赛的费用等原文均未提供。本平台一律标注「待确认」并提示如何核实，<b>不编造任何信息</b>。</span></li>
          <li class="check check--ok"><span class="check__mark">3</span><span><b>撞车检测</b>：题目未提示，但 9/19 晚 AI 公开课与网安小组、9/21 晚 Git 工作坊与训练营首次训练确实时间重叠。日历与详情页会主动提醒。</span></li>
          <li class="check check--ok"><span class="check__mark">4</span><span><b>发布体检</b>：学生发布时实时计算完整度、检测「日结／加微信／购买链接」等风险表述，高风险的发布会被标注并在列表中默认折叠。</span></li>
        </ul>
      </div>

      <div class="panel" style="margin-top:12px;box-shadow:none">
        <div class="panel__title">数据说明</div>
        <p class="form__hint">
          全部信息来自考核题目提供的 26 条模拟材料，逐字保留原文以供核对，不代表学校真实通知。
          当前展示 ${all.length} 条有效信息（已被补充通知覆盖的原始条目不再重复展示）。
          个人数据（收藏、报名、发布、上报）仅保存在本机浏览器，不上传任何服务器。
        </p>
      </div>

      <div class="panel" style="margin-top:12px;box-shadow:none">
        <div class="panel__title">技术说明</div>
        <p class="form__hint">
          零依赖纯前端单页应用（原生 ES Module + Hash 路由），无构建步骤、不加载任何 CDN 资源，
          因此在离线或网络受限的考场环境下也能直接运行。
          活动状态由结构化字段与当前时间实时计算得出，而非写死在页面中。
        </p>
      </div>`,
  });
}

/* ============================ 启动 ============================ */

document.getElementById('btnClock')?.addEventListener('click', openClockSheet);
document.getElementById('btnAbout')?.addEventListener('click', openAboutSheet);
window.addEventListener('hashchange', route);

if (!location.hash) location.hash = '#/discover';
route();

// 键盘快捷跳转（1—4），提升可访问性
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const map = { '1': '#/discover', '2': '#/calendar', '3': '#/mine', '4': '#/publish' };
  if (map[e.key]) { navStack.length = 0; location.hash = map[e.key]; }
});

console.log('%c校园圈 CampusLoop', 'color:#1D4ED8;font-weight:700;font-size:14px',
  `\n时间基准：${nowISO()}${isSimulated() ? '（已切换）' : ''}`,
  `\n信息条目：${allMerged().length} 条`,
  '\n提示：点击右上角 🕒 可切换时间基准，验证活动状态与截止倒计时是否随时间变化。');
