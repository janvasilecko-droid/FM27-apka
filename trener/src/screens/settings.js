/* Nastavení: stav a zkoušky, spotřeba AI, data a soukromí (záloha, smazání), hlas, Live Coach a vlastní klíč (samostatná verze). */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;
  const ui = FM27.ui;
  const { h, $, toast } = ui;

  const yesNo = (v) => (v ? 'ano' : 'ne');
  const money = (usd) => (usd < 0.01 ? '< 0,01 USD' : usd.toFixed(2).replace('.', ',') + ' USD');
  const bytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB');

  function diagRows(app) {
    const ai = FM27.ai;
    const lib = FM27.library;
    const st = app.store ? app.store.status() : null;
    const sync = !st ? 'zjišťuji' : { live: 'zapnutá (soukromá složka tvého účtu)', connecting: 'připojuji', error: 'chyba: ' + (st.error || ''), off: 'vypnutá, data jsou jen v tomto zařízení' }[st.remote];
    const build = (($('meta[name="trener-build"]') || {}).content) || '?';
    return [
      ['AI poskytovatel', ai.available ? ai.label() : app.caps.probed ? 'nedostupný' : 'zjišťuji'],
      ['Obrázky ke Claude', ai.imagesSupported ? `ano (až ${ai.limitsInfo.images.maxCount})` : 'ne'],
      ['Uložení souboru (export)', yesNo(app.caps.downloads)],
      ['Synchronizace mezi zařízeními', sync],
      ['Místní úložiště dat', st && st.local ? 'ano' : 'ne' + (app.storeNote ? ': ' + app.storeNote : '')],
      ['Úložiště knihovny v prohlížeči', lib.persist.ok ? 'ano' : 'ne: ' + lib.persist.note],
      ['Čtečka PDF', window.pdfjsLib ? 'načtená' : 'načte se při prvním PDF'],
      ['Knihy / úryvky', `${lib.books.length} / ${lib.passages.length}`],
      ['Hledání zdrojů na webu', FM27.web && FM27.web.available ? FM27.web.label() : 'ne: ' + ((FM27.web && FM27.web.reason) || 'modul chybí')],
      ['Oficiální zdroje FM27 v registru', String([...app.registry.byId.values()].filter((s) => app.registry.isOfficialFm27(s.id)).length)],
      ['Sdílení obrazovky v tomto okně', navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && app.standalone ? 'ano' : 'ne (jen v samostatné verzi)'],
      ['Hlasový výstup (čeština)', FM27.voice && FM27.voice.available() ? (FM27.voice.hasCzech() ? 'ano' : 'ano, ale bez české hlasové zásoby') : 'ne'],
      ['Systémová oznámení (okno skryté za hrou)', app.standalone ? (FM27.notify && FM27.notify.available() ? (FM27.notify.permission() === 'granted' ? 'povolena' : FM27.notify.permission() === 'denied' ? 'zakázána v prohlížeči' : 'zatím nepovolena') : 'ne: prohlížeč je neumí') : 'ne (jen v samostatné verzi)'],
      ['Hlasový vstup (mikrofon)', app.standalone ? (FM27.voice && FM27.voice.recognitionAvailable() ? 'ano' : 'ne: prohlížeč rozpoznávání řeči nemá') : 'ne (jen v samostatné verzi)'],
      ['Verze stránky', build],
    ];
  }

  async function testClaude(out) {
    if (!FM27.ai.available) return (out.textContent = 'Claude není dostupný.');
    out.textContent = 'Zkouším…';
    try {
      const data = await FM27.ai.json('Odpověz POUZE JSON objektem {"ok": true}', { modelTier: 'quick', cache: false, purpose: 'zkouška' });
      out.textContent = data && data.ok === true ? 'Spojení s Claude funguje.' : 'Claude odpověděl, ale jinak, než se čekalo.';
    } catch (e) {
      out.textContent = FM27.ai.errorText(e);
    }
  }
  function testSearch(out) {
    const demo = C.buildPassages('demo', [
      'Izolovaný útočník potřebuje podporu záložníků. Když se záložní řada drží hluboko, vzniká mezi řadami velká vzdálenost, kterou útočník sám nezvládne překonat.',
      'Vysoký presink vyžaduje kompaktní tým. Všechny řady se posouvají společně k míči, jinak soupeř prohraje souboj a najde prostor za obranou.',
    ]);
    const hits = new C.Index(demo).search('izolovaný útočník podpora');
    out.textContent = hits.length && hits[0].id === 'bk:demo:1:1' ? 'Hledání funguje: ukázkový dotaz našel správný úryvek.' : 'Hledání nevrátilo očekávaný úryvek.';
  }

  function usageCard() {
    const ai = FM27.ai;
    const box = h('div', { id: 'usageBox' });
    const draw = () => {
      box.replaceChildren();
      if (!ai.ledger) return box.append(h('p', { class: 'hint', text: 'Měření spotřeby není k dispozici.' }));
      const s = ai.ledger.summary({});
      if (!s.calls) return box.append(h('p', { class: 'hint', text: 'Zatím žádné volání AI.' }));
      const tiers = Object.entries(s.byTier || {}).map(([tier, v]) => `${{ quick: 'levné', default: 'běžné', complex: 'důkladné' }[tier] || tier}: ${v.calls}×`);
      box.append(
        h(
          'div',
          { class: 'diag' },
          h('div', null, h('span', { text: 'Volání celkem' }), h('span', { text: String(s.calls) })),
          h('div', null, h('span', { text: 'Podle náročnosti' }), h('span', { text: tiers.join(', ') || '–' })),
          h('div', null, h('span', { text: 'Odhad tokenů (vstup / výstup)' }), h('span', { text: `${Math.round(s.inputTokens).toLocaleString('cs-CZ')} / ${Math.round(s.outputTokens).toLocaleString('cs-CZ')}` })),
          h('div', null, h('span', { text: 'Odhad ceny podle ceníku API' }), h('span', { text: money(s.costUsd || 0) }))
        ),
        h('p', { class: 'hint', text: `${Math.round((s.estimatedShare || 0) * 100)} % záznamů je odhad podle délky textu${FM27.ai.kind === 'claude-sample' ? ' (stránka v Claude skutečné tokeny nehlásí; počítá se z tvého účtu Claude, ne z placeného API)' : ''}. Ceník je k ověření.` })
      );
    };
    draw();
    return h('section', { class: 'card' }, h('h2', { text: 'Spotřeba AI' }), box, h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', text: 'Obnovit', onclick: draw })));
  }

  /** Hledání zdrojů na webu: stav připojení, kdy se hledá samo a zkouška, která ukáže, jak to u tebe opravdu dopadne. */
  function webCard(app) {
    const web = FM27.web;
    const WS = window.TrenerWebSources;
    const status = h('p', { id: 'webStatusLine', class: 'hint', 'aria-live': 'polite', text: 'Zjišťuji…' });
    const linkBox = h('p', { class: 'hint', id: 'webStatusLink' });
    const out = h('p', { class: 'hint', id: 'webTestOut', 'aria-live': 'polite' });
    const results = h('div', { id: 'webTestResults', class: 'books' });
    const mode = ui.select([['auto', 'Automaticky (u konektoru zapnuto, u vlastního klíče vypnuto)'], ['on', 'Vždy zapnuto'], ['off', 'Vypnuto']], (app.settings().web || {}).mode || 'auto', { id: 'setWebMode' });
    mode.addEventListener('change', () => app.updateSettings({ web: { mode: mode.value } }).catch(() => toast('Nastavení se nepodařilo uložit.')));
    const refresh = async () => {
      if (!web || !web.status) return (status.textContent = 'Modul hledání na webu chybí.');
      const st = await web.status();
      status.textContent = st.text;
      status.dataset.state = st.state;
      linkBox.replaceChildren(...(st.link ? [h('a', { href: st.link.url, target: '_blank', rel: 'noopener noreferrer', text: st.link.label + ': ' + st.link.url })] : []));
    };
    refresh();
    const test = h('button', {
      class: 'btn small',
      id: 'webTest',
      type: 'button',
      text: 'Zkušební hledání',
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!web || !web.available) return (out.textContent = 'Hledání na webu není dostupné: ' + ((web && web.reason) || 'chybí modul.'));
        btn.disabled = true;
        out.textContent = 'Hledám… (při prvním použití potvrď okno Claude)';
        results.replaceChildren();
        try {
          const r = await web.search({ kind: 'test', queries: ['Football Manager 27 tactics'], objective: 'Find pages about Football Manager 27 tactics.' }, { refresh: true, max: 3 });
          out.textContent = r.results.length ? `Funguje: nalezeno ${r.results.length} ${ui.plural(r.results.length, 'zdroj', 'zdroje', 'zdrojů')} (${web.label()}).` : r.unparsed ? `Vyhledávač odpověděl, ale aplikace z odpovědi neumí přečíst odkazy. Začátek odpovědi: ${web.lastRaw}` : 'Vyhledávač odpověděl, ale nic nenašel.';
          for (const res of r.results) results.append(web.card(res));
        } catch (err) {
          out.textContent = web.errorText(err);
        } finally {
          btn.disabled = false;
          refresh();
        }
      },
    });
    return h(
      'section',
      { class: 'card', id: 'webCard' },
      h('h2', { text: 'Hledání zdrojů na webu' }),
      h('p', { class: 'lead', text: 'Aplikace umí sama hledat zdroje na internetu (oficiální články o FM27, rozbory taktiky, komunitní návody) a ukazuje je s odkazem, druhem zdroje, verzí hry a datem. Co najde, je vždy označené jako neověřené. Do hledání jde jen text tématu nebo dotazu, ne knihy, kariéra ani obrázky.' }),
      status,
      linkBox,
      ui.field('Kdy hledat při radě a lekci', mode),
      h('div', { class: 'actions' }, test),
      out,
      results,
      h('p', { class: 'hint', text: 'Neověřeno z cloudu: tvar odpovědi konektoru Parallel Search a hledání přes klíč Anthropic jsem nemohl zkusit proti skutečné službě. Tlačítko „Zkušební hledání“ ukáže, jak to u tebe opravdu dopadne.' })
    );
  }

  function dataCard(app) {
    const careers = app.careers();
    const importInput = h('input', { type: 'file', id: 'importData', accept: 'application/json,.json', hidden: true });
    importInput.addEventListener('change', async () => {
      const file = importInput.files[0];
      if (!file) return;
      try {
        const n = await app.store.importAll(JSON.parse(await file.text()));
        const skipped = (app.store.lastImport && app.store.lastImport.skipped) || 0;
        toast((n ? `Obnoveno dokumentů: ${n}.` : 'Nic nového k obnovení.') + (skipped ? ` Poškozených dokumentů přeskočeno: ${skipped}.` : ''), skipped ? 6000 : undefined);
        const all = app.careers();
        if (!app.career() && all.length) app.setCareer(all[0].id);
        else app.render();
      } catch (e) {
        toast('Obnovení se nepovedlo: ' + (e.message || e));
      }
      importInput.value = '';
    });
    const careerList = h(
      'div',
      { class: 'books' },
      careers.length
        ? careers.map((c) =>
            h(
              'div',
              { class: 'book' },
              h('div', { class: 'meta' }, h('b', { text: c.club }), h('span', { text: [c.competition, c.season].filter(Boolean).join(' · ') || 'bez soutěže a sezóny' })),
              ui.confirmButton('Smazat kariéru', 'Opravdu smazat vše z kariéry?', async () => {
                const n = await app.deleteCareer(c.id);
                toast(`Kariéra „${c.club}“ je smazaná (${n} ${ui.plural(n, 'dokument', 'dokumenty', 'dokumentů')}).`);
              })
            )
          )
        : [h('p', { class: 'hint', text: 'Žádná kariéra.' })]
    );
    return h(
      'section',
      { class: 'card' },
      h('h2', { text: 'Data a soukromí' }),
      h('p', { class: 'lead', text: 'Kariéry, soupisky, taktiky, zápasy a historie rad se ukládají v tomto zařízení a (v Claude) do soukromé složky tvého účtu, takže je uvidíš i na telefonu. Texty knih a klíče se nesynchronizují nikdy. Sdílení obrazovky a obrázky jdou ke Claude jen po tvém výslovném kroku. Aplikace nikdy sama neovládá hru.' }),
      h(
        'div',
        { class: 'actions' },
        h('button', {
          class: 'btn small',
          id: 'exportData',
          type: 'button',
          text: 'Uložit zálohu dat',
          onclick: () => app.saveFile('fm27-data.json', new Blob([JSON.stringify(app.store.exportAll())], { type: 'application/json' })),
        }),
        ui.pickButton('Obnovit ze zálohy', importInput, { class: 'btn small', id: 'importDataBtn' }),
        importInput
      ),
      h('h3', { text: 'Smazání', style: 'margin-top:16px' }),
      careerList,
      h(
        'div',
        { class: 'actions' },
        ui.confirmButton('Smazat všechna data aplikace', 'Opravdu smazat úplně všechno?', async () => {
          if (FM27.live) FM27.live.reset();
          const { removed, complete } = await app.store.purgeAll();
          app.careerId = null;
          ui.lsSet('fm27.career', null);
          // Všechno, co aplikace drží jen v tomto zařízení vedle dokumentů: staré rady, snímek, složené lekce, měření spotřeby, rozehraný zápas.
          for (const key of ['fm27.history', 'fm27.snap', 'fm27.lessons', 'fm27.ledger', 'fm27.liveMatch', 'fm27.historyMigrated']) {
            try {
              localStorage.removeItem(key);
            } catch (e) {
              /* nic */
            }
          }
          if (FM27.ai && FM27.ai.ledger) FM27.ai.ledger.clear();
          toast(
            `Smazáno dokumentů: ${removed}. Knihy a klíč AI zůstaly (mažou se zvlášť v Zdrojích znalostí a v kartě Vlastní klíč).` +
              (complete ? '' : ' Synchronizace neodpověděla, takže data na serveru mohla zůstat; smazání zopakuj, až bude připojení.'),
            complete ? undefined : 8000
          );
          app.render();
        })
      )
    );
  }

  function prefsCard(app) {
    const s = app.settings();
    // Změny se sbírají a ukládají najednou; kdyby se odložené uložení jen přepisovalo, rychlá druhá změna by první zahodila.
    let pending = {};
    const mergePatch = (a, b) => {
      const out = Object.assign({}, a);
      for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? mergePatch(out[k] || {}, v) : v;
      return out;
    };
    const flush = ui.debounce(() => {
      const patch = pending;
      pending = {};
      app.updateSettings(patch).catch(() => toast('Nastavení se nepodařilo uložit.'));
    }, 300);
    const save = (patch) => {
      pending = mergePatch(pending, patch);
      flush();
    };
    const volume = ui.input({ id: 'setVolume', type: 'range', min: 0, max: 1, step: 0.05, value: s.voice.volume });
    const rate = ui.input({ id: 'setRate', type: 'range', min: 0.7, max: 1.4, step: 0.05, value: s.voice.rate });
    const freq = ui.select([['low', 'Jen opravdu důležitá upozornění'], ['normal', 'Běžně'], ['high', 'Častěji']], s.voice.frequency, { id: 'setFreq' });
    // Výběr hlasu: nabízejí se jen české hlasy zařízení (v Edge bývají k dispozici přirozenější online hlasy). Uložený hlas, který
    // zařízení nemá (třeba z počítače na telefonu), se tiše nahradí automatickým výběrem.
    const voiceName = h('select', { id: 'setVoiceName' });
    const fillVoices = () => {
      const cz = FM27.voice && FM27.voice.available() ? FM27.voice.czechVoices() : [];
      const first = cz.length ? 'Automaticky (první česká)' : 'Česká hlasová zásoba v zařízení není';
      voiceName.replaceChildren(h('option', { value: '', text: first }), ...cz.map((v) => h('option', { value: v.voiceURI, text: v.name + (v.localService === false ? ' (online)' : '') })));
      voiceName.value = app.settings().voice.voiceURI || '';
      voiceName.disabled = !cz.length;
    };
    fillVoices();
    app.onCleanup(FM27.bus.on('voices', fillVoices));
    voiceName.addEventListener('change', () => save({ voice: { voiceURI: voiceName.value } }));
    const voiceOn = h('input', { type: 'checkbox', id: 'setVoiceOn', checked: s.voice.enabled });
    const quiet = h('input', { type: 'checkbox', id: 'setQuiet', checked: s.voice.quiet });
    const notifyAvailable = app.standalone && FM27.notify && FM27.notify.available();
    const notifyOn = h('input', { type: 'checkbox', id: 'setNotify', checked: !!(s.notify && s.notify.enabled) && notifyAvailable && FM27.notify.permission() === 'granted' });
    const notifyMsg = h('p', { class: 'hint', id: 'notifyMsg', 'aria-live': 'polite' });
    const notifyTest = h('button', {
      class: 'btn small',
      id: 'notifyTest',
      type: 'button',
      text: 'Zkušební oznámení',
      onclick: async () => {
        const r = await FM27.notify.test();
        notifyMsg.textContent = r.ok ? 'Zkušební oznámení jsem poslal. Když ho nevidíš, oznámení v tomhle prohlížeči nebo systému nejdou (zkontroluj nastavení webu a režim nerušit).' : r.reason === 'no_permission' ? 'Oznámení nejsou povolená.' : 'Oznámení se tady nepodařilo ukázat; důležitá upozornění zůstanou jen v aplikaci.';
      },
    });
    notifyOn.addEventListener('change', async () => {
      if (!notifyOn.checked) return save({ notify: { enabled: false } });
      const perm = FM27.notify.permission() === 'granted' ? 'granted' : await FM27.notify.request();
      if (perm !== 'granted') {
        notifyOn.checked = false;
        notifyMsg.textContent = perm === 'denied' ? 'Prohlížeč oznámení zakázal. Povol je v nastavení webu (ikona vlevo od adresy).' : 'Oznámení nejsou povolená.';
        return save({ notify: { enabled: false } });
      }
      notifyMsg.textContent = 'Oznámení jsou zapnutá. Pošlou se jen důležitá upozornění, když je okno aplikace skryté.';
      save({ notify: { enabled: true } });
    });
    const interval = ui.input({ id: 'setInterval', type: 'number', min: 5, max: 120, value: s.live.baseIntervalSec });
    const perHour = ui.input({ id: 'setPerHour', type: 'number', min: 5, max: 300, value: s.live.maxPerHour });
    const perMatch = ui.input({ id: 'setPerMatch', type: 'number', min: 10, max: 600, value: s.live.maxPerMatch });
    volume.addEventListener('input', () => save({ voice: { volume: Number(volume.value) } }));
    rate.addEventListener('input', () => save({ voice: { rate: Number(rate.value) } }));
    freq.addEventListener('change', () => save({ voice: { frequency: freq.value } }));
    voiceOn.addEventListener('change', () => save({ voice: { enabled: voiceOn.checked } }));
    quiet.addEventListener('change', () => save({ voice: { quiet: quiet.checked } }));
    const num = (el, min, max) => Math.min(max, Math.max(min, Number(el.value) || min));
    interval.addEventListener('change', () => save({ live: { baseIntervalSec: num(interval, 5, 120) } }));
    perHour.addEventListener('change', () => save({ live: { maxPerHour: num(perHour, 5, 300) } }));
    perMatch.addEventListener('change', () => save({ live: { maxPerMatch: num(perMatch, 10, 600) } }));
    // Změna nastavení z druhého zařízení se promítne do ovládacích prvků na místě (bez překreslení obrazovky a bez zásahu
    // do prvku, který právě upravuješ), takže se omylem nepřepíše starou hodnotou.
    const refreshControls = () => {
      const cur = app.settings();
      const put = (el, prop, value) => {
        if (el && document.activeElement !== el && el[prop] !== value) el[prop] = value;
      };
      put(volume, 'value', String(cur.voice.volume));
      put(rate, 'value', String(cur.voice.rate));
      put(freq, 'value', cur.voice.frequency);
      put(voiceOn, 'checked', !!cur.voice.enabled);
      put(quiet, 'checked', !!cur.voice.quiet);
      put(interval, 'value', String(cur.live.baseIntervalSec));
      put(perHour, 'value', String(cur.live.maxPerHour));
      put(perMatch, 'value', String(cur.live.maxPerMatch));
      // Hlas uložený na jiném zařízení tohle zařízení nemusí mít: pak zůstane „Automaticky“.
      put(voiceName, 'value', [...voiceName.options].some((o) => o.value === (cur.voice.voiceURI || '')) ? cur.voice.voiceURI || '' : '');
      if (notifyAvailable) put(notifyOn, 'checked', !!(cur.notify && cur.notify.enabled) && FM27.notify.permission() === 'granted');
    };
    app.onCleanup(app.store.on((e) => e.kind === 'change' && e.type === 'settings' && e.origin === 'remote' && refreshControls()));
    const test = h('button', {
      class: 'btn small',
      id: 'voiceTest',
      type: 'button',
      text: 'Vyzkoušet hlas',
      onclick: () => (FM27.voice ? FM27.voice.test(app) : toast('Hlasový výstup není k dispozici.')),
    });
    return h(
      'section',
      { class: 'card' },
      h('h2', { text: 'Hlas a Live Coach' }),
      h('p', { class: 'lead', text: 'Hlasový trenér mluví česky jen krátce a jen při důležitém. Tichý režim ho vypne, ale upozornění zůstanou na obrazovce.' }),
      h('label', { class: 'checkline' }, voiceOn, h('span', { text: 'Číst upozornění nahlas' })),
      h('label', { class: 'checkline' }, quiet, h('span', { text: 'Tichý režim (jen text na obrazovce)' })),
      notifyAvailable ? h('label', { class: 'checkline' }, notifyOn, h('span', { text: 'Systémové oznámení při důležitém upozornění, když je okno aplikace skryté' })) : null,
      notifyAvailable ? h('div', { class: 'actions', style: 'margin-top:6px' }, notifyTest) : null,
      notifyAvailable ? notifyMsg : null,
      notifyAvailable ? h('p', { class: 'hint', text: 'Funguje, dokud je aplikace otevřená (i skrytá za hrou). Oznámení na zavřený telefon aplikace neumí, ta by potřebovala vlastní server.' }) : null,
      h('div', { class: 'row' }, ui.field('Hlasitost', volume, { grow: true }), ui.field('Rychlost řeči', rate, { grow: true }), ui.field('Četnost upozornění', freq, { grow: true })),
      h('div', { class: 'row' }, ui.field('Hlas', voiceName, { grow: true })),
      h('div', { class: 'actions' }, test),
      h('h3', { text: 'Sledování zápasu', style: 'margin-top:16px' }),
      h('div', { class: 'row' }, ui.field('Základní odstup snímků (s)', interval, { width: '190px' }), ui.field('Nejvýš za hodinu', perHour, { width: '150px' }), ui.field('Nejvýš za zápas', perMatch, { width: '150px' })),
      h('p', { class: 'hint', text: 'Snímky se nepošlou, když se obrazovka nezměnila, a nikdy nepřekročí tyto limity. Každý poslaný snímek spotřebuje část limitu Claude.' })
    );
  }

  // Zpráva ke klíči musí přežít překreslení obrazovky (po uložení se karta kreslí znovu).
  let keyNote = '';

  function keyCard(app) {
    if (app.caps.sample) return null; // v Claude se klíč nepoužívá
    const cfg = FM27.ai.getConfig() || {};
    const kind = ui.select([['anthropic', 'Claude (Anthropic)'], ['openai', 'OpenAI-kompatibilní']], cfg.kind || 'anthropic', { id: 'keyKind' });
    const key = ui.input({ id: 'keyValue', type: 'password', autocomplete: 'off', placeholder: cfg.apiKey ? '(uložený klíč, nezobrazuje se)' : 'Vlož klíč sem, nikdy ho neposílej do chatu' });
    const baseUrl = ui.input({ id: 'keyBase', placeholder: 'https://api.openai.com/v1', value: cfg.baseUrl || '' });
    const mQuick = ui.input({ id: 'keyQuick', placeholder: 'levný model', value: (cfg.models && cfg.models.quick) || '' });
    const mDefault = ui.input({ id: 'keyDefault', placeholder: 'běžný model', value: (cfg.models && cfg.models.default) || '' });
    const mComplex = ui.input({ id: 'keyComplex', placeholder: 'důkladný model', value: (cfg.models && cfg.models.complex) || '' });
    const extra = h('div', { id: 'keyExtra' }, ui.field('Adresa API', baseUrl), h('div', { class: 'row' }, ui.field('Levný model', mQuick, { grow: true }), ui.field('Běžný model', mDefault, { grow: true }), ui.field('Důkladný model', mComplex, { grow: true })), h('p', { class: 'hint', id: 'keyOpenAiNote', text: 'Neověřeno: tenhle druh API je zkoušený jen proti napodobenině serveru, ne proti živé službě. Názvy modelů musíš zadat sám (žádný se nevymýšlí) a obrázky nebo JSON režim závisí na zvoleném modelu.' }));
    const sync = () => (extra.hidden = kind.value !== 'openai');
    kind.addEventListener('change', sync);
    sync();
    const msg = h('p', { class: 'hint', id: 'keyMsg', text: keyNote, 'aria-live': 'polite' });
    // Adresa *.github.io sdílí úložiště prohlížeče se všemi dalšími stránkami na github.io pod stejným účtem: skript z jiné
    // takové stránky by klíč přečetl. Proto je tam výchozí volba „jen do zavření záložky“ a ve stránce je varování.
    const shared = /\.github\.io$/i.test(location.hostname);
    const where = FM27.ai.configWhere();
    const remember = h('input', { type: 'checkbox', id: 'keyRemember', checked: where === 'local' || (where === 'none' && !shared) });
    const sharedWarn = shared
      ? h('div', { class: 'banner warn', id: 'keySharedWarn' }, h('b', { text: 'Tahle adresa sdílí úložiště prohlížeče s dalšími stránkami na github.io' }), h('span', { text: 'Skript na jiné stránce pod stejným účtem na github.io by mohl klíč přečíst. Použij samostatný klíč s nízkým měsíčním limitem a nech výchozí volbu „jen do zavření záložky“. Bezpečnější je spouštět aplikaci z vlastní adresy.' }))
      : null;
    return h(
      'section',
      { class: 'card', id: 'keyCard' },
      h('h2', { text: 'Vlastní klíč AI' }),
      h('p', { class: 'lead', text: 'Tahle verze aplikace neběží uvnitř Claude, takže potřebuje tvůj vlastní klíč. Klíč zůstane jen v tomto prohlížeči (nesynchronizuje se a není v kódu). Vytvoř si pro aplikaci samostatný klíč s měsíčním limitem výdajů.' }),
      sharedWarn,
      ui.field('Poskytovatel', kind),
      ui.field('Klíč', key),
      h('label', { class: 'checkline' }, remember, h('span', { text: 'Zapamatovat klíč v tomto prohlížeči (jinak platí jen do zavření záložky a příště ho zadáš znovu)' })),
      extra,
      h(
        'div',
        { class: 'actions' },
        h('button', {
          class: 'btn primary',
          id: 'keySave',
          type: 'button',
          text: 'Uložit klíč',
          onclick: async () => {
            const apiKey = key.value.trim() || cfg.apiKey;
            if (!apiKey) return (msg.textContent = keyNote = 'Vlož klíč.');
            const next = { kind: kind.value, apiKey };
            if (kind.value === 'openai') {
              next.baseUrl = baseUrl.value.trim() || 'https://api.openai.com/v1';
              next.models = { quick: mQuick.value.trim(), default: mDefault.value.trim(), complex: mComplex.value.trim() };
              if (!next.models.quick || !next.models.default || !next.models.complex) return (msg.textContent = keyNote = 'Vyplň názvy všech tří modelů.');
            }
            const saved = FM27.ai.setConfig(next, { remember: remember.checked });
            await FM27.ai.init(app);
            if (FM27.web && FM27.web.init) FM27.web.init(app); // cesta hledání na webu závisí na klíči
            keyNote = !saved
              ? 'Klíč se nepodařilo uložit (úložiště prohlížeče je zablokované).'
              : FM27.ai.available
                ? (remember.checked ? 'Klíč je uložený v tomhle prohlížeči.' : 'Klíč platí jen do zavření záložky.') + ' Zkus „Zkouška spojení s Claude“ výš.'
                : 'Klíč se nepodařilo použít: ' + (FM27.ai.problem || 'neznámý důvod');
            key.value = '';
            app.render();
          },
        }),
        ui.confirmButton('Smazat klíč', 'Opravdu smazat klíč?', async () => {
          FM27.ai.setConfig(null);
          await FM27.ai.init(app);
          if (FM27.web && FM27.web.init) FM27.web.init(app); // cesta hledání na webu závisí na klíči
          keyNote = 'Klíč je smazaný.';
          toast('Klíč je smazaný.');
          app.render();
        })
      ),
      msg
    );
  }

  /** Instalace samostatné verze do zařízení (plocha, domovská obrazovka). V Claude se nezobrazuje. */
  function installCard(app) {
    if (!app.standalone) return null;
    const box = h('div', { id: 'installBox' });
    const installed = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    const draw = () => {
      box.replaceChildren();
      if (installed()) return box.append(h('p', { class: 'hint', id: 'installNote', text: 'Aplikace běží jako nainstalovaná.' }));
      if (FM27.installPrompt) {
        return box.append(
          h('button', {
            class: 'btn primary',
            id: 'installBtn',
            type: 'button',
            text: 'Nainstalovat aplikaci',
            onclick: async () => {
              const ev = FM27.installPrompt;
              if (!ev) return;
              try {
                await ev.prompt();
              } catch (e) {
                toast('Instalaci se nepodařilo spustit. Použij nabídku prohlížeče.');
              }
              FM27.installPrompt = null;
              draw();
            },
          }),
          h('p', { class: 'hint', text: 'Nainstalovaná aplikace se otevře bez adresního řádku a po prvním otevření funguje i bez připojení (volání AI a čtení PDF ale potřebují internet).' })
        );
      }
      box.append(
        h('p', { class: 'hint', id: 'installNote', text: 'Prohlížeč zatím instalaci nenabídl. Počítač: v adresním řádku ikona instalace nebo nabídka prohlížeče „Nainstalovat“. Telefon s Androidem: nabídka „Přidat na plochu“. iPhone: Sdílet → Přidat na plochu (v Safari).' })
      );
    };
    draw();
    const off = FM27.bus.on('installable', draw);
    app.onCleanup(off);
    return h('section', { class: 'card', id: 'installCard' }, h('h2', { text: 'Instalace do zařízení' }), box);
  }

  function render(root, app) {
    const diag = h('div', { class: 'diag', id: 'diag' });
    const drawDiag = () => diag.replaceChildren(...diagRows(app).map(([k, v]) => h('div', null, h('span', { text: k }), h('span', { text: v }))));
    drawDiag();
    const out = h('p', { class: 'hint', id: 'testOut', 'aria-live': 'polite' });
    root.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Stav a zkoušky' }),
        diag,
        h('div', { class: 'actions' }, h('button', { class: 'btn small', id: 'testClaude', type: 'button', text: 'Zkouška spojení s Claude', onclick: () => testClaude(out) }), h('button', { class: 'btn small', id: 'testSearch', type: 'button', text: 'Zkouška hledání na ukázkovém textu', onclick: () => testSearch(out) })),
        out,
        h('p', { class: 'hint', text: 'Každé „Poradit“ spotřebuje tvůj limit Claude: obvykle jedno levné volání na plán hledání a jedno až dvě na radu.' })
      ),
      usageCard(),
      webCard(app),
      keyCard(app),
      installCard(app),
      prefsCard(app),
      dataCard(app),
      h(
        'section',
        { class: 'card' },
        h('h2', { text: 'Jak aplikace pracuje' }),
        h('ul', { class: 'list' }, [
          'Knihy dávají teorii obecného fotbalu. Neříkají, jak funguje FM27.',
          'Názvy rolí, nastavení a cest v menu FM27 aplikace nezná. Dokud je nepotvrdí tvůj screenshot nebo oficiální zdroj FM27, označí je jako neověřené.',
          'Starší verze Football Manageru není FM27. Oficiální články o FM27 popisují oznámené funkce předvydané verze, ne ověřené chování ve hře.',
          'Text a čísla přečtená strojem ze screenshotu jsou jen odhad, dokud je sám nepotvrdíš.',
          'Bez dvou ověřených screenshotů aplikace nikdy nenapíše „vysoká jistota“.',
          'Když informací nestačí, trenér to řekne a napíše, co potřebuje vidět.',
        ].map((t) => h('li', { text: t })))
      )
    );
    const off = app.store.on((e) => e.kind === 'status' && drawDiag());
    app.onCleanup(off);
  }

  FM27.screens.register({ id: 'nastaveni', hash: 'nastaveni', label: 'Nastavení', order: 10, render });
})();
