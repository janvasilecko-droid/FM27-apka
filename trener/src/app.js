/* FM27 Tactical Coach: stránka v Claude (rozhraní a napojení na schopnosti stránky).
   Logika (hledání, kontrola poctivosti, prompty) je v core.js a má vlastní testy. */
(function () {
  'use strict';
  const C = window.TrenerCore;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  // ------------------------------------------------------------------ stav
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const registry = C.Registry.fromKnowledgeJson(JSON.parse($('#knowledge-data').textContent));
  const state = {
    caps: { sample: null, downloads: null, limits: null, probed: false },
    persist: { ok: false, note: '' },
    books: [],
    passages: [],
    index: new C.Index([]),
    obs: [],
    plan: null,
    images: [],
    run: null,
    lastCtx: null,
  };

  // ------------------------------------------------------------------ drobnosti
  let toastTimer = 0;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3800);
  }
  function setPill(id, kind, text) {
    const el = $(id);
    el.className = 'pill ' + kind;
    el.lastElementChild.textContent = text;
  }
  const yieldToUi = () => new Promise((r) => setTimeout(r, 0));
  const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------ záložky
  const TABS = ['coach', 'knihovna', 'info'];
  function showTab(name, fromHash) {
    if (!TABS.includes(name)) name = 'coach';
    for (const t of TABS) {
      const on = t === name;
      $('#tab-' + t).hidden = !on;
      $('#tabBtn-' + t).setAttribute('aria-selected', String(on));
    }
    if (!fromHash) {
      try {
        history.replaceState(null, '', '#' + name);
      } catch (e) {
        /* v rámu to může být zakázané; nevadí */
      }
    }
    if (name === 'info') renderDiag();
  }

  // ------------------------------------------------------------------ úložiště (IndexedDB, jen pohodlí)
  const store = {
    db: null,
    open() {
      return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('IndexedDB není k dispozici'));
        let req;
        try {
          req = indexedDB.open('fm27-trener', 1);
        } catch (e) {
          return reject(e);
        }
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('books', { keyPath: 'id' });
          db.createObjectStore('passages', { keyPath: 'id' }).createIndex('bookId', 'bookId');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB se nepodařilo otevřít'));
      });
    },
    run(stores, mode, work) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(stores, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transakce se přerušila'));
        result = work(tx);
      });
    },
    all(name) {
      return new Promise((resolve, reject) => {
        const req = this.db.transaction(name, 'readonly').objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    saveBook(book, passages) {
      return this.run(['books', 'passages'], 'readwrite', (tx) => {
        tx.objectStore('books').put(book);
        const ps = tx.objectStore('passages');
        for (const p of passages) ps.put(p);
      });
    },
    removeBook(id) {
      return this.run(['books', 'passages'], 'readwrite', (tx) => {
        tx.objectStore('books').delete(id);
        const ix = tx.objectStore('passages').index('bookId');
        ix.openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
          const cur = e.target.result;
          if (cur) {
            tx.objectStore('passages').delete(cur.primaryKey);
            cur.continue();
          }
        };
      });
    },
  };

  async function loadLibrary() {
    try {
      store.db = await store.open();
      state.books = (await store.all('books')).sort((a, b) => a.addedAt - b.addedAt);
      state.passages = await store.all('passages');
      state.persist = { ok: true, note: '' };
    } catch (e) {
      state.persist = { ok: false, note: 'Úložiště prohlížeče není dostupné: knihovna se po zavření stránky neuchová.' };
    }
    rebuildIndex();
  }
  function rebuildIndex() {
    state.index = new C.Index(state.passages);
  }
  const bookById = (id) => state.books.find((b) => b.id === id) || null;
  const whereLabel = (book, p) => (book.pageMode === 'pdf' ? `list PDF č. ${p.page}` : `oddíl ${p.page}`);

  // ------------------------------------------------------------------ PDF (pdf.js z cdnjs, načte se až při prvním PDF)
  let pdfPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfPromise) {
      pdfPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PDFJS_URL;
        s.onload = () => {
          try {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
            resolve(window.pdfjsLib);
          } catch (e) {
            reject(e);
          }
        };
        s.onerror = () => {
          pdfPromise = null;
          reject(new Error('Čtečku PDF se nepodařilo načíst. Zkus textový soubor (.txt).'));
        };
        document.head.appendChild(s);
      });
    }
    return pdfPromise;
  }
  function itemsToText(items) {
    let out = '';
    let prev = null;
    for (const it of items) {
      if (!('str' in it)) continue;
      if (prev) {
        const sameLine = Math.abs(it.transform[5] - prev.transform[5]) < 2;
        if (!sameLine) out += '\n';
        else {
          const gap = it.transform[4] - (prev.transform[4] + prev.width);
          const height = Math.abs(prev.transform[3]) || 10;
          if (gap > height * 0.15 && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' ';
        }
      }
      out += it.str;
      prev = it;
      if (it.hasEOL) {
        out += '\n';
        prev = null;
      }
    }
    return out;
  }
  async function extractPdfPages(file, onProgress) {
    const pdfjs = await loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(itemsToText(content.items));
      onProgress(i, doc.numPages);
      if (i % 5 === 0) await yieldToUi();
    }
    return pages;
  }
  async function sha256Hex(file) {
    if (!(window.crypto && crypto.subtle)) return null;
    try {
      const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------ knihovna
  function renderLibrary() {
    const nb = state.books.length;
    const np = state.passages.length;
    setPill(
      '#pillLibrary',
      nb ? 'ok' : 'warn',
      nb ? `Knihovna: ${nb} ${plural(nb, 'kniha', 'knihy', 'knih')}, ${np} ${plural(np, 'úryvek', 'úryvky', 'úryvků')}` : 'Knihovna je prázdná'
    );
    const list = $('#bookList');
    list.replaceChildren();
    for (const b of state.books) {
      const langs = { cs: 'čeština', en: 'angličtina', de: 'němčina', other: 'jiný jazyk' };
      const extra = b.emptyPages ? ` · ${b.emptyPages} stran bez textu (sken) vynecháno` : '';
      list.append(
        h(
          'div',
          { class: 'book' },
          h(
            'div',
            { class: 'meta' },
            h('b', { text: b.title }),
            h('span', { text: `${b.author ? b.author + ' · ' : ''}${langs[b.language] || b.language} · ${b.pages} ${b.pageMode === 'pdf' ? plural(b.pages, 'list', 'listy', 'listů') : plural(b.pages, 'oddíl', 'oddíly', 'oddílů')} · ${b.passages} ${plural(b.passages, 'úryvek', 'úryvky', 'úryvků')}${extra}` })
          ),
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn small', type: 'button', onclick: () => ($('#searchQ').value = b.title) && $('#searchQ').focus(), text: 'Hledat' }),
            h('button', { class: 'btn small danger', type: 'button', onclick: () => deleteBook(b.id), text: 'Smazat' })
          )
        )
      );
    }
    $('#bookEmpty').hidden = nb > 0;
    $('#bookHint').textContent = state.persist.note;
    $('#libHint').textContent = state.persist.ok
      ? 'Export se hodí pro přenos na jiné zařízení. Soubor obsahuje texty knih, nikam ho nesdílej.'
      : state.persist.note;
  }

  let deleting = new Set();
  async function deleteBook(id) {
    const book = bookById(id);
    if (!book || deleting.has(id)) return;
    const btns = $$('#bookList .danger');
    // Okno confirm() v artefaktu nefunguje, proto druhé kliknutí do tří vteřin potvrdí.
    const target = btns[state.books.indexOf(book)];
    if (!target.dataset.armed) {
      target.dataset.armed = '1';
      target.textContent = 'Opravdu smazat?';
      setTimeout(() => {
        if (target.isConnected) {
          delete target.dataset.armed;
          target.textContent = 'Smazat';
        }
      }, 3000);
      return;
    }
    deleting.add(id);
    try {
      if (state.persist.ok) await store.removeBook(id);
      state.books = state.books.filter((b) => b.id !== id);
      state.passages = state.passages.filter((p) => p.bookId !== id);
      rebuildIndex();
      toast(`Kniha „${book.title}“ je smazaná.`);
    } catch (e) {
      toast('Smazání se nepovedlo: ' + (e.message || e));
    } finally {
      deleting.delete(id);
      renderLibrary();
    }
  }

  async function addBooks() {
    const files = [...$('#bookFile').files];
    const status = $('#bookStatus');
    if (!files.length) return (status.textContent = 'Vyber aspoň jeden soubor.');
    if (!$('#bookRights').checked) return (status.textContent = 'Potvrď, že dokument smíš používat.');
    const bar = $('#bookProgress');
    const fill = bar.firstElementChild;
    $('#bookAdd').disabled = true;
    bar.hidden = false;
    let added = 0;
    const problems = [];
    for (const [n, file] of files.entries()) {
      const label = `(${n + 1}/${files.length}) ${file.name}`;
      try {
        status.textContent = `${label}: čtu soubor…`;
        const book = await ingestOne(file, files.length === 1, (i, total) => {
          status.textContent = `${label}: list ${i} z ${total}`;
          fill.style.width = Math.round((i / total) * 100) + '%';
        });
        if (book) added++;
        else problems.push(`${file.name}: tuhle knihu už v knihovně máš.`);
      } catch (e) {
        problems.push(`${file.name}: ${e.message || e}`);
      }
      fill.style.width = '100%';
      await yieldToUi();
    }
    bar.hidden = true;
    fill.style.width = '0';
    $('#bookAdd').disabled = false;
    renderLibrary();
    status.textContent =
      (added ? `Přidáno: ${added}. ` : '') + (problems.length ? 'Problémy: ' + problems.join(' | ') : '');
    if (added) {
      $('#bookFile').value = '';
      $('#bookTitle').value = '';
      toast(`Přidáno knih: ${added}.`);
    }
  }

  async function ingestOne(file, single, onProgress) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const sha = await sha256Hex(file);
    if (sha && state.books.some((b) => b.sha256 === sha)) return null;
    let pages;
    let emptyPages = 0;
    if (isPdf) {
      pages = await extractPdfPages(file, onProgress);
      emptyPages = pages.filter((p) => p.trim().length < 20).length;
      pages = C.stripRunningLines(pages);
    } else {
      pages = C.splitTextIntoSections(await file.text());
    }
    if (!pages.some((p) => p.trim().length >= 40)) {
      throw new Error('v souboru není čitelný text (u skenů bez textové vrstvy čtení zatím není).');
    }
    let id;
    do id = C.makeId(6);
    while (bookById(id));
    const requested = $('#bookLang').value;
    const language = requested === 'auto' ? C.detectLanguage(pages.join(' ').slice(0, 40000)) : requested;
    const passages = C.buildPassages(id, pages);
    if (!passages.length) throw new Error('z textu nevzniklo žádné použitelné místo pro hledání.');
    const book = {
      id,
      title: (single && $('#bookTitle').value.trim()) || file.name.replace(/\.[^.]+$/, ''),
      author: $('#bookAuthor').value.trim(),
      language,
      kind: 'book',
      pageMode: isPdf ? 'pdf' : 'section',
      pages: pages.length,
      passages: passages.length,
      emptyPages,
      size: file.size,
      sha256: sha,
      fileName: file.name,
      addedAt: Date.now(),
    };
    if (state.persist.ok) await store.saveBook(book, passages);
    state.books.push(book);
    state.passages.push(...passages);
    rebuildIndex();
    return book;
  }

  function hitCard(hit) {
    const book = bookById(hit.bookId);
    return h(
      'div',
      { class: 'hit' },
      h('div', { class: 'cite' }, book ? `${book.title}, ${whereLabel(book, hit)}` : hit.id),
      h('p', { text: hit.text.length > 420 ? hit.text.slice(0, 420) + '…' : hit.text }),
      h('div', { class: 'actions', style: 'margin-top:8px' }, h('button', { class: 'btn small', type: 'button', onclick: () => openPassage(hit.id), text: 'Otevřít v kontextu' }))
    );
  }
  function runSearch() {
    const q = $('#searchQ').value.trim();
    const out = $('#searchResults');
    out.replaceChildren();
    if (!state.index.size) return out.append(h('p', { class: 'hint', text: 'Knihovna je prázdná.' }));
    if (!q) return;
    const hits = state.index.search(q, { k: 8, perBook: 4 });
    if (!hits.length) return out.append(h('p', { class: 'hint', text: 'Nic nenalezeno. Zkus jiná slova nebo jazyk knihy.' }));
    for (const hit of hits) out.append(hitCard(hit));
  }

  async function exportLibrary() {
    if (!state.caps.downloads) return toast('Export souboru není v tomto okně dostupný.');
    if (!state.books.length) return toast('Není co exportovat.');
    const blob = new Blob([JSON.stringify({ format: 'fm27-trener-library', version: 1, exportedAt: new Date().toISOString(), books: state.books, passages: state.passages })], { type: 'application/json' });
    try {
      await state.caps.downloads.save({ filename: 'fm27-knihovna.json', data: blob });
      toast('Export je uložený.');
    } catch (e) {
      if (e && e.code !== 'declined') toast('Uložení se nepovedlo (' + (e.code || 'chyba') + ').');
    }
  }
  async function importLibrary(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'fm27-trener-library' || !Array.isArray(data.books) || !Array.isArray(data.passages)) throw new Error('Tohle není export knihovny FM27 Tactical Coach.');
      let added = 0;
      for (const book of data.books) {
        if (!book || !book.id || bookById(book.id) || (book.sha256 && state.books.some((b) => b.sha256 === book.sha256))) continue;
        const own = data.passages.filter((p) => p.bookId === book.id && /^bk:/.test(String(p.id)) && typeof p.text === 'string');
        if (!own.length) continue;
        if (state.persist.ok) await store.saveBook(book, own);
        state.books.push(book);
        state.passages.push(...own);
        added++;
      }
      rebuildIndex();
      renderLibrary();
      toast(added ? `Importováno knih: ${added}.` : 'Nic nového k importu.');
    } catch (e) {
      toast('Import se nepovedl: ' + (e.message || e));
    }
  }

  // ------------------------------------------------------------------ výsuvný panel s úryvkem
  function openDrawer(title, nodes) {
    $('#drawerTitle').textContent = title;
    $('#drawerBody').replaceChildren(...nodes);
    $('#drawer').hidden = false;
    $('#drawerClose').focus();
  }
  function openPassage(id, snapshot) {
    const live = state.index.byId.get(id);
    if (live) {
      const book = bookById(live.bookId);
      const nodes = state.index.neighbours(id, 1).map((p) =>
        h('div', { class: 'passage' + (p.id === id ? ' focus' : '') }, h('small', { class: 'mono', text: `${p.id} · ${book ? whereLabel(book, p) : ''}` }), h('p', { text: p.text }))
      );
      nodes.push(h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => copyText(`${book.title}, ${whereLabel(book, live)}`, 'Citace je zkopírovaná.'), text: 'Kopírovat citaci' })));
      return openDrawer(book ? `${book.title}${book.author ? ' (' + book.author + ')' : ''}` : 'Úryvek', nodes);
    }
    if (snapshot) {
      return openDrawer(snapshot.title, [
        h('div', { class: 'passage focus' }, h('small', { class: 'mono', text: `${id} · ${snapshot.where}` }), h('p', { text: snapshot.text })),
        h('p', { class: 'hint', text: 'Kniha už není v knihovně, ukazuji uložený úryvek.' }),
      ]);
    }
    toast('Úryvek už není k dispozici.');
  }
  async function copyText(text, okMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMessage || 'Zkopírováno.');
    } catch (e) {
      const area = h('textarea', { readonly: true, style: 'width:100%;min-height:120px;margin-top:8px' });
      area.value = text;
      openDrawer('Zkopíruj ručně', [area]);
      area.select();
    }
  }

  // ------------------------------------------------------------------ pozorování, plán, obrázky
  const OBS_LABEL_CS = { user_entered: 'moje poznámka', screenshot_verified: 'ověřený screenshot', ocr_unverified: 'strojově vyčteno' };
  function renderObs() {
    const list = $('#obsList');
    list.replaceChildren();
    for (const o of state.obs) {
      list.append(
        h(
          'li',
          { class: 'obs-item' },
          h('span', { class: 'mono', text: o.id }),
          h('span', { class: 't' }, h('span', { class: 'chip t-' + C.LABEL_TO_TIER[o.label], text: OBS_LABEL_CS[o.label] || o.label }), ' ', o.minute !== null ? `${o.minute}'. ` : '', o.text),
          h('button', { type: 'button', 'aria-label': 'Odebrat pozorování ' + o.id, onclick: () => { state.obs = state.obs.filter((x) => x !== o); renderObs(); }, text: '×' })
        )
      );
    }
  }
  function nextObsId(prefix) {
    let n = 1;
    while (state.obs.some((o) => o.id === `${prefix}-${n}`)) n++;
    return `${prefix}-${n}`;
  }
  function addObservation(label, minute, text, prefix) {
    text = text.trim();
    if (!text) return false;
    if (state.obs.length >= 30) {
      toast('Víc než 30 pozorování se nevejde.');
      return false;
    }
    state.obs.push({ id: nextObsId(prefix || 'obs'), label, minute: Number.isInteger(minute) ? minute : null, text: text.slice(0, 400) });
    renderObs();
    return true;
  }
  async function loadPlan(file) {
    const info = $('#planInfo');
    if (!file) {
      state.plan = null;
      info.textContent = 'Bez plánu trenér nezná tvoje rozestavení ani role.';
      return;
    }
    try {
      const plan = JSON.parse(await file.text());
      if (!plan || typeof plan !== 'object' || !Array.isArray(plan.players)) throw new Error('Soubor nevypadá jako ruční plán (chybí hráči).');
      state.plan = plan;
      info.textContent = `Načteno: ${plan.tactic || 'plán'}, ${plan.players.length} hráčů. Jména a role jsou tvoje zadání, ne data načtená z FM27.`;
    } catch (e) {
      state.plan = null;
      $('#planInput').value = '';
      info.textContent = 'Plán se nepodařilo načíst: ' + (e.message || e);
    }
  }
  function pickImages() {
    const files = [...$('#imageInput').files];
    const max = (state.caps.limits && state.caps.limits.images && state.caps.limits.images.maxCount) || 0;
    state.images = files.slice(0, max || 0);
    $('#imageInfo').textContent = state.images.length
      ? `Vybráno: ${state.images.map((f) => f.name).join(', ')}. Pošle se jen po stisknutí „Poradit“. Co z něj Claude přečte, bere trenér jako neověřené.`
      : 'Obrázek se pošle ke Claude jen po stisknutí „Poradit“. Co z něj Claude přečte, bere trenér jako neověřené.';
    if (files.length > state.images.length) toast(`Najednou jde poslat nejvýš ${max} obrázků.`);
  }

  // ------------------------------------------------------------------ schopnosti stránky (Claude)
  async function detectCaps() {
    const claude = window.claude;
    const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
    if (!claude || typeof claude.use !== 'function') return;
    state.caps.sample = await withTimeout(claude.use('sample').catch(() => null), 10500);
    state.caps.downloads = await withTimeout(claude.use('downloads').catch(() => null), 3000);
    if (state.caps.sample && typeof state.caps.sample.limits === 'function') {
      try {
        state.caps.limits = await state.caps.sample.limits();
      } catch (e) {
        state.caps.limits = null;
      }
    }
  }
  function applyCaps() {
    state.caps.probed = true;
    if (state.caps.sample) setPill('#pillClaude', 'ok', 'Claude: připojeno');
    else setPill('#pillClaude', 'bad', 'Claude: nedostupné');
    $('#askBtn').disabled = !state.caps.sample;
    $('#askHint').textContent = state.caps.sample
      ? 'Při prvním použití tě Claude požádá o povolení.'
      : 'Tahle stránka nemá přístup ke Claude. Otevři ji v aplikaci Claude nebo na claude.ai.';
    $('#imageField').hidden = !(state.caps.limits && state.caps.limits.images);
    if (state.caps.limits && state.caps.limits.images) $('#imageInput').accept = state.caps.limits.images.mediaTypes.join(',');
  }

  const ERROR_COPY = {
    not_granted: 'Claude pro tuhle stránku není povolený. Bez povolení trenér radit nemůže.',
    sampling_disabled: 'Claude není pro tvůj účet nebo organizaci dostupný.',
    not_declared: 'Stránka už nemá povolené volání Claude.',
    capability_disabled: 'Volání Claude tady teď nejde použít.',
    capability_removed: 'Tahle verze aplikace Claude volání nepodporuje. Aktualizuj ji.',
    rate_limited: 'Dosáhl jsi limitu využití Claude. Zkus to později.',
    session_expired: 'Přihlášení vypršelo. Přihlas se znovu do Claude.',
    refused: 'Claude tuhle žádost odmítl zpracovat. Zkus ji přeformulovat.',
    empty_completion: 'Claude nevrátil žádný text. Zkus to znovu s kratším zadáním.',
    prompt_too_large: 'Zadání je příliš dlouhé. Zkrať pozorování nebo odeber plán.',
    image_rejected: 'Obrázek Claude nepřijal (typ nebo velikost). Zkus jiný.',
    images_unavailable: 'Obrázky tady nejdou poslat.',
    upstream_error: 'Služba Claude teď chybovala. Zkus to za chvíli.',
    invalid_request: 'Žádost měla špatný tvar. Zkus to znovu.',
  };
  const SECTION_CS = { context: 'Kontext', evidenceA: 'Důkaz A', evidenceB: 'Důkaz B', confidence: 'Jistota', diagnosis: 'Diagnóza', change: 'Změna', measure: 'Měření', risk: 'Rizika', reversal: 'Vrácení změny', unknown: 'Co trenér neví' };
  const humanize = (msg) => String(msg).replace(/^(context|evidenceA|evidenceB|confidence|diagnosis|change|measure|risk|reversal|unknown)(?:\[(\d+)\])?:/, (_, key, n) => `${SECTION_CS[key]}${n ? ' ' + n : ''}:`);
  const NO_RETRY = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'prompt_too_large', 'session_expired', 'rate_limited'];
  const retryRow = () => h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', text: 'Zkusit znovu', onclick: () => runCoach() }));
  const errorText = (e) => (e && ERROR_COPY[e.code]) || `Neočekávaná chyba (${(e && e.code) || (e && e.message) || 'neznámá'}).`;

  // ------------------------------------------------------------------ průběh
  const STEPS = [
    ['plan', 'Plánuji hledání v knihách'],
    ['search', 'Hledám v knihovně'],
    ['advice', 'Skládám radu'],
    ['check', 'Kontroluji poctivost'],
    ['repair', 'Opravuji radu podle kontroly'],
  ];
  const steps = {
    reset(withRepair) {
      const ol = $('#steps');
      ol.hidden = false;
      ol.replaceChildren(...STEPS.filter(([id]) => withRepair || id !== 'repair').map(([id, label]) => h('li', { id: 'step-' + id, text: label })));
    },
    set(id, cls, note) {
      let li = $('#step-' + id);
      if (!li) {
        li = h('li', { id: 'step-' + id, text: (STEPS.find((s) => s[0] === id) || [id, id])[1] });
        $('#steps').append(li);
      }
      li.className = cls;
      const label = (STEPS.find((s) => s[0] === id) || [id, id])[1];
      li.textContent = note ? `${label}: ${note}` : label;
    },
  };

  function setBusy(on) {
    $('#askBtn').disabled = on || !state.caps.sample;
    $('#stopBtn').hidden = !on;
  }

  // ------------------------------------------------------------------ rada
  async function runCoach(opts) {
    opts = opts || {};
    const sample = state.caps.sample;
    if (!sample) return toast('Claude není dostupný.');
    const question = $('#question').value.trim();
    let observations;
    try {
      observations = C.normalizeObservations(state.obs.map((o) => ({ ...o })));
    } catch (e) {
      return toast(e.message);
    }
    const obsMap = {};
    for (const o of observations) obsMap[o.id] = { label: o.label, text: o.text };
    if (state.plan) {
      const text = C.renderPlan(state.plan);
      observations.push({ id: 'plan', label: 'user_entered', minute: null, text });
      obsMap.plan = { label: 'user_entered', text };
    }
    const images = state.caps.limits && state.caps.limits.images ? state.images.slice() : [];
    const imageIds = images.map((_, i) => `img-${i + 1}`);
    imageIds.forEach((id) => {
      observations.push({ id, label: 'vision_unverified', minute: null, text: '(obrázek předaný modelu)' });
      obsMap[id] = { label: 'vision_unverified', text: '(obrázek předaný modelu)' };
    });
    if (!question && !observations.length) return toast('Napiš, co řešíš, nebo přidej pozorování.');

    const ctl = new AbortController();
    state.run = { ctl };
    setBusy(true);
    $('#resultEmpty').hidden = true;
    $('#result').replaceChildren();
    steps.reset(false);
    const deep = $('#deepMode').checked;
    const notes = [];
    try {
      // 1) plán hledání a 2) hledání v knihovně
      let hits = [];
      let queries = [];
      if (state.index.size) {
        steps.set('plan', 'run', 'při prvním použití potvrď okno Claude');
        let raw = null;
        const languages = [...new Set(state.books.map((b) => b.language).filter((l) => l && l !== 'other'))];
        try {
          raw = await sample.json(C.buildPlannerPrompt(question, observations, languages), { modelTier: 'quick', signal: ctl.signal });
        } catch (e) {
          if (e && e.code === 'cancelled') throw e;
          if (e && ['not_granted', 'sampling_disabled', 'not_declared', 'rate_limited', 'session_expired'].includes(e.code)) throw e;
          notes.push('Plán hledání se nepovedl, hledal jsem podle tvého zadání.');
        }
        const fallback = [question, ...observations.map((o) => o.text)].join(' ').slice(0, 300);
        queries = C.sanitizeQueries(raw, fallback);
        steps.set('plan', 'done', `${queries.length} ${plural(queries.length, 'dotaz', 'dotazy', 'dotazů')}`);
        steps.set('search', 'run');
        hits = C.multiSearch(state.index, queries, { k: 10, perBook: 3 });
        steps.set('search', 'done', `${hits.length} ${plural(hits.length, 'úryvek', 'úryvky', 'úryvků')}`);
      } else {
        steps.set('plan', 'skip', 'knihovna je prázdná');
        steps.set('search', 'skip');
        notes.push('Knihovna je prázdná, rada nevychází z knih.');
      }
      const passageCtx = {};
      for (const hit of hits) {
        const book = bookById(hit.bookId);
        passageCtx[hit.id] = { id: hit.id, bookId: hit.bookId, title: book ? book.title : '?', where: book ? whereLabel(book, hit) : '?', text: hit.text.slice(0, 1000) };
      }
      const passageList = Object.values(passageCtx);

      // 3) rada
      steps.set('advice', 'run', 'může trvat desítky vteřin');
      const baseTurns = C.buildAdviceTurns({
        question,
        observations,
        passages: passageList,
        sourcesDigest: registry.digest(),
        previousAdvice: opts.previousAdvice || '',
        imageIds,
      });
      const callOpts = (withImages) => ({
        modelTier: deep ? 'complex' : 'default',
        signal: ctl.signal,
        cache: false,
        images: withImages && images.length ? images : undefined,
        onText: ({ text }) => steps.set('advice', 'run', `${text.length} znaků`),
      });
      const validate = (advice) => C.validateAdvice10(advice, { observations: obsMap, registry, passages: new Set(Object.keys(passageCtx)) });

      let raw = null;
      let advice = null;
      let errors = [];
      try {
        advice = await sample.json(baseTurns, callOpts(true));
      } catch (e) {
        if (e && e.code === 'invalid_json') {
          raw = e.text || '';
          errors = ['Odpověď nebyla platný JSON objekt podle uvedeného tvaru.'];
        } else throw e;
      }
      steps.set('advice', 'done');
      steps.set('check', 'run');
      let verdict = advice !== null ? validate(advice) : { ok: false, errors, warnings: [], needs_verification: false };
      steps.set('check', verdict.ok ? 'done' : 'fail', verdict.ok ? 'prošla' : `${verdict.errors.length} výhrad`);

      // 4) jedno opravné kolo
      if (!verdict.ok) {
        steps.set('repair', 'run');
        const echoed = raw !== null && raw !== '' ? raw : JSON.stringify(advice);
        try {
          advice = await sample.json(C.buildRepairTurns(baseTurns, echoed, verdict.errors), callOpts(false));
          verdict = validate(advice);
          steps.set('repair', verdict.ok ? 'done' : 'fail', verdict.ok ? 'rada je opravená' : 'rada dál nesplňuje pravidla');
        } catch (e) {
          if (e && e.code === 'invalid_json') {
            verdict = { ok: false, errors: ['Opravená odpověď nebyla platný JSON.'], warnings: [], needs_verification: false };
            steps.set('repair', 'fail');
          } else throw e;
        }
      }

      const ctx = { passages: passageCtx, observations: obsMap, queries, notes };
      if (verdict.ok) {
        const entry = { at: Date.now(), question, advice, passages: passageCtx, observations: obsMap, warnings: verdict.warnings, needs_verification: verdict.needs_verification };
        saveHistory(entry);
        renderResult({ status: 'ok', advice, verdict, ctx });
      } else {
        renderResult({ status: 'needs_more_info', verdict, ctx });
      }
    } catch (e) {
      if (e && e.code === 'cancelled') {
        steps.set('advice', 'fail', 'zastaveno');
        toast('Zastaveno.');
      } else {
        steps.set('advice', 'fail');
        renderResult({ status: 'error', message: errorText(e), retry: !(e && NO_RETRY.includes(e.code)), ctx: { notes } });
      }
    } finally {
      state.run = null;
      setBusy(false);
    }
  }

  // ------------------------------------------------------------------ vykreslení rady
  const tierChip = (tier) => h('span', { class: 'chip t-' + tier, text: C.TIER_LABEL_CS[tier] || tier });
  function refChip(ref, ctx) {
    if (ref.startsWith('bk:') && ctx.passages[ref]) {
      const p = ctx.passages[ref];
      return h('button', { class: 'ref', type: 'button', title: 'Otevřít úryvek z knihy', onclick: () => openPassage(ref, p), text: `Kniha: ${p.title}, ${p.where}` });
    }
    if (ctx.observations && ctx.observations[ref]) return h('span', { class: 'ref', title: ctx.observations[ref].text, text: `Pozorování ${ref}` });
    const src = registry.get(ref);
    if (src) return h('a', { class: 'ref', href: src.url, target: '_blank', rel: 'noopener noreferrer', title: src.caveat || src.title, text: `Zdroj: ${src.title}` });
    return h('span', { class: 'ref', text: ref });
  }
  const refsRow = (refs, ctx) => (refs && refs.length ? h('div', { class: 'refs' }, refs.map((r) => refChip(r, ctx))) : null);
  const sec = (no, title, chip, ...body) => h('div', { class: 'sec' }, h('h3', null, h('span', { class: 'no', text: String(no).padStart(2, '0') }), title, chip), ...body);

  function renderResult(res) {
    const out = $('#result');
    out.replaceChildren();
    const ctx = res.ctx || {};
    if (res.status === 'error') {
      out.append(h('div', { class: 'banner bad' }, h('b', { text: 'Rada se nepovedla' }), h('span', { text: res.message }), res.retry ? retryRow() : null));
      return;
    }
    if (res.status === 'needs_more_info') {
      out.append(
        h(
          'div',
          { class: 'banner warn' },
          h('b', { text: 'Trenér nedodal radu, která by prošla kontrolou poctivosti' }),
          h('p', { text: 'Žádná rada se proto nezobrazuje. Doplň pozorování (co přesně vidíš, nejlépe na ověřeném screenshotu) a zkus to znovu.' }),
          h('ul', { class: 'list' }, res.verdict.errors.slice(0, 8).map((e) => h('li', { text: humanize(e) }))),
          retryRow()
        )
      );
      return;
    }
    const { advice, verdict } = res;
    const banner = h('div', { class: 'banner ok' }, h('b', { text: 'Rada prošla kontrolou poctivosti' }));
    const notes = [...(ctx.notes || []), ...verdict.warnings.filter((w) => !(verdict.needs_verification && /nejsou ověřené ve hře/.test(w)))];
    if (verdict.needs_verification) banner.append(h('p', { text: 'Názvy nastavení a cesty v menu FM27 jsou neověřené. Než změnu provedeš, ověř je ve hře (viz bod 10).' }));
    if (notes.length) banner.append(h('ul', { class: 'list' }, notes.map((n) => h('li', { text: humanize(n) }))));
    if (ctx.queries && ctx.queries.length) banner.append(h('p', { class: 'hint', text: 'Hledáno: ' + ctx.queries.map((q) => (q.length > 70 ? q.slice(0, 67) + '…' : q)).join(' · ') }));
    out.append(banner);

    const list = h('div', { class: 'advice' });
    const tiered = (no, title, key, extra) => {
      const s = advice[key];
      return sec(no, title, tierChip(s.tier), h('p', { text: s.text }), refsRow(s.refs, ctx), extra);
    };
    list.append(tiered(1, 'Kontext', 'context'), tiered(2, 'Důkaz A', 'evidenceA'), tiered(3, 'Důkaz B', 'evidenceB'));
    list.append(sec(4, 'Jistota', h('span', { class: 'chip t-' + (advice.confidence.level === 'high' ? 'observed' : advice.confidence.level === 'medium' ? 'inferred' : 'unknown'), text: C.LEVEL_CS[advice.confidence.level] }), h('p', { text: advice.confidence.text })));
    list.append(tiered(5, 'Diagnóza', 'diagnosis'));

    const changeSec = sec(6, 'Co změnit a kde', null, h('p', { text: advice.change.text }));
    changeSec.classList.add('key');
    for (const item of advice.change.items) {
      changeSec.append(
        h(
          'div',
          { class: 'change-item' },
          h('div', { class: 'what' }, `${item.player}: ${item.setting}`),
          h('div', null, `z „${item.from}“ `, h('span', { class: 'arrow', text: '→' }), ` na „${item.to}“`),
          h('div', { class: 'hint' }, 'Kde ve hře: ', tierChip(item.where_tier)),
          h('ol', null, item.where.map((s) => h('li', { text: s }))),
          refsRow(item.refs, ctx)
        )
      );
    }
    list.append(changeSec);

    const minutes = advice.measure.recheck_after_minutes;
    list.append(
      sec(7, 'Jak změřit', null, h('p', { text: advice.measure.text }), h('ul', null, advice.measure.checks.map((c) => h('li', { text: c }))), h('p', { class: 'hint', text: minutes ? `Znovu vyhodnotit za ${minutes} min.` : 'Čas dalšího vyhodnocení není určen.' }))
    );
    list.append(sec(8, 'Rizika', null, h('p', { text: advice.risk.text }), h('ul', null, advice.risk.items.map((c) => h('li', { text: c })))));
    list.append(sec(9, 'Jak změnu vrátit zpět', null, h('p', { text: advice.reversal.text })));

    const unknown = advice.unknown;
    const answers = [];
    const unknownSec = sec(10, 'Co trenér neví', tierChip('unknown'), h('p', { text: unknown.text }));
    if (unknown.items.length) {
      const form = h('div', { class: 'followup' });
      for (const item of unknown.items) {
        const input = h('input', { type: 'text', maxlength: 400, 'aria-label': 'Doplnění: ' + item, placeholder: 'Tvoje odpověď (nepovinné)' });
        answers.push([item, input]);
        form.append(h('label', { text: item }), input);
      }
      form.append(
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: 'Poradit znovu s doplněním', onclick: () => {
          let any = false;
          for (const [item, input] of answers) if (input.value.trim() && addObservation('user_entered', null, `${item} → ${input.value.trim()}`, 'dop')) any = true;
          if (!any) return toast('Doplň aspoň jednu odpověď.');
          runCoach({ previousAdvice: C.adviceToText(advice) });
        } }))
      );
      unknownSec.append(form);
    }
    list.append(unknownSec);
    out.append(list);
    out.append(h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', text: 'Kopírovat radu', onclick: () => copyText(C.adviceToText(advice), 'Rada je zkopírovaná.') })));
    state.lastCtx = ctx;
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------------ historie
  function loadHistory() {
    return lsGet('fm27.history', []);
  }
  function saveHistory(entry) {
    const list = loadHistory();
    list.unshift(entry);
    while (list.length > 15) list.pop();
    if (!lsSet('fm27.history', list)) {
      while (list.length > 3 && !lsSet('fm27.history', list)) list.pop();
    }
    renderHistory();
  }
  function renderHistory() {
    const list = loadHistory();
    const ul = $('#historyList');
    ul.replaceChildren();
    for (const entry of list) {
      ul.append(
        h(
          'li',
          null,
          h('span', { class: 'q', text: entry.question || '(bez dotazu)' }),
          h('span', { class: 'd', text: new Date(entry.at).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) }),
          h('button', { class: 'btn small', type: 'button', text: 'Otevřít', onclick: () => {
            $('#resultEmpty').hidden = true;
            renderResult({ status: 'ok', advice: entry.advice, verdict: { warnings: entry.warnings || [], needs_verification: !!entry.needs_verification }, ctx: { passages: entry.passages || {}, observations: entry.observations || {}, notes: ['Uložená rada z ' + new Date(entry.at).toLocaleString('cs-CZ')] } });
          } })
        )
      );
    }
    $('#historyEmpty').hidden = list.length > 0;
  }

  // ------------------------------------------------------------------ info a zkoušky
  function renderDiag() {
    const rows = [
      ['Volání Claude', state.caps.sample ? 'dostupné' : state.caps.probed ? 'nedostupné' : 'zjišťuji'],
      ['Obrázky ke Claude', state.caps.limits && state.caps.limits.images ? `ano (až ${state.caps.limits.images.maxCount})` : 'ne'],
      ['Uložení souboru (export)', state.caps.downloads ? 'ano' : 'ne'],
      ['Úložiště knihovny v prohlížeči', state.persist.ok ? 'ano' : 'ne: ' + state.persist.note],
      ['Čtečka PDF', window.pdfjsLib ? 'načtená' : 'načte se při prvním PDF'],
      ['Knihy / úryvky', `${state.books.length} / ${state.passages.length}`],
      ['Oficiální zdroje FM27 v registru', String(registry.size)],
      ['Verze stránky', (($('meta[name="trener-build"]') || {}).content) || '?'],
    ];
    $('#diag').replaceChildren(...rows.map(([k, v]) => h('div', null, h('span', { text: k }), h('span', { text: v }))));
  }
  async function testClaude() {
    const out = $('#testOut');
    if (!state.caps.sample) return (out.textContent = 'Claude není dostupný.');
    out.textContent = 'Zkouším…';
    try {
      const data = await state.caps.sample.json('Odpověz POUZE JSON objektem {"ok": true}', { modelTier: 'quick', cache: false });
      out.textContent = data && data.ok === true ? 'Spojení s Claude funguje.' : 'Claude odpověděl, ale jinak, než se čekalo.';
    } catch (e) {
      out.textContent = errorText(e);
    }
  }
  function testSearch() {
    const demo = C.buildPassages('demo', [
      'Izolovaný útočník potřebuje podporu záložníků. Když se záložní řada drží hluboko, vzniká mezi řadami velká vzdálenost, kterou útočník sám nezvládne překonat.',
      'Vysoký presink vyžaduje kompaktní tým. Všechny řady se posouvají společně k míči, jinak soupeř prohraje souboj a najde prostor za obranou.',
    ]);
    const hits = new C.Index(demo).search('izolovaný útočník podpora');
    $('#testOut').textContent = hits.length && hits[0].id === 'bk:demo:1:1' ? 'Hledání funguje: ukázkový dotaz našel správný úryvek.' : 'Hledání nevrátilo očekávaný úryvek.';
  }

  // ------------------------------------------------------------------ start
  function wire() {
    for (const t of TABS) $('#tabBtn-' + t).addEventListener('click', () => showTab(t));
    window.addEventListener('hashchange', () => showTab(location.hash.slice(1), true));
    $('#obsAdd').addEventListener('click', () => {
      const minuteRaw = $('#obsMinute').value.trim();
      const minute = minuteRaw === '' ? null : Number(minuteRaw);
      if (addObservation($('#obsLabel').value, minute, $('#obsText').value)) {
        $('#obsText').value = '';
        $('#obsMinute').value = '';
        $('#obsText').focus();
      }
    });
    $('#obsText').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('#obsAdd').click();
      }
    });
    $('#planInput').addEventListener('change', (e) => loadPlan(e.target.files[0]));
    $('#imageInput').addEventListener('change', pickImages);
    $('#askBtn').addEventListener('click', () => runCoach());
    $('#stopBtn').addEventListener('click', () => state.run && state.run.ctl.abort());
    $('#bookAdd').addEventListener('click', addBooks);
    $('#searchBtn').addEventListener('click', runSearch);
    $('#searchQ').addEventListener('keydown', (e) => e.key === 'Enter' && runSearch());
    $('#exportLib').addEventListener('click', exportLibrary);
    $('#importLib').addEventListener('change', (e) => e.target.files[0] && importLibrary(e.target.files[0]).then(() => (e.target.value = '')));
    $('#drawerClose').addEventListener('click', () => ($('#drawer').hidden = true));
    document.addEventListener('keydown', (e) => e.key === 'Escape' && ($('#drawer').hidden = true));
    $('#testClaude').addEventListener('click', testClaude);
    $('#testSearch').addEventListener('click', testSearch);
    $('#deepMode').checked = !!lsGet('fm27.deep', false);
    $('#deepMode').addEventListener('change', (e) => lsSet('fm27.deep', e.target.checked));
  }

  async function init() {
    wire();
    showTab(location.hash.slice(1) || 'coach', true);
    $('#askBtn').disabled = true;
    renderObs();
    renderHistory();
    await loadLibrary();
    renderLibrary();
    await detectCaps();
    applyCaps();
    renderDiag();
    window.__trenerReady = true;
  }
  init();
})();
