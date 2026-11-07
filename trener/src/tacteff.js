/* Tactical Effectiveness (FM27): pilíře, klíčové faktory a rady, co s nimi dělat. Čistá logika bez DOM, sítě a AI (test/tacteff.test.mjs).
   Zadání majitele (7. 11. 2026): hra FM27 má nové měřidlo Tactical Effectiveness a aplikace ho má umět vysvětlit a poradit.

   CO O TOM VÍME (průzkum ve hře 7. 11. 2026, docs/FM27_PRUZKUM_VE_HRE.md, řádky E1 až E3): vpravo nahoře na obrazovce Taktika jsou tři měřidla: Intenzita
   a Complexity (kruhové ikony s barevným prstencem) a Effectiveness (pruh s ukazatelem). Žádné z nich nemá číslo ani slovo a text po najetí myší se zjistit
   nepodařilo. Podrobnost je v Trénink › Tactical Effectiveness: čtyři pilíře (Tactical Understanding, Player Ability, Player Buy-In, Next Match Info), každý s popisem,
   klíčovými faktory a větou od asistenta (například „We need to dedicate more time to Build Up in training“). Tréninkový rozvrh má osm sezení Tactical Understanding
   a sedm sezení Zápasové přípravy; popis sezení uvádí „Session Impacts“ včetně Tactical Understanding.
   CO NEVÍME: z čeho se úroveň počítá, jak velká změna co udělá, co přesně znamená Intenzita a jakou stupnici mají pruhy. Proto UROVNĚ ZADÁVÁ UŽIVATEL slovně podle
   toho, co vidí (nízká, střední, vysoká, nevím); stupnice je volba aplikace, ne údaj hry. Odhad složitosti taktiky (počet instrukcí mimo výchozí hodnotu) je ODHAD
   aplikace, ne vzorec hry. Komunita tvrdí a hra to nepřímo potvrzuje (štítek „Tactical Tweak Pending“), že každá změna taktiky a každý tweak snižuje porozumění taktice. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fm27cs.js'));
  else root.TrenerTactEff = factory(root.TrenerFm27Cs);
})(typeof self !== 'undefined' ? self : this, function (CS) {
  'use strict';

  const VERSION = 'tacteff-1';
  const LEVELS = Object.freeze(['unknown', 'low', 'mid', 'high']);
  const LEVEL_CS = Object.freeze({ unknown: 'nevím', low: 'nízká', mid: 'střední', high: 'vysoká' });
  const LEVEL_RANK = { low: 0, mid: 1, unknown: 2, high: 3 }; // nejdřív nízká, pak střední, pak neznámá (nevíme, jestli není problém), vysoká poslední
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  // Popisy pilířů jsou přeložené věty, které hra píše pod nadpisem pilíře (anglicky); faktory jsou názvy ze hry.
  const PILLAR_INFO = Object.freeze({
    understanding: { cs: 'Porozumění taktice', game: 'A player\'s ability to comprehend what is being asked of them tactically (at a team level).', csDesc: 'Jak dobře hráči chápou, co se po nich taktikou chce, na úrovni týmu. Zahrnuje taktické oblasti (tvar s míčem a bez míče, styl přihrávek, výstavbu, tvorbu šancí, linii napadání, intenzitu napadání a past) a taktickou složitost.' },
    ability: { cs: 'Schopnost hráčů', game: 'A combination of a player\'s capability and their ability relative to the tactical role being asked of them.', csDesc: 'Spojení toho, co hráč umí, a toho, jak dobře sedí na roli, kterou mu taktika dává (hvězdičky ve sloupci Taktická schopnost).' },
    buyIn: { cs: 'Ochota hráčů', game: 'A player\'s willingness, not ability, to carry out the manager\'s tactics.', csDesc: 'Ochota hráčů taktiku dělat, ne schopnost. Souvisí s podporou od manažera, vztahy v týmu a štábu a s tím, jak manažer taktiku mění.' },
    // věta pilíře Next Match Info je ve hře (7. 11. 2026) opravdu stejná jako u Tactical Understanding bez dovětku; je to text hry, ne chyba přepisu, a v aplikaci se nezobrazuje
    nextMatch: { cs: 'Informace o příštím zápase', game: 'A player\'s ability to comprehend what is being asked of them tactically.', csDesc: 'Jak dobře tým ví, co ho čeká: kvalita zprávy o příštím soupeři a znalost jeho hráčů.' },
  });

  // Rady podle faktoru (klíč = název faktoru ve hře). Základ „HRA“ = text nebo chování hry, které jsme viděli; „ODHAD“ = úvaha autora aplikace.
  const FACTOR_ADVICE = Object.freeze({
    'In Possession Shape': 'Tvar s míčem: neměň rozestavení a role s míčem před zápasem; trénuj sezení In Possession Shape.',
    'Passing Style': 'Styl přihrávek (Přímočarost přihrávek, Tempo): drž ho stabilní a trénuj sezení Passing Style.',
    'Build Up': 'Výstavba (Strategie výstavby, Odkopy od brány, Rozehrávka brankáře): trénuj sezení Build Up; hra to často sama doporučuje větou pod pilířem.',
    'Chance Creation': 'Tvorba šancí (Střely z dálky, Styl centrování, Trpělivost): trénuj sezení Vytvoření šancí.',
    'Out Of Possession Shape': 'Tvar bez míče: neměň role bez míče před zápasem; trénuj sezení Out Of Possession Shape.',
    'Line of Engagement': 'Linie napadání: drž ji stabilní a trénuj sezení Line of Engagement.',
    'Pressing Intensity': 'Intenzita napadání (instrukce Napadání): trénuj sezení Pressing Intensity.',
    'Pressing Trap': 'Presinková past: trénuj sezení Pressing Trap, nebo ji vypni, když ji tým neumí.',
    'Player Tactical Ability': 'Schopnost hráčů chápat taktiku je vlastnost hráčů; časem roste tréninkem Tactical Understanding.',
    'Tactical Complexity': 'Složitost taktiky: čím víc instrukcí mimo výchozí hodnotu (a pokynů k soupeři), tím hůř se taktice rozumí. Zjednoduš: vrať instrukce, které nic zásadního nedělají.',
    'Player Capability': 'Schopnost hráčů: dej na místa hráče, kteří jsou na ně schopní (Rozbor sestavy ukáže slabá místa a výměny).',
    'Player Role Suitability': 'Vhodnost na roli: ve sloupci Taktická schopnost v Tvaru týmu hledej role s málo hvězdičkami a změň roli, nebo hráče.',
    'Managerial Support': 'Podpora manažera: promluvy s týmem a s jednotlivci, řešení nespokojených hráčů.',
    'Teammates and Staff Relationships': 'Vztahy v týmu a štábu: nespokojení hráči a konflikty snižují ochotu; řeš je osobními rozhovory.',
    'Manager Tendencies': 'Tendence manažera: ve hře není popsáno, co přesně znamenají; komunita uvádí, že časté změny taktiky ochotu hráčů snižují.',
    'Quality of Next Opposition Report': 'Kvalita zprávy o soupeři: záleží na analytikovi a skautech (hlavička zprávy: Analýza hodnocení zaměstnanců); posil štáb nebo počkej na víc zápasů soupeře.',
    'Opposition Player Knowledge': 'Znalost hráčů soupeře: jejich atributy jsou jen tak přesné, jak je zná skaut; u neznámých hráčů hra ukazuje méně.',
  });

  // Název sezení Tactical Understanding podle toho, co asistent napsal („Chance Creation“ se ve hře jmenuje česky „Vytvoření šancí“)
  const SESSION_ALIASES = Object.freeze({ chancecreation: 'Vytvoření šancí' });
  const key = (s) => (CS ? CS.key(s) : String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  function sessionFor(hint) {
    const k = key(hint);
    if (!k || !CS) return null;
    const list = CS.TRAINING.tacticalUnderstanding;
    const hit = list.find((s) => key(s) === k) || list.find((s) => key(SESSION_ALIASES[k] || '') === key(s));
    return hit || null;
  }

  const normLevel = (v) => (LEVELS.includes(v) ? v : 'unknown');

  /** analyze({levels, assistantHint, tacticAnalysis, oppositionInstructions, nextMatchPrepared}) → {version, pillars, priority, complexity, sessions, warnings, unknown, overall}.
      levels: {understanding, ability, buyIn, nextMatch, overall} každá 'low' | 'mid' | 'high' | 'unknown' (jak uživatel vidí pruh ve hře).
      assistantHint: název oblasti, kterou asistent ve hře jmenuje („Build Up“). tacticAnalysis: výsledek tacticanalysis.analyze (kvůli odhadu složitosti). */
  function analyze(input) {
    const o = isObj(input) ? input : {};
    const lv = isObj(o.levels) ? o.levels : {};
    const pillars = CS.TE.pillars.map((p) => {
      const level = normLevel(lv[p.id]);
      const info = PILLAR_INFO[p.id];
      const advice = [];
      if (level === 'low' || level === 'unknown') {
        for (const f of p.factors) if (FACTOR_ADVICE[f]) advice.push({ factor: f, text: FACTOR_ADVICE[f] });
      }
      const note = level === 'unknown' ? 'Úroveň jsi nezadal: otevři ve hře Trénink › Tactical Effectiveness a zvol podle pruhu u pilíře. Níž jsou všechny rady k pilíři.' : level === 'high' ? 'Úroveň je vysoká: stačí ji nezhoršit (hlavně nemáchat v taktice).' : null;
      return { id: p.id, name: p.name, cs: info.cs, game: info.game, csDesc: info.csDesc, factors: p.factors.slice(), level, levelCs: LEVEL_CS[level], advice, note };
    });
    const priority = pillars.filter((p) => p.level !== 'high').slice().sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || pillars.indexOf(a) - pillars.indexOf(b)).map((p) => p.id);

    // odhad složitosti taktiky: počet instrukcí mimo výchozí hodnotu + pokyny k soupeři (ve hře se počítají do složitosti)
    const ta = isObj(o.tacticAnalysis) ? o.tacticAnalysis : null;
    const opp = Number.isInteger(o.oppositionInstructions) && o.oppositionInstructions >= 0 ? o.oppositionInstructions : null;
    let complexity = null;
    if (ta && ta.complexity) {
      const total = ta.complexity.nonDefaultInstructions + (opp || 0);
      const known = ta.coverage && Number.isInteger(ta.coverage.settingsKnown) ? ta.coverage.settingsKnown : null;
      const all = ta.coverage && Number.isInteger(ta.coverage.settingsTotal) ? ta.coverage.settingsTotal : null;
      const complete = known !== null && all !== null && known >= all;
      // z nepřečtených instrukcí se nic nehádá: počet z přečtených je jen DOLNÍ odhad, takže „vysoká“ platí vždy, „střední“ jen jako „aspoň střední“, a „nízká“ se řekne, jen když je přečteno všech
      let level;
      if (complete) level = total >= 12 ? 'vysoká' : total >= 7 ? 'střední' : 'nízká';
      else if (total >= 12) level = 'vysoká';
      else if (total >= 7) level = 'aspoň střední';
      else level = 'neznámá';
      complexity = {
        nonDefault: ta.complexity.nonDefaultInstructions,
        opposition: opp,
        total,
        known,
        allInstructions: all,
        complete,
        level,
        basis: 'ODHAD',
        note: `Odhad aplikace: počet týmových instrukcí mimo výchozí hodnotu plus pokyny k soupeři. Vzorec hry neznáme; měřidlo Complexity ve hře je jen barevná ikona. Čím víc změn, tím hůř se taktice rozumí.${complete ? '' : ` Přečteno je ${known === null ? 'jen část' : `${known} z ${all}`} instrukcí, takže je to jen dolní odhad (nepřečtené instrukce se nepočítají a nehádají).`}${opp === null ? ' Počet pokynů k soupeři jsi nezadal, nepočítá se.' : ''} Výchozí hodnoty instrukcí aplikace ve FM27 neověřila (bere je z veřejných průvodců), takže i počet „mimo výchozí“ je přibližný.`,
        nonDefaultList: (ta.settings || []).filter((s) => !s.isDefault).map((s) => `${(CS.labelCs && CS.labelCs(s.id)) || s.name}: ${CS.valueCs(s.id, s.value) || s.value}`),
      };
    }

    // doporučená sezení z tréninkového rozvrhu
    const sessions = [];
    const understanding = pillars.find((p) => p.id === 'understanding');
    const hinted = sessionFor(o.assistantHint);
    if (understanding.level !== 'high') {
      if (hinted) sessions.push({ session: hinted, category: 'Tactical Understanding', why: `asistent ve hře radí věnovat víc času oblasti „${o.assistantHint}“`, basis: 'HRA' });
      else sessions.push({ session: null, category: 'Tactical Understanding', why: 'vyber to ze osmi sezení (Passing Style, Build Up, Vytvoření šancí, In Possession Shape, Line of Engagement, Pressing Intensity, Pressing Trap, Out Of Possession Shape), které asistent jmenuje ve větě pod pilířem Tactical Understanding', basis: 'ODHAD' });
    }
    const nextMatch = pillars.find((p) => p.id === 'nextMatch');
    if (nextMatch.level !== 'high') {
      sessions.push({ session: null, category: 'Zápasová příprava', why: o.nextMatchPrepared ? 'zprávu o soupeři už máš načtenou: sezení Zápasové přípravy vyber podle karty Příprava na zápas' : 'načti zprávu o soupeři (Analýza soupeře › Příprava na zápas): ta řekne, která sezení Zápasové přípravy dávají smysl', basis: 'ODHAD' });
    }
    const warnings = [
      'Každá změna taktiky a každý tweak snižuje porozumění taktice. Hra to ukazuje štítkem „Tactical Tweak Pending“: změna se neprojeví hned a několik minut drží staré hodnoty. Komunita to uvádí jako nejčastější stížnost na FM27.',
      'Úrovně pilířů zadáváš ty podle barevných pruhů ve hře; hra žádná čísla ani slova neukazuje. Z čeho se počítají a jak moc které změny pomáhají, aplikace neví.',
    ];
    const unknown = ['Co přesně ukazuje měřidlo Intenzita (text po najetí myší se zjistit nepodařilo).', 'Barevná stupnice a počet stupňů pruhů.'];
    const overall = normLevel(lv.overall);
    return { version: VERSION, overall, overallCs: LEVEL_CS[overall], pillars, priority, complexity, sessions, warnings, unknown };
  }

  return { VERSION, LEVELS, LEVEL_CS, PILLAR_INFO, FACTOR_ADVICE, sessionFor, analyze };
});
