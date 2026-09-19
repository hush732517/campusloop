/**
 * 校园活动与机会 · 结构化数据层
 * ------------------------------------------------------------------
 * 数据来源：珠海科技学院计算机协会软件部 2026 年秋季纳新第二轮考核题目「四、校园活动与机会信息」
 * 时间基准：2026-09-19（考核当日，周六）
 *
 * 【数据录入原则】（对应设计文档 4.3 节）
 *  1. `raw` 字段逐字保留题目原文，不作任何改写，供详情页「查看原文」对照。
 *  2. 结构化字段仅从原文可推断的内容生成；原文未提供的一律为 null，并记入 missing 列表。
 *     → 严禁编造时间、地点、费用、主办方。这是本题的硬性红线。
 *  3. `amendments` 声明「谁修订了谁、修订了哪些字段」，供通知合并视图使用。
 *  4. `risk` 记录开放发布带来的质量与可信度问题，不删除内容，只分级与标注。
 *
 * 字段说明
 *  id           稳定标识
 *  code         题目原始编号（保持可追溯）
 *  source       official 校/院官方 | org 正式赛事或机构 | student 学生自主发布
 *  category     training 训练营 | lecture 讲座分享 | recruit 招募组队 | contest 竞赛 |
 *               volunteer 志愿服务 | resource 学习资料 | meetup 交流活动
 *  time.start   ISO 本地时间 'YYYY-MM-DDTHH:mm'
 *  time.recurrence { weekday:1-7(周一=1), startDate, weeks }
 *  time.kind    onetime 单次 | recurring 周期 | resource 长期开放 | replay 回放
 *  eligibility.grades  ['all'] 或 [1,2] 表示大一/大二
 *  completeness.missing 原文确实未提供的信息键，驱动「待确认」提示
 */

export const DATA_UPDATED_AT = '2026-09-19T14:00';

export const CATEGORIES = {
  training: { label: '训练营', icon: '🎯' },
  lecture: { label: '讲座分享', icon: '🎤' },
  recruit: { label: '招募组队', icon: '🤝' },
  contest: { label: '竞赛', icon: '🏆' },
  volunteer: { label: '志愿服务', icon: '💚' },
  resource: { label: '学习资料', icon: '📚' },
  meetup: { label: '交流活动', icon: '💬' }
};

export const SOURCES = {
  official: { label: '校／院官方', short: '官方', icon: '🛡️' },
  org: { label: '赛事／机构', short: '赛事', icon: '🎖️' },
  student: { label: '同学发布', short: '同学', icon: '🙋' }
};

/** 缺失字段的友好文案 —— 让「不知道」成为被良好设计的信息状态 */
export const MISSING_LABELS = {
  time: '活动时间未注明',
  deadline: '报名截止时间未注明',
  location: '活动地点未注明',
  publisher: '主办方未提供',
  fee: '费用信息未提供',
  limit: '人数上限未注明',
  signupChannel: '报名方式未注明',
  description: '内容说明不完整',
  gradeLimit: '适用年级未注明'
};

export const GRADE_LABELS = { 1: '大一', 2: '大二', 3: '大三', 4: '大四' };

export const EVENTS = [
  {
    id: 'e01', code: '01', title: '“蓝桥杯”程序设计校内训练营',
    source: 'official', category: 'training', publisher: '校内训练营组委会',
    raw: '9月24日22:00报名截止；原计划9月20日起每周六19:00训练；面向全校学生；零基础可参加',
    time: {
      kind: 'recurring', deadline: '2026-09-24T22:00',
      recurrence: { weekday: 6, startDate: '2026-09-20', weeks: 6 },
      // 注：原文「9月20日起每周六」中的 9月20日 为周日，与「每周六」自相矛盾，
      //     且 09 号补充通知已将首次训练改为 9月21日 19:30，故此处以补充通知为准。
      note: '原计划 9月20日 起每周六 19:00；实际首次训练见补充通知'
    },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: true, fee: 'free', commitment: '每周六 19:00' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['location', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    relatesTo: ['e09'],
    keywords: ['蓝桥杯', '算法', '零基础', '训练营']
  },
  {
    id: 'e02', code: '02', title: 'AI 应用入门公开课',
    source: 'official', category: 'lecture', publisher: '计算机学院',
    raw: '9月19日19:00；计算机学院教学楼；面向全校学生；无需报名；预计90分钟',
    time: { kind: 'onetime', start: '2026-09-19T19:00', durationMin: 90 },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: false, fee: 'free' },
    location: { raw: '计算机学院教学楼', certainty: 'partial' },
    completeness: { missing: ['signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['AI', '人工智能', '公开课', '零基础', '无需报名']
  },
  {
    id: 'e03', code: '03', title: '大学生创新创业项目团队招募',
    source: 'official', category: 'recruit', publisher: '大学生创新创业项目组',
    raw: '招募开发、设计、材料成员；每周需稳定投入4小时以上；9月22日18:00截止；需提交简短自我介绍',
    time: { kind: 'onetime', deadline: '2026-09-22T18:00' },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: true, fee: 'free', commitment: '每周 4 小时以上' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['location', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    relatesTo: ['e20'],
    keywords: ['创新创业', '大创', '组队', '开发', '设计']
  },
  {
    id: 'e04', code: '04', title: '数学建模竞赛经验分享会',
    source: 'official', category: 'lecture', publisher: '数学建模竞赛组委会',
    raw: '直播时间为9月18日19:30；不限专业；直播已结束，活动方预计9月20日上传回放',
    time: { kind: 'replay', start: '2026-09-18T19:30', replayAt: '2026-09-20T00:00' },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: false, fee: 'free' },
    location: { raw: '线上直播', certainty: 'confirmed', online: true },
    completeness: { missing: ['signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['数学建模', '分享会', '回放', '不限专业']
  },
  {
    id: 'e05', code: '05', title: '校园公益志愿服务活动',
    source: 'official', category: 'volunteer', publisher: '校志愿服务队',
    raw: '活动时间9月27日8:30—17:00；9月20日12:00报名截止；预计服务8小时；需提前到场签到',
    time: { kind: 'onetime', start: '2026-09-27T08:30', end: '2026-09-27T17:00', deadline: '2026-09-20T12:00' },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: true, fee: 'free', commitment: '约 8 小时' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['location', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['志愿服务', '公益', '志愿时长', '签到']
  },
  {
    id: 'e06', code: '06', title: 'Web 开发零基础学习小组',
    source: 'student', category: 'meetup', publisher: null,
    raw: '9月23日起每周三19:30开展，共6周；面向零基础学生；限30人；报名时间未注明，满员即止',
    time: { kind: 'recurring', recurrence: { weekday: 3, startDate: '2026-09-23', weeks: 6 }, deadline: null },
    eligibility: { grades: ['all'], limit: 30 },
    participation: { needSignup: true, fee: null, commitment: '每周三 19:30，共 6 周' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['deadline', 'location', 'publisher', 'fee', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['Web', '前端', '零基础', '学习小组']
  },
  {
    id: 'e07', code: '07', title: 'AI 创新应用挑战赛',
    source: 'org', category: 'contest', publisher: 'AI 创新应用挑战赛组委会',
    raw: '2—4人组队；9月21日18:00前完成校内意向登记；10月20日提交作品；意向登记不等同于最终作品提交',
    time: { kind: 'onetime', deadline: '2026-09-21T18:00', milestones: [{ at: '2026-10-20T23:59', label: '提交最终作品' }] },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: true, fee: null, commitment: '2—4 人组队' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['location', 'fee', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['AI', '挑战赛', '组队', '意向登记']
  },
  {
    id: 'e08', code: '08', title: '校园软件项目组招募',
    source: 'official', category: 'recruit', publisher: '校园软件项目组',
    raw: '开发校园实用工具；面向大一、大二学生；希望成员了解Git基本操作；每周预计投入5小时；长期招募，满员即止',
    time: { kind: 'resource', deadline: null },
    eligibility: { grades: [1, 2], limit: null },
    participation: { needSignup: true, fee: 'free', commitment: '每周约 5 小时' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['deadline', 'location', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['软件项目', 'Git', '大一', '大二', '长期招募']
  },
  {
    id: 'e09', code: '09', title: '程序设计训练营补充通知',
    source: 'official', category: 'training', publisher: '校内训练营组委会',
    raw: '因场地调整，首次训练改为9月21日19:30，地点改至实验楼A402；已报名同学无需重复提交；报名截止时间不变',
    time: { kind: 'onetime', start: '2026-09-21T19:30' },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: true, fee: 'free' },
    location: { raw: '实验楼A402', certainty: 'confirmed', building: '实验楼' },
    completeness: { missing: ['signupChannel'] },
    risk: { level: 'none', reasons: [] },
    // 本条是对 e01 的修订：覆盖时间与地点，报名截止时间保持不变
    amendments: [{
      fromId: 'e01', type: 'override',
      fields: ['time.start', 'location.raw'],
      note: '首次训练时间与地点变更（场地调整）'
    }],
    keywords: ['补充通知', '场地调整', '实验楼A402', '已报名无需重复提交']
  },
  {
    id: 'e10', code: '10', title: '前端开发经验交流会',
    source: 'official', category: 'lecture', publisher: '计算机学院',
    raw: '9月19日15:00—16:30；线下A201并同步线上直播；无需报名',
    time: { kind: 'onetime', start: '2026-09-19T15:00', end: '2026-09-19T16:30' },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: false, fee: 'free' },
    location: { raw: 'A201（同步线上直播）', certainty: 'confirmed', building: 'A 栋', online: true },
    completeness: { missing: ['signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['前端', '交流会', '直播', '无需报名']
  },
  {
    id: 'e11', code: '11', title: '大学生科研入门分享会',
    source: 'official', category: 'lecture', publisher: '校学生科研管理部门',
    raw: '9月21日19:00—20:30；介绍论文检索、学生科研项目和导师联系方法；面向全校学生',
    time: { kind: 'onetime', start: '2026-09-21T19:00', end: '2026-09-21T20:30' },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: false, fee: 'free' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['location'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['科研', '论文检索', '导师', '分享会']
  },
  {
    id: 'e12', code: '12', title: '全国高校计算机能力挑战赛',
    source: 'org', category: 'contest', publisher: '全国高校计算机能力挑战赛组委会',
    raw: '面向本科生；10月5日23:59报名截止；个人参赛；具体费用信息未提供',
    time: { kind: 'onetime', start: '2026-10-05T23:59', deadline: '2026-10-05T23:59' },
    eligibility: { grades: [1, 2, 3, 4], limit: null },
    participation: { needSignup: true, fee: null, commitment: '个人参赛' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['fee', 'location', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['计算机能力挑战赛', '本科生', '个人赛', '国赛']
  },
  {
    id: 'e13', code: '13', title: '科研助理招募',
    source: 'official', category: 'recruit', publisher: '校科研团队',
    raw: '协助数据整理和实验工作；仅限大二及以上学生；每周预计投入6小时；9月21日截止报名',
    time: { kind: 'onetime', deadline: '2026-09-21T23:59', deadlineApprox: true },
    eligibility: { grades: [2, 3, 4], limit: null },
    participation: { needSignup: true, fee: 'free', commitment: '每周约 6 小时' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['location', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['科研助理', '数据整理', '大二及以上', '实验']
  },
  {
    id: 'e14', code: '14', title: 'Git 与 GitHub 零基础工作坊',
    source: 'official', category: 'training', publisher: '计算机学院',
    raw: '9月21日19:00—20:30；主要面向大一新生；限40人；需提前预约，提交报名表不代表最终录取，以审核通知为准',
    time: { kind: 'onetime', start: '2026-09-21T19:00', end: '2026-09-21T20:30', deadline: null },
    eligibility: { grades: [1], limit: 40, preferFreshman: true },
    participation: { needSignup: true, fee: 'free', audit: true, commitment: '约 1.5 小时' },
    location: { raw: 'A201', certainty: 'confirmed', building: 'A 栋' },
    completeness: { missing: ['deadline', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['Git', 'GitHub', '大一新生', '工作坊', '需预约', '审核']
  },
  {
    id: 'e15', code: '15', title: 'AI 应用创意挑战',
    source: 'org', category: 'contest', publisher: 'AI 应用创意挑战组委会',
    raw: '9月23日23:59前提交创意方案；9月30日前提交最终作品；允许个人或团队参加；进入展示环节后可再组队',
    time: {
      kind: 'onetime', deadline: '2026-09-23T23:59',
      milestones: [
        { at: '2026-09-23T23:59', label: '提交创意方案' },
        { at: '2026-09-30T23:59', label: '提交最终作品' }
      ]
    },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: true, fee: null, commitment: '个人或团队' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['location', 'fee', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['AI', '创意挑战', '个人或团队', '展示环节']
  },
  {
    id: 'e16', code: '16', title: '校园摄影志愿者招募',
    source: 'official', category: 'volunteer', publisher: '校宣传部门',
    raw: '长期招募；参与校内大型活动摄影；具体报名截止时间未注明；有摄影设备者优先但不作硬性要求',
    time: { kind: 'resource', deadline: null },
    eligibility: { grades: ['all'], limit: null, preferEquipment: true },
    participation: { needSignup: true, fee: 'free', commitment: '按活动场次安排' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['deadline', 'location', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['摄影', '志愿者', '长期招募', '设备优先']
  },
  {
    id: 'e17', code: '17', title: 'Python 程序设计学习资料合集',
    source: 'official', category: 'resource', publisher: '计算机学院',
    raw: '包含课程、练习和项目案例；资料长期开放；当前网盘提取信息有效至9月22日，后续将统一更新',
    time: { kind: 'resource', deadline: '2026-09-22T23:59', deadlineLabel: '网盘提取信息有效至' },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: false, fee: 'free' },
    location: { raw: '线上网盘', certainty: 'confirmed', online: true },
    completeness: { missing: ['signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['Python', '学习资料', '网盘', '课程', '练习']
  },
  {
    id: 'e18', code: '18', title: '网络安全兴趣交流小组',
    source: 'student', category: 'meetup', publisher: null,
    raw: '首次交流时间为9月19日19:30；之后每两周开展一次；面向CTF、Web安全等方向感兴趣的学生；不限基础',
    time: { kind: 'recurring', start: '2026-09-19T19:30', recurrence: { weekday: 6, startDate: '2026-09-19', weeks: 6, intervalWeeks: 2 } },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: false, fee: 'free' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['location', 'publisher'] },
    risk: { level: 'none', reasons: [] },
    relatesTo: ['e02'],
    keywords: ['网络安全', 'CTF', 'Web安全', '兴趣小组', '不限基础']
  },
  {
    id: 'e19', code: '19', title: '学生创新项目路演观摩',
    source: 'official', category: 'lecture', publisher: '校创新创业管理部门',
    raw: '活动时间9月20日14:30；原报名截止时间为9月18日22:00；活动方说明如现场仍有余位，可接受候补入场',
    time: { kind: 'onetime', start: '2026-09-20T14:30', deadline: '2026-09-18T22:00' },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: true, fee: 'free', waitlist: true },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['location', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['路演', '观摩', '候补入场', '创新项目']
  },
  {
    id: 'e20', code: '20', title: '创新创业项目团队补充说明',
    source: 'official', category: 'recruit', publisher: '大学生创新创业项目组',
    raw: '开发方向名额已满，现主要补充设计与材料成员；9月22日18:00截止；此前已投递者无需重复提交',
    time: { kind: 'onetime', deadline: '2026-09-22T18:00' },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: true, fee: 'free', commitment: '每周 4 小时以上' },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['location', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    // 本条是对 e03 的修订：招募方向变更
    amendments: [{
      fromId: 'e03', type: 'override',
      fields: ['recruitRoles'],
      note: '开发方向名额已满，仅补充设计与材料成员',
      overrides: { recruitRoles: ['设计', '材料'] }
    }],
    relatesTo: ['e03'],
    keywords: ['补充说明', '开发已满', '设计', '材料', '名额']
  },
  {
    id: 'e21', code: '21', title: '计算机学院 AI 产品设计分享会',
    source: 'official', category: 'lecture', publisher: '计算机学院',
    raw: '计算机学院发布；9月20日19:00；明德楼B203；面向全校学生；无需报名，座位有限',
    time: { kind: 'onetime', start: '2026-09-20T19:00' },
    eligibility: { grades: ['all'], limit: null, seatsLimited: true },
    participation: { needSignup: false, fee: 'free' },
    location: { raw: '明德楼B203', certainty: 'confirmed', building: '明德楼' },
    completeness: { missing: ['signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['AI', '产品设计', '计算机学院', '无需报名', '座位有限']
  },
  {
    id: 'e22', code: '22', title: '学生发起｜周末羽毛球约球',
    source: 'student', category: 'meetup', publisher: '同学个人',
    raw: '学生个人发布；9月20日16:00；计划6—8人；费用AA；场地待最终确认',
    time: { kind: 'onetime', start: '2026-09-20T16:00' },
    eligibility: { grades: ['all'], limit: 8, minPeople: 6 },
    participation: { needSignup: true, fee: 'AA', commitment: '约 2 小时' },
    location: { raw: null, certainty: 'pending', note: '场地待最终确认' },
    completeness: { missing: ['location', 'signupChannel'] },
    risk: { level: 'none', reasons: [] },
    keywords: ['羽毛球', '约球', 'AA', '场地待确认']
  },
  {
    id: 'e23', code: '23', title: '学生发起｜AI 工具交流搭子招募',
    source: 'student', category: 'meetup', publisher: '同学个人',
    raw: '学生个人发布；拟于9月21日晚开展；欢迎零基础；报名后拉群；具体地点未确定',
    time: { kind: 'onetime', start: '2026-09-21T19:00', timeApprox: true },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: true, fee: null, commitment: '晚间，约 1—2 小时' },
    location: { raw: null, certainty: 'pending', note: '具体地点未确定' },
    completeness: { missing: ['location', 'fee'] },
    risk: { level: 'none', reasons: [] },
    relatesTo: ['e02', 'e18'],
    keywords: ['AI工具', '搭子', '零基础', '拉群', '地点未定']
  },
  {
    id: 'e24', code: '24', title: '学生发起｜“校园兼职福利分享”',
    source: 'student', category: 'meetup', publisher: null,
    publisherNote: '原文未提供主办方，未说明发布者身份',
    raw: '学生个人发布；称“零门槛、日结”，要求添加私人微信获取详情；未提供主办方、地点和完整内容',
    time: { kind: 'onetime', start: null },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: true, fee: null },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['time', 'location', 'publisher', 'description'] },
    risk: {
      level: 'high',
      reasons: [
        '以“零门槛、日结”承诺收益，符合常见兼职引流话术特征',
        '要求添加私人微信获取详情，脱离平台可核查范围',
        '未提供主办方、地点与完整内容，无法核实真实性'
      ],
      advice: '建议不要添加私人微信或提供个人信息；如需兼职请通过学校勤工助学或正规招聘渠道核实。'
    },
    keywords: ['兼职', '日结', '加微信', '零门槛']
  },
  {
    id: 'e25', code: '25', title: '学生发起｜数码新品体验交流',
    source: 'student', category: 'meetup', publisher: null,
    publisherNote: '原文未提供主办方，未说明发布者身份',
    raw: '学生个人发布；标题为技术交流，正文主要介绍某商家优惠及购买链接；活动时间、地点未注明',
    time: { kind: 'onetime', start: null },
    eligibility: { grades: ['all'], limit: null },
    participation: { needSignup: null, fee: null },
    location: { raw: null, certainty: 'unknown' },
    completeness: { missing: ['time', 'location', 'publisher', 'description'] },
    risk: {
      level: 'medium',
      reasons: [
        '标题为技术交流，正文实为某商家优惠与购买链接，标题与内容不符',
        '未注明活动时间与地点，无实际可参加的线下内容'
      ],
      advice: '内容与校园技术活动关联较弱，更接近商品推广，请谨慎对待其中的购买引导。'
    },
    keywords: ['数码', '新品', '优惠', '购买链接']
  },
  {
    id: 'e26', code: '26', title: '外国语学院校园语言角',
    source: 'official', category: 'meetup', publisher: '外国语学院',
    raw: '外国语学院发布；9月21日15:00；面向全校学生；自由交流；场地容量有限，无需提前报名',
    time: { kind: 'onetime', start: '2026-09-21T15:00' },
    eligibility: { grades: ['all'], limit: null, seatsLimited: true },
    participation: { needSignup: false, fee: 'free' },
    location: { raw: '外国语学院', certainty: 'partial', building: '外国语学院' },
    completeness: { missing: ['signupChannel'] },
    risk: { level: 'none', reasons: [] },
    relatesTo: ['e23'],
    keywords: ['语言角', '外国语学院', '自由交流', '无需报名']
  }
];
