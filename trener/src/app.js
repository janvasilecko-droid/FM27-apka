/* Jádro aplikace: schopnosti stránky (Claude, db, uživatel, ukládání souborů), úložiště, nastavení, kariéry,
   hlavní menu o deseti sekcích a směrování podle #hash. Jednotlivé obrazovky jsou v screens/*.js a hlásí se do FM27.screens. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const ui = FM27.ui;
  const { $, h, toast } = ui;

  const DEFAULT_SETTINGS = {
    id: 'settings',
    voice: { enabled: false, volume: 0.9, rate: 1, frequency: 'normal', quiet: false, voiceURI: '' },
    live: { baseIntervalSec: 15, maxPerHour: 60, maxPerMatch: 150, autoAlerts: true },
    notify: { enabled: false },
    coach: { deep: false },
    web: { mode: 'auto' }, // hledání zdrojů na webu při radě a lekci: auto (zapnuto u konektoru, vypnuto u vlastního klíče), on, off
  };
  // Zastaralé adresy z první verze stránky vedou na nové sekce.
  const LEGACY_HASH = { coach: 'trener', knihovna: 'zdroje', info: 'nastaveni' };
  const DEFAULT_SCREEN = 'live';

  function deepMerge(base, patch) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const [k, v] of Object.entries(patch || {})) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) ? deepMerge(out[k], v) : v;
    }
    return out;
  }

  const cleanups = [];
  let renderToken = 0;

  const app = (FM27.app = {
    caps: { sample: null, downloads: null, db: null, user: null, mcp: null, probed: false },
    uid: null,
    store: null,
    registry: null,
    careerId: null,
    storeNote: '',
    screenId: null,
    standalone: false,
    waitingForSync: false,
    syncWaitExpired: false,
    syncTimer: 0,

    // ---------------------------------------------------------------- schopnosti stránky
    async detectCaps() {
      const claude = window.claude;
      app.caps.probed = true;
      if (!claude || typeof claude.use !== 'function') return;
      const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
      const use = (name, ms) => withTimeout(Promise.resolve().then(() => claude.use(name)).catch(() => null), ms);
      const [sample, downloads, db, user, mcp] = await Promise.all([use('sample', 10500), use('downloads', 4000), use('db', 6000), use('user', 6000), use('mcp', 6000)]);
      Object.assign(app.caps, { sample, downloads, db, user, mcp });
      if (user && typeof user.id === 'function') {
        try {
          app.uid = await user.id();
        } catch (e) {
          app.uid = null;
        }
      }
    },

    async initStore() {
      const lib = FM27.storeLib;
      let local = null;
      try {
        local = await new lib.IdbBackend().open();
      } catch (e) {
        app.storeNote = 'Úložiště prohlížeče není dostupné: data se po zavření stránky neuchovají.';
      }
      const remote = app.caps.db && app.uid ? new lib.DbBackend(app.caps.db, app.uid) : null;
      app.store = lib.createStore({ local, remote });
      app.store.on((e) => {
        if (e.kind === 'status') {
          renderPills();
          // Zařízení, které čekalo na první data z účtu, se překreslí, jakmile přijdou (nebo spojení selže).
          if (app.waitingForSync && e.status.remote !== 'connecting') {
            app.waitingForSync = false;
            renderScreen();
          }
        }
        if (e.kind === 'change' && e.type === 'career') {
          if (!app.career() && app.careers().length) {
            // Kariéry dorazily ze synchronizace na zařízení, které žádnou nemělo: vybere se první a obrazovka se překreslí.
            app.careerId = app.careers()[0].id;
            ui.lsSet('fm27.career', app.careerId);
            renderCareerBar();
            renderScreen();
            return;
          }
          renderCareerBar();
        }
      });
      await app.store.init();
    },

    // ---------------------------------------------------------------- nastavení (synchronizované, bez klíčů)
    settings: () => deepMerge(DEFAULT_SETTINGS, (app.store && app.store.get('settings', 'settings')) || {}),
    async updateSettings(patch) {
      const stored = app.store.get('settings', 'settings');
      const cur = stored ? app.store.draft(stored) : { id: 'settings' };
      await app.store.put('settings', deepMerge(cur, patch));
      FM27.bus.emit('settings', app.settings());
    },

    // ---------------------------------------------------------------- kariéry
    careers: () => (app.store ? app.store.list('career').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) : []),
    career: () => (app.store && app.careerId ? app.store.get('career', app.careerId) : null),
    setCareer(id) {
      app.careerId = id;
      ui.lsSet('fm27.career', id);
      renderCareerBar();
      FM27.bus.emit('career', app.career());
      renderScreen();
    },
    async createCareer(fields) {
      const club = String(fields.club || '').trim();
      if (!club) throw new Error('Napiš název klubu.');
      const career = await app.store.put('career', {
        club: club.slice(0, 80),
        competition: String(fields.competition || '').trim().slice(0, 80),
        season: String(fields.season || '').trim().slice(0, 20),
        activeTacticId: null,
        createdAt: Date.now(),
      });
      app.setCareer(career.id);
      return career;
    },
    async deleteCareer(id) {
      const n = await app.store.removeCareer(id);
      if (app.careerId === id) {
        const rest = app.careers();
        app.careerId = rest.length ? rest[0].id : null;
        ui.lsSet('fm27.career', app.careerId);
      }
      renderCareerBar();
      renderScreen();
      return n;
    },
    careerForm(onDone) {
      const club = ui.input({ id: 'careerClub', maxlength: 80, placeholder: 'Např. Chelsea' });
      const comp = ui.input({ id: 'careerComp', maxlength: 80, placeholder: 'Např. Premier League' });
      const season = ui.input({ id: 'careerSeason', maxlength: 20, placeholder: 'Např. 2026/27' });
      const msg = h('p', { class: 'hint', id: 'careerMsg' });
      return h(
        'div',
        { class: 'careerform' },
        ui.field('Klub', club),
        h('div', { class: 'row' }, ui.field('Soutěž (volitelné)', comp, { grow: true }), ui.field('Sezóna (volitelné)', season, { width: '140px' })),
        h(
          'div',
          { class: 'actions' },
          h('button', {
            class: 'btn primary',
            id: 'careerCreate',
            type: 'button',
            text: 'Založit kariéru',
            onclick: async () => {
              try {
                const c = await app.createCareer({ club: club.value, competition: comp.value, season: season.value });
                toast(`Kariéra „${c.club}“ je založená.`);
                if (onDone) onDone(c);
              } catch (e) {
                msg.textContent = e.message || String(e);
              }
            },
          })
        ),
        msg
      );
    },
    /** Obrazovky, které potřebují kariéru. Když žádná není, vykreslí výzvu a vrátí null. */
    requireCareer(root, what) {
      const c = app.career();
      if (c) return c;
      // Na novém zařízení zatím nejsou stažená data z účtu: nejdřív chvíli počkat, ať se neptáme na založení kariéry zbytečně.
      const st = app.store && app.store.status();
      if (st && st.remote === 'connecting' && !app.careers().length && !app.syncWaitExpired) {
        app.waitingForSync = true;
        if (!app.syncTimer) {
          app.syncTimer = setTimeout(() => {
            app.syncWaitExpired = true;
            if (app.waitingForSync) {
              app.waitingForSync = false;
              renderScreen();
            }
          }, 6000);
        }
        root.replaceChildren(h('p', { class: 'hint', id: 'syncWait', text: 'Načítám data z tvého účtu…' }));
        return null;
      }
      root.replaceChildren(
        ui.card(
          'Nejdřív založ kariéru',
          h('p', { class: 'lead', text: `${what || 'Tahle část'} se ukládá ke kariéře, aby si trenér pamatoval tvůj tým, taktiky a zápasy. Každá kariéra má vlastní oddělená data.` }),
          app.careerForm(() => renderScreen())
        )
      );
      return null;
    },

    // ---------------------------------------------------------------- soubory
    async saveFile(filename, data, mime) {
      if (app.caps.downloads) {
        try {
          await app.caps.downloads.save({ filename, data });
          toast('Soubor je uložený.');
          return true;
        } catch (e) {
          if (e && e.code !== 'declined') toast('Uložení se nepovedlo (' + ((e && e.code) || 'chyba') + ').');
          return false;
        }
      }
      try {
        const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: filename });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        return true;
      } catch (e) {
        toast('Soubor se nepodařilo uložit.');
        return false;
      }
    },

    // ---------------------------------------------------------------- směrování a úklid
    go(hash) {
      if (location.hash.slice(1) === hash) return renderScreen();
      try {
        location.hash = '#' + hash;
      } catch (e) {
        renderScreen(hash);
        return;
      }
      // hashchange vykreslí; kdyby ho okno nevyvolalo, vykreslíme sami
      setTimeout(() => app.screenId !== hash && renderScreen(hash), 60);
    },
    /** Úklid při odchodu z obrazovky (časovače, odběry). */
    onCleanup(fn) {
      cleanups.push(fn);
    },
    /** Odebírá změny v úložišti pro dané typy; volá `fn` s odložením. Úklid se zařídí sám. */
    watch(types, fn) {
      const run = ui.debounce(fn, 60);
      const off = app.store.on((e) => {
        if (e.kind === 'change' && (!types || types.includes(e.type))) run(e);
      });
      cleanups.push(off);
      return off;
    },
  });

  // ------------------------------------------------------------------ vykreslení kostry
  function renderNav() {
    const nav = $('#nav');
    nav.replaceChildren(
      ...FM27.screens.list
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s) =>
          h('button', {
            class: 'navbtn' + (s.id === 'live' ? ' live' : ''),
            id: 'nav-' + s.hash,
            type: 'button',
            text: s.label,
            onclick: () => app.go(s.hash),
          })
        )
    );
  }
  function markNav(hash) {
    for (const b of ui.$$('#nav .navbtn')) {
      const on = b.id === 'nav-' + hash;
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }

  function renderCareerBar() {
    const bar = $('#careerbar');
    if (!bar) return;
    bar.replaceChildren();
    const careers = app.careers();
    const open = () => ui.openDrawer('Nová kariéra', [app.careerForm(() => ui.closeDrawer())]);
    if (!careers.length) {
      bar.append(h('button', { class: 'btn small', id: 'careerNew', type: 'button', text: 'Založit kariéru', onclick: open }));
      return;
    }
    const sel = h(
      'select',
      { id: 'careerSelect', 'aria-label': 'Kariéra', onchange: (e) => app.setCareer(e.target.value) },
      careers.map((c) => h('option', { value: c.id, text: c.club + (c.season ? ` (${c.season})` : ''), selected: c.id === app.careerId }))
    );
    bar.append(sel, h('button', { class: 'btn small', id: 'careerNew', type: 'button', text: 'Nová kariéra', onclick: open }));
  }

  /** Šedé tlačítko „Načíst“: co a odkud se dá z aktuální hry načíst. Čte se jen to, co je vidět na obrazovce hry; paměť hry ani její
      soubory aplikace nečte (viz akceptační matice). Každý řádek vede na obrazovku, kde se to dělá. */
  function openLoadDrawer() {
    const ai = FM27.ai;
    const vision = !!(ai.available && ai.imagesSupported);
    const grab = !!(FM27.live && FM27.live.captureAvailable && FM27.live.captureAvailable());
    const go = (hash) => {
      ui.closeDrawer();
      location.hash = '#' + hash;
    };
    const row = (title, text, hash, noVision) =>
      h(
        'div',
        { class: 'book', 'data-load': hash },
        h('div', { class: 'meta' }, h('b', { text: title }), h('span', { text }), h('span', { class: 'chips' }, noVision ? ui.chip('good', 'bez čtení obrázků a bez AI') : ui.chip(vision ? 'good' : 'warn', vision ? 'jde načíst' : 'nejde: chybí Claude se čtením obrázků'))),
        h('button', { class: 'btn small', type: 'button', text: 'Otevřít', onclick: () => go(hash) })
      );
    ui.openDrawer('Načíst aktuální hru', [
      h('p', { class: 'lead', id: 'loadLead', text: grab ? 'Aplikace čte to, co je právě vidět na obrazovce hry. V každé z těchto sekcí je tlačítko „Načíst z okna hry“: sdílíš okno hry a vezme se jeden snímek.' : 'Aplikace čte to, co je právě vidět na obrazovce hry. Snímek vlož ručně (ve Windows Win+Shift+S a pak Ctrl+V, na telefonu fotka). Tlačítko „Načíst z okna hry“ je jen tam, kde to stránka smí (samostatná verze).' }),
      h(
        'div',
        { class: 'books', id: 'loadList' },
        row('Taktika', 'Formace, mentalita, instrukce a role z obrazovky taktiky.', 'taktiky'),
        row('Soupiska', 'Hráči a jejich atributy z obrazovky týmu.', 'tym'),
        row('Soupeř', 'Taktika, rozestavení a zpráva skauta o soupeři.', 'soupere'),
        row('Zápas', 'Statistiky a průběh zápasu (sledování obrazovky).', 'live'),
        row('Hráči z exportu nástroje', 'Tabulka hráčů uložená jiným nástrojem (CSV, TSV, webová stránka, JSON).', 'tym', true),
        row('Živá data a sestava z FMMatchLens', 'Zásuvný modul do hry, který nabízí data zápasu a sestavu na tomhle počítači (samostatná verze, Windows).', 'live', true)
      ),
      h('div', { class: 'banner warn', id: 'loadNot' }, h('b', { text: 'Co aplikace nedělá' }), h('span', { text: 'Sama nečte paměť běžící hry ani její uložené hry a nic do nich nezapisuje. Umí ale převzít data od nezávislých nástrojů, které to dělají pro offline hru (editory, skauti, FMMatchLens): tabulku hráčů a živá data zápasu. Takové údaje jsou „od nástroje u tebe“, ne „ověřeno hrou“.' })),
      h('p', { class: 'hint', text: 'Všechno přečtené z obrazovky je „neověřeno“, dokud to nepotvrdíš podle obrázku.' }),
    ]);
  }

  function renderPills() {
    const lib = FM27.library;
    const nb = lib.books.length;
    const np = lib.passages.length;
    ui.setPill('#pillLibrary', nb ? 'ok' : 'warn', nb ? `Knihovna: ${nb} ${ui.plural(nb, 'kniha', 'knihy', 'knih')}, ${np} ${ui.plural(np, 'úryvek', 'úryvky', 'úryvků')}` : 'Knihovna je prázdná');
    if (!app.caps.probed) ui.setPill('#pillClaude', 'warn', 'AI: zjišťuji…');
    else if (FM27.ai.available) ui.setPill('#pillClaude', 'ok', FM27.ai.kind === 'claude-sample' ? 'Claude: připojeno' : 'AI: ' + FM27.ai.label());
    else ui.setPill('#pillClaude', 'bad', FM27.ai.problem ? 'AI: nedostupné' : 'Claude: nedostupné');
    const st = app.store ? app.store.status() : null;
    const blocked = (st && st.blocked) || [];
    if (!st) ui.setPill('#pillSync', 'warn', 'Data: načítám…');
    // Nejhorší stav má přednost: data, která se neukládají vůbec, a pak dokumenty, které se nesynchronizují.
    else if (!st.local || app.storeNote) ui.setPill('#pillSync', 'bad', 'Data se v tomto zařízení neukládají');
    else if (blocked.length) ui.setPill('#pillSync', 'warn', `Nesynchronizuje se: ${blocked.length} ${ui.plural(blocked.length, 'dokument', 'dokumenty', 'dokumentů')}`);
    else if (st.remote === 'live') ui.setPill('#pillSync', st.pending ? 'warn' : 'ok', st.pending ? 'Synchronizace: ukládám…' : 'Synchronizace: zapnutá');
    else if (st.remote === 'connecting') ui.setPill('#pillSync', 'warn', 'Synchronizace: připojuji…');
    else if (st.remote === 'error') ui.setPill('#pillSync', 'bad', 'Synchronizace: chyba');
    else ui.setPill('#pillSync', 'warn', 'Data jen v tomto zařízení');
    const pill = $('#pillSync');
    if (pill && st) pill.title = [st.localError, app.storeNote, ...((st.blockedInfo || []).map((b) => `Dokument ${b.key} ${b.reason}; zůstává jen v tomto zařízení.`)), st.error].filter(Boolean).join(' ');
  }
  FM27.bus.on('library', renderPills);

  function renderScreen(forceHash) {
    const raw = typeof forceHash === 'string' ? forceHash : location.hash.slice(1);
    const hash = LEGACY_HASH[raw] || raw || DEFAULT_SCREEN;
    const screen = FM27.screens.get(hash) || FM27.screens.get(DEFAULT_SCREEN);
    while (cleanups.length) {
      try {
        cleanups.pop()();
      } catch (e) {
        console.error('Úklid obrazovky selhal', e);
      }
    }
    const token = ++renderToken;
    app.screenId = screen.hash;
    markNav(screen.hash);
    const main = $('#main');
    main.replaceChildren();
    ui.closeDrawer();
    const fail = (e) => {
      console.error('Obrazovka ' + screen.id + ' selhala', e);
      if (token === renderToken) main.replaceChildren(h('div', { class: 'banner bad' }, h('b', { text: 'Obrazovku se nepodařilo zobrazit' }), h('span', { text: (e && e.message) || String(e) })));
    };
    try {
      const done = screen.render(main, app);
      if (done && typeof done.catch === 'function') done.catch(fail);
    } catch (e) {
      fail(e);
    }
    FM27.bus.emit('screen', screen.id);
  }
  app.render = renderScreen;

  // ------------------------------------------------------------------ spuštění
  app.init = async function () {
    app.registry = C.Registry.fromKnowledgeJson(JSON.parse($('#knowledge-data').textContent));
    $('#drawerClose').addEventListener('click', ui.closeDrawer);
    $('#loadBtn').addEventListener('click', openLoadDrawer);
    document.addEventListener('keydown', (e) => e.key === 'Escape' && ui.closeDrawer());
    renderNav();
    renderPills();
    $('#main').replaceChildren(h('p', { class: 'hint', text: 'Načítám…' }));

    await Promise.all([FM27.library.init(), app.detectCaps()]);
    await app.initStore();
    await FM27.ai.init(app);
    try {
      FM27.web.init(app);
    } catch (e) {
      console.error('Hledání na webu se nepodařilo připravit', e);
    }

    const saved = ui.lsGet('fm27.career', null);
    const all = app.careers();
    app.careerId = all.some((c) => c.id === saved) ? saved : all.length ? all[0].id : null;
    renderCareerBar();
    renderPills();
    window.addEventListener('hashchange', () => renderScreen());
    renderScreen();
    FM27.bus.emit('ready', app);
  };
})();
