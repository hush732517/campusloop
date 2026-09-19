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
      out.push({
        sel, idx: i,
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

  return JSON.stringify({
    lane: laneRect ? { left: round(laneRect.left), w: round(laneRect.width), h: round(laneRect.height) } : null,
    axis: axisRect ? { left: round(axisRect.left), right: round(axisRect.right), w: round(axisRect.width) } : null,
    tickCount: document.querySelectorAll('.tl__tick').length,
    labelCount: labels.length,
    labelsInAxis,
    overlapCount: document.querySelectorAll('.tl__overlap').length,
    blockCount: document.querySelectorAll('.tl-block').length,
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

ws.close();
child.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
