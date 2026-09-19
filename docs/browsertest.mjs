/**
 * 真实浏览器渲染校验脚本
 * ------------------------------------------------------------------
 * 用法：node docs/browsertest.mjs [站点根地址]
 *
 * 为什么需要它：
 *   docs/rendertest.mjs 与 flowtest.mjs 使用自写的轻量 DOM 桩，能验证
 *   「渲染出什么文案」与「点下去发生什么」，但它们毕竟不是浏览器。
 *   本脚本调用真实浏览器（Edge / Chrome 的 headless 模式）加载页面，
 *   抓取**真实执行 JavaScript 之后**的 DOM，用于兜住三类桩测试漏掉的问题：
 *     1. 模块路径或 MIME 问题导致脚本没执行（页面白屏）
 *     2. 真实 DOM 下才暴露的渲染分支错误（例如合并视图取错条目）
 *     3. 各路由（#/calendar、#/mine、#/publish、#/event/xxx）是否都能打开
 *
 * 注意：本脚本需要能启动浏览器进程，因此在受限沙箱下可能无法运行；
 *       无法运行时请手动在浏览器中打开各页面核对（见 docs/测试用例.md）。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:5199';

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('未找到 Edge / Chrome，跳过真实浏览器校验。');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'cl-browser-'));
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function head(t) { console.log(`\n${t}`); }

/** 用真实浏览器加载页面并返回执行 JS 之后的 DOM */
function dumpDom(url) {
  const args = [
    '--headless', '--disable-gpu', '--no-sandbox', '--disable-crash-reporter',
    '--no-first-run', '--disable-extensions',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=8000',
    '--dump-dom', url
  ];
  try {
    return execFileSync(browser, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024
    });
  } catch (e) {
    return (e.stdout || '').toString();
  }
}

console.log(`浏览器：${browser}`);
console.log(`站点  ：${BASE}`);

/* ---------------- B1 首页真实渲染 ---------------- */
head('B1  首页在真实浏览器中完成渲染（脚本确实执行了）');
const home = dumpDom(`${BASE}/index.html`);
ok('拿到了 DOM', home.length > 3000, `长度 ${home.length}`);
ok('页面无错误回退', !/这个页面出了点问题/.test(home));
ok('渲染出活动卡片', (home.match(/data-card="[eu]\d+"/g) || []).length > 15);
ok('底部导航已渲染', /class="tab"/.test(home));
ok('今日日期条已渲染', /今天 9 月 19 日/.test(home));

head('B2  补充通知合并后的展示正确');
ok('训练营卡片使用原始通知标题', /“蓝桥杯”程序设计校内训练营/.test(home));
ok('训练营用了补充通知的新地点', /实验楼A402/.test(home));
ok('训练营保留了原始通知的报名截止时间', /9 月 24 日/.test(home));
ok('补充通知不再作为独立卡片出现', !/data-card="e09"/.test(home) && !/data-card="e20"/.test(home));
ok('信息体检的合并条数不是 0', !/有 <b>0<\/b> 条已被后续补充通知更新/.test(home));

head('B3  26 条材料的关键结论都出现在页面上');
ok('高风险内容默认折叠', /已被折叠/.test(home));
ok('待确认标注出现', /待确认/.test(home));
ok('来源分类标识出现', /同学发布/.test(home));

/* ---------------- B4 各路由都能打开 ---------------- */
head('B4  各页面路由在真实浏览器中都能打开');
const routes = [
  ['#/event/e01', '训练营详情'],
  ['#/event/e09', '补充通知详情（应规范化为原活动）'],
  ['#/calendar', '日历页'],
  ['#/mine', '我的页'],
  ['#/publish', '发布页']
];
for (const [hash, label] of routes) {
  const dom = dumpDom(`${BASE}/index.html${hash}`);
  ok(`${label} 正常渲染`, dom.length > 3000 && !/这个页面出了点问题/.test(dom),
    `长度 ${dom.length}`);
}

// 未知路由应给出友好空状态，而不是错误页；此时 DOM 本来就短，单独判定
{
  const dom = dumpDom(`${BASE}/index.html#/event/不存在的编号`);
  ok('未知活动显示友好空状态', /没有找到这条信息/.test(dom), `长度 ${dom.length}`);
  ok('未知活动未触发错误回退页', !/这个页面出了点问题/.test(dom));
}

head('B5  详情页与日历页的核心内容');
{
  const d = dumpDom(`${BASE}/index.html#/event/e01`);
  ok('详情页显示变更提示', /已被补充通知更新/.test(d));
  ok('详情页显示变更前后对比', /变更详情/.test(d));
  ok('详情页保留原文对照', /原文（逐字保留/.test(d));
  ok('详情页有报名操作', /我要报名/.test(d));

  const c = dumpDom(`${BASE}/index.html#/calendar`);
  ok('日历页显示时间轴', /时间轴/.test(c));
  ok('日历页有日期分组', /class="day/.test(c));

  const p = dumpDom(`${BASE}/index.html#/publish`);
  ok('发布页显示体检面板', /发布体检（实时）/.test(p));
  ok('发布页有三个步骤', /class="step/.test(p));
}

rmSync(profile, { recursive: true, force: true });

console.log(`\n${'='.repeat(52)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) { console.log('失败清单：'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('全部通过 ✓');
