/* Rozbor soupeře a příprava na zápas (zadání majitele 7. 11. 2026: „analýza soupeře, chci seznam konkrétních doporučení a úprav taktiky, kterou mám;
   najít slabá místa v sestavě soupeře, poradit hráčům“). Čistá logika bez DOM, sítě a AI (test/oppanalysis.test.mjs): stejný vstup dá vždy stejný výstup.

   CO TO DĚLÁ: ze zprávy o soupeři (to, co o něm píše sama hra: silné a slabé stránky, formace, mentalita a presink trenéra, výpadky, významní hráči,
   předpokládaná sestava, standardky), z viditelných atributů soupeřových hráčů (když je uživatel načetl), z VLASTNÍ taktiky (jak ji uživatel nastavil)
   a z vlastního kádru udělá seřazený seznam doporučení: co přenastavit v taktice (s českými názvy ze hry), koho dát do sestavy, jaké pokyny k soupeři
   zadat (sloupce Těsné obsazování a Napadání), které sezení Zápasové přípravy zvolit a jednu testovatelnou změnu. Pravidlo, kterému chybí vstup, se
   NEVYHODNOCUJE a je uvedené v „nevyhodnoceno“; chybějící údaj se nikdy nehádá a vlastní nastavení se nikdy nebere jako výchozí.

   PORADÍ DŮVĚRY: HRA = text, který o soupeři napsala sama hra (aplikace ho jen přepisuje a převádí na kroky); KOMUNITA = názor veřejných průvodců FM
   (Passion4FM, FM Scout, FM-Base, AssMan.AI; sporné body jsou označené); ODHAD = závěr autora této aplikace. Prahy atributů jsou nastavitelné (`opts.thresholds`)
   a nejsou pravidlem FM27: žádný zdroj číslo nedává. Nic se nepředpovídá: nikde nestojí, že taktika „zabere“. Skryté údaje (CA, PA, osobnost, reputace)
   se nepoužívají. Strany (P, L) soupeře se převádějí na NAŠI perspektivu: jeho pravá strana je naše levá.
   Cena změn: ve hře každá změna taktiky a každý tweak snižuje porozumění taktice (štítek „Tactical Tweak Pending“, několik minut staré hodnoty), proto
   doporučení nese počet změn a drží se nejvýš tří. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fm27know.js'), require('./fm27cs.js'), require('./dwrs.js'), require('./tacticanalysis.js'), require('./oppread.js'));
  else root.TrenerOppAnalysis = factory(root.TrenerFm27Know, root.TrenerFm27Cs, root.TrenerDwrs, root.TrenerTacticAnalysis, root.TrenerOppRead);
})(typeof self !== 'undefined' ? self : this, function (K, CS, D, TA, OR) {
  'use strict';

  const VERSION = 'oppanalysis-1';
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const r1 = (v) => Math.round(v * 10) / 10;
  const key = (s) => CS.key(s);
  const BASIS_CS = { HRA: 'text, který o soupeři napsala sama hra', KOMUNITA: 'názor veřejných průvodců FM (sporné body jsou označené)', ODHAD: 'odhad autora aplikace' };
  const SEV_CS = { doporuceno: 'Doporučeno', zvaz: 'Zvaž', info: 'K vědomí' };
  const SEV_RANK = { doporuceno: 0, zvaz: 1, info: 2 };

  /** Prahy jsou ODHAD aplikace a dají se posunout; žádný zdroj číslo nedává (R3 §6). */
  const DEFAULTS = Object.freeze({
    low: 9, // atribut ≤ low je nízký
    high: 14, // atribut ≥ high je vysoký
    aerialLow: 10, // průměr Heading a Jumping Reach stoperů ≤ aerialLow = slabý vzduch
    fast: 15, // Pace i Acceleration ≥ fast = rychlý hráč
    slowDefence: 10, // průměr Pace a Acceleration obránců ≤ slowDefence = pomalá obrana
    playmaker: 14, // průměr Passing, Vision a Technique ≥ playmaker = tvůrce hry
    weakPasser: 9, // Composure, Passing nebo First Touch ≤ weakPasser u obránce nebo brankáře = slabý rozehrávač
    minKnown: 3, // aspoň tolik hráčů sestavy musí mít načtené potřebné atributy, aby se rozbor atributů dělal
    physicalCount: 2, // aspoň tolik fyzických slabin hry = fyzicky měkký soupeř
    maxChanges: 3, // nejvýš tolik změn nastavení doporučuje aplikace najednou
    maxOi: 3, // nejvýš tolik pokynů k soupeři celkem (hlavní hráči nejvýš dva, slabý rozehrávač jeden)
    centreDiff: 2, // rozdíl počtu hráčů ve středu zálohy, od kterého jde o přesilu
  });

  const PHYSICAL = new Set(['Aggression', 'Bravery', 'Determination', 'Strength', 'Balance', 'Work Rate', 'Stamina', 'Natural Fitness']);
  const AERIAL_ATTRS = new Set(['Jumping Reach', 'Heading', 'Communication', 'Aerial Reach', 'Command Of Area', 'Punching', 'Eccentricity', 'Rushing Out']);
  const KEEPER_SHOT_ATTRS = new Set(['Reflexes', 'Handling', 'Agility', 'One On Ones']);
  const BACK = new Set(['DC', 'DR', 'DL', 'WBR', 'WBL']);
  const CENTRE_MID = new Set(['DM', 'MC', 'AMC']);
  const MID_AND_UP = new Set(['DM', 'MC', 'MR', 'ML', 'AMC', 'AMR', 'AML']);

  const txt = (v) => (typeof v === 'string' ? v : '');
  const flank = (side) => (side === 'R' ? 'pravá' : side === 'L' ? 'levá' : 'střední');
  const mine = (side) => (side === 'R' ? 'L' : side === 'L' ? 'R' : 'C'); // jeho pravá je naše levá
  const theirSide = (l) => (l && l.side && l.side.includes('R') ? 'R' : l && l.side && l.side.includes('L') ? 'L' : 'C');

  // ---------------------------------------------------------------- kontext
  function buildContext(input) {
    const o = isObj(input) ? input : {};
    const report = isObj(o.report) ? o.report : OR.emptyReport();
    const th = Object.assign({}, DEFAULTS, isObj(o.thresholds) ? o.thresholds : {});
    const squad = (Array.isArray(o.squad) ? o.squad : []).filter((p) => isObj(p) && p.id);
    const ours = isObj(o.tactic) ? TA.buildContext(o.tactic, { players: squad }) : null;

    // hráči soupeře s atributy (ze soupisky soupeře) se párují s předpokládanou sestavou podle jména
    const oppPlayers = Array.isArray(o.oppPlayers) ? o.oppPlayers.filter((p) => isObj(p) && typeof p.name === 'string') : [];
    const lineup = (Array.isArray(report.lineup) ? report.lineup : []).map((l) => {
      const p = oppPlayers.find((x) => CS.sameName(x.name, l.name)) || null;
      return Object.assign({}, l, { attrs: p ? D.playerAttributes(p) : null, age: p && Number.isInteger(p.age) ? p.age : null });
    });
    const weaknesses = Array.isArray(report.weaknesses) ? report.weaknesses : [];
    const strengths = Array.isArray(report.strengths) ? report.strengths : [];
    const c = {
      report, th, ours, squad, lineup, weaknesses, strengths, oppPlayers,
      weak: (type) => weaknesses.filter((w) => w.cls && w.cls.type === type),
      strong: (type) => strengths.filter((w) => w.cls && w.cls.type === type),
      weakAttrs: (set) => weaknesses.filter((w) => w.cls && w.cls.type === 'attr' && set.has(w.cls.attr)),
      attr: (p, name) => (p && p.attrs && p.attrs.has(K.norm(name)) ? p.attrs.get(K.norm(name)) : null),
      byFm: (set) => lineup.filter((l) => l.fm && set.has(l.fm)),
      hasOurs: () => !!ours,
      own: (id) => (ours ? ours.v(id) : null),
      ownStep: (id) => (ours ? ours.step(id) : null),
      ownLabel: (id) => (ours && ours.team.has(id) ? ours.label(id) : null),
    };
    /** Průměr atributů přes hráče sestavy; null, když ho zná míň než minKnown hráčů. */
    c.avgAttr = (players, names) => {
      const vals = [];
      let known = 0;
      for (const p of players) {
        const v = names.map((n) => c.attr(p, n)).filter((x) => x !== null);
        if (v.length === names.length) {
          known++;
          vals.push(v.reduce((a, b) => a + b, 0) / v.length);
        }
      }
      return known >= th.minKnown || (known >= 2 && players.length <= 3) ? { value: vals.reduce((a, b) => a + b, 0) / vals.length, known } : null;
    };
    /** Nejlepší hráči vlastního kádru podle průměru atributů (jen ti, kdo je mají všechny); `want` zužuje na pozice (kódy pozic). */
    c.bestOwn = (names, n, want) => {
      const out = [];
      for (const p of squad) {
        if (p.flags && p.flags.injury) continue;
        if (want && !(Array.isArray(p.positions) && p.positions.some((x) => want.has(x)))) continue;
        const attrs = D.playerAttributes(p);
        const v = names.map((nm) => (attrs.has(K.norm(nm)) ? attrs.get(K.norm(nm)) : null));
        if (v.some((x) => x === null)) continue;
        out.push({ name: p.name, value: r1(v.reduce((a, b) => a + b, 0) / v.length), detail: names.map((nm, i) => `${CS.canonAttr(nm)} ${v[i]}`).join(', ') });
      }
      return out.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'cs')).slice(0, n);
    };
    return c;
  }

  // ---------------------------------------------------------------- změny nastavení v jazyce hry
  /** change(c, id, to, dir) → {id, name, to, label, value, valueSeen, from, fromCs, known, already}.
      dir: 'exact' (jiná hodnota = změna), 'up' (už stejná nebo vyšší hodnota není změna), 'down' (už stejná nebo nižší není změna). */
  function change(c, id, to, dir) {
    const t = K.TEAM_BY_ID.get(id);
    const cur = c.own(id);
    const curStep = c.ownStep(id);
    const toStep = K.stepOf(id, to);
    let already = false;
    if (cur !== null) {
      if (cur === to) already = true;
      else if (dir === 'up' && curStep !== null && toStep !== null && curStep >= toStep) already = true;
      else if (dir === 'down' && curStep !== null && toStep !== null && curStep <= toStep) already = true;
    }
    return {
      id, name: t.name, to,
      label: CS.labelCs(id) || t.name,
      value: CS.valueCs(id, to) || to,
      valueSeen: CS.valueSeen(id, to) === true,
      from: cur,
      fromCs: cur !== null ? CS.valueCs(id, cur) || cur : null,
      known: cur !== null,
      already,
    };
  }
  const changeText = (ch) => `${ch.label} → ${ch.value}${ch.valueSeen || ch.value === ch.to ? '' : ` (${ch.to})`}`;

  // ---------------------------------------------------------------- katalog pravidel
  const NOTHING = null; // pravidlo vyhodnoceno a nic nenašlo
  const R = (id, area, basis, title, test) => ({ id, area, basis, title, test });
  const evGame = (list) => list.map((w) => `hra píše: „${[w.area, w.text].filter(Boolean).join(': ')}“`);

  const RULES = [
    R('P01', 'Vzduch a centry', 'HRA', 'Soupeř je slabý ve vzduchu nebo v brankářově hře do vzduchu', (c) => {
      const game = [...c.weak('aerial'), ...c.weakAttrs(AERIAL_ATTRS), ...c.weak('goalkeeper'), ...c.weak('goalsAgainst').filter((w) => /centr|cross/i.test(w.text))];
      const dcs = c.byFm(new Set(['DC']));
      const dcAvg = c.avgAttr(dcs, ['Heading', 'Jumping Reach']);
      const attrHit = dcAvg && dcAvg.value <= c.th.aerialLow;
      if (!game.length && !attrHit) return c.weaknesses.length || dcAvg ? NOTHING : undefined;
      const changes = [change(c, 'crossingStyle', 'Floated Crosses', 'exact'), change(c, 'attackingWidth', 'Wider', 'up')];
      const aerial = c.bestOwn(['Heading', 'Jumping Reach'], 3, new Set(['ST', 'AMC', 'AML', 'AMR']));
      const ev = evGame(game);
      if (attrHit) ev.push(`stopeři soupeře mají průměr Heading a Jumping Reach ${r1(dcAvg.value)} (načteno u ${dcAvg.known} z ${dcs.length}; práh ${c.th.aerialLow})`);
      const risks = [];
      const w = c.ownStep('attackingWidth');
      if (w !== null && w <= 1) risks.push(`Máš Šířku při útočení „${CS.valueCs('attackingWidth', c.own('attackingWidth')) || c.own('attackingWidth')}“: centry z krajů nebudou mít kdo dorážet; nejdřív ji uprav.`);
      risks.push('Centry mají smysl jen s hráči, kteří je ve vápně dorazí (Heading, Jumping Reach). Úspěšnost centrů závisí i na krajních hráčích.');
      return {
        sev: game.length ? 'doporuceno' : 'zvaz', basis: game.length ? 'HRA' : 'ODHAD', priority: game.length ? 3 : 2,
        text: 'Hraj do vápna po křídlech a ze standardek: soupeř je zranitelný ve vzduchu.',
        changes, who: aerial.map((a) => ({ name: a.name, why: `vzduch: ${a.detail}` })), ev, risks,
        watch: 'Úspěšnost centrů a vyhrané hlavičky v prvních 15 minutách; když centry nedoletí, vrať Šířku.',
        training: ['Corners'],
      };
    }),

    R('P02', 'Fyzická hra', 'HRA', 'Soupeř je fyzicky a mentálně měkký', (c) => {
      const hits = c.weakAttrs(PHYSICAL);
      const kinds = new Set(hits.map((w) => w.cls.attr));
      if (kinds.size < c.th.physicalCount) return c.weaknesses.length ? NOTHING : undefined;
      const changes = [change(c, 'tackling', 'Get Stuck In', 'exact'), change(c, 'triggerPress', 'More Often', 'up')];
      const risks = ['Tvrdší hra znamená víc faulů a karet: zvlášť blízko vlastní branky (standardky, penalty).', 'Hráči, kteří víc presují, se rychleji unaví: zkontroluj Výdrž a Nasazení svých záložníků.'];
      const tired = (c.squad || []).filter((p) => p.flags && p.flags.fatigue).map((p) => p.name);
      if (tired.length) risks.push(`Unavení hráči v kádru: ${tired.slice(0, 4).join(', ')}.`);
      return {
        sev: kinds.size >= 3 ? 'doporuceno' : 'zvaz', basis: 'HRA', priority: kinds.size >= 3 ? 3 : 2,
        text: 'Přitvrď a napadej víc: soupeř je podle hry slabý v oblastech, kde rozhoduje tvrdost a nasazení.',
        changes, ev: evGame(hits), risks,
        tweak: 'V zápase to samé udělá balíček Get Physical (Active Tactical Tweaks): mění Hrát na standardky, Obranný zákrok (Přitvrdit hru) a Napadání. Je to jeden tweak místo tří změn, ale platí za něj stejné porozumění.',
        watch: 'Fauly a žluté karty obou týmů a to, jestli soupeř ztrácí míče; když přibývají tvoje karty, vrať Obranný zákrok.',
        training: ['Defensive Engagement'],
      };
    }),

    R('P03', 'Brankář', 'ODHAD', 'Soupeřův brankář je slabý v zákrocích', (c) => {
      const hits = c.weakAttrs(KEEPER_SHOT_ATTRS);
      const gk = c.byFm(new Set(['GK']))[0];
      const low = gk ? ['Reflexes', 'Handling', 'Agility'].filter((n) => c.attr(gk, n) !== null && c.attr(gk, n) <= c.th.low) : [];
      if (!hits.length && !low.length) return c.weaknesses.length || (gk && gk.attrs) ? NOTHING : undefined;
      const changes = [change(c, 'shotsFromDistance', 'Encourage', 'exact')];
      const shooters = c.bestOwn(['Long Shots', 'Finishing'], 2, MID_AND_UP);
      const ev = evGame(hits);
      if (low.length) ev.push(`brankář ${gk.name}: ${low.map((n) => `${CS.canonAttr(n)} ${c.attr(gk, n)}`).join(', ')} (práh ${c.th.low})`);
      return {
        sev: 'zvaz', basis: hits.length ? 'HRA' : 'ODHAD', priority: 1,
        text: 'Zkoušej střely i z dálky a dorážej: brankář soupeře je v zákrocích zranitelný.',
        changes, who: shooters.map((s) => ({ name: s.name, why: `střelba: ${s.detail}` })), ev,
        risks: ['Střely z dálky mají obvykle nízkou kvalitu šance; bez střelců (Long Shots, Finishing) jen plýtváš držením míče. Jde o úvahu z jednoho starého průvodce.'],
        watch: 'Počet a kvalita střel zpoza vápna; když přibývají jen slabé střely, vrať Střely z dálky.',
      };
    }),

    R('P04', 'Strana', 'HRA', 'Hráč soupeře ve špatné formě: útoč přes jeho stranu', (c) => {
      const bad = c.weak('poorForm');
      if (!bad.length) return c.weaknesses.length ? NOTHING : undefined;
      const found = [];
      for (const w of bad) {
        const hay = key(`${w.area} ${w.text}`);
        // hráč se v textu hry pozná podle příjmení (poslední slovo jména, aspoň čtyři písmena): křestní jména se opakují
        const l = c.lineup.find((x) => {
          const parts = x.name.split(/\s+/).filter(Boolean);
          const sn = key(parts[parts.length - 1] || '');
          return sn.length >= 4 && hay.includes(sn);
        });
        if (l) found.push({ w, l });
      }
      if (!found.length) {
        return { sev: 'info', basis: 'HRA', priority: 0, text: 'Hra uvádí hráče soupeře ve špatné formě, ale v očekávané sestavě ho nenacházím: nevím, kterou stranu to otevírá.', changes: [], ev: evGame(bad), risks: [], watch: '', info: true };
      }
      const f = found[0];
      const theirs = theirSide(f.l);
      const ours = mine(theirs);
      const to = ours === 'L' ? 'Left' : ours === 'R' ? 'Right' : 'Middle';
      const changes = [change(c, 'progressThrough', to, 'exact')];
      return {
        sev: 'zvaz', basis: 'HRA', priority: 2,
        text: `Útoč přes ${ours === 'L' ? 'svou levou' : ours === 'R' ? 'svou pravou' : 'střed'}: hráč soupeře ${f.l.name} (jeho ${flank(theirs)} strana) je podle hry ve špatné formě. Strana je převedená na tvou perspektivu: jeho pravá je tvá levá.`,
        changes, ev: evGame([f.w]).concat([`v očekávané sestavě hraje na místě ${f.l.code || f.l.slot || f.l.position || f.l.fm}`]),
        risks: ['Forma je vzorek několika zápasů. Soupeř se může přesunout nebo hráče vystřídat. Tvůj hráč na té straně musí slabinu umět využít (Acceleration, Dribbling, Crossing).'],
        watch: 'Kolik útoků a šancí jde přes tu stranu v prvních 20 minutách.',
      };
    }),

    R('P05', 'Pokyny k soupeři', 'KOMUNITA', 'Hlavní hráči soupeře: těsné obsazování', (c) => {
      const kp = c.report.keyPlayers || [];
      const candidates = [];
      const add = (name, why) => {
        const l = c.lineup.find((x) => CS.sameName(x.name, name));
        if (!l || l.fm === 'GK' || candidates.some((x) => CS.sameName(x.name, l.name))) return;
        candidates.push({ name: l.name, l, why });
      };
      const order = { topAssists: 0, topScorer: 1, topRating: 2 };
      for (const k of kp.slice().sort((a, b) => order[a.kind] - order[b.kind])) add(k.name, { topAssists: 'hra ho uvádí s nejvíc asistencemi', topScorer: 'hra ho uvádí jako nejlepšího střelce', topRating: 'hra ho uvádí s nejlepším hodnocením' }[k.kind]);
      let basis = 'HRA';
      if (!candidates.length) {
        // bez významných hráčů v sestavě: tvůrce hry podle atributů (jen když je máme načtené)
        const mids = c.byFm(new Set(['DM', 'MC', 'AMC', 'AMR', 'AML']));
        const scored = mids.map((l) => {
          const v = ['Passing', 'Vision', 'Technique'].map((n) => c.attr(l, n));
          return v.every((x) => x !== null) ? { l, v: v.reduce((a, b) => a + b, 0) / 3 } : null;
        }).filter(Boolean).sort((a, b) => b.v - a.v);
        if (scored.length >= c.th.minKnown && scored[0].v >= c.th.playmaker) {
          candidates.push({ name: scored[0].l.name, l: scored[0].l, why: `tvůrce hry podle atributů: průměr Passing, Vision a Technique ${r1(scored[0].v)} (práh ${c.th.playmaker})` });
          basis = 'ODHAD';
        }
      }
      if (!candidates.length) return kp.length || c.lineup.length ? NOTHING : undefined;
      const picked = candidates.slice(0, Math.min(2, c.th.maxOi));
      const absent = kp.filter((k) => !c.lineup.some((x) => CS.sameName(x.name, k.name)) && c.lineup.length).map((k) => k.name);
      const oi = picked.map((p) => ({ code: p.l.code || null, slot: p.l.slot || null, hint: p.l.code || p.l.position || p.l.fm, name: p.name, column: 'Těsné obsazování', value: 'Vždy', why: p.why }));
      const risks = ['Hlídající hráč se může nechat vytáhnout z pozice a unaví se. Hlídání samo nezabrání průnikové přihrávce.', 'Pokyn k soupeři zmizí, když soupeř hráče vystřídá nebo ho přesune: nastav ho až na sestavu v den zápasu.'];
      if (absent.length) risks.push(`Významní hráči, kteří nejsou v očekávané sestavě (pokyn na ně nenastavuj): ${absent.join(', ')}.`);
      return {
        sev: 'zvaz', basis, priority: 2,
        text: `V Taktika › Opposition nastav Těsné obsazování: Vždy jen na ${picked.map((p) => `${p.l.code || p.l.position || p.l.fm} (${p.name})`).join(' a ')}.`,
        changes: [], oi, ev: picked.map((p) => `${p.name}: ${p.why}`), risks,
        cost: { oi: picked.length },
        watch: 'Jestli se hlídaný hráč v prvních 20 minutách dostává k míči; když ne, nech pokyn. Nikdo nezměřil, že pokyny k soupeři zlepší výsledek: ber to jako malou úpravu.',
      };
    }),

    R('P06', 'Výpadky', 'HRA', 'Soupeř nebude mít některé hráče', (c) => {
      const ab = c.report.absences || [];
      if (!ab.length) return c.report.team || c.lineup.length ? NOTHING : undefined;
      const out = ab.filter((a) => a.status === 'out');
      const doubt = ab.filter((a) => a.status === 'doubt');
      const posOf = (name) => {
        const k = (c.report.keyPlayers || []).find((x) => CS.sameName(x.name, name));
        if (k && k.fm) return k.fm;
        const p = c.oppPlayers.find((x) => CS.sameName(x.name, name));
        const codes = p && Array.isArray(p.positions) ? p.positions : [];
        return codes[0] || null;
      };
      const outBack = out.filter((a) => posOf(a.name) === 'DC');
      const ev = ab.map((a) => `${a.name}: ${a.status === 'out' ? 'nehraje' : 'nejistý start'}${a.note ? ` (${a.note})` : ''}`);
      const risks = ['Očekávaná sestava se do dne zápasu může změnit: pokyny k soupeři zadávej až na konci.'];
      if (doubt.length) risks.push(`Nejistý start: ${doubt.map((a) => a.name).join(', ')}. Před zápasem znovu otevři Předpokládanou sestavu.`);
      return {
        sev: outBack.length >= 2 ? 'doporuceno' : 'info', basis: 'HRA', priority: outBack.length >= 2 ? 2 : 0,
        text: outBack.length >= 2 ? 'Soupeři chybí oba hlavní stopeři: zkus hru do prostoru za obranou a do vzduchu (úvaha z komunitních rad, ne pravidlo).' : `Soupeř nebude mít: ${out.map((a) => a.name).join(', ') || 'nikdo jistě nechybí'}. Nehlídej ani nenastavuj pokyny na hráče, který nehraje.`,
        changes: [], ev, risks, watch: '', info: outBack.length < 2,
      };
    }),

    R('P07', 'Presink soupeře', 'KOMUNITA', 'Soupeř napadá často: bezpečná rozehrávka', (c) => {
      const p = txt(c.report.manager && c.report.manager.pressing);
      if (!p) return undefined;
      const k = key(p);
      const high = /castej|vzdy|vysok|often|always|high/.test(k) && !/mene|less|zridka/.test(k);
      if (!high) return NOTHING;
      const bu = c.own('buildUpStrategy');
      const changes = [change(c, 'buildUpStrategy', 'Bypass Press', 'exact')];
      const ev = [`styl pressingu soupeřova trenéra: „${p}“`];
      const risks = [];
      if (!c.hasOurs()) risks.push('Nemáš načtenou vlastní taktiku, takže nevím, co už máš nastavené.');
      if (bu === 'Play Through Press') risks.push('Tvoje Strategie výstavby je „Hrát přes pressink“: proti častému napadání hrozí ztráty ve vlastní třetině.');
      const pd = c.ownStep('passingDirectness');
      if (bu === 'Bypass Press' && pd !== null && pd <= 1) risks.push('Možný rozpor (úvaha autora aplikace, ne pravidlo hry): Strategie výstavby je „Obejít pressink“, ale Přímočarost přihrávek je krátká. Obejít pressink znamená hrát míč dopředu a krátké přihrávky tomu brání.');
      const todo = changes.filter((x) => !x.already);
      if (!todo.length && !risks.length) return { sev: 'info', basis: 'KOMUNITA', priority: 0, text: 'Soupeř napadá často a ty už máš Strategii výstavby na „Obejít pressink“. Tohle je v pořádku.', changes, ev, risks, watch: '', info: true, good: true };
      return {
        sev: todo.length ? 'doporuceno' : 'zvaz', basis: 'KOMUNITA', priority: todo.length ? 2 : 1,
        text: todo.length ? 'Soupeř napadá často: obejdi jeho pressink (Strategie výstavby), ať neztrácíš míče ve vlastní třetině.' : 'Soupeř napadá často: zkontroluj, že tvoje rozehrávka dokáže pressink obejít.',
        changes, ev, risks, watch: 'Ztráty míče ve vlastní třetině v prvních 15 minutách.', training: ['Press Avoidance'],
      };
    }),

    R('P08', 'Styl soupeře', 'KOMUNITA', 'Mentalita soupeřova trenéra: jak na něj', (c) => {
      const m = txt(c.report.manager && c.report.manager.mentality);
      if (!m) return undefined;
      const k = key(m);
      const cautious = /opatrn|obran|defen|cautious/.test(k) && !/dobrodruz/.test(k);
      const attacking = /dobrodruz|utocn|aktivn|attack|positive|adventur/.test(k);
      const ev = [`mentalita soupeřova trenéra: „${m}“`];
      if (cautious) {
        const changes = [change(c, 'attackingWidth', 'Wider', 'up')];
        const risks = ['Proti hlubokému bloku nehraj jen „Trpělivost: Zpracovat míč do vápna“: podle průvodců to hraje soupeři do karet (spor zdrojů).'];
        if (c.own('patience') === 'Work Ball Into Box') risks.push('Máš právě Trpělivost „Work Ball Into Box“: zvaž ji.');
        return { sev: 'zvaz', basis: 'KOMUNITA', priority: 1, text: 'Soupeř bude opatrný a postaví blok: rozšiř hru po stranách a nehraj jen středem.', changes, ev, risks, watch: 'Jestli se soupeř dostane k protiútokům po tvých ztrátách; držení míče samo nestačí.' };
      }
      if (attacking) {
        const changes = [change(c, 'attackingTransition', 'Counter-Attack', 'exact')];
        const risks = ['Soupeř se otevře dopředu: prostor za jeho obranou bývá velký, ale vysoká linie ti ho zase vezme.'];
        const fast = c.byFm(new Set(['DR', 'DL', 'DC', 'AMR', 'AML', 'ST'])).filter((l) => c.attr(l, 'Pace') !== null && c.attr(l, 'Acceleration') !== null && c.attr(l, 'Pace') >= c.th.fast && c.attr(l, 'Acceleration') >= c.th.fast);
        if (fast.length && c.ownStep('defensiveLine') !== null && c.ownStep('defensiveLine') >= 3) risks.push(`Soupeř má rychlé hráče (${fast.map((l) => l.name).join(', ')}) a ty máš vyšší obrannou linii: hrozí průnik za obranu.`);
        return { sev: 'zvaz', basis: 'KOMUNITA', priority: 1, text: 'Soupeř bude hrát odvážně a otevřeně: využij rychlý přechod do útoku.', changes, ev, risks, watch: 'Kolik šancí vzniká ze ztrát soupeře a kolik z jeho protiútoků.' };
      }
      return NOTHING;
    }),

    R('P09', 'Střed zálohy', 'ODHAD', 'Přesila ve středu zálohy', (c) => {
      if (c.lineup.length < 10 || !c.ours) return undefined;
      const theirs = c.lineup.filter((l) => l.fm && CENTRE_MID.has(l.fm)).length;
      const own = c.ours.slots.filter((s) => s.pos && CS.fmOfSlot(s.pos) && CENTRE_MID.has(CS.fmOfSlot(s.pos))).length;
      const diff = theirs - own;
      if (Math.abs(diff) < c.th.centreDiff) return NOTHING;
      if (diff > 0) {
        return { sev: 'zvaz', basis: 'ODHAD', priority: 1, text: `Soupeř má ve středu zálohy ${theirs} hráčů proti tvým ${own}: dorovnej střed (třetí záložník, nebo hraj víc přes křídla).`, changes: [], ev: [`střed soupeře: ${theirs} (DZ, Z, OZ uprostřed), tvůj: ${own}`], risks: ['Soupeř může tvar v zápase změnit. Víc hráčů ve středu znamená míň hráčů na křídlech.'], watch: 'Kdo vyhrává souboje ve středu a kolik míčů ztrácíš v prostřední třetině.' };
      }
      return { sev: 'info', basis: 'ODHAD', priority: 0, text: `Ve středu zálohy máš převahu: ${own} proti ${theirs}. Využij ji držením míče ve středu.`, changes: [], ev: [`střed soupeře: ${theirs}, tvůj: ${own}`], risks: [], watch: '', info: true, good: true };
    }),

    R('P10', 'Standardky', 'HRA', 'Soupeř je zranitelný při obraně standardek', (c) => {
      const defend = (c.report.setPieces && c.report.setPieces.defence) || [];
      const weakDef = defend.filter((t) => /struggled to defend|conceding from|conceded from|neubránil|inkasuj/i.test(t) && !/none of the previous|good when defending|dobře brán/i.test(t));
      if (!defend.length) return undefined;
      if (!weakDef.length) return NOTHING;
      const zone = weakDef.some((t) => /far post|zadní tyč/i.test(t)) ? 'zadní tyč' : weakDef.some((t) => /near post|přední tyč/i.test(t)) ? 'přední tyč' : null;
      const changes = [change(c, 'playForSetPieces', 'Play For Set Pieces', 'exact')];
      return {
        sev: 'zvaz', basis: 'HRA', priority: 2,
        text: `Soupeř podle hry hůř brání standardky${zone ? ` (zvlášť ${zone})` : ''}: hraj na standardky a zacil na slabé místo.`,
        changes, ev: weakDef.slice(0, 3).map((t) => `hra píše: „${t}“`),
        risks: ['Malý vzorek zápasů: konverze standardek je v krátkých řadách náhodná. Tvůj kádr potřebuje vysoké hráče a dobrého exekutora.'],
        watch: 'Počet rohů a kopů a kam padají; po 10 zápasech teprve poznáš, jestli to funguje.',
        training: ['Corners', 'Free Kicks'],
      };
    }),

    R('P11', 'Standardky', 'HRA', 'Soupeř je nebezpečný na standardky', (c) => {
      const threat = [...c.strong('setPieceChances'), ...c.strong('freeKicks')];
      const att = ((c.report.setPieces && c.report.setPieces.attack) || []).filter((t) => /scored from|goals from|delivered .* (good|well)|vytvář/i.test(t) && !/failed|ineffective|never/i.test(t));
      if (!threat.length && !att.length) return c.strengths.length || (c.report.setPieces && (c.report.setPieces.attack || []).length) ? NOTHING : undefined;
      return {
        sev: 'zvaz', basis: 'HRA', priority: 1,
        text: 'Soupeř je nebezpečný na standardky: nefauluj blízko vlastního vápna a postav na standardky nejvzdušnější hráče.',
        changes: [], ev: evGame(threat).concat(att.slice(0, 2).map((t) => `hra píše: „${t}“`)),
        risks: ['Rada je obecná: hra neukazuje, jak soupeř standardky vymýšlí; zvaž sezení Zápasové přípravy (Corners, Free Kicks), ale jejich přesný účinek není ověřený.'],
        watch: 'Fauly kolem vápna a rohy proti.',
      };
    }),

    R('P12', 'Soupiska soupeře', 'ODHAD', 'Pomalá obrana soupeře a rychlý útočník u tebe', (c) => {
      const backs = c.byFm(BACK);
      const avg = c.avgAttr(backs, ['Pace', 'Acceleration']);
      if (!avg) return undefined;
      if (avg.value > c.th.slowDefence) return NOTHING;
      const fastOwn = c.bestOwn(['Pace', 'Acceleration'], 2, new Set(['ST', 'AMC', 'AML', 'AMR']));
      const changes = [change(c, 'passReception', 'Pass Into Space', 'exact'), change(c, 'attackingTransition', 'Counter-Attack', 'exact')];
      return {
        sev: 'zvaz', basis: 'ODHAD', priority: 2,
        text: 'Obrana soupeře je pomalá: hraj míče za obranu rychlým útočníkům.',
        changes, who: fastOwn.map((p) => ({ name: p.name, why: `rychlost: ${p.detail}` })),
        ev: [`obránci soupeře: průměr Pace a Acceleration ${r1(avg.value)} (načteno u ${avg.known}; práh ${c.th.slowDefence})`],
        risks: ['Proti hluboké obraně není prostor za ní. Ve FM27 SI píše, že obránci už nedoběhnou „nereálně rychle“, takže starší rady o dobíhání nemusí platit.'],
        watch: 'Kolik míčů za obranu skončí šancí a kolikrát jsi v ofsajdu.',
      };
    }),

    R('P13', 'Soupiska soupeře', 'ODHAD', 'Soupeřovi rychlí útočníci proti tvé vysoké linii', (c) => {
      const fwd = c.byFm(new Set(['ST', 'AMR', 'AML', 'AMC'])).filter((l) => c.attr(l, 'Pace') !== null && c.attr(l, 'Acceleration') !== null);
      if (!fwd.length) return undefined;
      const fast = fwd.filter((l) => c.attr(l, 'Pace') >= c.th.fast && c.attr(l, 'Acceleration') >= c.th.fast);
      if (!fast.length) return NOTHING;
      const step = c.ownStep('defensiveLine');
      const quick = c.bestOwn(['Pace', 'Acceleration'], 3, new Set(['DC', 'DR', 'DL']));
      const risky = step !== null && step >= 3;
      return {
        sev: risky ? 'doporuceno' : 'info', basis: 'ODHAD', priority: risky ? 3 : 0,
        text: risky ? `Soupeř má rychlé hráče (${fast.map((l) => l.name).join(', ')}) a ty hraješ s vyšší obrannou linií: sniž Výšku obranné linie, nebo dej do obrany nejrychlejší stopery.` : `Soupeř má rychlé hráče (${fast.map((l) => l.name).join(', ')}): dej do obrany nejrychlejší stopery.`,
        changes: risky ? [change(c, 'defensiveLine', 'Standard', 'down')] : [],
        who: quick.map((p) => ({ name: p.name, why: `rychlost: ${p.detail}` })),
        ev: fast.map((l) => `${l.name}: Pace ${c.attr(l, 'Pace')}, Acceleration ${c.attr(l, 'Acceleration')} (práh ${c.th.fast})`),
        risks: ['Hlubší linie znamená méně tlaku na soupeře a víc práce při rozehrávce.'],
        watch: 'Kolikrát soupeř vyběhne za tvou obranu.', info: !risky,
      };
    }),

    R('P14', 'Soupiska soupeře', 'KOMUNITA', 'Slabý rozehrávač v zadní řadě soupeře', (c) => {
      const back = c.byFm(new Set(['GK', 'DC', 'DR', 'DL']));
      const weak = [];
      for (const l of back) {
        const bad = ['Composure', 'Passing', 'First Touch'].filter((n) => c.attr(l, n) !== null && c.attr(l, n) <= c.th.weakPasser);
        if (bad.length) weak.push({ l, bad });
      }
      const known = back.filter((l) => l.attrs);
      if (known.length < 2) return undefined;
      if (!weak.length) return NOTHING;
      const w = weak.sort((a, b) => b.bad.length - a.bad.length)[0];
      const oi = [{ code: w.l.code || null, slot: w.l.slot || null, hint: w.l.code || w.l.position || w.l.fm, name: w.l.name, column: 'Napadání', value: 'Vždy', why: `slabý rozehrávač: ${w.bad.map((n) => `${CS.canonAttr(n)} ${c.attr(w.l, n)}`).join(', ')}` }];
      return {
        sev: 'zvaz', basis: 'KOMUNITA', priority: 1,
        text: `V Taktika › Opposition nastav Napadání: Vždy na ${w.l.code || w.l.position || w.l.fm} (${w.l.name}): má slabou rozehru.`,
        changes: [], oi, ev: oi.map((o) => `${o.name}: ${o.why} (práh ${c.th.weakPasser})`),
        cost: { oi: 1 },
        risks: ['Techničtější spoluhráči tlak obejdou a hráči, kteří napadají, se vytáhnou z pozic. Komunita se neshoduje: jedni radí tlačit na slabého rozehrávače, jiní hlídat natěsno toho nejlepšího.'],
        watch: 'Jestli soupeř ztrácí míče v první třetině; když ne, pokyn odeber.',
      };
    }),

    R('P15', 'Soupiska soupeře', 'ODHAD', 'Vzdušně silní útočníci soupeře: tvoji nejlepší stopeři', (c) => {
      const fwd = c.byFm(new Set(['ST', 'AMC'])).filter((l) => c.attr(l, 'Heading') !== null && c.attr(l, 'Jumping Reach') !== null);
      if (!fwd.length) return undefined;
      const strong = fwd.filter((l) => c.attr(l, 'Heading') >= c.th.high && c.attr(l, 'Jumping Reach') >= c.th.high);
      if (!strong.length) return NOTHING;
      const cbs = c.bestOwn(['Heading', 'Jumping Reach'], 2, new Set(['DC']));
      return {
        sev: 'zvaz', basis: 'ODHAD', priority: 1,
        text: `Soupeřův útočník ${strong.map((l) => l.name).join(', ')} je silný ve vzduchu: postav proti němu své nejvzdušnější stopery.`,
        changes: [], who: cbs.map((p) => ({ name: p.name, why: `vzduch: ${p.detail}` })),
        ev: strong.map((l) => `${l.name}: Heading ${c.attr(l, 'Heading')}, Jumping Reach ${c.attr(l, 'Jumping Reach')} (práh ${c.th.high})`),
        risks: ['Nesmíš zůstat bez vzdušných hráčů v obranném vápně u standardek.'], watch: 'Vyhrané a prohrané hlavičky v obranném vápně.',
      };
    }),

    R('P16', 'Poctivost zprávy', 'HRA', 'Stejná oblast je u soupeře silná i slabá', (c) => {
      if (!c.strengths.length || !c.weaknesses.length) return undefined;
      const sKeys = new Map();
      for (const s of c.strengths) sKeys.set(s.cls.type === 'attr' ? `a:${s.cls.attr}` : `t:${s.cls.type}`, s);
      const both = [];
      for (const w of c.weaknesses) {
        const k = w.cls.type === 'attr' ? `a:${w.cls.attr}` : `t:${w.cls.type}`;
        if (w.cls.type !== 'other' && sKeys.has(k)) both.push({ w, s: sKeys.get(k) });
      }
      if (!both.length) return NOTHING;
      return {
        sev: 'info', basis: 'HRA', priority: 0, info: true,
        text: `Hra uvádí oblast „${both[0].w.area}“ jako silnou i slabou stránku soupeře: rada v ní není jednostranná.`,
        changes: [], ev: both.slice(0, 3).map((b) => `silná: „${b.s.area}: ${b.s.text}“, slabá: „${b.w.area}: ${b.w.text}“`), risks: [], watch: '',
      };
    }),

    R('P17', 'Znalost soupeře', 'HRA', 'Kolik o soupeři hra a aplikace opravdu ví', (c) => {
      const items = [];
      const sa = txt(c.report.staffAnalysis);
      if (sa && /zakladn|basic/.test(key(sa))) items.push(`Analýza hodnocení zaměstnanců je „${sa}“: zpráva o soupeři je jen tak dobrá, jak dobrý je analytik a skaut. V Tactical Effectiveness je to pilíř Next Match Info (Quality of Next Opposition Report).`);
      if (c.lineup.length && !c.oppPlayers.length) items.push('Atributy soupeřových hráčů nejsou načtené: rozbor podle atributů (rychlost, vzduch, rozehra) se nedělá. Načti soupisku soupeře ze snímků (Opposition Player Knowledge).');
      if (!items.length) return NOTHING;
      return { sev: 'info', basis: 'HRA', priority: 0, info: true, text: items[0], changes: [], ev: items.slice(1), risks: [], watch: '' };
    }),
  ];
  const RULE_BY_ID = Object.freeze(Object.fromEntries(RULES.map((r) => [r.id, r])));

  // ---------------------------------------------------------------- hlavní funkce
  /** analyze({report, oppPlayers, tactic, squad, thresholds}) → výsledek (viz hlavička). */
  function analyze(input) {
    const o = isObj(input) ? input : {};
    const c = buildContext(o);
    const th = c.th;
    const usable = !!(c.report && c.report.ok !== false && (c.weaknesses.length || c.strengths.length || c.lineup.length || c.report.manager.mentality || c.report.manager.pressing || (c.report.absences || []).length || (c.report.keyPlayers || []).length || ((c.report.setPieces && (c.report.setPieces.attack || []).length) || 0) || ((c.report.setPieces && (c.report.setPieces.defence || []).length) || 0)));
    const recs = [];
    const notChecked = [];
    const passed = [];
    if (usable) {
      for (const rule of RULES) {
        let f;
        try {
          f = rule.test(c);
        } catch (e) {
          f = undefined;
        }
        if (f === undefined) {
          notChecked.push({ id: rule.id, title: rule.title });
          continue;
        }
        if (f === null) {
          passed.push({ id: rule.id, title: rule.title });
          continue;
        }
        const changes = Array.isArray(f.changes) ? f.changes : [];
        recs.push({
          id: rule.id, area: rule.area, title: rule.title, sev: f.sev || 'zvaz', sevCs: SEV_CS[f.sev || 'zvaz'], basis: f.basis || rule.basis, basisCs: BASIS_CS[f.basis || rule.basis],
          priority: Number.isFinite(f.priority) ? f.priority : 1, text: f.text, changes, who: f.who || [], oi: f.oi || [], ev: f.ev || [], risks: f.risks || [], watch: f.watch || '',
          tweak: f.tweak || null, training: f.training || [], cost: { settings: changes.filter((x) => !x.already).length, oi: (f.cost && f.cost.oi) || 0 }, info: !!f.info, good: !!f.good, optional: false,
        });
      }
    }
    recs.sort((a, b) => b.priority - a.priority || SEV_RANK[a.sev] - SEV_RANK[b.sev] || a.id.localeCompare(b.id));

    // rozpočet změn: nejvýš maxChanges nastavení najednou, ostatní je volitelné
    let used = 0;
    for (const r of recs) {
      if (r.info || (!r.cost.settings && !r.cost.oi)) continue;
      if (r.cost.settings && used + r.cost.settings > th.maxChanges) r.optional = true;
      else used += r.cost.settings;
    }
    const total = recs.filter((r) => !r.info).reduce((s, r) => s + r.cost.settings, 0);
    const budget = { settings: used, offered: total, max: th.maxChanges, over: total > th.maxChanges };

    // pokyny k soupeři (nejvýš maxOi, hlavní hráči přednostně)
    const oi = [];
    for (const r of recs) for (const x of r.oi) if (oi.length < th.maxOi && !oi.some((y) => y.name === x.name && y.column === x.column)) oi.push(Object.assign({ recId: r.id }, x));

    // sezení Zápasové přípravy z doporučení (názvy ze hry; účinek sezení nebyl ověřen)
    const trainMap = new Map();
    for (const r of recs) for (const s of r.training) if (!r.info && !trainMap.has(s)) trainMap.set(s, r.id);
    const TRAIN_WHY = {
      'Press Avoidance': 'soupeř napadá často; sezení nacvičuje, jak se tým organizuje za míčem při držení podle taktiky (popis sezení viděný ve hře)',
      'Defensive Engagement': 'plánuješ tvrdší napadání a obranné zákroky',
      Corners: 'soupeř je zranitelný ve vzduchu nebo hůř brání standardky: nacvič rohy',
      'Free Kicks': 'soupeř hůř brání přímé kopy nebo hraješ na standardky',
    };
    const training = [...trainMap.entries()].map(([session, recId]) => ({ session, recId, why: TRAIN_WHY[session] || 'z doporučení', basis: 'ODHAD', note: 'Název sezení je ze hry (Tréninkový rozvrh › Zápasová příprava), jeho přesný účinek nebyl ověřen: přečti si u sezení „About Session“.' }));

    // jedna testovatelná změna: nejlevnější z nejvyšších doporučení
    const changeable = recs.filter((r) => !r.info && !r.optional && r.changes.some((x) => !x.already));
    changeable.sort((a, b) => b.priority - a.priority || a.cost.settings - b.cost.settings || a.id.localeCompare(b.id));
    const top = changeable[0] || null;
    const oneChange = top
      ? {
          recId: top.id,
          text: `Zkus jen tohle: ${top.changes.filter((x) => !x.already).map(changeText).join(', ')}.`,
          watch: top.watch || 'Sleduj prvních 15 až 20 minut.',
          revert: 'Když se do 20 až 25 minut nic nezlepší, vrať původní hodnotu. Změna chvíli drží staré hodnoty (štítek „Tactical Tweak Pending“) a každá změna snižuje porozumění taktice.',
        }
      : null;

    // rady hráčům z vlastního kádru (jen to, co aplikace ví z viditelných údajů)
    const playerNotes = [];
    for (const p of c.squad) {
      if (p.flags && p.flags.injury) playerNotes.push({ name: p.name, text: 'je zraněný: nezařazuj ho do sestavy', basis: 'HRA' });
      else if (p.flags && p.flags.fatigue) playerNotes.push({ name: p.name, text: 'je unavený: zvaž odpočinek, hlavně při tvrdším napadání', basis: 'HRA' });
    }
    for (const r of recs) for (const w of r.who) playerNotes.push({ name: w.name, text: `${w.why} (${r.title.toLowerCase()})`, basis: r.basis, recId: r.id });

    const warnings = [
      'Každá změna taktiky a každý tweak snižuje porozumění taktice (Tactical Understanding): hra to ukazuje štítkem „Tactical Tweak Pending“ a několik minut drží staré hodnoty. Drž se nejvýš tří změn.',
      'Strany (pravá, levá) jsou ve zprávě z pohledu soupeře: jeho pravá strana je tvá levá.',
      'Pokyny k soupeři zmizí po střídání nebo změně pozice hráče. Hra nabízí i „Radu asistenta“ (Využít rady): porovnej ji s tímto seznamem.',
      'Nikdo neměřil, že doporučení „slabina → využití“ zvýší šanci na výhru, a aplikace nic nepředpovídá: je to seznam, co zkusit, ne záruka.',
    ];

    const inputs = {
      weaknesses: c.weaknesses.length, strengths: c.strengths.length, lineup: c.lineup.length, lineupWithAttributes: c.lineup.filter((l) => l.attrs).length,
      oppPlayers: c.oppPlayers.length, tactic: c.hasOurs(), tacticInstructions: c.ours ? c.ours.team.size : 0, squad: c.squad.length,
      manager: !!(c.report.manager && (c.report.manager.mentality || c.report.manager.pressing || c.report.manager.preferredFormation)),
    };
    return { version: VERSION, usable, team: c.report.team || '', inputs, recs, oi, training, oneChange, budget, playerNotes, warnings, notChecked, passed, thresholds: th };
  }

  /** Souhrn jako text pro kopírování a pro Osobního trenéra. */
  function summaryLines(result) {
    if (!result || !result.usable) return ['Rozbor soupeře: o soupeři nejsou načtená žádná data ze zprávy ze hry.'];
    const head = ['Rozbor soupeře'];
    if (result.team) head.push(result.team);
    const lines = [`${head.join(' ')}: ${result.recs.filter((r) => !r.info).length} doporučení, ${result.notChecked.length} pravidel nevyhodnoceno kvůli chybějícím údajům; změn nastavení ${result.budget.settings} z nejvýš ${result.budget.max}.`];
    for (const r of result.recs) {
      const ch = r.changes.filter((x) => !x.already).map(changeText);
      lines.push(`${r.sevCs} [${r.id}] ${r.title}: ${r.text}${ch.length ? ` Změna: ${ch.join(', ')}.` : ''}${r.optional ? ' (volitelné: přes rozpočet změn)' : ''} Původ: ${r.basis}.`);
    }
    for (const o of result.oi) lines.push(`Pokyn k soupeři: ${o.column} = ${o.value} u ${o.hint || o.code || '?'} (${o.name}).`);
    for (const t of result.training) lines.push(`Zápasová příprava: ${t.session}.`);
    if (result.oneChange) lines.push(`Jedna testovatelná změna: ${result.oneChange.text}`);
    return lines;
  }

  return { VERSION, DEFAULTS, BASIS_CS, SEV_CS, RULES, RULE_BY_ID, buildContext, analyze, summaryLines };
});
