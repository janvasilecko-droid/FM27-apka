/* Načtení klubu ze hry při zakládání kariéry (rozhraní). Klub, soutěž a sezónu přečte Claude ze snímku obrazovky hry (vložený soubor nebo okno hry),
   nebo je poví plugin FMMatchLens, když ve hře běží zápas (jen samostatná verze). Výsledek jen vyplní formulář kariéry jako NÁVRH:
   kariéra vznikne až kliknutím uživatele na „Založit kariéru“ a co nechal tak, jak to navrhl obraz, je „z obrazovky, potvrzeno“.
   Do paměti hry ani do jejích souborů aplikace nesahá. Pravidla čtení a čištění jsou v careerread.js (čistý modul, zkoušený v Node). */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const ui = FM27.ui;
  const { h } = ui;
  const CR = () => window.TrenerCareerRead;
  const SIDE_CS = { home: 'domácí', away: 'hosté' };

  const describe = (p) =>
    [p.club ? `klub „${p.club}“` : null, p.competition ? `soutěž „${p.competition}“` : null, p.season ? `sezóna ${p.season}` : null].filter(Boolean).join(', ');

  FM27.clubRead = {
    /** block({ onProposal }) → prvek s ovládáním. onProposal dostane { club, competition, season, source: 'screenshot'|'plugin', via, note, issues }. */
    block(opts) {
      const o = opts || {};
      const ai = FM27.ai;
      const feed = FM27.feed;
      const status = h('p', { class: 'hint', id: 'clubReadStatus', 'aria-live': 'polite' });
      const out = h('div', { id: 'clubReadOut' });
      const parts = [];

      const give = (proposal, lead) => {
        o.onProposal(proposal);
        const issues = (proposal.issues || []).filter((i) => !/^Klub, který řídíš/.test(i));
        status.textContent =
          `${lead} ${describe(proposal)}. Je to jen návrh: zkontroluj ho podle hry (políčka níž jde přepsat) a teprve potom založ kariéru.` +
          (proposal.club ? '' : ' Klub se přečíst nepodařilo, napiš ho.') +
          (issues.length ? ' ' + issues.join(' ') : '') +
          (proposal.note ? ` Poznámka ke čtení: ${proposal.note}` : '');
      };

      // ---------------------------------------------------------------- ze snímku obrazovky
      const vision = !!(ai && ai.available && ai.imagesSupported);
      if (vision) {
        const input = h('input', { type: 'file', id: 'clubShot', accept: ai.limitsInfo.images.mediaTypes.join(',') });
        let grabbed = []; // snímek okna hry (jen tam, kde to stránka smí)
        const grab = FM27.widgets.frameGrabButton(
          (blob) => {
            grabbed = [blob];
            status.textContent = 'Snímek okna hry je připravený. Klikni na „Přečíst klub ze snímku“.';
          },
          { id: 'clubGrab' }
        );
        const read = h('button', {
          class: 'btn primary',
          id: 'clubReadBtn',
          type: 'button',
          text: 'Přečíst klub ze snímku',
          onclick: async () => {
            const files = [...input.files, ...grabbed].slice(0, ai.limitsInfo.images.maxCount);
            if (!files.length) return (status.textContent = 'Vyber snímek obrazovky hry nebo načti okno hry.');
            read.disabled = true;
            out.replaceChildren();
            status.textContent = 'Čtu obrázek… (při prvním použití potvrď okno Claude)';
            try {
              const raw = await ai.json(CR().PROMPT, { modelTier: 'quick', images: files, cache: false, purpose: 'čtení klubu' });
              const r = CR().normalizeCareerExtraction(raw);
              if (!r.ok) {
                status.textContent = (r.issues.join(' ') || 'Nic čitelného jsem nenašel.') + (r.note ? ` Poznámka ke čtení: ${r.note}` : '');
                return;
              }
              grabbed = [];
              give(Object.assign({}, r.read, { source: 'screenshot', note: r.note, issues: r.issues }), 'Přečteno ze snímku:');
            } catch (e) {
              status.textContent = ai.errorText(e);
            } finally {
              read.disabled = false;
            }
          },
        });
        parts.push(
          h('p', { class: 'hint', text: 'Otevři ve hře libovolnou obrazovku, kde je vidět tvůj klub (Přehled klubu, Soupiska, Taktika, Vstupní schránka), a vyfoť ji nebo ji načti z okna hry. Claude přepíše klub, soutěž a sezónu, jen co je vidět.' }),
          ui.field('Snímek obrazovky hry', input),
          h('div', { class: 'actions' }, grab, read)
        );
      } else {
        parts.push(
          h('p', {
            class: 'hint',
            id: 'clubReadNoVision',
            text: `Čtení ze snímku tu není dostupné: potřebuje Claude se čtením obrázků (ve stránce v Claude ho dává tvůj účet, v samostatné verzi klíč v Nastavení).${FM27.app && FM27.app.standalone ? '' : ' Klub můžeš napsat ručně.'}`,
          })
        );
      }

      // ---------------------------------------------------------------- z pluginu FMMatchLens (jen samostatná verze, jen při zápase)
      if (FM27.app && FM27.app.standalone && feed && CR() && window.TrenerMatchLens) {
        const url = ui.input({ id: 'clubFeedUrl', maxlength: 60, placeholder: window.TrenerMatchLens.DEFAULT_URL, value: feed.prefs().url });
        const apply = (meta, side) => {
          const r = CR().clubFromMeta(meta, { side });
          if (r.needSide) {
            out.replaceChildren(
              h('p', { class: 'hint', text: 'Z dat pluginu se nepozná, který tým je tvůj. Vyber ho:' }),
              h('div', { class: 'actions' }, r.choices.map((c) => h('button', { class: 'btn', type: 'button', 'data-side': c.side, text: `Můj klub: ${c.name} (${SIDE_CS[c.side]})`, onclick: () => apply(meta, c.side) })))
            );
            status.textContent = 'Plugin hlásí zápas, ale neřekl, který tým řídíš.';
            return;
          }
          if (!r.ok) {
            status.textContent = r.issues.join(' ') || 'Klub se z pluginu nepodařilo zjistit.';
            return;
          }
          out.replaceChildren();
          give({ club: r.club, competition: r.competition, season: null, source: 'plugin', via: r.via, issues: [] }, 'Z pluginu FMMatchLens:');
          status.textContent += ' Sezónu plugin neposílá: doplň ji ručně nebo ze snímku.';
        };
        const btn = h('button', {
          class: 'btn',
          id: 'clubFromPlugin',
          type: 'button',
          text: 'Načíst klub z pluginu',
          onclick: async () => {
            feed.savePrefs({ url: url.value.trim() });
            btn.disabled = true;
            out.replaceChildren();
            status.textContent = 'Ptám se pluginu… Pokud se prohlížeč zeptá, jestli smí stránka přistupovat k aplikacím na tomto počítači, povol to.';
            try {
              const p = await feed.probe();
              if (!p.ok) return (status.textContent = p.error || 'Spojení s pluginem nevyšlo.');
              if (!p.health.inMatch || !p.meta || !p.meta.ok) {
                return (status.textContent = 'Plugin odpovídá, ale zápas zatím nehlásí. Klub umí zjistit jen během zápasu: spusť zápas ve hře a zkus to znovu, nebo načti klub ze snímku obrazovky.');
              }
              apply(p.meta);
            } finally {
              btn.disabled = false;
            }
          },
        });
        parts.push(
          h(
            'details',
            { class: 'manual', id: 'clubPlugin' },
            h('summary', { text: 'Nebo z pluginu FMMatchLens (jen když ve hře běží zápas)' }),
            h('p', { class: 'hint', text: 'Plugin FMMatchLens nabízí data hry na tomhle počítači. Klub je tým, který ve hře řídí člověk. Údaj je „od nástroje u tebe“, ne „ověřeno hrou“.' }),
            ui.field('Adresa pluginu (jen tento počítač)', url),
            h('div', { class: 'actions' }, btn)
          )
        );
      }

      return h('section', { class: 'card inner', id: 'clubRead' }, h('h3', { text: 'Načíst klub ze hry' }), ...parts, status, out);
    },
  };
})();
