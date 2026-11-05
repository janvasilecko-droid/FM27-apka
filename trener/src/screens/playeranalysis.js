/* Rozbor hráče (šuplík u hráče v Můj tým): jak se hráč hodí na role, které aplikace zná (profily rolí), nejlepší a nejhorší role, silné stránky a mezery u nejlepší role,
   pořadí v týmu a vhodnost na místa v aktivní taktice. Výpočet je v dwrs.js a squadopt.js; tady je jen obrazovka.
   Poctivost: číslo je DWRS, tedy odhad aplikace (ESTIMATED), ne pravidlo FM27, a vždy se píše podle jakého profilu vah vzniklo. Chybí-li hráči atribut, role se nehodnotí
   (nedostupné), nikdy nula. Skupinu pozic role aplikace zjistí z nastavení u role, z použití v taktikách nebo z anglického názvu; kde to nejde, role se nehodnotí a říká proč.
   Skryté údaje hry (CA, PA, osobnost) se nepoužívají. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const ui = FM27.ui;
  const { h } = ui;
  const fmt = (v) => String(v).replace('.', ',');
  const h3 = (text) => h('h3', { text, style: 'margin-top:16px' });
  const LEVEL_CS = { key: 'klíčový', pref: 'žádoucí', other: 'ostatní' };
  const SOURCE_CS = { explicit: 'skupina nastavená u role', tactic: 'podle použití v taktikách', name: 'odhad z názvu role' };

  function analysis(app, p) {
    const DW = window.TrenerDwrs;
    const SO = window.TrenerSquadOpt;
    const RF = window.TrenerRoleFit;
    const W = FM27.weightsUI;
    const wp = W ? W.activeProfile(app) : DW.defaultProfile();
    const profiles = app.store.list('roleprofile');
    const tactics = FM27.context.tactics(app);
    const groups = SO.inferRoleGroups(profiles, tactics.map((t) => t.slots || []));
    const groupInfo = (name) => groups.get(RF.roleKey(name)) || { group: null, source: null };
    const player = { id: p.id, name: p.name, positions: p.positions || [], attributes: p.attributes || {} };
    const attrCount = Object.keys(player.attributes).length;
    const an = DW.analyzePlayer(player, SO.withGroups(profiles, groups), wp, {});
    const box = h('div', { id: 'playerAnalysis' });
    box.append(
      h('p', { class: 'hint', id: 'paNote', text: `Rozbor podle DWRS: odhad aplikace (ESTIMATED), ne pravidlo FM27. Profil vah „${wp.name}“ (změníš ho v Nastavení → Hodnocení hráčů). Skryté údaje hry se nepoužívají.` }),
      h('p', { class: 'hint', text: [(p.positions || []).join('/') || 'pozice neuvedena', p.age ? `věk ${p.age}` : null, `${attrCount} ${ui.plural(attrCount, 'atribut', 'atributy', 'atributů')}`, p.flags && p.flags.injury ? 'zraněný' : null].filter(Boolean).join(' · ') })
    );
    if (!profiles.length) return (box.append(h('p', { class: 'banner warn', id: 'paNoRoles', text: 'Zatím není žádný profil role, takže není co hodnotit. Role se čtou z obrazovky hry nebo zadávají ručně v Moje taktiky → Profily rolí.' })), box);
    if (!attrCount) return (box.append(h('p', { class: 'banner warn', id: 'paNoAttrs', text: 'Hráč nemá žádné atributy. Doplň je v úpravě hráče nebo je načti z exportu či ze screenshotu; bez nich se nic nedá hodnotit.' })), box);
    if (!an.roles.length) box.append(h('p', { class: 'banner warn', id: 'paNoScore', text: 'Žádnou roli se nepodařilo ohodnotit (viz důvody níže).' }));

    const roleItem = (r) => {
      const gi = groupInfo(r.role);
      return h('li', { 'data-role': r.role },
        h('b', { text: `${r.role}${r.duty ? ' (' + r.duty + ')' : ''}` }), ` ${fmt(r.score)}${r.partial ? ' (částečná data)' : ''} `,
        h('span', { class: 'hint', text: `skupina: ${DW.GROUP_CS[r.group]}${gi.source ? ' (' + SOURCE_CS[gi.source] + ')' : ''}` }),
        r.relevant ? null : [' ', h('span', { class: 'chip c-warn', text: 'mimo jeho pozice' })]);
    };
    if (an.best.length) {
      box.append(h3('Nejlepší role'), h('ol', { class: 'list', id: 'paBest' }, an.best.map(roleItem)));
      const top = an.best[0];
      const sg = DW.strengthsGaps(top.result.contributions, 3);
      const li = (x) => h('li', { text: `${x.attribute} ${x.value}${x.level ? ` (v roli ${LEVEL_CS[x.level] || x.level}${x.tier ? ', ' + DW.TIER_CS[x.tier] : ''})` : ''}` });
      box.append(
        h3(`Silné stránky a mezery u role „${top.role}“`),
        sg.strengths.length ? h('div', null, h('b', { text: 'Silné stránky' }), h('ul', { class: 'list', id: 'paStrengths' }, sg.strengths.map(li))) : h('p', { class: 'hint', id: 'paStrengths', text: 'Žádný atribut s váhou nemá hodnotu 12 nebo víc.' }),
        sg.gaps.length ? h('div', null, h('b', { text: 'Mezery' }), h('ul', { class: 'list', id: 'paGaps' }, sg.gaps.map(li))) : h('p', { class: 'hint', id: 'paGaps', text: 'Žádný důležitý atribut nemá hodnotu 9 nebo méně.' }),
        h('details', { class: 'flow-table', id: 'paBreakdown' }, h('summary', { text: `Z čeho se počítá „${top.role}“` }),
          h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Atribut', 'Kategorie', 'V roli', 'Hodnota', 'Váha', 'Body'].map((t) => h('th', { text: t })))),
            h('tbody', null, top.result.contributions.map((c) => h('tr', null, h('td', { text: c.attribute }), h('td', { text: DW.TIER_CS[c.tier] || c.tier }), h('td', { text: LEVEL_CS[c.level] || c.level }), h('td', { text: String(c.value) }), h('td', { text: fmt(Math.round(c.weight * 1000) / 1000) }), h('td', { text: fmt(Math.round(c.points * 100) / 100) })))))),
        // pořadí v týmu na nejlepší roli
        (() => {
          const squad = FM27.context.players(app).map((x) => ({ id: x.id, name: x.name, positions: x.positions || [], attributes: x.attributes || {}, injured: !!(x.flags && x.flags.injury) }));
          const prof = profiles.find((x) => RF.roleKey(x.name) === RF.roleKey(top.role));
          const rows = SO.rankForRole({ players: squad, profile: prof, slotPos: '', group: top.group }, { model: 'dwrs', wp, mode: 'free' });
          const ranked = rows.filter((x) => x.fit !== null);
          const me = rows.find((x) => x.id === p.id);
          if (!me || me.rank === null) return null;
          const lead = ranked[0];
          return h('div', null,
            h3('Pořadí v týmu'),
            h('p', { id: 'paRank', 'data-rank': String(me.rank), text: `Na roli „${top.role}“ je ${me.rank}. z ${ranked.length} hodnotitelných hráčů${lead && lead.id !== p.id ? `; nejlepší je ${lead.name} (${fmt(lead.fit)})` : ' a nejlepší v týmu'}. Pozice hráčů se tu nehlídají, jen atributy.` }));
        })()
      );
    }
    if (an.worst.length) box.append(h3('Nejhorší role (z těch, které na jeho pozicích dávají smysl)'), h('ol', { class: 'list', id: 'paWorst' }, an.worst.map(roleItem)));
    if (an.unavailable.length) {
      box.append(h('details', { class: 'flow-table', id: 'paUnavailable' }, h('summary', { text: `Role bez hodnocení (${an.unavailable.length})` }), h('ul', { class: 'list' }, an.unavailable.map((u) => h('li', { 'data-role': u.role, text: `${u.role}: ${u.reason}` })))));
    }
    // vhodnost na místa v aktivní taktice
    const tactic = FM27.context.activeTactic(app);
    if (tactic) {
      const input = { slots: (tactic.slots || []).map((s) => ({ key: s.key, pos: s.pos, role: s.role, duty: s.duty })), players: [player], profiles };
      const fits = SO.playerSlotFits(input, { model: 'dwrs', wp, mode: 'strict' }, p.id);
      const ok = fits.filter((f) => f.fit !== null).sort((a, b) => b.fit - a.fit);
      const nope = fits.filter((f) => f.fit === null && f.eligible === false);
      box.append(
        h3(`Vhodnost na místa v taktice „${tactic.name}“`),
        ok.length
          ? h('ol', { class: 'list', id: 'paTactic' }, ok.map((f) => h('li', { 'data-slot': f.slotKey, text: `${f.pos} · ${f.role}: ${fmt(f.fit)}${f.partial ? ' (částečná data)' : ''}${f.flag ? ` (${f.flag})` : ''}` })))
          : h('p', { class: 'hint', id: 'paTactic', text: 'Na žádné místo s rolí v téhle taktice se hráč nedá ohodnotit (jiná pozice, chybí profil role nebo atributy).' }),
        nope.length ? h('p', { class: 'hint', text: `Na ${nope.length} ${ui.plural(nope.length, 'místě', 'místech', 'místech')} nemá hráč pozici (ale jen podle zadaných pozic).` }) : null
      );
    }
    return box;
  }

  function open(app, p) {
    ui.openDrawer(`Rozbor hráče: ${p.name}`, [analysis(app, p)]);
  }

  FM27.playerAnalysis = { open, analysis };
})();
