/* Zdroje znalostí: knihy (teorie obecného fotbalu), registr zdrojů o FM27 a ruční zdroje s rozlišením důvěryhodnosti.
   Zadání § 12: rozlišovat ověřené mechaniky FM27, principy skutečného fotbalu, komunitní zkušenosti a hypotézy AI. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const ui = FM27.ui;
  const { h, $, toast } = ui;

  const CATEGORY_CS = {
    real_football: 'Princip skutečného fotbalu',
    community: 'Komunitní zkušenost',
    other: 'Jiné',
  };
  const TYPE_CS = { book: 'kniha', analysis: 'analýza trenéra nebo týmu', article: 'článek', video: 'video', forum: 'diskuse na fóru', other: 'jiné' };

  // Místa, kde se dá hledat dál. Stránka v Claude nemá přístup na web, nic z toho se nestahuje a nic z toho není ověřené.
  const WHERE_TO_LOOK = [
    ['Football Manager (oficiální stránky hry)', 'https://www.footballmanager.com', 'oficiální'],
    ['Sports Interactive (vývojář)', 'https://www.sigames.com', 'oficiální'],
    ['SEGA (vydavatel)', 'https://www.sega.com', 'oficiální'],
    ['FM Scout', 'https://www.fmscout.com', 'komunitní'],
    ['Sortitoutsi', 'https://sortitoutsi.net', 'komunitní'],
    ['Passion4FM', 'https://www.passion4fm.com', 'komunitní'],
    ['Reddit: r/footballmanagergames', 'https://www.reddit.com/r/footballmanagergames/', 'komunitní'],
  ];

  // ------------------------------------------------------------------ registr zdrojů (oficiální + ruční)
  /** Ruční zdroje se do registru dostanou VŽDY jako neoficiální: aplikace nemůže ověřit, kdo je napsal. */
  function sourceFromUser(doc) {
    return C.parseSource({
      id: 'my:' + doc.id,
      title: doc.title,
      url: doc.url || '',
      publisher: doc.publisher || '',
      version: doc.fmVersion ? `FM${String(doc.fmVersion).replace(/\D/g, '')} (zadal uživatel)` : '',
      source_type: 'zadal uživatel (neověřeno)',
      trust: doc.category,
      caveat: 'Zdroj zadal uživatel ručně. Aplikace ho neověřila, takže ho bere jen jako odhad.',
      claims: String(doc.claims || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 8),
    });
  }
  function rebuildRegistry(app) {
    const base = JSON.parse(ui.$('#knowledge-data').textContent);
    const own = app.store ? app.store.list('source').map(sourceFromUser) : [];
    const official = ((base && base.items) || []).map(C.parseSource);
    app.registry = new C.Registry([...official, ...own]);
  }
  FM27.bus.on('ready', (app) => {
    rebuildRegistry(app);
    app.store.on((e) => e.kind === 'change' && e.type === 'source' && rebuildRegistry(app));
  });

  // ------------------------------------------------------------------ knihovna
  let deleting = new Set();

  function renderBooks(app) {
    const lib = FM27.library;
    const list = $('#bookList');
    if (!list) return;
    list.replaceChildren();
    const langs = { cs: 'čeština', en: 'angličtina', de: 'němčina', other: 'jiný jazyk' };
    for (const b of lib.books) {
      const extra = b.emptyPages ? ` · ${b.emptyPages} stran bez textu (sken) vynecháno` : '';
      const unit = b.pageMode === 'pdf' ? ui.plural(b.pages, 'list', 'listy', 'listů') : ui.plural(b.pages, 'oddíl', 'oddíly', 'oddílů');
      list.append(
        h(
          'div',
          { class: 'book' },
          h('div', { class: 'meta' }, h('b', { text: b.title }), h('span', { text: `${b.author ? b.author + ' · ' : ''}${langs[b.language] || b.language} · ${b.pages} ${unit} · ${b.passages} ${ui.plural(b.passages, 'úryvek', 'úryvky', 'úryvků')}${extra}` })),
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn small', type: 'button', text: 'Hledat', onclick: () => (($('#searchQ').value = b.title), $('#searchQ').focus()) }),
            ui.confirmButton('Smazat', 'Opravdu smazat?', async () => {
              if (deleting.has(b.id)) return;
              deleting.add(b.id);
              try {
                await lib.removeBook(b.id);
                toast(`Kniha „${b.title}“ je smazaná.`);
              } catch (e) {
                toast('Smazání se nepovedlo: ' + (e.message || e));
              } finally {
                deleting.delete(b.id);
                renderBooks(app);
              }
            })
          )
        )
      );
    }
    $('#bookEmpty').hidden = lib.books.length > 0;
    $('#bookHint').textContent = lib.persist.note;
    $('#libHint').textContent = lib.persist.ok ? 'Export se hodí pro přenos na jiné zařízení. Soubor obsahuje texty knih, nikam ho nesdílej.' : lib.persist.note;
  }

  function hitCard(hit) {
    const lib = FM27.library;
    const book = lib.bookById(hit.bookId);
    return h(
      'div',
      { class: 'hit' },
      h('div', { class: 'cite' }, book ? `${book.title}, ${lib.whereLabel(book, hit)}` : hit.id),
      h('p', { text: hit.text.length > 420 ? hit.text.slice(0, 420) + '…' : hit.text }),
      h('div', { class: 'actions', style: 'margin-top:8px' }, h('button', { class: 'btn small', type: 'button', onclick: () => FM27.openPassage(hit.id), text: 'Otevřít v kontextu' }))
    );
  }

  async function addBooks(app) {
    const lib = FM27.library;
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
        const book = await lib.addFile(file, {
          title: files.length === 1 ? $('#bookTitle').value.trim() : '',
          author: $('#bookAuthor').value.trim(),
          language: $('#bookLang').value,
          onProgress: (i, total) => {
            status.textContent = `${label}: list ${i} z ${total}`;
            fill.style.width = Math.round((i / total) * 100) + '%';
          },
        });
        if (book) added++;
        else problems.push(`${file.name}: tuhle knihu už v knihovně máš.`);
      } catch (e) {
        problems.push(`${file.name}: ${e.message || e}`);
      }
      fill.style.width = '100%';
      await ui.yieldToUi();
    }
    bar.hidden = true;
    fill.style.width = '0';
    $('#bookAdd').disabled = false;
    renderBooks(app);
    status.textContent = (added ? `Přidáno: ${added}. ` : '') + (problems.length ? 'Problémy: ' + problems.join(' | ') : '');
    if (added) {
      $('#bookFile').value = '';
      $('#bookTitle').value = '';
      toast(`Přidáno knih: ${added}.`);
    }
  }

  function runSearch() {
    const lib = FM27.library;
    const q = $('#searchQ').value.trim();
    const out = $('#searchResults');
    out.replaceChildren();
    if (!lib.size) return out.append(h('p', { class: 'hint', text: 'Knihovna je prázdná.' }));
    if (!q) return;
    const hits = lib.search(q, { k: 8, perBook: 4 });
    if (!hits.length) return out.append(h('p', { class: 'hint', text: 'Nic nenalezeno. Zkus jiná slova nebo jazyk knihy.' }));
    for (const hit of hits) out.append(hitCard(hit));
  }

  // ------------------------------------------------------------------ zdroje o FM27
  function sourceRow(s, own, app) {
    const verified = app.registry.isOfficialFm27(s.id);
    return h(
      'div',
      { class: 'book' },
      h(
        'div',
        { class: 'meta' },
        h('b', { text: s.title }),
        h('span', { text: [s.publisher, s.fmVersion ? `FM${s.fmVersion}` : 'verze FM neuvedena', s.releaseState === 'pre_release' ? 'předvydaná verze' : null].filter(Boolean).join(' · ') }),
        s.caveat ? h('span', { text: 'Pozor: ' + s.caveat }) : null,
        s.claims.length ? h('span', { text: `Tvrzení: ${s.claims.slice(0, 3).join(' | ')}${s.claims.length > 3 ? ' …' : ''}` }) : null,
        s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', class: 'hint', text: s.url }) : null
      ),
      h('div', { class: 'row' }, ui.tierChip(verified ? 'verified' : 'inferred', verified ? 'oficiální FM27' : 'jen odhad'), own ? ui.confirmButton('Smazat', 'Opravdu?', () => app.store.remove('source', own.id).then(() => renderSources(app))) : null)
    );
  }

  function renderSources(app) {
    const box = $('#sourceList');
    if (!box) return;
    box.replaceChildren();
    const base = JSON.parse(ui.$('#knowledge-data').textContent);
    for (const item of (base && base.items) || []) box.append(sourceRow(C.parseSource(item), null, app));
    for (const doc of app.store.list('source')) box.append(sourceRow(sourceFromUser(doc), doc, app));
    $('#sourceHdr').textContent = `Zdroje, které smí trenér citovat (${box.children.length})`;
  }

  function sourceForm(app) {
    const title = ui.input({ id: 'srcTitle', maxlength: 160, placeholder: 'Název článku, videa nebo rozboru' });
    const url = ui.input({ id: 'srcUrl', maxlength: 300, placeholder: 'https://…' });
    const date = ui.input({ id: 'srcDate', type: 'date' });
    const ver = ui.input({ id: 'srcVer', maxlength: 8, placeholder: 'Např. 26 (jen když je zdroj o konkrétní verzi)' });
    const type = ui.select(Object.entries(TYPE_CS), 'article', { id: 'srcType' });
    const cat = ui.select(Object.entries(CATEGORY_CS), 'community', { id: 'srcCat' });
    const area = ui.input({ id: 'srcArea', maxlength: 120, placeholder: 'Např. presink, rozehrávka' });
    const claims = h('textarea', { id: 'srcClaims', placeholder: 'Co tvrdí (jedno tvrzení na řádek, vlastními slovy). Trenér je smí citovat jen jako odhad.', style: 'min-height:70px' });
    const msg = h('p', { class: 'hint', id: 'srcMsg' });
    return h(
      'div',
      null,
      h('p', { class: 'hint', text: 'Zdroj, který přidáš ručně, trenér bere vždy jen jako odhad. Aplikace nemůže ověřit, kdo ho napsal ani jak je aktuální. Starší verze Football Manageru není FM27.' }),
      h('div', { class: 'row' }, ui.field('Název', title, { grow: true }), ui.field('Odkaz', url, { grow: true })),
      h('div', { class: 'row' }, ui.field('Datum', date, { width: '170px' }), ui.field('Verze FM', ver, { grow: true }), ui.field('Typ', type, { width: '210px' }), ui.field('Druh poznatku', cat, { width: '230px' })),
      ui.field('Oblast použití', area),
      ui.field('Tvrzení ze zdroje', claims),
      h(
        'div',
        { class: 'actions' },
        h('button', {
          class: 'btn',
          id: 'srcAdd',
          type: 'button',
          text: 'Přidat zdroj',
          onclick: async () => {
            const t = title.value.trim();
            if (!t) return (msg.textContent = 'Napiš název zdroje.');
            if (url.value.trim() && !/^https?:\/\//i.test(url.value.trim())) return (msg.textContent = 'Odkaz musí začínat https://.');
            await app.store.put('source', {
              title: t,
              url: url.value.trim(),
              date: date.value,
              fmVersion: ver.value.trim(),
              type: type.value,
              category: cat.value,
              area: area.value.trim(),
              claims: claims.value,
              addedAt: Date.now(),
            });
            for (const el of [title, url, date, ver, area, claims]) el.value = '';
            msg.textContent = '';
            toast('Zdroj je přidaný.');
            renderSources(app);
          },
        })
      ),
      msg
    );
  }

  // ------------------------------------------------------------------ obrazovka
  function render(root, app) {
    const lib = FM27.library;
    const importInput = h('input', { type: 'file', id: 'importLib', accept: 'application/json,.json', hidden: true });
    importInput.addEventListener('change', async () => {
      const file = importInput.files[0];
      if (!file) return;
      try {
        const n = await lib.importData(JSON.parse(await file.text()));
        renderBooks(app);
        toast(n ? `Importováno knih: ${n}.` : 'Nic nového k importu.');
      } catch (e) {
        toast('Import se nepovedl: ' + (e.message || e));
      }
      importInput.value = '';
    });

    root.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Přidat knihu' }),
        h('p', { class: 'lead', text: 'Soubory se čtou přímo v tomto zařízení. Texty knih zůstávají tady a trenér z nich cituje s názvem knihy a listem PDF. Kniha je teorie obecného fotbalu, ne popis toho, jak funguje FM27.' }),
        ui.field('Soubory (PDF s textovou vrstvou, TXT nebo MD)', h('input', { type: 'file', id: 'bookFile', accept: '.pdf,.txt,.md,application/pdf,text/plain,text/markdown', multiple: true })),
        h(
          'div',
          { class: 'row' },
          ui.field('Název (u jednoho souboru)', ui.input({ id: 'bookTitle', maxlength: 160, placeholder: 'Doplní se z názvu souboru' }), { grow: true }),
          ui.field('Autor (volitelné)', ui.input({ id: 'bookAuthor', maxlength: 120 }), { grow: true }),
          ui.field('Jazyk', ui.select([['auto', 'Poznat sám'], ['cs', 'čeština'], ['en', 'angličtina'], ['de', 'němčina'], ['other', 'jiný']], 'auto', { id: 'bookLang' }), { width: '150px' })
        ),
        h('label', { class: 'checkline' }, h('input', { type: 'checkbox', id: 'bookRights' }), h('span', { text: 'Mám právo tento dokument používat pro vlastní potřebu.' })),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', id: 'bookAdd', type: 'button', text: 'Zpracovat a přidat', onclick: () => addBooks(app) }), h('span', { class: 'hint', id: 'bookHint' })),
        h('div', { class: 'progress', id: 'bookProgress', hidden: true }, h('i')),
        h('p', { class: 'hint', id: 'bookStatus', 'aria-live': 'polite' })
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Moje knihy' }),
        h('div', { class: 'books', id: 'bookList' }),
        h('p', { class: 'hint', id: 'bookEmpty', text: 'Knihovna je prázdná. Bez knih trenér poradí jen z tvých pozorování a řekne to.' }),
        h(
          'div',
          { class: 'actions' },
          h('button', {
            class: 'btn small',
            id: 'exportLib',
            type: 'button',
            text: 'Exportovat knihovnu',
            onclick: () => {
              if (!lib.books.length) return toast('Není co exportovat.');
              app.saveFile('fm27-knihovna.json', new Blob([JSON.stringify(lib.exportData())], { type: 'application/json' }));
            },
          }),
          h('label', { class: 'btn small', for: 'importLib', style: 'cursor:pointer', text: 'Importovat knihovnu' }),
          importInput,
          h('span', { class: 'hint', id: 'libHint' })
        )
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Zkušební hledání' }),
        h('p', { class: 'lead', text: 'Podívej se, co z knihovny trenér vidí. Takové úryvky dostane, když se ho zeptáš.' }),
        h(
          'div',
          { class: 'row' },
          ui.field('Hledaný výraz', ui.input({ id: 'searchQ', placeholder: 'Např.: izolovaný útočník, support striker' }), { grow: true, noMargin: true }),
          h('button', { class: 'btn', id: 'searchBtn', type: 'button', text: 'Hledat', onclick: runSearch })
        ),
        h('div', { id: 'searchResults' })
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { id: 'sourceHdr', text: 'Zdroje, které smí trenér citovat' }),
        h('p', { class: 'lead', text: 'Rozlišuji čtyři druhy poznatků: ověřená mechanika FM27 (jen oficiální zdroj výslovně o FM27), princip skutečného fotbalu (knihy a rozbory), komunitní zkušenost a hypotéza AI (ta není zdroj, je vždy označená jako odhad).' }),
        h('div', { class: 'books', id: 'sourceList' }),
        h('h3', { text: 'Přidat vlastní zdroj', style: 'margin-top:16px' }),
        sourceForm(app)
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Kde hledat dál' }),
        h('p', { class: 'lead', text: 'Tahle stránka nemá přístup na web a nic z těchto míst nestahuje. Je to jen seznam, kde se dá ověřit, co hra opravdu umí. Co tam najdeš, přidej výš jako zdroj s datem a verzí hry.' }),
        h('ul', { class: 'list' }, WHERE_TO_LOOK.map(([name, url, kind]) => h('li', null, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: name }), ` (${kind}, neověřeno)`)))
      )
    );
    $('#searchQ').addEventListener('keydown', (e) => e.key === 'Enter' && runSearch());
    renderBooks(app);
    renderSources(app);
    const off = FM27.bus.on('library', () => renderBooks(app));
    app.onCleanup(off);
  }

  FM27.screens.register({ id: 'zdroje', hash: 'zdroje', label: 'Zdroje znalostí', order: 9, render });
})();
