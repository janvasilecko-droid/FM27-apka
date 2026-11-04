/* Knihovna knih: čtení PDF (pdf.js z cdnjs), TXT a MD, uložení v IndexedDB, hledání (BM25 z core.js).
   Texty knih zůstávají jen v tomto zařízení (nesynchronizují se do `db`, jsou velké a mohou být chráněné autorským právem).
   Schéma databáze fm27-trener (obchody books a passages) je z první verze stránky a nesmí se měnit,
   aby se knihy, které si majitel už přidal, po aktualizaci neztratily. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const { yieldToUi } = FM27.ui;

  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // ------------------------------------------------------------------ IndexedDB
  const idb = {
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

  // ------------------------------------------------------------------ PDF (pdf.js se načte až při prvním PDF)
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
      if (onProgress) onProgress(i, doc.numPages);
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
  const lib = (FM27.library = {
    books: [],
    passages: [],
    index: new C.Index([]),
    persist: { ok: false, note: '' },

    async init() {
      try {
        idb.db = await idb.open();
        lib.books = (await idb.all('books')).sort((a, b) => a.addedAt - b.addedAt);
        lib.passages = await idb.all('passages');
        lib.persist = { ok: true, note: '' };
      } catch (e) {
        lib.persist = { ok: false, note: 'Úložiště prohlížeče není dostupné: knihovna se po zavření stránky neuchová.' };
      }
      lib.rebuild();
    },
    rebuild() {
      lib.index = new C.Index(lib.passages);
      FM27.bus.emit('library', lib);
    },
    bookById: (id) => lib.books.find((b) => b.id === id) || null,
    whereLabel: (book, p) => (book.pageMode === 'pdf' ? `list PDF č. ${p.page}` : `oddíl ${p.page}`),
    citation(passageId) {
      const p = lib.index.byId.get(passageId);
      const b = p && lib.bookById(p.bookId);
      return b ? `${b.title}, ${lib.whereLabel(b, p)}` : passageId;
    },
    search: (q, opts) => lib.index.search(q, opts),
    get size() {
      return lib.index.size;
    },
    languages: () => [...new Set(lib.books.map((b) => b.language).filter((l) => l && l !== 'other'))],

    /** Přidá jeden soubor. Vrací knihu, null když už v knihovně je. Chyby jsou Error s českou zprávou. */
    async addFile(file, o) {
      const opts = Object.assign({ title: '', author: '', language: 'auto', onProgress: null }, o);
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      const sha = await sha256Hex(file);
      if (sha && lib.books.some((b) => b.sha256 === sha)) return null;
      let pages;
      let emptyPages = 0;
      if (isPdf) {
        pages = await extractPdfPages(file, opts.onProgress);
        emptyPages = pages.filter((p) => p.trim().length < 20).length;
        pages = C.stripRunningLines(pages);
      } else {
        pages = C.splitTextIntoSections(await file.text());
      }
      if (!pages.some((p) => p.trim().length >= 40)) throw new Error('v souboru není čitelný text (u skenů bez textové vrstvy čtení zatím není).');
      let id;
      do id = C.makeId(6);
      while (lib.bookById(id));
      const language = opts.language === 'auto' ? C.detectLanguage(pages.join(' ').slice(0, 40000)) : opts.language;
      const passages = C.buildPassages(id, pages);
      if (!passages.length) throw new Error('z textu nevzniklo žádné použitelné místo pro hledání.');
      const book = {
        id,
        title: opts.title || file.name.replace(/\.[^.]+$/, ''),
        author: opts.author || '',
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
      if (lib.persist.ok) await idb.saveBook(book, passages);
      lib.books.push(book);
      lib.passages.push(...passages);
      lib.rebuild();
      return book;
    },

    async removeBook(id) {
      if (lib.persist.ok) await idb.removeBook(id);
      lib.books = lib.books.filter((b) => b.id !== id);
      lib.passages = lib.passages.filter((p) => p.bookId !== id);
      lib.rebuild();
    },

    exportData: () => ({ format: 'fm27-trener-library', version: 1, exportedAt: new Date().toISOString(), books: lib.books, passages: lib.passages }),

    async importData(data) {
      if (!data || data.format !== 'fm27-trener-library' || !Array.isArray(data.books) || !Array.isArray(data.passages)) {
        throw new Error('Tohle není export knihovny FM27 Tactical Coach.');
      }
      let added = 0;
      for (const book of data.books) {
        if (!book || !book.id || lib.bookById(book.id) || (book.sha256 && lib.books.some((b) => b.sha256 === book.sha256))) continue;
        const own = data.passages.filter((p) => p.bookId === book.id && /^bk:/.test(String(p.id)) && typeof p.text === 'string');
        if (!own.length) continue;
        if (lib.persist.ok) await idb.saveBook(book, own);
        lib.books.push(book);
        lib.passages.push(...own);
        added++;
      }
      lib.rebuild();
      return added;
    },
  });
})();
