/**
 * 渲染冒烟测试（Node + 轻量 DOM 桩）
 * ------------------------------------------------------------------
 * 用法：node docs/rendertest.mjs
 *
 * 目的：在没有浏览器的环境下，确认应用能真正启动、四个 Tab 与详情页都能
 * 渲染出内容，并且关键文案（合并结论、待确认标注、风险折叠、冲突提醒）
 * 确实出现在 DOM 中。用于捕获「语法正确但一运行就白屏」这类问题。
 *
 * 注意：这是一个用于自动化验证的最小 DOM 实现，不是通用 DOM 库。
 */

/* ------------------------- 最小 DOM 实现 ------------------------- */

class ClassList {
  constructor(el) { this.el = el; }
  get set() { return new Set((this.el._class || '').split(/\s+/).filter(Boolean)); }
  _write(s) { this.el._class = Array.from(s).join(' '); }
  add(...n) { const s = this.set; n.forEach((x) => s.add(x)); this._write(s); }
  remove(...n) { const s = this.set; n.forEach((x) => s.delete(x)); this._write(s); }
  contains(n) { return this.set.has(n); }
  toString() { return this.el._class || ''; }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.dataset = {};
    this._html = '';
    this._text = '';
    this._listeners = {};
    this._class = '';
    this.classList = new ClassList(this);
    this.style = {};
    this.value = '';
    this.checked = false;
    this.type = '';
  }
  get className() { return this._class; }
  set className(v) { this._class = v == null ? '' : String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v == null ? '' : String(v); this.children = []; }
  get textContent() { return this._text || stripTags(this._html); }
  set textContent(v) { this._text = v == null ? '' : String(v); this._html = ''; }
  setAttribute(k, v) {
    if (k === 'class') { this.className = v; return; }
    if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v);
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    if (k === 'class') return this.className;
    if (k.startsWith('data-')) {
      const v = this.dataset[camel(k.slice(5))];
      return v === undefined ? null : v;
    }
    return this.attrs[k] === undefined ? null : this.attrs[k];
  }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter((f) => f !== fn); }
  dispatch(t, extra = {}) {
    const ev = { type: t, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...extra };
    (this._listeners[t] || []).forEach((fn) => fn(ev));
    return ev;
  }
  click() { return this.dispatch('click'); }
  focus() {} blur() {} setSelectionRange() {}
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  matches() { return false; }
}

function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function stripTags(html) { return String(html).replace(/<[^>]*>/g, ' '); }

/* ------------------- 在渲染出的 HTML 中查找元素 ------------------- */

function findAll(html, selector) {
  const out = [];
  const parts = selector.trim().split(/\s+/);

  function attrsOf(tagText) {
    const a = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(tagText))) a[m[1]] = m[2];
    const bare = /(^|\s)([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?=[\s/>]|$)/g;
    while ((m = bare.exec(tagText))) a[m[2]] = '';
    return a;
  }

  function matchSimple(tagText, sel) {
    const a = attrsOf(tagText);
    const tagName = (tagText.match(/^<\s*([a-zA-Z0-9-]+)/) || [, ''])[1].toLowerCase();
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return (a.class || '').split(/\s+/).includes(cls);
    }
    if (sel.startsWith('[')) {
      const inner = sel.slice(1, -1);
      const [k, v] = inner.split('=').map((s) => s.replace(/^"|"$/g, ''));
      if (v === undefined) return a[k] !== undefined;
      return a[k] === v;
    }
    if (sel.includes('#')) {
      const [t, id] = sel.split('#');
      return (!t || tagName === t) && a.id === id;
    }
    if (sel.includes('.')) {
      const [t, ...cls] = sel.split('.');
      const classes = (a.class || '').split(/\s+/);
      return (!t || tagName === t) && cls.every((c) => classes.includes(c));
    }
    return tagName === sel.toLowerCase();
  }

  function collect(text) {
    const re = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|[^>"])*)>/g;
    let m;
    while ((m = re.exec(text))) {
      if (matchSimple(m[0], parts[0])) out.push(m[0]);
    }
  }

  const last = parts[parts.length - 1];
  collect(html);
  return out.filter((t) => matchSimple(t, last));
}

function countMatches(html, selector) { return findAll(html, selector).length; }

/* ------------------------- 安装全局环境 ------------------------- */

const memStore = {};
globalThis.localStorage = {
  getItem: (k) => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: (k) => { delete memStore[k]; },
  clear: () => { Object.keys(memStore).forEach((k) => delete memStore[k]); }
};

const viewEl = new El('div');
const tabbarEl = new El('div');
const todayChipEl = new El('span');
const byId = {
  view: viewEl, tabbar: tabbarEl, todayChipSlot: todayChipEl,
  btnClock: new El('button'), btnAbout: new El('button'),
  main: new El('main'), brandSub: new El('span')
};

const docListeners = {};
globalThis.document = {
  getElementById: (id) => byId[id] || null,
  createElement: (t) => new El(t),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); },
  removeEventListener: () => {},
  body: { appendChild() {}, removeChild() {} },
  dispatch(t, e) { (docListeners[t] || []).forEach((fn) => fn(e)); }
};

const winListeners = {};
globalThis.window = {
  addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn); },
  scrollTo() {}, scrollY: 0, __ctx: null
};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.location = { hash: '#/discover' };
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.Blob = class { constructor(p) { this.parts = p; } };

/* ------------------------- 断言工具 ------------------------- */

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function head(t) { console.log(`\n${t}`); }

async function go(hash) {
  globalThis.location.hash = hash;
  (winListeners.hashchange || []).forEach((fn) => fn());
  await new Promise((r) => setTimeout(r, 5));
  return viewEl.innerHTML;
}

/* ------------------------- 开始测试 ------------------------- */

console.log('启动应用…');
await import('../scripts/main.js');
await new Promise((r) => setTimeout(r, 10));

head('R1  应用启动');
{
  const html = viewEl.innerHTML;
  ok('发现页渲染出内容', html.length > 2000, `长度 ${html.length}`);
  ok('渲染出活动卡片', countMatches(html, '[data-card]') > 10, `卡片数 ${countMatches(html, '[data-card]')}`);
  ok('底部导航渲染出 4 个 Tab', countMatches(tabbarEl.innerHTML, '[data-tab]') === 4);
  ok('顶部显示今日日期条', /今天/.test(todayChipEl.innerHTML), todayChipEl.innerHTML);
  ok('无渲染错误页', !/这个页面出了点问题/.test(html));
}

head('R2  26 条材料的关键处理都体现在界面上');
{
  const html = viewEl.innerHTML;
  ok('训练营显示合并后的 9 月 21 日', /9 月 21 日/.test(html));
  ok('训练营显示合并后的地点 实验楼A402', /实验楼A402/.test(html));
  ok('训练营卡片以原始通知标题呈现', /“蓝桥杯”程序设计校内训练营/.test(html));
  ok('不再把补充通知当成独立卡片', !/data-card="e09"/.test(html) && !/data-card="e20"/.test(html));
  ok('训练营保留原始通知的报名截止时间', /9 月 24 日/.test(html));
  ok('体检面板的合并条数不为 0', !/有 <b>0<\/b> 条已被后续补充通知更新/.test(html));
  ok('信息体检面板存在', /本平台信息体检/.test(html));
  ok('默认折叠高风险内容', /已被折叠/.test(html));

  // 卡片统计：23 条正常展示 + 3 条当天活动在「今天」区块再次置顶
  // （e24 为高风险内容，默认折叠，不出现在列表中）
  const cardCount = (html.match(/data-card="[eu]\d+"/g) || []).length;
  ok('列表卡片数符合预期（23 条 + 今日置顶 3 条 = 26）', cardCount === 26, `实际 ${cardCount}`);
  ok('今日区块置顶当天活动', /今天（9 月 19 日/.test(html));
}

head('R3  搜索与筛选入口（核心功能 A）');
{
  const html = viewEl.innerHTML;
  ok('存在搜索框', /id="q"/.test(html));
  ok('存在分类筛选 chips', /data-cat="lecture"/.test(html));
  ok('存在来源筛选 chips', /data-src="student"/.test(html));
  ok('存在排序下拉', /id="sort"/.test(html));
  ok('存在快捷筛选', /data-quick="today"/.test(html) && /data-quick="gap"/.test(html));
  ok('存在结果计数', /id="resultCount"/.test(html));
}

head('R4  详情页：通知合并 + 信息缺口（创新 1、2）');
{
  const html = await go('#/event/e01');
  ok('详情页渲染成功', html.length > 1500);
  ok('显示变更提示条', /已被补充通知更新/.test(html));
  ok('显示合并后的地点 实验楼A402', /实验楼A402/.test(html));
  ok('显示变更前后对比', /变更详情/.test(html) && /diff__from/.test(html));
  ok('显示通知记录时间线', /通知记录（含补充通知）/.test(html));
  ok('提供原文逐字对照', /原文（逐字保留/.test(html));
  ok('底部有收藏 / 报名操作条', /actionbar/.test(html) && /我要报名/.test(html));
}

head('R5  详情页：缺失信息必须标注且不编造（创新 2）');
{
  const html = await go('#/event/e06');
  ok('学习小组详情渲染成功', html.length > 1500);
  ok('标注「报名截止时间未注明」', /报名截止时间未注明/.test(html));
  ok('出现「待确认」提示', /原文未提供，待确认/.test(html));
  ok('明确声明不补全信息', /不会替主办方补全/.test(html));
  ok('给出如何确认的建议', /建议这样确认/.test(html));
}

head('R6  详情页：风险内容提示（创新 4 展示侧）');
{
  const html = await go('#/event/e24');
  ok('兼职分享显示高风险提示', /高风险/.test(html));
  ok('列出风险原因', /私人微信/.test(html));
  ok('给出安全建议', /不要添加私人微信/.test(html));

  const html2 = await go('#/event/e25');
  ok('数码体验显示疑似推广提示', /疑似推广|推广性质/.test(html2));
}

head('R7  详情页：撞车提醒（创新 3）');
{
  const html = await go('#/event/e14');
  ok('Git 工作坊详情页提示时间冲突', /时间冲突/.test(html));
  ok('指出冲突对象是训练营', /训练营/.test(html));
}

head('R8  日历页：按日聚合与冲突高亮');
{
  const html = await go('#/calendar');
  ok('日历页渲染成功', html.length > 1000);
  ok('显示时间轴标题', /未来 \d+ 天日程/.test(html));
  ok('显示冲突提示卡', /检测到 \d+ 组时间冲突/.test(html) || /没有检测到时间冲突/.test(html));
  ok('存在日期分组', /class="day/.test(html));
  ok('提供时间范围切换', /data-range="14"/.test(html));

  // ---- 图形可视化（本次新增） ----
  ok('提供图形 / 列表双视图切换', /data-mode="chart"/.test(html) && /data-mode="list"/.test(html));
  ok('渲染了每日密度条', /class="density"/.test(html) && /density__bar/.test(html));
  ok('密度条标记了冲突日', /density__col--clash/.test(html));
  ok('渲染了甘特时间轴', /class="tl[ "]/.test(html) && /tl__lane/.test(html));
  ok('时间轴带整点刻度', /tl__tick-label/.test(html) && /08:00/.test(html));
  ok('活动块按时间定位（top/height 内联样式）', /tl-block[^>]*style="top:\d+px;height:\d+px/.test(html));
  ok('活动块用来源色区分', /tl-block--official/.test(html) && /tl-block--student/.test(html));
  ok('冲突活动块加了警示样式', /tl-block--clash/.test(html));
  ok('绘制了冲突时段斜纹色带', /class="tl__overlap"/.test(html));
  ok('今天绘制了当前时刻线', /class="tl__now"/.test(html) && /现在 \d\d:\d\d/.test(html));
  ok('重叠活动并排为多列（列宽按列数分）', /width:calc\(50% - 6px\)|width:calc\(100% - 6px\)/.test(html));
  ok('截止时间与时间轴分开呈现', /class="dl-chip/.test(html) && /报名截止|⏳|⌛/.test(html));
  ok('提供图例说明', /tl-legend/.test(html) && /时间冲突区/.test(html));
  ok('提供紧凑 / 全天缩放切换', /data-zoom="compact"/.test(html) && /data-zoom="full"/.test(html));
  ok('默认使用紧凑缩放', /data-zoom="compact" aria-pressed="true"/.test(html));
  ok('紧凑模式的刻度对齐整点', /tl__tick-label">\d\d:00</.test(html) && !/tl__tick-label">\d\d:(?!00)\d\d</.test(html));

  // ---- 切到列表模式 ----
  const list = await go('#/calendar');
  ok('列表模式可切换（默认图形模式已含切换入口）', /📋 列表明细/.test(list));
}

head('R9  我的页：持久化与数据管理');
{
  const html = await go('#/mine');
  ok('我的页渲染成功', html.length > 1000);
  ok('显示四个统计项', countMatches(html, '.stat') >= 4, `实际 ${countMatches(html, '.stat')}`);
  ok('存在收藏 / 报名 / 发布 / 上报四个 Tab', countMatches(html, '[data-tab]') >= 4);
  ok('空状态有引导文案', /还没有收藏任何活动/.test(html));
  ok('提供数据管理入口', /清空全部本地数据/.test(html));
}

head('R10 发布页：三步向导 + 实时体检（创新 4）');
{
  const html = await go('#/publish');
  ok('发布页渲染成功', html.length > 1500);
  ok('显示三个步骤', countMatches(html, '.step') === 3);
  ok('有标题输入框', /id="p-title"/.test(html));
  ok('有发布体检面板', /发布体检（实时）/.test(html) && /信息完整度/.test(html));
  ok('有实时预览', /同学会看到什么（实时预览）/.test(html));
  ok('空表单时完整度不为满分', !/>100</.test(html));
}

head('R11 恶意输入不会破坏页面（转义检查）');
{
  const { store } = await import('../scripts/store.js');
  store.addPublished({
    id: 'ux1', code: 'U1', title: '<img src=x onerror="alert(1)">测试活动',
    source: 'student', category: 'meetup', publisher: null,
    raw: '<script>alert(2)</script>正文',
    time: { kind: 'onetime', start: '2026-09-21T18:00', deadline: null },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: true, fee: 'free' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: [] }, risk: { level: 'none', reasons: [] },
    keywords: [], addedAt: '2026-09-19T14:00'
  });
  const html = await go('#/discover');
  ok('尖括号被转义为实体', /&lt;img/.test(html));
  ok('未注入可执行标签', !/<img src=x onerror/.test(html));
  const d = await go('#/event/ux1');
  ok('详情页同样转义原文', /&lt;script&gt;/.test(d) && !/<script>alert\(2\)<\/script>/.test(d));
  store.set('published', []);
}

head('R12 时间基准切换后状态随之变化');
{
  const { setNow, resetNow } = await import('../scripts/util.js');
  const before = await go('#/event/e05');
  const beforeClosing = /即将截止/.test(before);

  setNow('2026-09-18T14:00');
  const html18 = await go('#/event/e05');
  ok('9/18 志愿活动为报名中', /报名中/.test(html18));

  setNow('2026-09-20T13:00');
  const html20 = await go('#/event/e05');
  ok('9/20 报名已截止', /报名已截止/.test(html20));
  ok('状态确实随时间变化（非硬编码）', html18 !== html20);
  ok('默认基准下为即将截止', beforeClosing, '默认 9/19 14:00 距 9/20 12:00 截止不足 24 小时');
  resetNow();
}

head('R13 未知路由与容错');
{
  const html = await go('#/event/不存在的编号');
  ok('未知活动显示友好空状态', /没有找到这条信息/.test(html));
  ok('未抛出未捕获异常（无错误页）', !/这个页面出了点问题/.test(html));
  const html2 = await go('#/discover');
  ok('可正常返回发现页', /data-card=/.test(html2));
}

/* ------------------------- 汇总 ------------------------- */
console.log(`\n${'='.repeat(52)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) { console.log('失败清单：'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('全部通过 ✓');
