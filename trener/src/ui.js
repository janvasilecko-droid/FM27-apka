/* Společné pomůcky rozhraní: tvorba prvků, hlášky, panel, potvrzení druhým kliknutím, sběrnice událostí.
   Tohle je první soubor rozhraní: vytváří globální jmenný prostor FM27, do kterého se hlásí ostatní. */
(function () {
  'use strict';
  const FM27 = (window.FM27 = window.FM27 || {});
  const ui = (FM27.ui = {});

  // ------------------------------------------------------------------ sběrnice událostí
  const listeners = new Map();
  FM27.bus = {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },
    emit(name, payload) {
      for (const fn of [...(listeners.get(name) || [])]) {
        try {
          fn(payload);
        } catch (e) {
          console.error('Posluchač události ' + name + ' selhal', e);
        }
      }
    },
  };

  // ------------------------------------------------------------------ obrazovky se hlásí sem
  FM27.screens = {
    list: [],
    register(screen) {
      if (this.list.some((s) => s.id === screen.id)) throw new Error('Obrazovka už je zaregistrovaná: ' + screen.id);
      this.list.push(screen);
    },
    get(id) {
      return this.list.find((s) => s.id === id || s.hash === id) || null;
    },
  };

  // ------------------------------------------------------------------ DOM
  ui.$ = (sel, root) => (root || document).querySelector(sel);
  ui.$$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  /** h('div', {class:'x', onclick: fn, value: 'text'}, 'dítě', jinýPrvek). Hodnoty false/null/undefined se přeskočí. */
  ui.h = function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** svg('circle', {cx: 5, cy: 5, r: 3}, děti…) */
  ui.svg = function svg(tag, attrs, ...kids) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  // ------------------------------------------------------------------ drobnosti
  ui.plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
  ui.yieldToUi = () => new Promise((r) => setTimeout(r, 0));
  ui.debounce = (fn, ms) => {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };
  ui.lsGet = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  };
  ui.lsSet = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  };
  ui.fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '');
  ui.fmtDateTime = (ts) => (ts ? new Date(ts).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  ui.clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  let toastTimer = 0;
  ui.toast = (message, ms) => {
    const el = ui.$('#toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), ms || 3800);
  };

  ui.setPill = (el, kind, text) => {
    if (typeof el === 'string') el = ui.$(el);
    if (!el) return;
    el.className = 'pill ' + kind;
    el.lastElementChild.textContent = text;
  };

  // ------------------------------------------------------------------ panel (úryvek, vysvětlení, ruční kopie)
  ui.openDrawer = (title, nodes) => {
    ui.$('#drawerTitle').textContent = title;
    ui.$('#drawerBody').replaceChildren(...nodes);
    ui.$('#drawer').hidden = false;
    ui.$('#drawerClose').focus();
  };
  ui.closeDrawer = () => {
    const d = ui.$('#drawer');
    if (d) d.hidden = true;
  };
  ui.copyText = async (text, okMessage) => {
    try {
      await navigator.clipboard.writeText(text);
      ui.toast(okMessage || 'Zkopírováno.');
    } catch (e) {
      const area = ui.h('textarea', { readonly: true, style: 'width:100%;min-height:140px;margin-top:8px' });
      area.value = text;
      ui.openDrawer('Zkopíruj ručně', [area]);
      area.select();
    }
  };

  /** Tlačítko, které si žádá druhé kliknutí do tří vteřin (okno confirm() v artefaktu nefunguje). */
  ui.confirmButton = (label, confirmLabel, onConfirm, opts) => {
    const o = Object.assign({ class: 'btn small danger', ms: 3000 }, opts);
    let armed = false;
    let timer = 0;
    const btn = ui.h('button', { class: o.class, type: 'button', text: label });
    btn.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        btn.textContent = confirmLabel;
        timer = setTimeout(() => {
          armed = false;
          btn.textContent = label;
        }, o.ms);
        return;
      }
      clearTimeout(timer);
      armed = false;
      btn.textContent = label;
      onConfirm();
    });
    return btn;
  };

  // ------------------------------------------------------------------ stavební prvky formulářů a karet
  let uid = 0;
  ui.nextId = (prefix) => `${prefix || 'f'}-${++uid}`;

  /** field('Popisek', control, {hint, grow, width}) → div.field s propojeným popiskem */
  ui.field = (label, control, o) => {
    const opts = o || {};
    if (!control.id) control.id = ui.nextId('fld');
    const style = [opts.width ? `width:${opts.width}` : '', opts.noMargin ? 'margin-top:0' : ''].filter(Boolean).join(';');
    return ui.h(
      'div',
      { class: 'field' + (opts.grow ? ' grow' : ''), style: style || null },
      ui.h('label', { for: control.id, text: label }),
      control,
      opts.hint ? ui.h('p', { class: 'hint', text: opts.hint }) : null
    );
  };
  ui.input = (props) => ui.h('input', Object.assign({ type: 'text' }, props));
  ui.select = (options, value, props) => {
    const el = ui.h('select', props || {}, options.map(([v, text]) => ui.h('option', { value: v, text })));
    if (value !== undefined && value !== null) el.value = value;
    return el;
  };
  ui.card = (title, ...kids) => ui.h('section', { class: 'card' }, title ? ui.h('h2', { text: title }) : null, ...kids);
  ui.emptyState = (title, text, ...actions) =>
    ui.h('div', { class: 'empty' }, ui.h('b', { text: title }), text ? ui.h('p', { class: 'hint', text }) : null, actions.length ? ui.h('div', { class: 'actions' }, ...actions) : null);

  const TIER_CS = {
    verified: 'ověřeno, oficiální zdroj',
    observed: 'pozorováno na ověřeném screenshotu',
    user_entered: 'zadal uživatel',
    inferred: 'odhad',
    unknown: 'neznámé',
  };
  ui.tierChip = (tier, text) => ui.h('span', { class: 'chip t-' + tier, text: text || TIER_CS[tier] || tier });
})();
