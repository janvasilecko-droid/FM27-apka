/* Kontext kariéry pro trenéra: soupiska, aktivní taktika a paměť z minulých zápasů se převedou na pozorování,
   aby je poradce, soupeř i rozbor zápasu uměli citovat. Zadání § 5: AI musí poznat, že rada pro jeden tým
   nemusí platit pro tým s jinými hráči.

   Poctivost: soupisku a taktiku zadal uživatel (štítek user_entered). Paměť z minulých zápasů je odvozená (heuristic_coach,
   tedy odhad), protože její text psal model a uživatel ho jen schválil. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const C = window.TrenerCore;

  const MAX_LESSONS = 40;
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function players(app) {
    const career = app.career();
    if (!career) return [];
    return app.store.list('player', (p) => p.careerId === career.id).sort((a, b) => String(a.name).localeCompare(String(b.name), 'cs'));
  }
  function tactics(app) {
    const career = app.career();
    if (!career) return [];
    return app.store.list('tactic', (t) => t.careerId === career.id).sort((a, b) => (a.kind === 'primary' ? -1 : 1) - (b.kind === 'primary' ? -1 : 1) || String(a.name).localeCompare(String(b.name), 'cs'));
  }
  function activeTactic(app) {
    const career = app.career();
    if (!career) return null;
    const all = tactics(app);
    return all.find((t) => t.id === career.activeTacticId) || all.find((t) => t.kind === 'primary') || all[0] || null;
  }

  // Soupiska i taktika jsou pozorování na jednom řádku (položky odděluje středník). Texty zadané uživatelem (jména, role,
  // poznámky) se zploští po jednom, takže žádný z nich nemůže do promptu vnést nový řádek ani sloupec.
  const one = (v, n) => C.oneLine(v, n || 80);

  function playerLine(p) {
    const attrs = Object.entries(p.attributes || {})
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${one(k, 40)} ${one(v, 20)}`)
      .slice(0, 8)
      .join(', ');
    const flags = [p.flags && p.flags.injury ? 'zraněný' : '', p.flags && p.flags.fatigue ? 'unavený' : ''].filter(Boolean).join(', ');
    const bits = [
      (p.positions || []).map((x) => one(x, 12)).join('/') || '?',
      `role ${one(p.role, 60) || '?'}${p.duty ? ' (' + one(p.duty, 40) + ')' : ''}`,
      p.age ? `věk ${one(p.age, 4)}` : '',
      attrs ? `atributy: ${attrs}` : '',
      p.strengths && p.strengths.length ? `silné: ${p.strengths.map((x) => one(x, 40)).join(', ')}` : '',
      p.weaknesses && p.weaknesses.length ? `slabé: ${p.weaknesses.map((x) => one(x, 40)).join(', ')}` : '',
      flags,
    ].filter(Boolean);
    return clip(`${one(p.name, 60)} [${bits.join(', ')}]`, 260);
  }

  function tacticText(app, t) {
    const byId = new Map(players(app).map((p) => [p.id, p]));
    const parts = [`Taktika „${one(t.name, 80)}“ (${t.kind === 'primary' ? 'hlavní' : 'alternativní'}), formace ${one(t.formation, 20)}${t.mentality ? ', mentalita: ' + one(t.mentality, 80) : ''}.`];
    if (t.teamInstructions && t.teamInstructions.length) parts.push('Týmové instrukce: ' + t.teamInstructions.map((x) => one(x, 80)).join('; ') + '.');
    const slots = (t.slots || []).map((s) => {
      const p = s.playerId ? byId.get(s.playerId) : null;
      return `${one(s.pos, 10)}${p ? ' ' + one(p.name, 60) : ' (nikdo)'} [role ${one(s.role, 60) || '?'}${s.duty ? ' (' + one(s.duty, 40) + ')' : ''}, x=${Math.round(s.x)}, y=${Math.round(s.y)}]`;
    });
    if (slots.length) parts.push('Sloty: ' + slots.join('; ') + '.');
    return parts.join(' ');
  }

  const ctx = (FM27.context = {
    players,
    tactics,
    activeTactic,
    MAX_LESSONS,

    // ---------------------------------------------------------------- paměť kariéry
    memory(app) {
      const career = app.career();
      if (!career) return { id: null, careerId: null, lessons: [] };
      return app.store.get('memory', career.id) || { id: career.id, careerId: career.id, lessons: [] };
    },
    async addLesson(app, text, source, matchId) {
      const career = app.career();
      if (!career) throw new Error('Nejdřív založ kariéru.');
      const mem = app.store.draft(ctx.memory(app));
      const t = String(text || '').trim().slice(0, 400);
      if (t.length < 8) throw new Error('Poznámka je příliš krátká.');
      if (mem.lessons.some((l) => l.text === t)) return mem;
      mem.lessons.push({ id: C.makeId(6), at: Date.now(), text: t, source: source || 'user', matchId: matchId || null });
      while (mem.lessons.length > MAX_LESSONS) mem.lessons.shift();
      return app.store.put('memory', mem);
    },
    async removeLesson(app, lessonId) {
      const mem = app.store.draft(ctx.memory(app));
      mem.lessons = mem.lessons.filter((l) => l.id !== lessonId);
      return app.store.put('memory', mem);
    },

    // ---------------------------------------------------------------- pozorování pro AI
    /** Pozorování popisující kariéru; ids jsou stabilní, aby se na ně rada mohla odkázat. */
    observations(app, opts) {
      const o = Object.assign({ squad: true, tactic: true, memory: true }, opts);
      const career = app.career();
      if (!career) return [];
      const out = [];
      out.push({ id: 'career', label: 'user_entered', minute: null, text: `Kariéra: ${career.club}${career.competition ? ', soutěž ' + career.competition : ''}${career.season ? ', sezóna ' + career.season : ''}.` });
      const team = players(app);
      if (o.squad && team.length) {
        const text = `Soupiska (zadal uživatel, ${team.length} hráčů): ` + team.slice(0, 30).map(playerLine).join('; ') + '.';
        out.push({ id: 'squad', label: 'user_entered', minute: null, text: clip(text, 4200) });
      }
      const t = activeTactic(app);
      if (o.tactic && t) out.push({ id: 'tactic', label: 'user_entered', minute: null, text: clip(tacticText(app, t), 3200) });
      // vhodnost hráčů na role: jen když ji uživatel v téhle relaci spočítal; je to heuristika a tak je i označená
      if (o.tactic && t && FM27.rolefitUI) {
        const fit = FM27.rolefitUI.observationFor(t.id);
        if (fit) out.push(fit);
      }
      if (o.memory) {
        const lessons = ctx.memory(app).lessons.slice(-12);
        lessons.forEach((l, i) => out.push({ id: `mem-${i + 1}`, label: 'heuristic_coach', minute: null, text: `Zkušenost z dřívějška (${new Date(l.at).toLocaleDateString('cs-CZ')}): ${l.text}` }));
      }
      return out;
    },

    /** Jednořádkový popis pro obrazovky: co trenér o kariéře ví. */
    describe(app) {
      const career = app.career();
      if (!career) return 'Bez kariéry trenér nezná tvůj tým ani taktiku.';
      const n = players(app).length;
      const t = activeTactic(app);
      const m = ctx.memory(app).lessons.length;
      const parts = [`Kariéra: ${career.club}`, n ? `soupiska: ${n} ${n === 1 ? 'hráč' : n < 5 ? 'hráči' : 'hráčů'}` : 'soupiska zatím prázdná', t ? `taktika: ${t.name} (${t.formation})` : 'žádná taktika'];
      if (m) parts.push(`paměť: ${m} ${m === 1 ? 'poznámka' : m < 5 ? 'poznámky' : 'poznámek'}`);
      return parts.join(' · ') + '.';
    },
  });
})();
