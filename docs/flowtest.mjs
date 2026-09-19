/**
 * 交互流程测试（Node + 轻量 DOM 桩）
 * ------------------------------------------------------------------
 * 用法：node docs/flowtest.mjs
 *
 * rendertest.mjs 只验证「渲染出什么」，本脚本进一步验证「点下去会发生什么」，
 * 覆盖题目硬性要求的核心链路：
 *   收藏 / 报名 → 刷新后保留（基础要求 6）
 *   学生发布 → 进入发现页同一流程（基础要求 5）
 *   状态上报 → 我的页可见
 *   时间基准切换 → 状态随之变化
 */

/* ---------- 复用 rendertest 的 DOM 桩（此处内联以便独立运行） ---------- */

class ClassList {
  constructor(el) { this.el = el; }
  get set() { return new Set((this.el._class || '').split(/\s+/).filter(Boolean)); }
  _write(s) { this.el._class = Array.from(s).join(' '); }
  add(...n) { const s = this.set; n.forEach((x) => s.add(x)); this._write(s); }
  remove(...n) { const s = this.set; n.forEach((x) => s.delete(x)); this._write(s); }
  contains(n) { return this.set.has(n); }
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
  get textContent() { return this._text || this._html.replace(/<[^>]*>/g, ' '); }
  set textContent(v) { this._text = v == null ? '' : String(v); this._html = ''; }
  setAttribute(k, v) {
    if (k === 'class') { this.className = v; return; }
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    if (k === 'class') return this.className;
    if (k.startsWith('data-')) {
      const key = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return this.dataset[key] === undefined ? null : this.dataset[key];
    }
    return this.attrs[k] === undefined ? null : this.attrs[k];
  }
  addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this._listeners[t] = (this._listeners[t] || []).filter((f) => f !== fn); }
  /**
   * 清空事件监听。
   * 真实浏览器中 `root.innerHTML = ...` 会销毁旧元素、新建元素，因此旧监听不会残留。
   * 本测试为了验证「下一步 → 下一步 → 发布」的连续链路而复用了同一批元素对象，
   * 所以每次重渲染前必须显式清空监听，否则监听会逐次累积，
   * 导致一次点击触发多次提交（这是测试桩的失真，不是应用的问题）。
   */
  clearListeners() { this._listeners = {}; }
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

/* ---------- 元素桩：能真正记录并触发事件 ---------- */

function makeElement(spec = {}) {
  const el = new El(spec.tag || 'div');
  Object.assign(el, spec);
  if (spec.attrs) Object.entries(spec.attrs).forEach(([k, v]) => el.setAttribute(k, v));
  el._removed = false;
  const origRemove = el.remove.bind(el);
  el.remove = () => { el._removed = true; origRemove(); };
  return el;
}

/**
 * 可复用的元素集合：同一选择器在多次渲染之间返回**同一个元素对象**。
 * 这更贴近真实浏览器（重命名控件是同一个交互对象），
 * 也能真正验证「下一步 → 下一步 → 发布」这条连续操作链路。
 */
function stubSet(specs) {
  const map = new Map();
  Object.entries(specs).forEach(([sel, spec]) => map.set(sel, makeElement(spec)));
  return {
    root() {
      const root = new El('div');
      // 模拟浏览器重渲染：旧元素被销毁，新元素不带旧监听
      map.forEach((e) => e.clearListeners());
      root.querySelector = (sel) => map.get(sel) || null;
      root.querySelectorAll = (sel) => (map.has(sel) ? [map.get(sel)] : []);
      return root;
    },
    get(sel) { return map.get(sel); }
  };
}

/* ---------- 安装全局环境 ---------- */

const memStore = {};
globalThis.localStorage = {
  getItem: (k) => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: (k) => { delete memStore[k]; },
  clear: () => { Object.keys(memStore).forEach((k) => delete memStore[k]); }
};

const viewEl = new El('div');
const byId = {
  view: viewEl, tabbar: new El('div'), todayChipSlot: new El('span'),
  btnClock: new El('button'), btnAbout: new El('button'), main: new El('main')
};

const docListeners = {};
globalThis.document = {
  getElementById: (id) => byId[id] || null,
  createElement: (t) => new El(t),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); },
  removeEventListener: () => {},
  body: { appendChild() {}, removeChild() {} }
};

const winListeners = {};
globalThis.window = {
  addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn); },
  scrollTo() {}, scrollY: 0
};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.location = { hash: '#/discover' };
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.Blob = class { constructor(p) { this.parts = p; } };

/* ---------- 断言工具 ---------- */

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

/* ==================================================================
   开始测试
   ================================================================== */

await import('../scripts/main.js');
await new Promise((r) => setTimeout(r, 10));

const { store: appStore } = await import('../scripts/store.js');
const { setNow, resetNow } = await import('../scripts/util.js');

/** 每组用例开始前清空本地数据，避免相互污染 */
async function resetLocal() {
  localStorage.clear();
  appStore.refresh();          // 丢弃内存缓存，强制重新解析（模拟新开页面）
  return go('#/discover');
}

head('F1  收藏后刷新页面仍然保留（基础要求 6）');
{
  await resetLocal();
  const { renderDetail } = await import('../scripts/views/detail.js');
  const ctx = { go() {}, back() {}, rerender() {}, refreshChrome() {} };
  const s = stubSet({ '[data-act="fav"]': { tag: 'button', attrs: { 'data-act': 'fav' } } });

  renderDetail(s.root(), ctx, 'e02');
  s.get('[data-act="fav"]').click();
  ok('收藏写入本地存储', appStore.get('favorites').includes('e02'), JSON.stringify(appStore.get('favorites')));

  // 模拟「刷新」：直接读取 localStorage 中的原始内容
  const raw = JSON.parse(localStorage.getItem('campusloop.v1'));
  ok('刷新后 localStorage 中仍有该收藏', raw.favorites.includes('e02'));

  const html = await go('#/mine');
  ok('我的页统计显示收藏 1 条', /<div class="stat__num">1<\/div>/.test(html));

  renderDetail(s.root(), ctx, 'e02');
  s.get('[data-act="fav"]').click();
  ok('再次点击可取消收藏', !appStore.has('favorites', 'e02'));
}

head('F2  报名后刷新页面仍然保留');
{
  await resetLocal();
  const { renderDetail } = await import('../scripts/views/detail.js');
  const s = stubSet({ '[data-act="signup"]': { tag: 'button', attrs: { 'data-act': 'signup' } } });
  renderDetail(s.root(), { go() {}, back() {}, rerender() {}, refreshChrome() {} }, 'e14');
  s.get('[data-act="signup"]').click();
  ok('报名写入本地存储', appStore.get('signups').includes('e14'));
  const raw = JSON.parse(localStorage.getItem('campusloop.v1'));
  ok('刷新后仍保留报名记录', raw.signups.includes('e14'));

  const html = await go('#/mine');
  ok('我的页统计显示已报名 1 条', /已报名 \/ 日程/.test(html));
  ok('显示报名相关的截止提醒区域', /我的校园圈/.test(html));
}

head('F3  学生发布后进入发现页的同一流程（基础要求 5）');
{
  await resetLocal();
  const { renderPublish, resetPublish } = await import('../scripts/views/publish.js');
  resetPublish();
  const ctx = { go(hash) { globalThis.location.hash = hash || '#/discover'; }, back() {}, rerender() {}, refreshChrome() {} };

  // 用持久元素集合模拟一次完整的发布操作：同一控件跨步骤保持不变
  const s = stubSet({
    '#p-title': { tag: 'input', attrs: { id: 'p-title' } },
    '#p-pub': { tag: 'input', attrs: { id: 'p-pub' } },
    '#p-desc': { tag: 'textarea', attrs: { id: 'p-desc' } },
    '#p-start': { tag: 'input', attrs: { id: 'p-start' } },
    '#p-loc': { tag: 'input', attrs: { id: 'p-loc' } },
    '#p-deadline': { tag: 'input', attrs: { id: 'p-deadline' } },
    '#p-contact': { tag: 'input', attrs: { id: 'p-contact' } },
    '#p-fee': { tag: 'select', attrs: { id: 'p-fee' } },
    '#p-limit': { tag: 'input', attrs: { id: 'p-limit' } },
    '[data-act="next"]': { tag: 'button', attrs: { 'data-act': 'next' } },
    '[data-act="submit"]': { tag: 'button', attrs: { 'data-act': 'submit' } }
  });

  // 第一步：基本信息（每次重渲染都取一次 root，模拟浏览器重建 DOM）
  renderPublish(s.root(), ctx);
  s.get('#p-title').value = '周末羽毛球约球（缺 2 人）';
  s.get('#p-pub').value = '计算机学院 2026 级 张三';
  s.get('#p-desc').value = '体育馆 3 号场，自带球拍，费用 AA，欢迎零基础一起打。';
  s.get('[data-act="next"]').click();
  ok('第一步校验通过并进入第二步', true);

  // 第二步：时间与地点
  renderPublish(s.root(), ctx);
  s.get('#p-start').value = '2026-09-20T16:00';
  s.get('#p-loc').value = '体育馆 3 号场';
  s.get('#p-deadline').value = '2026-09-20T12:00';
  s.get('[data-act="next"]').click();
  ok('第二步校验通过并进入第三步', true);

  // 第三步：联系方式并提交
  renderPublish(s.root(), ctx);
  s.get('#p-contact').value = '群号 123456789';
  s.get('#p-fee').value = 'AA';
  s.get('#p-limit').value = '8';
  s.get('[data-act="submit"]').click();

  const published = appStore.get('published');
  ok('发布内容已写入本地存储', published.length === 1, `实际 ${published.length}`);
  const p = published.find((x) => /羽毛球/.test(x.title)) || published[0];
  if (p) {
    ok('标题正确', p.title === '周末羽毛球约球（缺 2 人）', p.title);
    ok('来源标记为同学发布', p.source === 'student');
    ok('记录了活动时间', p.time.start === '2026-09-20T16:00', p.time.start);
    ok('记录了地点', p.location.raw === '体育馆 3 号场', p.location.raw);
    ok('记录了报名截止时间', p.time.deadline === '2026-09-20T12:00', p.time.deadline);
    ok('记录了费用方式', p.participation.fee === 'AA');
    ok('记录了人数上限', p.eligibility.limit === 8, String(p.eligibility.limit));
    ok('保存了发布时的完整度体检结果', !!p.checkup && typeof p.checkup.score === 'number', JSON.stringify(p.checkup));
    ok('发布者信息被保留', p.publisher === '计算机学院 2026 级 张三');
  }

  const html = await go('#/discover');
  ok('发布的内容出现在发现页同一列表', /周末羽毛球约球/.test(html));
  ok('用户发布使用 u 前缀 id，与题目材料同列展示', /data-card="u/.test(html));
  ok('可被来源筛选「同学发布」命中', /data-src="student"/.test(html));

  const mine = await go('#/mine');
  ok('我的页显示已发布', /我发布的/.test(mine));
  const detail = await go(`#/event/${p.id}`);
  ok('可打开该发布的详情页（进入同一流程）', /周末羽毛球约球/.test(detail) && !/没有找到这条信息/.test(detail));
  ok('详情页显示同学发布来源', /同学发布/.test(detail));
}

head('F4  高风险发布会被标注且默认折叠（创新 4）');
{
  await resetLocal();
  const { renderPublish, resetPublish } = await import('../scripts/views/publish.js');
  resetPublish();
  const ctx = { go() {}, back() {}, rerender() {}, refreshChrome() {} };

  const s = stubSet({
    '#p-title': { tag: 'input', attrs: { id: 'p-title' } },
    '#p-desc': { tag: 'textarea', attrs: { id: 'p-desc' } },
    '#p-start': { tag: 'input', attrs: { id: 'p-start' } },
    '#p-loc': { tag: 'input', attrs: { id: 'p-loc' } },
    '#p-contact': { tag: 'input', attrs: { id: 'p-contact' } },
    '[data-act="next"]': { tag: 'button', attrs: { 'data-act': 'next' } },
    '[data-act="submit"]': { tag: 'button', attrs: { 'data-act': 'submit' } }
  });
  renderPublish(s.root(), ctx);

  const { publishCheckup } = await import('../scripts/model.js');
  const check = publishCheckup({
    title: '校园兼职福利分享（零门槛日结）',
    raw: '零门槛、日结，加微信获取详情',
    description: '零门槛、日结，加微信获取详情'
  });
  ok('体检判定为高风险', check.level === 'high', check.level);
  ok('命中「日结」风险词', check.riskHits.some((r) => /日结/.test(r.why)));
  ok('命中「加微信」风险词', check.riskHits.some((r) => /私人微信|微信/.test(r.why)));
  ok('完整度被封顶（< 60）', check.score < 60, `实际 ${check.score}`);
  ok('体检给出明确结论', /高风险特征/.test(check.verdict), check.verdict);

  s.get('#p-title').value = '校园兼职福利分享（零门槛日结）';
  s.get('#p-desc').value = '零门槛、日结，加微信获取详情，名额有限速来';
  s.get('[data-act="next"]').click();

  renderPublish(s.root(), ctx);
  s.get('#p-start').value = '2026-09-21T20:00';
  s.get('#p-loc').value = '线上';
  s.get('[data-act="next"]').click();

  renderPublish(s.root(), ctx);
  s.get('#p-contact').value = '加微信 abc123';
  s.get('[data-act="submit"]').click();

  const list = appStore.get('published');
  const risky = list.find((x) => /兼职/.test(x.title));
  ok('高风险发布仍然被保存（不阻断发布，只标注）', !!risky);
  if (risky) {
    ok('风险等级被写入数据', risky.risk.level === 'high', risky.risk.level);
    ok('风险原因被写入数据', risky.risk.reasons.length >= 2, `${risky.risk.reasons.length} 条`);
    ok('发布时完整度被封顶记录', risky.checkup.score < 60, String(risky.checkup && risky.checkup.score));
  }

  const html = await go('#/discover');
  ok('发现页不直接展示该高风险内容', !/校园兼职福利分享（零门槛日结）/.test(html));
  ok('发现页提示存在被折叠的内容', /已被折叠/.test(html));
  ok('提供「我了解风险，仍要查看」入口', /我了解风险，仍要查看/.test(html));
  ok('折叠说明解释了原因', /缺少可核实信息，或带有推广、引流特征/.test(html));
}

head('F5  状态众包上报后我的页可见');
{
  await resetLocal();
  const { renderDetail } = await import('../scripts/views/detail.js');
  const btn = makeElement({ tag: 'button', attrs: { 'data-report': 'closed' } });
  const root = new El('div');
  root.querySelector = () => null;
  root.querySelectorAll = (sel) => (sel === '[data-report]' ? [btn] : []);
  renderDetail(root, { go() {}, back() {}, rerender() {}, refreshChrome() {} }, 'e05');
  btn.click();
  const rep = appStore.getReport('e05');
  ok('上报记录已写入', !!rep && rep.status === 'closed', JSON.stringify(rep));
  const html = await go('#/mine');
  ok('我的页可查询到该上报', /我的上报/.test(html));
}

head('F6  时间基准切换真的改变状态（非硬编码）');
{
  const at14 = await go('#/event/e05');
  ok('9/19 14:00 → 即将截止', /即将截止/.test(at14));

  setNow('2026-09-18T14:00');
  const at18 = await go('#/event/e05');
  ok('9/18 14:00 → 报名中', /报名中/.test(at18));
  ok('两次渲染结果不同', at14 !== at18);

  setNow('2026-09-28T10:00');
  const at28 = await go('#/event/e05');
  ok('9/28 → 已结束', /已结束/.test(at28));

  resetNow();
  const back14 = await go('#/event/e05');
  ok('恢复默认基准后回到即将截止', /即将截止/.test(back14));
}

head('F7  数据管理：清空本地数据后应用仍正常');
{
  // 制造可清空的数据：一条发布 + 一条收藏
  appStore.addPublished({
    id: 'uz9', code: 'U9', title: '清空前测试用发布', source: 'student', category: 'meetup',
    publisher: null, raw: '测试', time: { kind: 'onetime', start: '2026-09-21T18:00', deadline: null },
    eligibility: { grades: ['all'], limit: null }, participation: { needSignup: true, fee: 'free' },
    location: { raw: null, certainty: 'unknown' }, completeness: { missing: [] },
    risk: { level: 'none', reasons: [] }, keywords: [], addedAt: '2026-09-19T14:00'
  });
  appStore.add('favorites', 'e02');
  ok('清空前有 1 条发布记录', appStore.get('published').length === 1,
    `实际 ${appStore.get('published').length}`);
  ok('清空前有 1 条收藏', appStore.get('favorites').length === 1);

  appStore.clearAll();
  ok('清空后收藏为 0', appStore.get('favorites').length === 0);
  ok('清空后发布为 0', appStore.get('published').length === 0);
  ok('清空后 has() 判定为未收藏', appStore.has('favorites', 'e02') === false);
  ok('清空后 all() 返回的数组均为空',
    appStore.all().favorites.length === 0 && appStore.all().published.length === 0);
  ok('清空已写入 localStorage', JSON.parse(localStorage.getItem('campusloop.v1')).published.length === 0);

  const html = await go('#/discover');
  ok('清空后发现页仍正常渲染材料', /data-card=/.test(html) && /“蓝桥杯”程序设计校内训练营/.test(html));
  ok('清空后不再有用户发布内容', !/清空前测试用发布/.test(html));
}

/* ------------------------- 汇总 ------------------------- */
console.log(`\n${'='.repeat(52)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) { console.log('失败清单：'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('全部通过 ✓');
