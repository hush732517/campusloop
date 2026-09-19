/**
 * 计算元素实际几何信息（真实浏览器），用于验证图形可视化的排版
 * ------------------------------------------------------------------
 * 用法：node docs/measure.mjs <url> <选择器> [更多选择器...]
 *
 * 为什么需要它：
 *   DOM 断言只能证明「元素存在」，无法证明「元素被摆在了正确的位置」。
 *   时间轴这类图形化视图的关键正确性在于坐标——块的 top/height 是否与
 *   时间成正比、刻度线是否真的横跨泳道、并排的块是否真的不重叠。
 *   本脚本通过 CDP 读取真实布局盒模型来验证这些。
 *
 * 实现说明：通过 Chrome DevTools Protocol 的 Runtime.evaluate 在页面里
 *   执行测量脚本。需要浏览器支持 --remote-debugging-port。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, ...selectors] = process.argv.slice(2);
if (!url) {
  console.error('用法：node docs/measure.mjs <url> <选择器...>');
  process.exit(1);
}

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];
const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) { console.error('未找到 Edge / Chrome'); process.exit(2); }

const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'cl-measure-'));
const child = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-crash-reporter',
  '--no-first-run', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`, '--window-size=1000,1400', url
], { stdio: 'ignore', detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpTargets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* 浏览器还没起来 */ }
    await sleep(400);
  }
  throw new Error('无法连接到浏览器调试端口');
}

function rpc(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => reject(new Error('CDP 超时: ' + method)), 20000);
  });
}

const expr = `(() => {
  const sels = ${JSON.stringify(selectors)};
  const out = [];
  const round = (n) => Math.round(n * 100) / 100;

  // 网格线：用伪元素无法直接量，改为检查 tick 是否铺满泳道宽度
  const lane = document.querySelector('.tl__lane');
  const laneRect = lane ? lane.getBoundingClientRect() : null;

  for (const sel of sels) {
    const els = Array.from(document.querySelectorAll(sel));
    els.slice(0, 40).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // 所属日期卡片的序号：用于把「同一天内的刻度间距」与跨天的偏移区分开
      const card = el.closest('.day');
      const dayIdx = card ? Array.from(document.querySelectorAll('.day')).indexOf(card) : -1;
      out.push({
        sel, idx: i, dayIdx,
        top: round(r.top), left: round(r.left),
        w: round(r.width), h: round(r.height),
        cssTop: el.style.top || null,
        cssHeight: el.style.height || null,
        pos: cs.position, bg: cs.backgroundColor,
        text: (el.textContent || '').trim().slice(0, 26)
      });
    });
  }

  // tick 标签是否落在左侧刻度栏内（即没有被裁掉或跑到泳道里）
  const axis = document.querySelector('.tl__axis');
  const axisRect = axis ? axis.getBoundingClientRect() : null;
  const labels = Array.from(document.querySelectorAll('.tl__tick-label'));
  const labelsInAxis = axisRect
    ? labels.filter((l) => l.getBoundingClientRect().right <= axisRect.right + 1).length
    : 0;

  // 活动块的排版检查。
  // 教训：曾把「单行紧凑块」的高度阈值写成 44px，结果 42px 的块也被并排显示，
  // 标题与时间被推到块的两端、中间留出大片空白，视觉上像排版错乱。
  const blocks = Array.from(document.querySelectorAll('.tl-block'));
  const blockLayout = blocks.map((b) => ({
    h: Math.round(b.getBoundingClientRect().height),
    dir: getComputedStyle(b).flexDirection,
    isShort: b.classList.contains('tl-block--short'),
    title: (b.querySelector('.tl-block__title') || {}).textContent || ''
  }));
  // 方向为 row 的块必须确实放不下两行（高度很小），否则就是阈值设错了
  const badShort = blockLayout.filter((b) => b.dir === 'row' && b.h >= 32);

  // 当前时刻标签不得溢出所在卡片
  const nowLabel = document.querySelector('.tl__now-label');
  let nowLabelOk = true;
  if (nowLabel) {
    const tl = nowLabel.closest('.tl').getBoundingClientRect();
    const r = nowLabel.getBoundingClientRect();
    nowLabelOk = r.top >= tl.top - 1 && r.bottom <= tl.bottom + 1;
  }

  return JSON.stringify({
    lane: laneRect ? { left: round(laneRect.left), w: round(laneRect.width), h: round(laneRect.height) } : null,
    axis: axisRect ? { left: round(axisRect.left), right: round(axisRect.right), w: round(axisRect.width) } : null,
    tickCount: document.querySelectorAll('.tl__tick').length,
    labelCount: labels.length,
    labelsInAxis,
    overlapCount: document.querySelectorAll('.tl__overlap').length,
    blockCount: blocks.length,
    blockLayout,
    badShort,
    nowLabelOk,
    horizOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    items: out
  });
})()`;

const target = await cdpTargets();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
});

await rpc(ws, 1, 'Runtime.enable', {});
await sleep(2500);   // 等前端脚本渲染完成
const res = await rpc(ws, 2, 'Runtime.evaluate', { expression: expr, returnByValue: true });

const data = JSON.parse(res.result.value);
console.log('=== 泳道与刻度栏 ===');
console.log('lane :', JSON.stringify(data.lane));
console.log('axis :', JSON.stringify(data.axis));
console.log(`tick=${data.tickCount}  label=${data.labelCount}  落在刻度栏内=${data.labelsInAxis}`);
console.log(`overlap带=${data.overlapCount}  活动块=${data.blockCount}`);
console.log('\n=== 元素几何 ===');
for (const it of data.items) {
  console.log(`  ${it.sel} [${it.idx}] top=${it.top} left=${it.left} w=${it.w} h=${it.h} pos=${it.pos} :: ${it.text}`);
}

/* ---------------------- 断言 ---------------------- */

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

console.log('\n=== 布局断言 ===');
ok('刻度标签全部落在左侧刻度栏内',
  data.labelCount > 0 && data.labelsInAxis === data.labelCount,
  `${data.labelsInAxis}/${data.labelCount}`);
ok('渲染了活动块', data.blockCount > 0, String(data.blockCount));
ok('绘制了冲突时段斜纹带', data.overlapCount > 0, String(data.overlapCount));
ok('页面无横向溢出', data.horizOverflow === false);

// 回归守卫：放得下两行的块不得被排成单行（否则标题与时间会被推到两端）
ok('高度足够的活动块采用上下两行排版（未被误判为单行）',
  data.badShort.length === 0,
  data.badShort.map((b) => `"${b.title}" h=${b.h}`).join('; '));
ok('排成单行的块确实高度不足', data.blockLayout.every((b) => b.dir !== 'row' || b.h < 32));

// 回归守卫：当前时刻标签不得溢出卡片
ok('当前时刻标签未溢出时间轴区域', data.nowLabelOk !== false);

// 时间与坐标严格成正比：同一天卡片内的相邻刻度间距应完全一致。
// 必须按 dayIdx 分组，否则会把「上一张卡片的最后一个刻度」与
// 「下一张卡片的第一个刻度」之间那段跨卡片距离也算进来。
const tickItems = data.items.filter((i) => i.sel === '.tl__tick-label');
const byDay = new Map();
tickItems.forEach((t) => {
  if (!byDay.has(t.dayIdx)) byDay.set(t.dayIdx, []);
  byDay.get(t.dayIdx).push(t.top);
});
const gapSets = [];
byDay.forEach((tops) => {
  tops.sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < tops.length; i++) {
    const g = Math.round((tops[i] - tops[i - 1]) * 100) / 100;
    if (g > 0) gaps.push(g);
  }
  if (gaps.length) gapSets.push(Array.from(new Set(gaps)));
});
ok('同一天内刻度间距均匀（时间与坐标成正比）',
  gapSets.length > 0 && gapSets.every((s) => s.length === 1),
  gapSets.map((s) => `[${s.join(', ')}]`).join(' '));
ok('每天的小时间距一致（同为 30px/小时）',
  gapSets.length > 0 && new Set(gapSets.map((s) => s[0])).size === 1,
  gapSets.map((s) => s[0]).join(', '));

console.log(`\n${'='.repeat(52)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) { console.log('失败清单：'); fails.forEach((f) => console.log('  - ' + f)); }

ws.close();
child.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
process.exit(fail ? 1 : 0);
