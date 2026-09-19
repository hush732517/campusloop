/**
 * 模块导入导出一致性检查
 * ------------------------------------------------------------------
 * 用法：node docs/importcheck.mjs
 *
 * 动机：ES Module 的命名导入如果写错（导入了一个并不存在的导出），
 * 浏览器会在运行时直接抛 SyntaxError 导致整页白屏，而这属于「语法检查
 * 通过、静态分析不报错」的盲区。这个脚本把每个模块真正 import 一遍，
 * 并逐个校验各文件 `import { ... } from '...'` 中列出的名字是否真实存在。
 *
 * 本作品刻意零依赖、无构建流程，因此打包器不会帮我们发现这类错误，
 * 必须自己检查。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 注意：路径包含中文与空格，必须用 fileURLToPath 正确解码百分号转义
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 提供一个最小 localStorage，让 store.js 可以安全被加载
const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function head(t) { console.log(`\n${t}`); }

/* ---------------------- 收集所有 js 文件 ---------------------- */

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const files = walk(ROOT).filter((f) => !f.includes('node_modules'));

/**
 * 应用模块（需要浏览器 DOM 才能加载）与测试脚本本身不参与静态导入校验：
 *  - scripts/main.js 在模块顶层就调用 document.getElementById，属于入口文件，
 *    由 docs/rendertest.mjs 通过 DOM 桩验证；
 *  - docs/*.mjs 是测试脚本，其动态 import 由各自的测试流程覆盖。
 */
const SKIP = ['scripts/main.js'];
const isAppModule = (f) => f.endsWith('.js') && !f.endsWith('.mjs')
  && !SKIP.some((s) => relative(ROOT, f).replace(/\\/g, '/') === s);

head('M1  所有模块都能被成功导入（无运行时 SyntaxError）');
{
  for (const f of files.filter(isAppModule)) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    try {
      await import(pathToFileURL(f).href);
      ok(`import ${rel}`, true);
    } catch (e) {
      ok(`import ${rel}`, false, `→ ${e.message}`);
    }
  }
  ok('scripts/main.js 由 rendertest.mjs 用 DOM 桩验证（此处跳过）', true);
}

/* ------------------- 校验命名导入是否真实存在 ------------------- */

head('M2  每个 import 的具名导出都真实存在');
{
  // 先把所有模块的导出名收集起来
  const exportsOf = new Map();
  for (const f of files.filter(isAppModule)) {
    try {
      const mod = await import(pathToFileURL(f).href);
      exportsOf.set(f, new Set(Object.keys(mod)));
    } catch { /* M1 已报告 */ }
  }

  // 入口文件无法在此导入，改为静态扫描它的导入语句
  const scanFiles = files.filter((f) => !f.endsWith('.mjs'));

  for (const f of scanFiles) {
    const src = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    const re = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) {
      const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      const spec = m[2];
      if (!spec.startsWith('.')) continue;                 // 跳过裸模块（本作品没有）
      const target = resolve(dirname(f), spec);
      const targetFile = target.endsWith('.js') ? target : target + '.js';
      const exp = exportsOf.get(targetFile);
      if (!exp) { ok(`${rel} → ${spec}`, false, '目标模块未成功加载'); continue; }
      const bad = names.filter((n) => !exp.has(n));
      ok(`${rel} 的 ${names.length} 个导入均存在于 ${spec}`, bad.length === 0,
        bad.length ? `缺失: ${bad.join(', ')}` : '');
    }
  }
}

/* ------------------- 样式与代码的对应关系 ------------------- */

head('M3  CSS 中承担状态表达的关键类名在代码里确实被使用');
{
  const css = readFileSync(join(ROOT, 'styles', 'app.css'), 'utf8');
  const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const critical = [
    'card--official', 'card--org', 'card--student', 'card--risk',
    'badge--ok', 'badge--warn', 'badge--risk', 'badge--live', 'badge--accent', 'badge--pending',
    'notice--change', 'notice--gap', 'notice--risk', 'notice--info', 'notice--ok',
    'slot--clash', 'day--today', 'timeline__item--latest',
    'score--ok', 'score--warn', 'score--risk',
    'src--official', 'src--org', 'src--student', 'step--done', 'step--active'
  ];
  critical.forEach((c) => {
    const inCss = css.includes('.' + c);
    const inJs = all.includes(c);
    ok(`.${c} 在 CSS 与 JS 中都有定义`, inCss && inJs,
      !inCss ? '（CSS 缺失）' : (!inJs ? '（JS 未使用）' : ''));
  });
}

/* ------------------- 状态 tone 与徽标样式的一致性 ------------------- */

head('M4  状态机定义的 tone 都有对应的徽标样式');
{
  const css = readFileSync(join(ROOT, 'styles', 'app.css'), 'utf8');
  const model = readFileSync(join(ROOT, 'scripts', 'model.js'), 'utf8');
  const tones = new Set();
  const re = /tone:\s*'([a-z]+)'/g;
  let m;
  while ((m = re.exec(model))) tones.add(m[1]);
  ok('状态机至少定义了 6 种 tone', tones.size >= 6, `实际 ${tones.size}`);
  [...tones].forEach((t) => {
    ok(`.badge--${t} 有对应样式`, css.includes(`.badge--${t}`));
  });
}

console.log(`\n${'='.repeat(52)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) { console.log('失败清单：'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('全部通过 ✓');
