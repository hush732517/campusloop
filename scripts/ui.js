/**
 * UI 基元：DOM 构建、Toast、确认弹窗、空状态、骨架屏
 * ------------------------------------------------------------------
 * 安全约定：所有来自题目原文或用户输入的内容一律经过 esc() 转义后再插入模板。
 * 只有本文件与各视图中的静态标记可以直接写入 innerHTML。
 */

import { escapeHtml, nowISO, fmtDate, weekdayLabel } from './util.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const esc = escapeHtml;

/** 简洁的元素工厂，替代冗长的 createElement */
export function h(tag, attrs = {}, html = '') {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  });
  if (html) el.innerHTML = html;
  return el;
}

/** 把模板字符串挂载到容器（整体替换） */
export function mount(container, html) {
  container.innerHTML = html;
  return container;
}

/* ---------------------------- Toast ---------------------------- */

let toastHost = null;

export function toast(message, tone = 'default', ms = 2200) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const icons = { ok: '✓', warn: '!', risk: '⚠', default: 'i' };
  const el = h('div', { class: `toast toast--${tone}` },
    `<span class="toast__icon">${icons[tone] || icons.default}</span><span>${esc(message)}</span>`);
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* --------------------------- 确认弹窗 --------------------------- */

export function confirmDialog({ title, body, confirmText = '确定', cancelText = '再想想', tone = 'default' }) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back', role: 'dialog', 'aria-modal': 'true' });
    back.innerHTML = `
      <div class="modal">
        <h3 class="modal__title">${esc(title)}</h3>
        <p class="modal__body">${esc(body)}</p>
        <div class="modal__actions">
          <button class="btn btn--ghost" data-act="cancel">${esc(cancelText)}</button>
          <button class="btn btn--${tone === 'risk' ? 'danger' : 'primary'}" data-act="ok">${esc(confirmText)}</button>
        </div>
      </div>`;
    const close = (val) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    back.addEventListener('click', (e) => {
      if (e.target === back) close(false);
      const act = e.target.closest('[data-act]');
      if (act) close(act.dataset.act === 'ok');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('is-in'));
    const okBtn = back.querySelector('[data-act="ok"]');
    if (okBtn) okBtn.focus();
  });
}

/* --------------------------- 底部抽屉 --------------------------- */

export function sheet({ title, contentHtml, onMount }) {
  const back = h('div', { class: 'sheet-back', role: 'dialog', 'aria-modal': 'true' });
  back.innerHTML = `
    <div class="sheet" role="document">
      <div class="sheet__grip" aria-hidden="true"></div>
      <div class="sheet__head">
        <h3 class="sheet__title">${esc(title)}</h3>
        <button class="icon-btn" data-act="close" aria-label="关闭">✕</button>
      </div>
      <div class="sheet__body">${contentHtml}</div>
    </div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-act="close"]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('is-in'));
  if (onMount) onMount(back.querySelector('.sheet__body'), close);
  return { el: back, close };
}

/* --------------------------- 空状态 --------------------------- */

export function emptyState({ icon = '🗂️', title, hint = '', action = '' }) {
  return `
    <div class="empty">
      <div class="empty__icon" aria-hidden="true">${icon}</div>
      <p class="empty__title">${esc(title)}</p>
      ${hint ? `<p class="empty__hint">${esc(hint)}</p>` : ''}
      ${action}
    </div>`;
}

export function skeletonCards(n = 3) {
  return Array.from({ length: n }).map(() => `
    <div class="card card--skeleton" aria-hidden="true">
      <div class="sk sk--title"></div>
      <div class="sk sk--line"></div>
      <div class="sk sk--line sk--short"></div>
    </div>`).join('');
}

/* --------------------------- 小组件 --------------------------- */

export function badge(text, tone = 'muted') {
  return `<span class="badge badge--${tone}">${esc(text)}</span>`;
}

export function sourceTag(source, SOURCES) {
  const s = SOURCES[source] || SOURCES.student;
  return `<span class="src src--${source}">${s.icon} ${esc(s.short)}</span>`;
}

/** 今日日期条：让「以 9 月 19 日为时间背景」始终可见 */
export function todayBar(now = nowISO()) {
  return `<span class="today-chip">📅 今天 ${fmtDate(now, false)} ${weekdayLabel(now)}</span>`;
}

/** 数字滚动/进度环，用于完整度展示 */
export function scoreRing(score, label = '完整度') {
  const tone = score >= 80 ? 'ok' : score >= 55 ? 'warn' : 'risk';
  return `
    <div class="score score--${tone}" role="img" aria-label="${esc(label)} ${score} 分">
      <span class="score__num">${score}</span>
      <span class="score__unit">分</span>
    </div>`;
}

export function progressBar(pct, tone = 'ok') {
  return `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <span class="bar__fill bar__fill--${tone}" style="width:${Math.max(4, Math.min(100, pct))}%"></span>
  </div>`;
}

/** 供事件委托使用：读取被点击元素上的 data 属性 */
export function dataOf(e, name) {
  const el = e.target.closest(`[data-${name}]`);
  return el ? el.getAttribute(`data-${name}`) : null;
}
