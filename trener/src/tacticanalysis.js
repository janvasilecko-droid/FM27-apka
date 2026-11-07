/* Rozbor taktiky (zadání majitele 6. 11. 2026: „analyzuj taktiku, najdi slabá místa a poraď, co a jak změnit“).
   Čistá logika bez DOM, sítě a AI (test/tacticanalysis.test.mjs): stejný vstup dá vždy stejný výstup, vstupy se nemění.

   CO TO JE: katalog pravidel, která z VIDITELNÉHO nastavení taktiky (mentalita, týmové instrukce, role s míčem a bez míče, rozestavení) a
   z viditelných atributů hráčů, které uživatel načetl, hledají rozpory, nedodělky a dobře sedící dvojice. Pravidlo, kterému chybí vstup
   (instrukce nebyla načtena, role není rozpoznaná), se NEVYHODNOCUJE a v rozboru je uvedené jako „nevyhodnoceno“; nikdy se nehádá
   a chybějící údaj se nebere jako výchozí hodnota.

   ODKUD JSOU PRAVIDLA (průzkum 6. 11. 2026, docs/ANALYZA_SESTAVY_A_PRIPRAVY.md): komunitní průvodci (AssMan.AI, FM Scout, Passion4FM, Guide to
   Football) a texty hry; každé pravidlo nese druh (HRA = text nebo přednastavení hry, KOMUNITA = názor průvodců, ODHAD = závěr autora této
   aplikace), shodu zdrojů a závažnost. Pravidla byla posuzována proti 10 stylům a 90 dvojicím formací, které dodává samotná hra: co hra sama
   používá, je jen upozornění nebo poznámka, ne chyba. (Jedenáctý styl, „Čistý štít“ / Clean Sheet, který FM27 přidala, s pravidly srovnán nebyl.) ŽÁDNÉ pravidlo není pravidlem hry FM27 a žádné nepotřebuje skrytá data (CA, PA,
   osobnost, reputace). Prahy atributů jsou komunitní a dají se posunout (`opts.attrShift`, například −2 pro nižší soutěž). Rozbor
   nepředpovídá výsledek zápasu a neříká, že taktika „zabere“: říká, kde se nastavení vzájemně tluče nebo chybí práce. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fm27know.js'), require('./dwrs.js'));
  else root.TrenerTacticAnalysis = factory(root.TrenerFm27Know, root.TrenerDwrs);
})(typeof self !== 'undefined' ? self : this, function (K, D) {
  'use strict';

  const VERSION = 'tacticanalysis-1';
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const SEV_RANK = { error: 0, warn: 1, note: 2, info: 3, good: 4 };
  const SEV_CS = { error: 'Vážný rozpor', warn: 'Upozornění', note: 'Poznámka', info: 'K vědomí', good: 'Silná stránka' };
  const BASIS_CS = { HRA: 'podle textu nebo přednastavení hry', KOMUNITA: 'názor komunitních průvodců', ODHAD: 'odhad autora aplikace' };
  const LOE_STEP = { 'Low Block': 1, 'Mid Block': 3, 'High Press': 5 };

  // ---------------------------------------------------------------- kontext: tactic + hráči → pohodlné dotazy pro pravidla
  function buildContext(tactic, opts) {
    const o = isObj(opts) ? opts : {};
    const team = new Map();
    const unknownSettings = [];
    for (const raw of Array.isArray(tactic && tactic.teamInstructions) ? tactic.teamInstructions : []) {
      const p = K.parseInstruction(raw);
      if (p) team.set(p.id, { id: p.id, name: p.name, phase: p.phase, value: p.value, step: K.stepOf(p.id, p.value), raw: String(raw) });
      else if (String(raw).trim()) unknownSettings.push(String(raw).trim().slice(0, 120));
    }
    const mentality = K.parseMentality(tactic && tactic.mentality);
    const attrOf = new Map();
    for (const p of Array.isArray(o.players) ? o.players : []) if (isObj(p) && p.id) attrOf.set(p.id, D.playerAttributes(p));
    const shift = Number.isFinite(o.attrShift) ? o.attrShift : 0;
    const slots = (Array.isArray(tactic && tactic.slots) ? tactic.slots : []).map((s) => {
      const roleIn = s.role ? K.findRole(s.role, 'in') : null;
      const roleOut = s.oopRole ? K.findRole(s.oopRole, 'out') : null;
      return {
        key: s.key,
        pos: s.pos,
        grp: K.groupOfPos(s.pos),
        side: K.sideOfPos(s.pos),
        y: Number.isFinite(s.y) ? s.y : null,
        roleIn: roleIn ? roleIn.name : null,
        roleInRaw: s.role ? String(s.role) : '',
        roleOut: roleOut ? roleOut.name : null,
        roleOutRaw: s.oopRole ? String(s.oopRole) : '',
        attrs: s.playerId && attrOf.has(s.playerId) ? attrOf.get(s.playerId) : null,
      };
    });
    const c = {
      mentality,
      team,
      slots,
      shift,
      unknownSettings,
      v: (id) => (team.has(id) ? team.get(id).value : null),
      step: (id) => (team.has(id) ? team.get(id).step : null),
      known: (...ids) => ids.every((id) => team.has(id) && team.get(id).step !== null),
      label: (id) => (team.has(id) ? `${team.get(id).name}: ${team.get(id).value}` : ''),
      outfield: slots.filter((s) => s.grp && s.grp !== 'GK'),
      roleLabel: (s, phase) => `${s.pos}: ${phase === 'out' ? s.roleOut : s.roleIn}`,
      /** Sloty se známou rolí s míčem (nebo bez míče); `grps` zužuje na skupiny pozic, `trait` na vlastnost role. */
      withRole(phase, grps, trait) {
        return slots.filter((s) => (phase === 'out' ? s.roleOut : s.roleIn) && (!grps || grps.includes(s.grp)) && (!trait || K.hasTrait(phase === 'out' ? s.roleOut : s.roleIn, trait)));
      },
      /** Všechny sloty ve skupinách mají rozpoznanou roli (jinak se pravidlo nedá vyhodnotit). */
      rolesKnown(phase, grps) {
        const list = slots.filter((s) => grps.includes(s.grp));
        return list.length > 0 && list.every((s) => (phase === 'out' ? s.roleOut : s.roleIn));
      },
      attr: (s, name) => (s.attrs && s.attrs.has(K.norm(name)) ? s.attrs.get(K.norm(name)) : null),
    };
    c.WIDE = ['D (L/R)', 'WB (L/R)', 'M (L/R)', 'AM (L/R)'];
    c.flank = (side) => slots.filter((s) => s.side === side && c.WIDE.includes(s.grp));
    /** Boky, na kterých jsou nějaká krajní místa; `known` = všechna mají rozpoznanou roli s míčem (jinak se bok nedá posoudit). */
    c.flanks = () =>
      ['L', 'R']
        .map((side) => {
          const list = c.flank(side);
          return { side, list, known: list.length > 0 && list.every((s) => s.roleIn) };
        })
        .filter((f) => f.list.length);
    /** Nejnižší hodnota atributu mezi sloty (jen ty, kde je známá); null, když ji nezná žádný. */
    c.minAttr = (list, name) => {
      let best = null;
      for (const s of list) {
        const v = c.attr(s, name);
        if (v !== null && (best === null || v < best.value)) best = { value: v, slot: s };
      }
      return best;
    };
    return c;
  }

  // ---------------------------------------------------------------- katalog pravidel
  // test(c) → undefined (nejde vyhodnotit: chybí vstup) | NA (pravidlo se na tohle rozestavení nevztahuje) | null (v pořádku) | {ev: [text], slots: [klíč]} (nález)
  const NA = 'na';
  const need = (c, ...ids) => c.known(...ids);
  const R = (id, area, sev, basis, agree, title, why, fix, test) => ({ id, area, sev, basis, agree, title, why, fix, test });
  const gap = (c) => {
    const dl = c.step('defensiveLine');
    const le = LOE_STEP[c.v('lineOfEngagement')];
    return dl === null || !le ? null : { dl: dl + 1, le, diff: Math.abs(dl + 1 - le) };
  };
  const slotsOf = (list) => list.map((s) => s.key);
  const evRoles = (list, phase) => list.map((s) => `${s.pos}: ${phase === 'out' ? s.roleOut : s.roleIn}`);

  const RULES = [
    // -------- obrana: výška linie, linie zapojení, presink, přechod
    R('A01', 'Obrana', 'error', 'KOMUNITA', '3 zdroje',
      'Obranná linie a linie zapojení jsou příliš daleko od sebe',
      'Presující hráči jsou daleko před obranou (nebo naopak obrana daleko před presujícími). Mezi nimi vznikne pás, který musí sám pokrýt střed zálohy; podle průvodců je to nejčastější selhání nastavení.',
      ['Defensive Line → Standard, nebo Line of Engagement → Mid Block', 'Chceš-li zůstat u extrému, dej do středu clonícího záložníka (Screening Defensive Midfielder)'],
      (c) => {
        if (!need(c, 'defensiveLine', 'lineOfEngagement')) return undefined;
        const g = gap(c);
        return g.diff >= 3 ? { ev: [c.label('defensiveLine'), c.label('lineOfEngagement')] } : null;
      }),
    R('A02', 'Obrana', 'warn', 'KOMUNITA', 'spor v přísnosti',
      'Obranná linie a linie zapojení nesedí o dva stupně',
      'Rozdíl dvou stupňů funguje jen s vhodným kádrem: u linie nad zapojením potřebuje střed neúnavného běžce, u zapojení nad linií rychle se vracejícího záložníka. Žádný ze stylů hry to sám nepoužívá.',
      ['Srovnej o stupeň (Defensive Line nebo Line of Engagement)', 'Nebo zkontroluj Stamina, Work Rate a Pace hráčů ve středu a v obraně'],
      (c) => {
        if (!need(c, 'defensiveLine', 'lineOfEngagement')) return undefined;
        const g = gap(c);
        return g.diff === 2 ? { ev: [c.label('defensiveLine'), c.label('lineOfEngagement')] } : null;
      }),
    R('A03', 'Obrana', 'warn', 'KOMUNITA', 'spor s hrou',
      'Counter-Press s nízkou obrannou linií',
      'Po ztrátě míče tým presuje hned, ale obrana stojí hluboko: průvodci popisují mezeru zhruba 25 až 30 metrů. Pozor: styl Fluid Counter-Attack ve hře tohle nastavení používá, takže jde o upozornění, ne o chybu.',
      ['Defensive Line → Standard (nebo Higher)', 'Nebo Defensive Transition → Regroup'],
      (c) => {
        if (!need(c, 'defensiveTransition', 'defensiveLine')) return undefined;
        return c.v('defensiveTransition') === 'Counter-Press' && c.step('defensiveLine') <= 1 ? { ev: [c.label('defensiveTransition'), c.label('defensiveLine')] } : null;
      }),
    R('A04', 'Obrana', 'error', 'KOMUNITA', '3 zdroje',
      'Counter-Press z nízkého bloku',
      'Z hlubokého bloku je zpětné presování dlouhý sprint a mezi útočníkem a stopery zůstane mezera. Counter-Press patří k vyššímu bloku, Regroup k nízkému. Žádný styl hry tohle nepoužívá.',
      ['Defensive Transition → Regroup (a Defensive Line Behaviour → Drop Off More)', 'Nebo Line of Engagement → Mid Block / High Press s odpovídající obrannou linií'],
      (c) => {
        if (!need(c, 'defensiveTransition', 'lineOfEngagement')) return undefined;
        return c.v('defensiveTransition') === 'Counter-Press' && c.v('lineOfEngagement') === 'Low Block' ? { ev: [c.label('defensiveTransition'), c.label('lineOfEngagement')] } : null;
      }),
    R('A04b', 'Obrana', 'note', 'ODHAD', '2 zdroje',
      'Regroup při vysokém presinku',
      'Tým se tlačí nahoru, ale po ztrátě se stahuje: vysoký presink pak nemá návaznost. V reálných taktikách FM27 se tahle kombinace téměř nevyskytuje.',
      ['Defensive Transition → Standard nebo Counter-Press', 'Nebo Line of Engagement → Mid Block'],
      (c) => {
        if (!need(c, 'defensiveTransition', 'lineOfEngagement')) return undefined;
        return c.v('defensiveTransition') === 'Regroup' && c.v('lineOfEngagement') === 'High Press' ? { ev: [c.label('defensiveTransition'), c.label('lineOfEngagement')] } : null;
      }),
    R('A05', 'Obrana', 'warn', 'HRA', '1 zdroj',
      'Counter-Press se širokým týmem',
      'Podle textů hry je širší tvar horší pozice pro zpětné presování, protože hráči jsou od sebe daleko; užší tvar je lepší.',
      ['Attacking Width → Standard nebo Narrower', 'Nebo Defensive Transition → Regroup'],
      (c) => {
        if (!need(c, 'defensiveTransition', 'attackingWidth')) return undefined;
        return c.v('defensiveTransition') === 'Counter-Press' && c.step('attackingWidth') >= 3 ? { ev: [c.label('defensiveTransition'), c.label('attackingWidth')] } : null;
      }),
    R('A06', 'Obrana', 'warn', 'KOMUNITA', '1 zdroj + texty hry',
      'Vysoká obrana, ale málo spuštěný presink',
      'Obrana jde nahoru, zbytek týmu čeká: mezi nimi je díra. Průvodce tomu říká sebeporážející nastavení.',
      ['Trigger Press → Standard', 'Nebo Defensive Line → Standard'],
      (c) => {
        if (!need(c, 'triggerPress', 'defensiveLine')) return undefined;
        return c.step('triggerPress') <= 1 && c.step('defensiveLine') >= 3 ? { ev: [c.label('triggerPress'), c.label('defensiveLine')] } : null;
      }),
    R('A07', 'Obrana', 'warn', 'KOMUNITA', '1 zdroj + texty hry',
      'Chování linie jde proti její výšce',
      'Drop Off More s vysokou linií zve míč přes obranu; Step Up More s nízkou linií tlačí hráče nahoru z hlubokého postavení. Modifikátor a výška linie by měly mířit stejným směrem.',
      ['Sladit Defensive Line Behaviour s Defensive Line (vysoká linie → Step Up More nebo Balanced, nízká → Drop Off More nebo Balanced)'],
      (c) => {
        if (!need(c, 'defensiveLineBehaviour', 'defensiveLine')) return undefined;
        const b = c.v('defensiveLineBehaviour');
        const d = c.step('defensiveLine');
        return (b === 'Drop Off More' && d >= 3) || (b === 'Step Up More' && d <= 1) ? { ev: [c.label('defensiveLineBehaviour'), c.label('defensiveLine')] } : null;
      }),
    R('A08', 'Obrana', 'error', 'KOMUNITA', '3+ zdroje',
      'Vysoká obranná linie a pomalí stopeři',
      'Podle textů hry je vyšší linie zranitelnější vůči průnikovým míčům a víc se spoléhá na brankáře; FM27 navíc počítá realističtěji rychlost a zrychlení. Prahy (Pace 12, Acceleration 11) jsou komunitní a posouvají se podle soutěže.',
      ['Defensive Line → Standard, nebo Line of Engagement → Mid Block', 'Nebo dosadit rychlejší stopery (Pace a Acceleration)'],
      (c) => {
        if (!need(c, 'defensiveLine')) return undefined;
        const cbs = c.slots.filter((s) => s.grp === 'D (C)');
        const pace = c.minAttr(cbs, 'Pace');
        if (!pace) return undefined;
        if (c.step('defensiveLine') < 3) return null;
        const lim = 12 + c.shift;
        const acc = c.minAttr(cbs, 'Acceleration');
        const ev = [c.label('defensiveLine'), `nejpomalejší stoper ${pace.slot.pos}: Pace ${pace.value}`];
        if (acc) ev.push(`nejmenší Acceleration ve stoperech: ${acc.value}`);
        if (pace.value < lim) return { sev: 'error', ev, slots: [pace.slot.key] };
        if (pace.value <= lim + 1 || (acc && acc.value < 11 + c.shift)) return { sev: 'warn', ev, slots: [pace.slot.key] };
        return null;
      }),
    R('A09', 'Obrana', 'warn', 'ODHAD', '2 zdroje',
      'Vysoká linie s brankářem, který zůstává na čáře',
      'Vyšší linie se víc spoléhá na brankáře při zachycování míčů za obranou; Line-Holding Keeper zůstává v malém vápně a bránění nechává spoluhráčům.',
      ['Role brankáře bez míče → Sweeper Keeper', 'Nebo Defensive Line → Standard'],
      (c) => {
        if (!need(c, 'defensiveLine')) return undefined;
        const gk = c.slots.find((s) => s.grp === 'GK');
        if (!gk || !gk.roleOut) return undefined;
        return c.step('defensiveLine') >= 3 && gk.roleOut === 'Line-Holding Keeper' ? { ev: [c.label('defensiveLine'), 'GK bez míče: Line-Holding Keeper'], slots: [gk.key] } : null;
      }),
    R('A12', 'Obrana', 'note', 'KOMUNITA', '2 zdroje',
      'Krátké rozehrávky soupeřova brankáře bez vysokého presinku',
      'Instrukce Short Goalkeeper Distribution: Yes patří k vysokému presinku; s nízkou linií je tým zranitelnější přímým průnikovým míčům.',
      ['Short Goalkeeper Distribution → No, nebo Line of Engagement → High Press'],
      (c) => {
        if (!need(c, 'shortGkDistribution')) return undefined;
        if (c.v('shortGkDistribution') !== 'Yes') return null;
        const le = c.v('lineOfEngagement');
        const dl = c.step('defensiveLine');
        if (le === null && dl === null) return undefined;
        return (le !== null && le !== 'High Press') || (dl !== null && dl <= 1) ? { ev: [c.label('shortGkDistribution'), c.label('lineOfEngagement'), c.label('defensiveLine')].filter(Boolean) } : null;
      }),

    // -------- výdrž a disciplína
    R('B01', 'Výdrž', 'warn', 'KOMUNITA', '3+ zdroje',
      'Intenzivní presink a střed bez výdrže',
      'Podle FM27 má Stamina větší vliv na opakované sprinty a pokles kondice za 90 minut. Měří se NEJHORŠÍ hráč středu, ne průměr. Prahy (Stamina a Work Rate 14) jsou komunitní.',
      ['Defensive Transition → Regroup, nebo Line of Engagement → Mid Block, nebo Trigger Press → Standard', 'Nebo střídat kolem 60. minuty'],
      (c) => {
        const pressing = c.v('lineOfEngagement') === 'High Press' || c.v('defensiveTransition') === 'Counter-Press' || (c.step('triggerPress') !== null && c.step('triggerPress') >= 3);
        if (c.v('lineOfEngagement') === null && c.v('defensiveTransition') === null && c.v('triggerPress') === null) return undefined;
        const mids = c.slots.filter((s) => s.grp === 'DM' || s.grp === 'M (C)');
        const st = c.minAttr(mids, 'Stamina');
        const wr = c.minAttr(mids, 'Work Rate');
        if (!st && !wr) return undefined;
        if (!pressing) return null;
        const lim = 14 + c.shift;
        const worst = Math.min(st ? st.value : 99, wr ? wr.value : 99);
        const ev = [[c.label('lineOfEngagement'), c.label('defensiveTransition'), c.label('triggerPress')].filter(Boolean).join(', ')];
        if (st) ev.push(`nejnižší Stamina ve středu: ${st.value} (${st.slot.pos})`);
        if (wr) ev.push(`nejnižší Work Rate ve středu: ${wr.value} (${wr.slot.pos})`);
        const slots = [st && st.value === worst ? st.slot.key : null, wr && wr.value === worst ? wr.slot.key : null].filter(Boolean);
        if (worst <= lim - 2) return { sev: 'error', ev, slots };
        if (worst < lim) return { sev: 'warn', ev, slots };
        return null;
      }),
    R('B02', 'Výdrž', 'note', 'KOMUNITA', '2 zdroje',
      'Counter-Press s tvrdým nasazením',
      'Counter-Press spolu s Get Stuck In znamená víc faulů a karet a obránce, kteří se vytahují z pozice. Styl Fluid Counter-Attack to ve hře používá, proto jen poznámka.',
      ['Tackling → Standard nebo Stay On Feet', 'Nebo počítat s rotací a kartami'],
      (c) => {
        if (!need(c, 'defensiveTransition', 'tackling')) return undefined;
        return c.v('defensiveTransition') === 'Counter-Press' && c.v('tackling') === 'Get Stuck In' ? { ev: [c.label('defensiveTransition'), c.label('tackling')] } : null;
      }),
    R('B03', 'Výdrž', 'note', 'KOMUNITA', '1 zdroj',
      'Nízký blok s tvrdým nasazením',
      'Nízký blok přežívá tím, že drží jedenáct hráčů na hřišti; Get Stuck In zvyšuje riziko karet. Styly Direct Counter-Attack a Park the Bus to ve hře používají, proto jen poznámka.',
      ['Tackling → Standard nebo Stay On Feet'],
      (c) => {
        if (!need(c, 'tackling')) return undefined;
        const low = c.v('lineOfEngagement') === 'Low Block' || c.v('defensiveTransition') === 'Regroup';
        if (c.v('lineOfEngagement') === null && c.v('defensiveTransition') === null) return undefined;
        return low && c.v('tackling') === 'Get Stuck In' ? { ev: [c.label('lineOfEngagement'), c.label('defensiveTransition'), c.label('tackling')].filter(Boolean) } : null;
      }),

    // -------- útok
    R('C01', 'Útok', 'error', 'KOMUNITA', '3 zdroje',
      'Přímé přihrávky a trpělivý útok najednou',
      'Rozpor „rychle dopředu“ a „trpělivě kroužit“. Podle textů hry Work Ball Into Box vyžaduje vysokou techniku a More Direct silné fyzické vlastnosti; tým nemůže obojí. Žádný styl hry to nepoužívá.',
      ['Passing Directness → Standard a Patience → Standard (nebo Hit Early Crosses)', 'Nebo Passing Directness → Shorter a ponechat Work Ball Into Box'],
      (c) => {
        if (!need(c, 'passingDirectness', 'patience')) return undefined;
        return c.step('passingDirectness') >= 3 && c.v('patience') === 'Work Ball Into Box' ? { ev: [c.label('passingDirectness'), c.label('patience')] } : null;
      }),
    R('C02', 'Útok', 'warn', 'KOMUNITA', '2 zdroje',
      'Protiútok s trpělivým nebo krátkým rozehráním',
      'Counter-Attack znamená méně struktury a víc ztrát; průvodci uvádějí „kontra plus trpělivost“ jako nejčastější chybu. Pozor: styly Vertical Tiki-Taka a Fluid Counter-Attack to ve hře používají, proto upozornění.',
      ['Passing Directness ≥ Standard a Patience → Standard (nebo Hit Early Crosses)', 'Nebo Attacking Transition → Standard / Hold Shape'],
      (c) => {
        if (!need(c, 'attackingTransition')) return undefined;
        if (c.v('attackingTransition') !== 'Counter-Attack') return null;
        if (c.v('patience') === null && c.step('passingDirectness') === null) return undefined;
        return c.v('patience') === 'Work Ball Into Box' || (c.step('passingDirectness') !== null && c.step('passingDirectness') <= 1) ? { ev: [c.label('attackingTransition'), c.label('patience'), c.label('passingDirectness')].filter(Boolean) } : null;
      }),
    R('C03', 'Útok', 'warn', 'KOMUNITA', '1–2 zdroje',
      'Největší tempo s krátkou a trpělivou hrou',
      'Much Higher tempo přináší spoustu špatných přihrávek ze spěchu a s krátkými přihrávkami nebo trpělivostí je to nesplnitelné.',
      ['Tempo → Higher (ne Much Higher), nebo Passing Directness → Standard / More Direct'],
      (c) => {
        if (!need(c, 'tempo')) return undefined;
        if (c.v('tempo') !== 'Much Higher') return null;
        if (c.v('patience') === null && c.step('passingDirectness') === null) return undefined;
        return (c.step('passingDirectness') !== null && c.step('passingDirectness') <= 1) || c.v('patience') === 'Work Ball Into Box' ? { ev: [c.label('tempo'), c.label('passingDirectness'), c.label('patience')].filter(Boolean) } : null;
      }),
    R('C04', 'Útok', 'warn', 'KOMUNITA', '2 zdroje',
      'Široký tým s krátkými přihrávkami',
      'Široký tým má mezi hráči větší vzdálenosti, takže krátké přihrávky mají málo možností a tým míč neudrží.',
      ['Attacking Width → Standard, nebo Passing Directness → Standard'],
      (c) => {
        if (!need(c, 'attackingWidth', 'passingDirectness')) return undefined;
        return c.step('attackingWidth') >= 3 && c.step('passingDirectness') <= 1 ? { ev: [c.label('attackingWidth'), c.label('passingDirectness')] } : null;
      }),
    R('C06', 'Útok', 'error', 'KOMUNITA', '3 zdroje',
      'Na křídle nikdo nedrží lajnu',
      'Všichni hráči na tom křídle stahují do středu, takže nikdo neroztahuje obranu soupeře. Podle popisů rolí se Inside Winger obvykle kombinuje s útočným krajním obráncem u lajny.',
      ['Jednomu z hráčů na tom křídle dát roli, která zůstává široko (Winger, Wide Forward, Wing-Back, Full-Back …)', 'Nebo počítat s přesahem z druhé řady'],
      (c) => {
        const fl = c.flanks().filter((f) => f.known);
        if (!fl.length) return undefined;
        const bad = fl.filter((f) => !f.list.some((s) => K.hasTrait(s.roleIn, 'staysWide')));
        if (!bad.length) return null;
        return { ev: bad.map((b) => `${b.side === 'L' ? 'levé' : 'pravé'} křídlo: ${b.list.map((s) => `${s.pos} ${s.roleIn}`).join(', ')}`), slots: bad.flatMap((b) => slotsOf(b.list)) };
      }),
    R('C07', 'Útok', 'warn', 'KOMUNITA', '3 zdroje',
      'Přesah nebo podběh bez hráče, který jej dělá',
      'Overlap předpokládá hráče, který naběhne vnější stranou, Underlap hráče, který běží zevnitř. Bez takové role instrukce míří do prázdna.',
      ['Sladit instrukci s rolemi na křídle: Overlap k Wing-Back / Advanced Wing-Back (u Inside Winger / Inside Forward), Underlap k široké roli a hráči s během zevnitř (Channel Midfielder, Inside Forward)'],
      (c) => {
        const ov = c.v('overlap');
        const un = c.v('underlap');
        if (ov === null && un === null) return undefined;
        const ev = [];
        const slots = [];
        let judged = false;
        if (ov && ov !== 'Balanced') {
          for (const f of c.flanks().filter((x) => ov === 'Both Flanks' || x.side === (ov === 'Left' ? 'L' : 'R'))) {
            if (!f.known) continue;
            judged = true;
            if (!f.list.some((s) => K.hasTrait(s.roleIn, 'runsWide'))) {
              ev.push(`${c.label('overlap')}, ale ${f.side === 'L' ? 'vlevo' : 'vpravo'} nikdo nenabíhá vnější stranou (${f.list.map((s) => s.roleIn).join(', ')})`);
              slots.push(...slotsOf(f.list));
            }
          }
        } else if (ov === 'Balanced') judged = true;
        if (un && un !== 'Balanced') {
          if (c.outfield.every((s) => s.roleIn)) {
            judged = true;
            const runners = c.outfield.filter((s) => ['Channel Midfielder', 'Channel Forward', 'Box-To-Box Midfielder', 'Inside Forward'].some((r) => K.norm(r) === K.norm(s.roleIn)));
            if (!runners.length) ev.push(`${c.label('underlap')}, ale nikdo nemá běh zevnitř (Channel Midfielder, Channel Forward, Box-To-Box Midfielder, Inside Forward)`);
          }
        } else if (un === 'Balanced') judged = true;
        if (!judged) return undefined;
        return ev.length ? { ev, slots } : null;
      }),
    R('C08', 'Útok', 'warn', 'KOMUNITA', '2 zdroje',
      'Trpělivý útok se střelami z dálky',
      'Work Ball Into Box chce dlouhé útoky do vápna a Shots from Distance: Encourage je ukončuje zdálky; tlak se pak hůř udržuje.',
      ['Shots from Distance → Balanced nebo Discourage, nebo Patience → Standard'],
      (c) => {
        if (!need(c, 'patience', 'shotsFromDistance')) return undefined;
        return c.v('patience') === 'Work Ball Into Box' && c.v('shotsFromDistance') === 'Encourage' ? { ev: [c.label('patience'), c.label('shotsFromDistance')] } : null;
      }),
    R('C10', 'Útok', 'note', 'KOMUNITA', '1 zdroj',
      'Disciplína týmu proti rolím s pevnou tvořivostí',
      'More Disciplined chce, aby se hráči drželi plánu, ale role jako Deep-Lying Playmaker, Playmaking Winger nebo Free Role jsou ze své podstaty tvořivé a týmovou instrukci u svého hráče přebijí.',
      ['Ponechat jen záměrně; jinak Creative Freedom → Balanced'],
      (c) => {
        if (!need(c, 'creativeFreedom')) return undefined;
        if (c.v('creativeFreedom') !== 'More Disciplined') return null;
        if (!c.outfield.every((s) => s.roleIn)) return undefined;
        const ex = c.withRole('in', null, 'expressive');
        return ex.length ? { ev: [c.label('creativeFreedom'), ...evRoles(ex, 'in')], slots: slotsOf(ex) } : null;
      }),
    R('C12', 'Útok', 'good', 'HRA', '2 zdroje',
      'Counter-Press s udržením tvaru po zisku míče',
      'Po ztrátě tým rychle tlačí zpět, po zisku drží strukturu. Tuhle dvojici používá i samotná hra v přednastavení Tiki-Taka.',
      [],
      (c) => {
        if (!need(c, 'defensiveTransition', 'attackingTransition')) return undefined;
        return c.v('defensiveTransition') === 'Counter-Press' && c.v('attackingTransition') === 'Hold Shape' ? { ev: [c.label('defensiveTransition'), c.label('attackingTransition')] } : null;
      }),
    R('C14', 'Útok', 'note', 'KOMUNITA', '1 zdroj',
      'Přihrávky do prostoru s krátkou nebo trpělivou hrou',
      'Pass Into Space chce rychlé a přímé útočníky; s krátkými přihrávkami nebo Work Ball Into Box simulace tuhle kombinaci hůř plní. Styl Fluid Counter-Attack ji ve hře používá.',
      ['Pass Reception → Balanced, nebo Passing Directness → Standard'],
      (c) => {
        if (!need(c, 'passReception')) return undefined;
        if (c.v('passReception') !== 'Pass Into Space') return null;
        if (c.v('patience') === null && c.step('passingDirectness') === null) return undefined;
        return (c.step('passingDirectness') !== null && c.step('passingDirectness') <= 1) || c.v('patience') === 'Work Ball Into Box' ? { ev: [c.label('passReception'), c.label('passingDirectness'), c.label('patience')].filter(Boolean) } : null;
      }),
    R('C15', 'Útok', 'note', 'ODHAD', '1 zdroj',
      'Rozehra přes presink s přímými přihrávkami',
      'Play Through Press míří na krátkou rozehru, přímé přihrávky ji obcházejí; nastavení si odporuje.',
      ['Build-Up Strategy a Passing Directness sladit (Play Through Press ↔ Shorter / Standard, Bypass Press ↔ More Direct)'],
      (c) => {
        if (!need(c, 'buildUpStrategy', 'passingDirectness')) return undefined;
        return c.v('buildUpStrategy') === 'Play Through Press' && c.step('passingDirectness') >= 3 ? { ev: [c.label('buildUpStrategy'), c.label('passingDirectness')] } : null;
      }),

    // -------- budování od brankáře
    R('D01', 'Rozehra', 'error', 'KOMUNITA', '2 zdroje',
      'Rozehra přes presink s dlouhými výkopy',
      'Strategie Play Through Press se ignoruje při každém výkopu, když brankář hraje dlouze (Goal Kicks: Long nebo GK Distribution na útočníka či za obranu).',
      ['Goal Kicks → Short a GK Distribution → Centre-Backs', 'Nebo Build-Up Strategy → Bypass Press'],
      (c) => {
        if (!need(c, 'buildUpStrategy')) return undefined;
        if (c.v('buildUpStrategy') !== 'Play Through Press') return null;
        if (c.v('goalKicks') === null && c.v('gkDistribution') === null) return undefined;
        const longKick = c.v('goalKicks') === 'Long' || ['Target Forward', 'Over Opposition Defence'].includes(c.v('gkDistribution'));
        return longKick ? { ev: [c.label('buildUpStrategy'), c.label('goalKicks'), c.label('gkDistribution')].filter(Boolean) } : null;
      }),
    R('D02', 'Rozehra', 'note', 'ODHAD', '1 zdroj',
      'Obejití presinku s krátkými výkopy',
      'Bypass Press míří na obejití presinku, krátké výkopy naopak lákají soupeře do presinku. Opak předchozí kombinace.',
      ['Goal Kicks → Mixed nebo Long, nebo Build-Up Strategy → Balanced'],
      (c) => {
        if (!need(c, 'buildUpStrategy', 'goalKicks')) return undefined;
        return c.v('buildUpStrategy') === 'Bypass Press' && c.v('goalKicks') === 'Short' ? { ev: [c.label('buildUpStrategy'), c.label('goalKicks')] } : null;
      }),
    R('D03', 'Rozehra', 'warn', 'KOMUNITA', '3 zdroje',
      'Rozehra od brankáře a technicky slabí stopeři',
      'Play Through Press, krátké výkopy a rozehra na stopery podle textů hry vyžadují technickou kvalitu. Komunitní práh je Passing, Composure a First Touch aspoň 13; chyba je až u 11 a méně.',
      ['Build-Up Strategy → Bypass Press, Goal Kicks → Mixed / Long', 'Nebo technicky lepší stopeři a nejhlubší záložník'],
      (c) => {
        const build = c.v('buildUpStrategy') === 'Play Through Press' || c.v('goalKicks') === 'Short' || c.v('gkDistribution') === 'Centre-Backs';
        if (c.v('buildUpStrategy') === null && c.v('goalKicks') === null && c.v('gkDistribution') === null) return undefined;
        const corridor = c.slots.filter((s) => s.grp === 'D (C)');
        const dm = c.slots.filter((s) => s.grp === 'DM');
        const list = corridor.concat(dm.slice(0, 1));
        const found = ['Passing', 'Composure', 'First Touch'].map((a) => ({ a, m: c.minAttr(list, a) })).filter((x) => x.m);
        if (!found.length) return undefined;
        if (!build) return null;
        const lim = 13 + c.shift;
        const worst = found.reduce((b, x) => (x.m.value < b.m.value ? x : b));
        const ev = [[c.label('buildUpStrategy'), c.label('goalKicks'), c.label('gkDistribution')].filter(Boolean).join(', '), ...found.map((x) => `nejnižší ${x.a}: ${x.m.value} (${x.m.slot.pos})`)];
        if (worst.m.value <= lim - 2) return { sev: 'error', ev, slots: [worst.m.slot.key] };
        if (worst.m.value < lim) return { sev: 'warn', ev, slots: [worst.m.slot.key] };
        return null;
      }),
    R('D06', 'Rozehra', 'note', 'ODHAD', '1 zdroj',
      'Role brankáře s míčem a bez míče si odporují',
      'Ball-Playing Goalkeeper riskuje s míčem, ale Line-Holding Keeper stojí na čáře; No-Nonsense Goalkeeper je opatrný, ale Sweeper Keeper je proaktivní. Ve hře se tyto dvojice v přednastaveních nevyskytují.',
      ['Ball-Playing Goalkeeper ↔ Sweeper Keeper (nebo Goalkeeper)', 'No-Nonsense Goalkeeper ↔ Line-Holding Keeper (nebo Goalkeeper)'],
      (c) => {
        const gk = c.slots.find((s) => s.grp === 'GK');
        if (!gk || !gk.roleIn || !gk.roleOut) return undefined;
        const bad = (gk.roleIn === 'Ball-Playing Goalkeeper' && gk.roleOut === 'Line-Holding Keeper') || (gk.roleIn === 'No-Nonsense Goalkeeper' && gk.roleOut === 'Sweeper Keeper');
        return bad ? { ev: [`${gk.roleIn} / ${gk.roleOut}`], slots: [gk.key] } : null;
      }),

    // -------- záloha
    R('E01', 'Záloha', 'note', 'KOMUNITA', '2 zdroje',
      'Ve středu chybí jedna z prací: držák, běžec nebo tvůrce',
      'Průvodci doporučují mít ve středu zálohy někde jednoho držáka, jednoho běžce a jednoho tvůrce. Pozor: samotná hra tohle splňuje jen u 22 z 90 přednastavených dvojic formací, takže jde o poznámku, ne chybu.',
      ['Změnit JEDNU roli ve středu na chybějící práci (tvůrce: Deep-Lying Playmaker / Advanced Playmaker; běžec: Box-To-Box Midfielder / Channel Midfielder; držák: Defensive Midfielder / Half Back)'],
      (c) => {
        let mids = c.slots.filter((s) => s.grp === 'DM' || s.grp === 'M (C)');
        if (mids.length === 2) mids = mids.concat(c.slots.filter((s) => s.grp === 'AM (C)'));
        if (mids.length < 3) return NA; // rozestavení bez trojice ve středu: pravidlo se na ně nevztahuje
        if (!mids.every((s) => s.roleIn)) return undefined;
        const has = (trait) => mids.some((s) => K.hasTrait(s.roleIn, trait));
        const miss = [!has('holder') && 'držák', !has('runner') && 'běžec', !has('creator') && 'tvůrce'].filter(Boolean);
        return miss.length ? { ev: [`střed: ${mids.map((s) => s.roleIn).join(', ')}`, `chybí: ${miss.join(', ')}`], slots: slotsOf(mids) } : null;
      }),
    R('E02', 'Záloha', 'warn', 'KOMUNITA', '1 zdroj',
      'Dvojice záložníků se dvěma stejnými pracemi',
      'Dva držáky bez tvůrce, dva tvůrci bez držáku nebo dva bloudící hráči ve stejném kanálu: nikdo netvoří, nebo je před stopery pás bez ochrany.',
      ['Jednu roli ve dvojici změnit na opačnou práci'],
      (c) => {
        const pair = c.slots.filter((s) => s.grp === 'DM' || s.grp === 'M (C)');
        if (pair.length !== 2) return NA; // jen pro dvojici záložníků
        if (!pair.every((s) => s.roleIn)) return undefined;
        const a = pair[0].roleIn;
        const b = pair[1].roleIn;
        const holders = pair.filter((s) => K.hasTrait(s.roleIn, 'holder'));
        const creators = pair.filter((s) => K.hasTrait(s.roleIn, 'creator'));
        const am = c.slots.filter((s) => s.grp === 'AM (C)');
        const amCreates = am.some((s) => s.roleIn && K.hasTrait(s.roleIn, 'creator'));
        if (holders.length === 2 && am.length && am.every((s) => s.roleIn) && !amCreates) return { ev: [`dva držáci: ${a}, ${b}`, 'před nimi nikdo netvoří'], slots: slotsOf(pair) };
        if (creators.length === 2 && !holders.length) return { ev: [`dva tvůrci: ${a}, ${b}`, 'žádný držák'], slots: slotsOf(pair) };
        return null;
      }),
    R('E03', 'Záloha', 'note', 'KOMUNITA', '2 zdroje',
      'Ve středu bez míče nikdo nečistí prostor',
      'Rozbor taktik uvádí jako častou slabinu, když ve středu bez míče není žádná clonící role (Screening Defensive Midfielder, Screening Central Midfielder, Dropping Defensive Midfielder). Hra sama má clonu jen u 36 z 90 přednastavení, proto jen poznámka.',
      ['Jednomu záložníkovi dát roli bez míče Screening Defensive Midfielder (nebo Screening Central Midfielder)'],
      (c) => {
        const mids = c.slots.filter((s) => s.grp === 'DM' || s.grp === 'M (C)');
        if (!mids.length || !mids.every((s) => s.roleOut)) return undefined;
        return mids.some((s) => K.hasTrait(s.roleOut, 'screening')) ? null : { ev: [`střed bez míče: ${mids.map((s) => s.roleOut).join(', ')}`], slots: slotsOf(mids) };
      }),

    // -------- boky
    R('F01', 'Boky', 'warn', 'KOMUNITA', '2 zdroje',
      'Dva hráči běhají po stejné lajně',
      'Dva hráči s rolí, která zůstává široko a běhá daleko dopředu, na jednom křídle po ztrátě míče nikoho nenechají vzadu; průvodci říkají „nikdy oba útočící v jednom kanálu“.',
      ['Jednoho z nich změnit na držící nebo vnitřní roli (Winger, Inside Winger, Inside Forward, Full-Back)', 'Nebo ponechat jen jeden přesah (Overlap)'],
      (c) => {
        const fl = c.flanks().filter((f) => f.known);
        if (!fl.length) return undefined;
        const hits = fl.map((f) => f.list.filter((s) => K.hasTrait(s.roleIn, 'runsWide'))).filter((run) => run.length >= 2);
        return hits.length ? { ev: hits.map((h) => h.map((s) => `${s.pos}: ${s.roleIn}`).join(' + ')), slots: hits.flatMap(slotsOf) } : null;
      }),
    R('F02', 'Boky', 'good', 'HRA', '3 zdroje',
      'Vnitřní křídelník s krajním obráncem u lajny',
      'Podle popisů rolí v samotné hře se Inside Winger a Inside Forward kombinují s útočným krajním obráncem, který drží lajnu: každý má vlastní prostor a vznikne prostor pro přesah.',
      [],
      (c) => {
        const fl = c.flanks().filter((f) => f.known);
        if (!fl.length) return undefined;
        const hits = [];
        for (const f of fl) {
          const inner = f.list.filter((s) => K.hasTrait(s.roleIn, 'innerWinger'));
          const back = f.list.filter((s) => K.hasTrait(s.roleIn, 'wideBack'));
          if (inner.length && back.length) hits.push(`${f.side === 'L' ? 'levé' : 'pravé'} křídlo: ${inner[0].roleIn} + ${back[0].roleIn}`);
        }
        return hits.length ? { ev: hits } : null;
      }),
    R('F04', 'Boky', 'warn', 'KOMUNITA', '2 zdroje',
      'Oba krajní obránci útočí za jediným defenzivním záložníkem',
      'Jeden záložník nepokryje obě strany: po ztrátě míče zůstanou vedle něj mezery.',
      ['Jednoho beka změnit na Full-Back, Holding Wing-Back nebo vnitřní roli', 'Nebo přidat druhého záložníka s obrannou prací'],
      (c) => {
        const backs = c.slots.filter((s) => s.grp === 'D (L/R)' || s.grp === 'WB (L/R)');
        const dm = c.slots.filter((s) => s.grp === 'DM');
        if (backs.length !== 2 || dm.length !== 1) return NA; // jen pro dva krajní obránce a jediného defenzivního záložníka
        if (!backs.every((s) => s.roleIn)) return undefined;
        return backs.every((s) => K.hasTrait(s.roleIn, 'attackingBack')) ? { ev: [`${backs[0].roleIn} + ${backs[1].roleIn}`, `před obranou jen ${dm[0].pos}`], slots: slotsOf(backs) } : null;
      }),
    R('F05', 'Boky', 'good', 'KOMUNITA', '2 zdroje',
      'Asymetrie na bocích',
      'Různé role vlevo a vpravo (přesah na jedné straně a podběh na druhé) se hůř čtou. Hra sama staví boky nesouměrně (krajní obránci v 76 % přednastavení).',
      [],
      (c) => {
        const L = c.flank('L');
        const R2 = c.flank('R');
        if (!L.length || !R2.length || !L.concat(R2).every((s) => s.roleIn)) return undefined;
        const a = L.map((s) => s.roleIn).sort().join('|');
        const b = R2.map((s) => s.roleIn).sort().join('|');
        return a !== b ? { ev: [`vlevo: ${L.map((s) => s.roleIn).join(', ')}`, `vpravo: ${R2.map((s) => s.roleIn).join(', ')}`] } : null;
      }),

    // -------- útočníci, stopeři, role bez míče
    R('G01', 'Útok', 'warn', 'KOMUNITA', '1–2 zdroje',
      'Dva útočníci se stejnou prací',
      'Dvě spojky, dva běžci nebo dva Target Forward: útok se izoluje, protože nikdo nedělá doplňující práci. Ve hře dvojice útočníků nikdy shodná není (24 z 24 přednastavení).',
      ['Jednu roli změnit: jeden spojuje (Deep-Lying Forward, False Nine), druhý běhá (Channel Forward, Poacher)'],
      (c) => {
        const st = c.slots.filter((s) => s.grp === 'ST (C)');
        if (st.length !== 2) return NA; // jen pro dva útočníky
        if (!st.every((s) => s.roleIn)) return undefined;
        const same = (t) => st.every((s) => K.hasTrait(s.roleIn, t));
        const target = st.every((s) => s.roleIn === 'Target Forward');
        return same('linkForward') || same('runnerForward') || target ? { ev: [`${st[0].roleIn} + ${st[1].roleIn}`], slots: slotsOf(st) } : null;
      }),
    R('G02', 'Útok', 'info', 'KOMUNITA', '1 zdroj',
      'Osamělý útočník bez spojky za sebou',
      'Jediný útočník bez hráče, který se mezi linie stahuje, je strukturálně v nevýhodě: stopeři ho zmáčknou.',
      ['Za útočníka dát spojku (Attacking Midfielder, Advanced Playmaker, Second Striker) nebo druhého útočníka'],
      (c) => {
        const st = c.slots.filter((s) => s.grp === 'ST (C)');
        if (st.length !== 1) return NA;
        const behind = c.slots.filter((s) => s.grp === 'AM (C)' || s.grp === 'M (C)');
        if (!behind.length || !behind.every((s) => s.roleIn)) return undefined;
        return behind.some((s) => K.hasTrait(s.roleIn, 'linkBehindStriker')) ? null : { ev: [`osamělý útočník ${st[0].pos}; za ním: ${behind.map((s) => s.roleIn).join(', ')}`], slots: slotsOf(st) };
      }),
    R('G03', 'Obrana', 'warn', 'KOMUNITA', '1 zdroj',
      'Dva stopeři s rolí Ball-Playing Centre-Back',
      'Jeden stoper má riskovat přihrávkou a druhý jistit; dva Ball-Playing Centre-Back se hodí jen při technicky zdatných stoperech, skutečném držáku před nimi a soupeři, který netlačí vysoko. Ve hře není tahle dvojice v žádném přednastavení.',
      ['Jednoho změnit na Centre-Back nebo No-Nonsense Centre-Back'],
      (c) => {
        const cb = c.slots.filter((s) => s.grp === 'D (C)');
        if (cb.length < 2) return NA;
        if (!cb.every((s) => s.roleIn)) return undefined;
        const bp = cb.filter((s) => s.roleIn === 'Ball-Playing Centre-Back');
        return bp.length >= 2 ? { ev: bp.map((s) => `${s.pos}: ${s.roleIn}`), slots: slotsOf(bp) } : null;
      }),
    R('G06', 'Obrana', 'warn', 'ODHAD', '2 zdroje',
      'Víc rolí Outlet, nebo Outlet s Counter-Pressem',
      'Outlet role zůstává vysoko a nebrání; víc než jedna znamená málo hráčů poblíž míče při zpětném presování. Ve hře je v přednastaveních nejvýš jeden Outlet.',
      ['Nechat nejvýš jednu až dvě Outlet role (ke kontře: Counter-Attack, More Direct)', 'Nebo Defensive Transition → Regroup'],
      (c) => {
        const out = c.slots.filter((s) => s.roleOut && K.hasTrait(s.roleOut, 'outlet'));
        const known = c.outfield.every((s) => s.roleOut);
        if (!out.length && !known) return undefined;
        if (out.length >= 2) return { ev: out.map((s) => `${s.pos}: ${s.roleOut}`), slots: slotsOf(out) };
        if (out.length === 1 && c.v('defensiveTransition') === 'Counter-Press') return { ev: [`${out[0].pos}: ${out[0].roleOut}`, c.label('defensiveTransition')], slots: slotsOf(out) };
        return null;
      }),
    R('G07', 'Obrana', 'note', 'HRA', '2 zdroje',
      'Týmový Trigger Press proti rolím, které jej mají pevně',
      'Role bez míče Pressing a Stopping mají Trigger Press More Often zamčený přímo v roli a týmové nastavení u svého hráče přebíjejí; tým „čeká“, jediný hráč běží.',
      ['Sladit týmový Trigger Press s převládající rolí, nebo vybrat Holding / Covering role'],
      (c) => {
        if (!need(c, 'triggerPress')) return undefined;
        if (c.step('triggerPress') > 1) return null;
        const pr = c.slots.filter((s) => s.roleOut && K.hasTrait(s.roleOut, 'pressing'));
        return pr.length ? { ev: [c.label('triggerPress'), ...evRoles(pr, 'out')], slots: slotsOf(pr) } : null;
      }),
    R('H01', 'Mentalita', 'warn', 'ODHAD', '1 zdroj',
      'Opatrná mentalita, ale víc hráčů zůstává vysoko',
      'Při opatrné mentalitě a nízké linii přebíjí pevné chování rolí (Outlet role zůstávají vysoko, role s Make More Runs běhají dopředu) týmové nastavení u svého hráče; vznikne díra mezi řadami.',
      ['Mentalitu neměnit, změnit role: nejvýš jednoho hráče s Outlet rolí nebo s rolí Wing-Back / Advanced Wing-Back / Wide Forward'],
      (c) => {
        if (!c.mentality) return undefined;
        if (!['Very Defensive', 'Defensive', 'Cautious'].includes(c.mentality)) return null;
        if (c.step('defensiveLine') === null || c.step('defensiveLine') > 1) return undefined;
        const outl = c.slots.filter((s) => s.roleOut && K.hasTrait(s.roleOut, 'outlet'));
        const run = c.slots.filter((s) => s.roleIn && K.hasTrait(s.roleIn, 'runsWide'));
        const n = outl.length + run.length;
        return n >= 2 ? { ev: [`mentalita ${c.mentality}`, c.label('defensiveLine'), ...evRoles(outl, 'out'), ...evRoles(run, 'in')], slots: slotsOf(outl.concat(run)) } : null;
      }),
  ];

  const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

  // ---------------------------------------------------------------- rozbor
  /** analyze(tactic, opts) → rozbor taktiky. opts: {players: [hráči s atributy], attrShift: číslo (prahy atributů se posunou)}. */
  function analyze(tactic, opts) {
    if (!isObj(tactic)) throw new TypeError('analyze: chybí taktika');
    const c = buildContext(tactic, opts);
    const findings = [];
    const notEvaluated = [];
    let passed = 0;
    let notApplicable = 0;
    for (const rule of RULES) {
      let r;
      try {
        r = rule.test(c);
      } catch (e) {
        throw new Error(`Pravidlo ${rule.id}: ${e && e.message ? e.message : e}`);
      }
      if (r === undefined) notEvaluated.push({ id: rule.id, title: rule.title });
      else if (r === NA) notApplicable++;
      else if (r === null) passed++;
      else
        findings.push({
          id: rule.id,
          area: rule.area,
          sev: r.sev || rule.sev,
          kind: (r.sev || rule.sev) === 'good' ? 'strength' : 'finding',
          title: rule.title,
          why: rule.why,
          fix: rule.fix.slice(),
          ev: (r.ev || []).filter(Boolean),
          slots: r.slots || [],
          basis: rule.basis,
          basisCs: BASIS_CS[rule.basis],
          agree: rule.agree,
        });
    }
    const order = (f) => SEV_RANK[f.sev];
    findings.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
    const settings = [...c.team.values()].map((t) => ({ id: t.id, name: t.name, phase: t.phase, value: t.value, isDefault: K.TEAM_BY_ID.get(t.id).default === t.value }));
    const placed = c.slots.filter((s) => s.grp);
    const rolesKnown = (phase) => placed.filter((s) => (phase === 'out' ? s.roleOut : s.roleIn)).length;
    const nonDefault = settings.filter((s) => !s.isDefault).length;
    const evaluated = RULES.length - notEvaluated.length - notApplicable;
    const fired = findings.filter((f) => f.kind === 'finding').length;
    return {
      version: VERSION,
      formation: tactic.formation || null,
      mentality: c.mentality,
      settings,
      unknownSettings: c.unknownSettings,
      coverage: {
        settingsKnown: settings.filter((x) => !K.THIRD_PARTY_ONLY.includes(x.id)).length,
        settingsTotal: K.GAME_INSTRUCTION_COUNT,
        rolesIn: { known: rolesKnown('in'), total: placed.length },
        rolesOut: { known: rolesKnown('out'), total: placed.length },
        withAttributes: c.slots.filter((s) => s.attrs).length,
        slotsTotal: c.slots.length,
      },
      findings: findings.filter((f) => f.kind === 'finding'),
      strengths: findings.filter((f) => f.kind === 'strength'),
      checks: { total: RULES.length, evaluated, passed, fired, notApplicable, notEvaluated },
      complexity: { nonDefaultInstructions: nonDefault, level: nonDefault >= 12 ? 'vysoká' : nonDefault >= 7 ? 'střední' : 'nízká' },
      note: 'Rozbor hledá rozpory v nastavení a chybějící práci rolí. Je to pomůcka podle komunitních průvodců a textů hry, ne pravidlo FM27 a ne předpověď výsledku zápasu.',
    };
  }

  /** Souhrn jako řádky textu (kopírování, kontext pro Osobního trenéra). */
  function summaryLines(result) {
    const lines = [];
    const cov = result.coverage;
    lines.push(`Rozbor taktiky ${result.formation || '?'}: mentalita ${result.mentality || 'nepřečtena'}, instrukcí rozpoznáno ${cov.settingsKnown} z ${cov.settingsTotal}, rolí s míčem ${cov.rolesIn.known}/${cov.rolesIn.total}, bez míče ${cov.rolesOut.known}/${cov.rolesOut.total}.`);
    for (const f of result.findings) lines.push(`${SEV_CS[f.sev]} [${f.id}] ${f.title}: ${f.ev.join('; ')}. Změna: ${f.fix.join(' / ')}`);
    for (const f of result.strengths) lines.push(`Silná stránka [${f.id}] ${f.title}: ${f.ev.join('; ')}`);
    lines.push(`Kontroly: vyhodnoceno ${result.checks.evaluated} z ${result.checks.total} (bez nálezu ${result.checks.passed}, nález ${result.checks.fired}), na tohle rozestavení se nevztahuje ${result.checks.notApplicable}, nevyhodnoceno kvůli chybějícím údajům ${result.checks.notEvaluated.length}.`);
    return lines;
  }

  return { VERSION, RULES, RULE_BY_ID, SEV_CS, BASIS_CS, NA, buildContext, analyze, summaryLines };
});
