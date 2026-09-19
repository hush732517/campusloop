/**
 * 领域模型自测脚本（Node 环境，无需浏览器）
 * ------------------------------------------------------------------
 * 用法：node docs/selftest.mjs
 *
 * 目的：在没有浏览器的环境下验证领域模型的正确性，尤其是题目材料里的
 * 那些「坑」——补充通知合并、信息缺口、时间冲突、风险分级。
 * 这些断言与 docs/测试用例.md 中的 A/B 组用例一一对应。
 */

import {
  mergeView, computeStatus, missingFields, completenessScore, findClashes,
  actionLine, publishCheckup, allMerged, visibleMerged, occurrences, coveredIds
} from '../scripts/model.js';
import { setNow, resetNow, EXAM_NOW } from '../scripts/util.js';

let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
function head(t) { console.log(`\n${t}`); }

// localStorage 兜底（Node 环境）
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
};

resetNow();
const NOW = EXAM_NOW;

/* ============ T1 补充通知合并：01 + 09 ============ */
head('T1  训练营补充通知应合并到原始通知');
{
  const m = mergeView('e01');
  ok('合并后首次训练时间为 9/21 19:30', m.time.start === '2026-09-21T19:30', `实际 ${m.time.start}`);
  ok('合并后地点为实验楼A402', m.location.raw === '实验楼A402', `实际 ${m.location.raw}`);
  ok('报名截止时间保持不变（9/24 22:00）', m.time.deadline === '2026-09-24T22:00', `实际 ${m.time.deadline}`);
  ok('记录到补充通知来源', Array.isArray(m.amendedBy) && m.amendedBy[0].id === 'e09');
  ok('变更处数为 2', m.changeCount === 2, `实际 ${m.changeCount}`);
  const line = actionLine(m, NOW);
  ok('一句话结论包含合并后的明确日期', /9 月 21 日/.test(line), line);
}

/* ============ T2 双创招募：开发岗已满 ============ */
head('T2  双创团队补充说明应生效');
{
  const m = mergeView('e03');
  ok('招募方向仅剩设计与材料', Array.isArray(m.recruitRoles) && m.recruitRoles.join('、') === '设计、材料');
  ok('生成「开发方向名额已满」结论', /开发方向名额已满/.test(m.recruitNote || ''), m.recruitNote);
  ok('报名截止仍为 9/22 18:00', m.time.deadline === '2026-09-22T18:00');
}

/* ============ T3 数模分享会：已结束、回放待上传 ============ */
head('T3  已结束的直播应显示回放状态');
{
  const m = mergeView('e04');
  const st = computeStatus(m, NOW);
  ok('状态为回放待上传', st.key === 'replay', st.key);
  ok('提示中包含回放预计时间', /9 月 20 日/.test(st.note || ''), st.note);
}

/* ============ T4 学习小组：报名时间未注明 ============ */
head('T4  未注明报名时间的活动不得编造日期');
{
  const m = mergeView('e06');
  const gap = missingFields(m);
  ok('缺失项包含 deadline', gap.includes('deadline'), gap.join(','));
  ok('确实没有报名截止字段', m.time.deadline === null);
  ok('状态不是「即将截止」（因为没有截止时间）', computeStatus(m, NOW).key !== 'closing');
  const occ = occurrences(m, '2026-11-01');
  ok('周期场次可正确展开为 6 次', occ.length === 6, `实际 ${occ.length}`);
  ok('首场为 9/23（周三）', occ[0].slice(0, 10) === '2026-09-23', occ[0]);
}

/* ============ T5 挑战赛：费用未提供 ============ */
head('T5  未提供费用的赛事不得显示金额');
{
  const m = mergeView('e12');
  ok('费用字段为 null', m.participation.fee === null);
  ok('缺失项包含 fee', missingFields(m).includes('fee'));
  const line = actionLine(m, NOW);
  ok('一句话结论中不含任何金额', !/[0-9]+\s*元/.test(line), line);
}

/* ============ T6 路演观摩：可候补 ============ */
head('T6  报名已截止但可候补');
{
  const m = mergeView('e19');
  const st = computeStatus(m, NOW);
  ok('状态为可候补', st.key === 'waitlist', st.key);
  ok('参与方式标记了候补', m.participation.waitlist === true);
}

/* ============ T7 高风险内容 ============ */
head('T7  兼职分享应判定为高风险');
{
  const m = mergeView('e24');
  ok('风险等级为 high', m.risk.level === 'high');
  ok('状态为已折叠', computeStatus(m, NOW).key === 'risk_high');
  ok('缺失项包含主办方', missingFields(m).includes('publisher'));
  ok('给出安全建议', /不要添加私人微信/.test(m.risk.advice || ''), m.risk.advice);
}

/* ============ T8 疑似推广 ============ */
head('T8  数码体验应判定为疑似推广');
{
  const m = mergeView('e25');
  ok('风险等级为 medium', m.risk.level === 'medium');
  ok('状态非高风险折叠', computeStatus(m, NOW).key !== 'risk_high');
  ok('给出风险原因', m.risk.reasons.length >= 1);
}

/* ============ T9 / T10 撞车检测 ============ */
head('T9  9/19 晚 AI 公开课与网安小组应判定冲突');
{
  const clashes = findClashes(allMerged(), NOW, 14);
  const hit = clashes.find((c) =>
    [c.a.id, c.b.id].includes('e02') && [c.a.id, c.b.id].includes('e18') && c.day === '2026-09-19');
  ok('检测到 e02 × e18 冲突', !!hit);
  if (hit) ok('重叠时长为 60 分钟', hit.overlapMin === 60, `实际 ${hit.overlapMin}`);
}

head('T10 补充通知必须合并进原始通知，而不是替代它');
{
  const clashes = findClashes(allMerged(), NOW, 14);
  const hit = clashes.find((c) =>
    [c.a.id, c.b.id].includes('e01') && [c.a.id, c.b.id].includes('e14') && c.day === '2026-09-21');
  ok('检测到 e01 × e14 冲突（训练营首次训练 vs Git 工作坊）', !!hit);
  if (hit) ok('重叠时长为 60 分钟', hit.overlapMin === 60, `实际 ${hit.overlapMin}`);

  // 展示哪一条：补充通知只是修订，不能替代原始通知，否则会丢掉
  // 只写在原始通知里的信息（报名截止时间、主办方、周期安排）。
  ok('被合并的补充通知是 e09 与 e20', coveredIds().sort().join(',') === 'e09,e20',
    coveredIds().join(','));
  const vis = visibleMerged();
  ok('可见列表保留原始通知 e01', vis.some((m) => m.id === 'e01'));
  ok('可见列表保留原始通知 e03', vis.some((m) => m.id === 'e03'));
  ok('可见列表不含补充通知 e09', !vis.some((m) => m.id === 'e09'));
  ok('可见列表不含补充通知 e20', !vis.some((m) => m.id === 'e20'));

  // 关键回归：展示用的 e01 必须同时具备
  //   ① 补充通知带来的新时间与地点  ② 原始通知里的报名截止时间
  const shown = vis.find((m) => m.id === 'e01');
  ok('展示卡保留了原始标题', /^“蓝桥杯”程序设计校内训练营$/.test(shown.title), shown.title);
  ok('展示卡用上了补充通知的新时间 9/21 19:30', shown.time.start === '2026-09-21T19:30', shown.time.start);
  ok('展示卡用上了补充通知的新地点 实验楼A402', shown.location.raw === '实验楼A402', shown.location.raw);
  ok('展示卡保留了原始通知的报名截止 9/24 22:00',
    shown.time.deadline === '2026-09-24T22:00', String(shown.time.deadline));
  ok('展示卡标记为「已更新」', (shown.changeCount || 0) > 0, String(shown.changeCount));
  const line = actionLine(shown, NOW);
  ok('结论行体现新时间而非「截止未注明」',
    /9 月 21 日/.test(line) && !/报名截止时间未注明|截止未注明/.test(line), line);

  // 双创招募同理：补充说明带来「开发岗已满」，但截止时间仍在原始通知里
  const dbl = vis.find((m) => m.id === 'e03');
  ok('双创招募保留了报名截止 9/22 18:00', dbl.time.deadline === '2026-09-22T18:00', String(dbl.time.deadline));
  ok('双创招募体现开发岗已满', /开发方向名额已满/.test(dbl.recruitNote || ''), dbl.recruitNote);

  ok('e01 与 e09 不再互为冲突', !clashes.some((c) =>
    [c.a.id, c.b.id].includes('e01') && [c.a.id, c.b.id].includes('e09')));
  // 重叠不足 15 分钟的不提示（如 23:53 结束 vs 23:59 截止），避免噪音淹没真实冲突
  ok('无意义的微小重叠已被忽略', !clashes.some((c) => c.overlapMin < 15));
  ok('冲突组数收敛到可处理范围（≤ 8 组）', clashes.length <= 8, `实际 ${clashes.length}`);
  ok('冲突组数至少 2 组', clashes.length >= 2, `实际 ${clashes.length}`);
}

head('T10b 状态标签与结论行不得自相矛盾');
{
  // 曾经的缺陷：学习小组「报名时间未注明」，状态标签显示「无需报名」，
  // 结论行却写「需报名（截止未注明）」，同一张卡片自相矛盾。
  const e06 = mergeView('e06');
  const st6 = computeStatus(e06, NOW);
  const line6 = actionLine(e06, NOW);
  ok('学习小组状态不是「无需报名」', st6.label !== '无需报名', st6.label);
  ok('学习小组结论行说了要报名', /需报名/.test(line6), line6);
  ok('状态标签与结论行一致（都要求报名）',
    !/无需报名/.test(st6.label) && /需报名/.test(line6));

  // 长期招募类同理
  const e16 = mergeView('e16');
  const st16 = computeStatus(e16, NOW);
  ok('摄影志愿者状态体现需要报名', st16.label === '长期可报名', st16.label);

  // 年级展示：全部年级可选时不应罗列「大一、大二、大三、大四」
  const e12 = mergeView('e12');
  const line12 = actionLine(e12, NOW);
  ok('覆盖全部年级时简化为「全校可参加」', /全校可参加/.test(line12), line12);
  const e13 = mergeView('e13');
  const line13 = actionLine(e13, NOW);
  ok('限定年级时仍如实列出（大二、大三、大四）', /大二、大三、大四可参加/.test(line13), line13);
}

/* ============ 状态机在不同时点的表现 ============ */
head('T11 状态应随时间推进自动变化（不硬编码）');
{
  const e02 = mergeView('e02');
  setNow('2026-09-19T14:00');
  ok('9/19 14:00 → 今天', computeStatus(e02, '2026-09-19T14:00').key === 'today');
  ok('9/19 19:30 → 进行中', computeStatus(e02, '2026-09-19T19:30').key === 'ongoing');
  ok('9/19 21:00 → 已结束', computeStatus(e02, '2026-09-19T21:00').key === 'finished');

  const e05 = mergeView('e05');
  ok('9/18 → 志愿活动报名中', computeStatus(e05, '2026-09-18T14:00').key === 'open');
  ok('9/19（截止前 22 小时）→ 即将截止', computeStatus(e05, '2026-09-19T14:00').key === 'closing');
  ok('9/20 13:00 → 报名已截止', computeStatus(e05, '2026-09-20T13:00').key === 'passed');
  ok('9/28 → 已结束', computeStatus(e05, '2026-09-28T10:00').key === 'finished');

  const e17 = mergeView('e17');
  ok('9/19 → 长期开放', ['resource', 'closing'].includes(computeStatus(e17, '2026-09-19T14:00').key));
  ok('9/23 → 有效期已过', computeStatus(e17, '2026-09-23T14:00').key === 'passed');
  resetNow();
}

/* ============ 发布体检 ============ */
head('T12 发布体检：完整度、风险词检测与风险封顶');
{
  const good = {
    title: '周末羽毛球约球（缺 2 人）', description: '体育馆 3 号场，自带球拍，费用 AA，欢迎零基础。',
    start: '2026-09-20T16:00', location: '体育馆 3 号场', fee: 'AA', contact: '群号 123456789', limit: '8'
  };
  const g = publishCheckup(good);
  ok('完整信息得分 ≥ 90', g.score >= 90, `实际 ${g.score}`);
  ok('无风险', g.level === 'none');

  const bad = {
    title: '校园兼职福利分享', description: '零门槛日结，加微信获取详情，名额有限',
    timeUndecided: true, locationUndecided: true, fee: '', contact: ''
  };
  const b = publishCheckup(bad);
  ok('高风险内容被判为 high', b.level === 'high', b.level);
  ok('命中「日结」与「加微信」', b.riskHits.length >= 2, `实际 ${b.riskHits.length}`);
  ok('风险内容完整度被封顶（< 60）', b.score < 60, `实际 ${b.score}`);
  ok('列出缺失项', b.missing.length >= 2);

  const ad = { title: '数码新品体验交流', description: '某商家优惠及购买链接，欢迎感兴趣的同学看看', start: '2026-09-20T10:00', location: '线上', fee: 'free', contact: '群号 1' };
  const a = publishCheckup(ad);
  ok('广告伪装判为 medium（非高风险）', a.level === 'medium', a.level);
  ok('命中购买链接风险词', a.riskHits.some((r) => /购买链接/.test(r.why)), JSON.stringify(a.riskHits.map((r) => r.why)));
  ok('推广内容完整度被封顶（≤ 65）', a.score <= 65, `实际 ${a.score}`);
}

/* ============ 数据完整性 ============ */
head('T13 数据层完整性');
{
  const all = allMerged();
  ok('共收录 26 条材料', all.length === 26, `实际 ${all.length}`);
  ok('每条都有原文 raw', all.every((m) => typeof m.raw === 'string' && m.raw.length > 0));
  ok('每条都有来源分类', all.every((m) => ['official', 'org', 'student'].includes(m.source)));
  const srcCount = {
    official: all.filter((m) => m.source === 'official').length,
    org: all.filter((m) => m.source === 'org').length,
    student: all.filter((m) => m.source === 'student').length
  };
  ok('三类来源都存在', srcCount.official > 0 && srcCount.org > 0 && srcCount.student > 0, JSON.stringify(srcCount));
  ok('可见列表为 24 条（26 条去除 2 条已合并的补充通知）', visibleMerged().length === 24, `实际 ${visibleMerged().length}`);
  const known = all.filter((m) => missingFields(m).length > 0).length;
  ok('存在带缺失信息的内容（应被标注）', known >= 8, `实际 ${known}`);
  ok('完整度评分均在 0—100', all.every((m) => { const s = completenessScore(m); return s >= 0 && s <= 100; }));
  const riskCount = all.filter((m) => m.risk && m.risk.level !== 'none').length;
  ok('识别出 2 条可信度问题内容', riskCount === 2, `实际 ${riskCount}`);
}

/* ============ 汇总 ============ */
console.log(`\n${'='.repeat(52)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) { console.log('失败清单：'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('全部通过 ✓');
