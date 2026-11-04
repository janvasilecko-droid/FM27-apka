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
      ['Oficiální zdroje FM27 v registru', String([...app.registry.byId.values()].filter((s) => app.registry.isOfficialFm27(s.id)).length)],
      ['Sdílení obrazovky v tomto okně', navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && app.standalone ? 'ano' : 'ne (jen v samostatné verzi)'],
      ['Hlasový výstup (čeština)', FM27.voice && FM27.voice.available() ? 'ano' : 'ne'],
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

  function dataCard(app) {
    const careers = app.careers();
    const importInput = h('input', { type: 'file', id: 'importData', accept: 'application/json,.json', hidden: true });
    importInput.addEventListener('change', async () => {
      const file = importInput.files[0];
      if (!file) return;
      try {
        const n = await app.store.importAll(JSON.parse(await file.text()));
        toast(n ? `Obnoveno dokumentů: ${n}.` : 'Nic nového k obnovení.');
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
        h('label', { class: 'btn small', for: 'importData', style: 'cursor:pointer', text: 'Obnovit ze zálohy' }),
        importInput
      ),
      h('h3', { text: 'Smazání', style: 'margin-top:16px' }),
      careerList,
      h(
        'div',
        { class: 'actions' },
        ui.confirmButton('Smazat všechna data aplikace', 'Opravdu smazat úplně všechno?', async () => {
          const n = await app.store.purgeAll();
          app.careerId = null;
          ui.lsSet('fm27.career', null);
          localStorage.removeItem('fm27.history');
          localStorage.removeItem('fm27.snap');
          toast(`Smazáno dokumentů: ${n}. Knihy zůstaly (smažeš je v Zdrojích znalostí).`);
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
    const voiceOn = h('input', { type: 'checkbox', id: 'setVoiceOn', checked: s.voice.enabled });
    const quiet = h('input', { type: 'checkbox', id: 'setQuiet', checked: s.voice.quiet });
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
      h('div', { class: 'row' }, ui.field('Hlasitost', volume, { grow: true }), ui.field('Rychlost řeči', rate, { grow: true }), ui.field('Četnost upozornění', freq, { grow: true })),
      h('div', { class: 'actions' }, test),
      h('h3', { text: 'Sledování zápasu', style: 'margin-top:16px' }),
      h('div', { class: 'row' }, ui.field('Základní odstup snímků (s)', interval, { width: '190px' }), ui.field('Nejvýš za hodinu', perHour, { width: '150px' }), ui.field('Nejvýš za zápas', perMatch, { width: '150px' })),
      h('p', { class: 'hint', text: 'Snímky se nepošlou, když se obrazovka nezměnila, a nikdy nepřekročí tyto limity. Každý poslaný snímek spotřebuje část limitu Claude.' })
    );
  }

  function keyCard(app) {
    if (app.caps.sample) return null; // v Claude se klíč nepoužívá
    const cfg = FM27.ai.getConfig() || {};
    const kind = ui.select([['anthropic', 'Claude (Anthropic)'], ['openai', 'OpenAI-kompatibilní']], cfg.kind || 'anthropic', { id: 'keyKind' });
    const key = ui.input({ id: 'keyValue', type: 'password', autocomplete: 'off', placeholder: cfg.apiKey ? '(uložený klíč, nezobrazuje se)' : 'Vlož klíč sem, nikdy ho neposílej do chatu' });
    const baseUrl = ui.input({ id: 'keyBase', placeholder: 'https://api.openai.com/v1', value: cfg.baseUrl || '' });
    const mQuick = ui.input({ id: 'keyQuick', placeholder: 'levný model', value: (cfg.models && cfg.models.quick) || '' });
    const mDefault = ui.input({ id: 'keyDefault', placeholder: 'běžný model', value: (cfg.models && cfg.models.default) || '' });
    const mComplex = ui.input({ id: 'keyComplex', placeholder: 'důkladný model', value: (cfg.models && cfg.models.complex) || '' });
    const extra = h('div', { id: 'keyExtra' }, ui.field('Adresa API', baseUrl), h('div', { class: 'row' }, ui.field('Levný model', mQuick, { grow: true }), ui.field('Běžný model', mDefault, { grow: true }), ui.field('Důkladný model', mComplex, { grow: true })));
    const sync = () => (extra.hidden = kind.value !== 'openai');
    kind.addEventListener('change', sync);
    sync();
    const msg = h('p', { class: 'hint', id: 'keyMsg' });
    return h(
      'section',
      { class: 'card', id: 'keyCard' },
      h('h2', { text: 'Vlastní klíč AI' }),
      h('p', { class: 'lead', text: 'Tahle verze aplikace neběží uvnitř Claude, takže potřebuje tvůj vlastní klíč. Klíč zůstane jen v tomto prohlížeči (nesynchronizuje se a není v kódu). Vytvoř si pro aplikaci samostatný klíč s měsíčním limitem výdajů.' }),
      ui.field('Poskytovatel', kind),
      ui.field('Klíč', key),
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
            if (!apiKey) return (msg.textContent = 'Vlož klíč.');
            const next = { kind: kind.value, apiKey };
            if (kind.value === 'openai') {
              next.baseUrl = baseUrl.value.trim() || 'https://api.openai.com/v1';
              next.models = { quick: mQuick.value.trim(), default: mDefault.value.trim(), complex: mComplex.value.trim() };
              if (!next.models.quick || !next.models.default || !next.models.complex) return (msg.textContent = 'Vyplň názvy všech tří modelů.');
            }
            FM27.ai.setConfig(next);
            await FM27.ai.init(app);
            msg.textContent = FM27.ai.available ? 'Klíč je uložený. Zkus „Zkouška spojení“ výš.' : 'Klíč se nepodařilo použít: ' + (FM27.ai.problem || 'neznámý důvod');
            key.value = '';
            app.render();
          },
        }),
        ui.confirmButton('Smazat klíč', 'Opravdu smazat klíč?', async () => {
          FM27.ai.setConfig(null);
          await FM27.ai.init(app);
          toast('Klíč je smazaný.');
          app.render();
        })
      ),
      msg
    );
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
      keyCard(app),
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
