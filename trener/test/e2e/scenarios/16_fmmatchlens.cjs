/* Scénář 16: ŽIVÁ DATA A SESTAVA Z FMMatchLens (zásuvný modul do hry, lokální adresa 127.0.0.1:16726). Samostatná verze volá jen tento počítač,
   z odpovědí skládá časovou osu zápasu bez volání AI, hlídá poctivost (údaje jsou „zadal uživatel“, skryté údaje hry se nečtou, cizí adresa se
   odmítne) a umí se zotavit z chyb. Co se zkouší: celá cesta od zkoušky spojení po snímky na časové ose a načtení sestavy.
   Co se NEzkouší: skutečný plugin ani skutečná hra. Plugin zde zastupuje náhražka, jejíž odpovědi mají tvar podle zdrojového kódu pluginu
   (verze 0.7.x). Jestli skutečná hra posílá totéž, a jestli prohlížeč stránce z internetu dovolí volat tento počítač, ukáže až skutečné prostředí. */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'Content-Type' };
const INT_KEYS = ['goals', 'shots', 'shotsOnTarget', 'shotsOffTarget', 'blockedShots', 'clearCutChances', 'passes', 'passesCompleted', 'crosses', 'crossesCompleted', 'aerials', 'aerialsWon', 'progressivePasses', 'finalThirdPasses', 'tacklesAttempted', 'tacklesWon', 'fouls', 'corners', 'offsides', 'yellowCards', 'redCards', 'firstHalfShots', 'secondHalfShots'];
const team = (over) => Object.assign(Object.fromEntries(INT_KEYS.map((k) => [k, 0])), { xg: 0, possessionTime: 0 }, over);

module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, nav, text } = h;
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 10000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 40));
    }
    return fn();
  };

  // ------------------------------------------------------------------ náhražka pluginu
  const plugin = { online: true, name: 'FMMatchLens', inMatch: false, matchId: 'zapas-1', minute: 30, home: { goals: 0, xg: 0.4, possessionTime: 600, shots: 3, shotsOnTarget: 1, passes: 100, passesCompleted: 80, tacklesWon: 3, fouls: 2, corners: 1, offsides: 0, redCards: 0 }, away: { goals: 0, xg: 0.2, possessionTime: 400, shots: 2, shotsOnTarget: 1, passes: 70, passesCompleted: 50, tacklesWon: 5, fouls: 3, corners: 0, offsides: 1, redCards: 0 }, period: 1, evil: false, hits: [] };
  const framePlayers = () => [
    { slot: 0, playerId: 91000, team: 'home', isBallHolder: false, x: 1, y: 2, rating: 7.1, isSubstitute: false, isOnPitch: true, savesHeld: 0, savesParried: 0, savesTipped: 0, goals: 0, assists: 0, ratingInputs: { statsPacked: 'AAAA' } },
    { slot: 1, playerId: 91001, team: 'home', rating: 6.4, isSubstitute: false, isOnPitch: true, savesHeld: 2, savesParried: 0, savesTipped: 0, goals: 0, assists: 0 },
    { slot: 2, playerId: 91002, team: 'home', rating: 0, isSubstitute: true, isOnPitch: false, savesHeld: 0, savesParried: 0, savesTipped: 0, goals: 0, assists: 0 },
    { slot: 20, playerId: 92000, team: 'away', rating: 7.9, isSubstitute: false, isOnPitch: true, savesHeld: 1, savesParried: 0, savesTipped: 0, goals: 0, assists: 0 },
  ];
  const metaBody = () => ({
    matchId: plugin.matchId,
    home: { uid: 1, clubUid: 11, name: plugin.evil ? '<img src=x onerror="window.__pwned=1">Chelsea' : 'Chelsea', manager: { firstName: 'Jan', secondName: 'Novák', isHumanControlled: true } },
    away: { uid: 2, clubUid: 22, name: 'Arsenal', manager: { firstName: 'Mikel', secondName: 'Arteta', isHumanControlled: false } },
    competition: { name: 'Premier League' },
    players: [
      { slot: 0, playerId: 91000, uid: 91000, team: 'home', shirtNumber: 9, position: 'ST', displayName: plugin.evil ? '<script>window.__pwned=2</script>Jan Novák' : 'Jan Novák', profile: { currentAbility: 9876, potentialAbility: 8765, weeklyWage: 123456 }, attributes: { technical: { Finishing: 16, Passing: 11 }, mental: { Vision: 12, Consistency: 17, 'Important Matches': 15 }, physical: { Pace: 15 }, goalkeeping: { Reflexes: 3 } }, inPossession: { position: 'ST', role: 'Advanced Forward', roleAbbreviation: 'AF', duty: 'Attack' }, outOfPossession: { position: 'ST', role: 'Central Defender', duty: 'Defend' } },
      { slot: 1, playerId: 91001, team: 'home', shirtNumber: 1, position: 'GK', displayName: 'Petr Brankář', attributes: { goalkeeping: { Reflexes: 15, Handling: 14 } }, inPossession: { position: 'GK', role: 'Sweeper Keeper', duty: 'Support' } },
      { slot: 2, playerId: 91002, team: 'home', shirtNumber: 14, position: 'MC', displayName: 'Karel Lavička', attributes: { technical: { Passing: 13 } } },
      { slot: 20, playerId: 92000, team: 'away', shirtNumber: 7, position: 'AMR', displayName: 'Bukayo Saka' },
    ],
  });
  const frameBody = () => ({
    sequence: 1,
    matchId: plugin.matchId,
    tick: plugin.minute * 240,
    displayTick: plugin.minute * 240 + 40,
    period: plugin.period,
    possessionTeam: 'home',
    home: team(plugin.home),
    away: team(plugin.away),
    players: framePlayers(),
    ratingModel: { activeBaseline: 600 },
  });
  const handler = (route) => {
    const u = new URL(route.request().url());
    plugin.hits.push(u.pathname);
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (!plugin.online) return route.abort('connectionrefused');
    const json = (body, status) => route.fulfill({ status: status || 200, headers: CORS, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
    if (u.pathname === '/api/health') return json({ status: plugin.inMatch ? 'live' : 'waiting', name: plugin.name, pluginVersion: '0.7.1', game: 'Football Manager 27', gameVersion: '27.0.0', inMatch: plugin.inMatch, tick: plugin.minute * 240, frameCount: 10 });
    if (!plugin.inMatch) return json(null);
    if (u.pathname === '/api/match/meta') return json(metaBody());
    if (u.pathname === '/api/match/current') return json(frameBody());
    return json({ error: 'Not found' }, 404);
  };
  const set = (patch) => Object.assign(plugin, patch);
  const hits = (p) => plugin.hits.filter((x) => x === p).length;

  const c = await newContext(browser, { standalone: true });
  const page = c.page;
  await c.context.route('http://127.0.0.1:16726/**', handler);
  const snaps = () => page.evaluate(() => { const m = window.FM27.live.match(window.FM27.app); return m ? m.timeline.map((s) => ({ minute: s.minute, score: s.score, provenance: s.provenance, via: s.via, stats: s.stats, players: s.players, teams: s.teams, notes: s.notes, screen: s.screen })) : []; });
  const feedStatus = () => text(page, '#feedStatus');

  await open(page, 'live');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#feedCard');
  await page.evaluate(() => { window.FM27.feed.timing.live = 150; window.FM27.feed.timing.wait = 150; window.FM27.feed.timing.error = 200; });

  // ====================================================== A) před zápasem: zkouška spojení a poctivost
  const card = await text(page, '#feedCard');
  check('16 karta FMMatchLens je v Live Coachi před zápasem a říká, co to je, že je to neověřeno a že skryté údaje se nečtou', /FMMatchLens/.test(card) && /licence MIT/.test(card) && /Neověřeno na skutečné hře/.test(card) && /Skryté údaje hry/.test(card) && /bez volání AI/.test(card), card.slice(0, 200));
  set({ online: false });
  await page.click('#feedProbe');
  await until(async () => /Spojení nevyšlo/.test(await feedStatus()));
  check('16 když plugin neodpovídá, aplikace to řekne a dá kontrolní seznam (hra, adresa, povolení prohlížeče)', /Spojení nevyšlo/.test(await feedStatus()) && /Zkontroluj/.test(await text(page, '#feedLines')) && /nainstalovaný/.test(await text(page, '#feedLines')), await text(page, '#feedLines'));
  await page.fill('#feedUrl', 'http://example.com:16726');
  await page.dispatchEvent('#feedUrl', 'change');
  await page.click('#feedProbe');
  await until(async () => /Adresa musí být na tomto počítači/.test(await text(page, '#feedLines')));
  check('16 cizí adresa se odmítne ještě před voláním a nic se na ni nepošle', /Adresa musí být na tomto počítači/.test(await text(page, '#feedLines')) && !c.problems.failed.some((u) => /example\.com/.test(u)), c.problems.failed.filter((u) => /example/.test(u)));
  await page.fill('#feedUrl', 'http://192.168.1.20:16726');
  await page.dispatchEvent('#feedUrl', 'change');
  await page.click('#feedProbe');
  await until(async () => /Adresa musí být na tomto počítači/.test(await text(page, '#feedLines')));
  check('16 adresa v místní síti se také odmítne (jen tento počítač)', /Adresa musí být na tomto počítači/.test(await text(page, '#feedLines')) && !c.problems.failed.some((u) => /192\.168/.test(u)));
  await page.fill('#feedUrl', '');
  await page.dispatchEvent('#feedUrl', 'change');

  set({ online: true, name: 'Něco jiného', inMatch: false });
  await page.click('#feedProbe');
  await until(async () => /něco jiného než FMMatchLens/.test(await text(page, '#feedLines')));
  check('16 když na adrese odpovídá jiná služba, aplikace její odpověď nepoužije', /něco jiného než FMMatchLens/.test(await text(page, '#feedLines')) && (await page.locator('#feedBegin').count()) === 1);

  set({ name: 'FMMatchLens', inMatch: false });
  await page.click('#feedProbe');
  await until(async () => /plugin zápas zatím nehlásí/.test(await feedStatus()));
  check('16 plugin běží, ale zápas se nehraje: aplikace to řekne', /plugin zápas zatím nehlásí/.test(await feedStatus()) && /FMMatchLens 0\.7\.1 odpovídá/.test(await text(page, '#feedLines')), await text(page, '#feedLines'));
  await page.click('#feedBegin');
  await until(async () => /žádný zápas nehlásí/.test(await feedStatus()));
  check('16 bez zápasu v pluginu se zápas v aplikaci nezačne', /žádný zápas nehlásí/.test(await feedStatus()) && (await page.locator('#liveHeader').count()) === 0 && (await snaps()).length === 0);

  // ====================================================== B) zápas z pluginu
  const aiBefore = await page.evaluate(() => window.__mock.calls.length);
  set({ inMatch: true, minute: 30 });
  await page.click('#feedProbe');
  await until(async () => /Chelsea – Arsenal/.test(await text(page, '#feedLines')));
  check('16 diagnostika ukáže zápas, soutěž, počet hráčů a tvůj tým podle hry', /Chelsea – Arsenal \(Premier League\)/.test(await text(page, '#feedLines')) && /tvůj tým podle hry: domácí/.test(await text(page, '#feedLines')) && /30\. minuta/.test(await text(page, '#feedLines')), await text(page, '#feedLines'));
  await page.click('#feedBegin');
  await page.waitForSelector('#liveHeader');
  check('16 zápas vznikl z dat pluginu: soupeř, soutěž a strana', /Chelsea – Arsenal/.test(await text(page, '#liveHeader')) && /Hraješ za domácí/.test(await text(page, '#liveScore')), await text(page, '#liveHeader'));
  await until(async () => (await snaps()).length >= 1);
  let s = await snaps();
  check('16 první snímek přišel hned: 30. minuta, skóre 0:0, původ „z pluginu“, zadal uživatel, ne ověřeno hrou', s.length === 1 && s[0].minute === 30 && s[0].score.home === 0 && s[0].score.away === 0 && s[0].via === 'fmmatchlens' && s[0].provenance === 'user_entered', s);
  check('16 statistiky: držení míče z podílu času (60 %), přesnost přihrávek, vyhrané souboje, zákroky, xG', s[0].stats.home.possession === 60 && s[0].stats.away.possession === 40 && s[0].stats.home.passAccuracy === 80 && s[0].stats.home.tackles === 3 && s[0].stats.home.saves === 2 && s[0].stats.away.saves === 1 && s[0].stats.home.xg === 0.4, s[0].stats);
  check('16 hodnocení hráčů jen z mého týmu a jen ze hřiště; jména z metadat', JSON.stringify(s[0].players) === JSON.stringify([{ name: 'Jan Novák', rating: 7.1 }, { name: 'Petr Brankář', rating: 6.4 }]), s[0].players);
  await until(async () => /z pluginu/.test(await text(page, '#liveTimeline')));
  check('16 časová osa ukáže snímek s původem FMMatchLens a stavem „neověřeno hrou“', /z pluginu/.test(await text(page, '#liveTimeline')) && /živě z FMMatchLens/.test(await text(page, '#liveTimeline')) && /neověřeno hrou/.test(await text(page, '#liveTimeline')), await text(page, '#liveTimeline'));
  check('16 stav sledování ukazuje minutu a skóre', /Sleduji zápas z pluginu: 30\. min, 0:0/.test(await feedStatus()), await feedStatus());
  check('16 čtení z pluginu nestojí jediné volání AI', (await page.evaluate(() => window.__mock.calls.length)) === aiBefore, await page.evaluate(() => window.__mock.calls.length));
  check('16 aplikace při čtení nevolala žádnou jinou adresu (zkušební stránka by ji zaznamenala jako zablokovanou)', c.problems.failed.length === 0, c.problems.failed);

  // minuta 31 až 32: nový snímek není potřeba (méně než 3 herní minuty)
  set({ minute: 32 });
  await new Promise((r) => setTimeout(r, 700));
  check('16 do tří herních minut žádný nový snímek', (await snaps()).length === 1, (await snaps()).length);
  // minuta 34: uplynuly tři herní minuty
  set({ minute: 34, home: Object.assign({}, plugin.home, { shots: 5, possessionTime: 900 }) });
  await until(async () => (await snaps()).length === 2);
  s = await snaps();
  check('16 po třech herních minutách přibyl druhý snímek (34. minuta)', s.length === 2 && s[1].minute === 34 && s[1].stats.home.shots === 5, s.map((x) => x.minute));
  // gól: snímek hned, i když minuty neuplynuly
  set({ minute: 35, home: Object.assign({}, plugin.home, { goals: 1, shots: 6 }) });
  await until(async () => (await snaps()).length === 3);
  s = await snaps();
  check('16 gól vyvolá snímek hned (35. minuta, 1:0), i když tři minuty neuplynuly', s.length === 3 && s[2].minute === 35 && s[2].score.home === 1, s.map((x) => [x.minute, x.score]));
  await until(async () => /Poslední skóre 1:0/.test(await text(page, '#liveScore')));
  check('16 hlavička zápasu ukáže poslední skóre z pluginu', /Poslední skóre 1:0/.test(await text(page, '#liveScore')) && /35\. minuta/.test(await text(page, '#liveScore')), await text(page, '#liveScore'));
  // červená karta
  set({ minute: 36, away: Object.assign({}, plugin.away, { redCards: 1 }) });
  await until(async () => (await snaps()).length === 4);
  check('16 červená karta vyvolá snímek hned', (await snaps()).length === 4 && (await snaps())[3].minute === 36);
  // poločas
  set({ minute: 45, period: 2 });
  await until(async () => (await snaps()).length === 5);
  check('16 nová část zápasu vyvolá snímek hned', (await snaps()).length === 5 && (await snaps())[4].minute === 45);

  // pozorování pro radu mluví poctivě o původu
  const obs = await page.evaluate(() => window.FM27.live.observations(window.FM27.live.match(window.FM27.app)));
  check('16 pozorování pro radu jsou „zadal uživatel“ a říkají, že jde o živá data z FMMatchLens neověřená hrou', obs.length > 0 && obs.filter((o) => o.scope === 'live' && /Živá data z FMMatchLens/.test(o.text)).every((o) => o.label === 'user_entered') && obs.some((o) => /neověřené hrou/.test(o.text)), obs.slice(0, 2));
  check('16 vlastní úprava snímku z pluginu ho už nepovažuje za data pluginu (jsou to čísla uživatele)', await page.evaluate(async () => {
    const m = window.FM27.live.match(window.FM27.app);
    const id = m.timeline[0].id;
    await window.FM27.live.edit(window.FM27.app, id, { minute: 31 });
    const after = window.FM27.live.match(window.FM27.app).timeline.find((x) => x.id === id);
    return after.provenance === 'user_entered' && !('via' in after) && after.minute === 31;
  }));

  // plugin hlásí jiný zápas: sledování se zastaví a nic se nesměsí
  set({ matchId: 'zapas-2', minute: 5 });
  await until(async () => /jiný zápas/.test(await feedStatus()));
  check('16 plugin hlásí jiný zápas: sledování se zastaví s vysvětlením a nic se nepřidá', /jiný zápas, než který sleduješ/.test(await feedStatus()) && (await snaps()).length === 5 && /Zapnout sledování/.test(await text(page, '#feedToggle')), await feedStatus());
  const hitsAfterStop = hits('/api/health');
  await new Promise((r) => setTimeout(r, 600));
  check('16 po zastavení se plugin už nedotazuje', hits('/api/health') === hitsAfterStop, [hitsAfterStop, hits('/api/health')]);

  // zapnutí zpět, výpadek pluginu a zotavení
  set({ matchId: 'zapas-1', minute: 50 });
  await page.click('#feedToggle');
  await until(async () => (await snaps()).length === 6); // minuta 50 je o víc než tři minuty později než 45
  check('16 po opětovném zapnutí se navazuje na stejný zápas (stejný identifikátor) a přibyl snímek z 50. minuty', (await snaps()).length === 6 && (await snaps())[5].minute === 50, (await snaps()).map((x) => x.minute));
  set({ online: false });
  await until(async () => /Spojení se nedaří/.test(await feedStatus()));
  check('16 výpadek pluginu: aplikace to řekne s kontrolním seznamem a zkouší dál', /Spojení se nedaří/.test(await feedStatus()) && /Zkontroluj/.test(await feedStatus()), await feedStatus());
  set({ online: true, minute: 55 });
  await until(async () => /Sleduji zápas z pluginu: 55\. min/.test(await feedStatus()));
  check('16 po návratu pluginu se sledování samo obnoví', /Sleduji zápas z pluginu: 55\. min/.test(await feedStatus()), await feedStatus());

  // po novém načtení stránky se naváže bez zdvojení
  const countBeforeReload = (await snaps()).length;
  await page.reload();
  await page.waitForSelector('#liveHeader');
  await page.evaluate(() => { window.FM27.feed.timing.live = 150; window.FM27.feed.timing.wait = 150; window.FM27.feed.timing.error = 200; });
  await until(async () => /Sleduji zápas z pluginu/.test(await feedStatus()));
  check('16 po novém načtení stránky sledování naváže samo a nezdvojí poslední snímek', /Sleduji zápas z pluginu: 55\. min/.test(await feedStatus()) && (await snaps()).length === countBeforeReload, [await feedStatus(), (await snaps()).length, countBeforeReload]);
  await page.click('#feedToggle');
  check('16 ruční zastavení sledování je vidět na tlačítku a stavu', /Zapnout sledování/.test(await text(page, '#feedToggle')) && /vypnuté/.test(await feedStatus()), await feedStatus());

  // ====================================================== C) sestava z pluginu v Můj tým
  await nav(page, 'tym');
  await page.waitForSelector('#feedCard');
  await page.click('#feedSquad');
  await page.waitForSelector('#feedSquadList');
  const list = await text(page, '#feedSquadList');
  check('16 sestava z pluginu: tři hráči mého týmu s rolemi s míčem (soupeř ne)', /Jan Novák/.test(list) && /Petr Brankář/.test(list) && /Karel Lavička/.test(list) && !/Saka/.test(list) && /Advanced Forward \(Attack\)/.test(list) && /Sweeper Keeper \(Support\)/.test(list), list);
  await page.click('#feedSquadAdd');
  check('16 bez potvrzení se nic nepřidá', /Nejdřív potvrď/.test(await text(page, '#toast')) && (await page.evaluate(() => window.FM27.context.players(window.FM27.app).length)) === 0);
  await page.check('#feedSquadConfirm');
  await page.click('#feedSquadAdd');
  await until(async () => (await page.evaluate(() => window.FM27.context.players(window.FM27.app).length)) === 3);
  const players = await page.evaluate(() => window.FM27.context.players(window.FM27.app).map((p) => ({ name: p.name, positions: p.positions, role: p.role, duty: p.duty, attributes: p.attributes, source: p.source, prov: p.prov, notes: p.notes, age: p.age })));
  const jan = players.find((p) => p.name === 'Jan Novák');
  check('16 uložení: zdroj fmmatchlens, údaje zadal uživatel, role a povinnost podle hry, věk prázdný', players.length === 3 && jan.source === 'fmmatchlens' && jan.prov.all === 'user_entered' && jan.role === 'Advanced Forward' && jan.duty === 'Attack' && jan.age === null && JSON.stringify(jan.positions) === '["ST"]', jan);
  check('16 skryté údaje a schopnosti se nenačetly (Consistency, Important Matches, CA, PA, mzda) a brankářský atribut u hráče z pole také ne', JSON.stringify(jan.attributes) === JSON.stringify({ Finishing: 16, Passing: 11, Vision: 12, Pace: 15 }) && !JSON.stringify(players).match(/9876|8765|123456|Consistency|Important/), jan.attributes);
  check('16 role bez míče je v poznámce, náhradník označený', /Bez míče: Central Defender, Defend/.test(jan.notes) && /náhradník/.test(players.find((p) => p.name === 'Karel Lavička').notes), players.map((p) => p.notes));
  await page.waitForSelector('#playerList .player');
  check('16 seznam hráčů ukáže původ „z FMMatchLens“ a neověřeno hrou', /z FMMatchLens/.test(await text(page, '#playerList')) && /neověřeno hrou/.test(await text(page, '#playerList')), await text(page, '#playerList'));
  await page.click('#feedSquad');
  await until(async () => /Není koho přidat/.test(await text(page, '#feedOut')));
  check('16 podruhé už je sestava v soupisce: není koho přidat', /Není koho přidat/.test(await text(page, '#feedOut')) && /Už v soupisce jsou: 3/.test(await text(page, '#feedOut')) && (await page.isDisabled('#feedSquadAdd')), await text(page, '#feedOut'));

  // ====================================================== D) nepřátelská data z pluginu jsou jen text
  set({ evil: true });
  await page.click('#feedProbe');
  await until(async () => /Premier League/.test(await text(page, '#feedLines')));
  await page.click('#feedSquad');
  await page.waitForSelector('#feedSquadList');
  check('16 značky ve jménech z pluginu se zobrazí jako text a žádný kód se nespustí', (await page.evaluate(() => window.__pwned)) === undefined && (await page.locator('#feedSquadList img, #feedSquadList script, #feedLines img, #feedLines script').count()) === 0, await text(page, '#feedLines'));
  set({ evil: false });

  check('16 bez chyb ve skriptu a v konzoli (kromě blokovaných zdrojů a odmítnutých spojení)', c.problems.page.length === 0 && c.problems.console.filter((m) => !/Failed to load resource|net::ERR/.test(m)).length === 0, { page: c.problems.page, console: c.problems.console });
  await c.context.close();

  // ====================================================== E) stránka v Claude: prohlížeč volání na tento počítač neumožní
  const a = await newContext(browser, {});
  await open(a.page, 'live');
  await a.page.fill('#careerClub', 'Chelsea');
  await a.page.click('#careerCreate');
  await a.page.waitForSelector('#feedCard');
  await a.page.click('#feedProbe');
  await until(async () => /Spojení nevyšlo/.test(await text(a.page, '#feedStatus')));
  check('16 ve stránce v Claude se volání zablokuje a aplikace poradí samostatnou verzi', /Spojení nevyšlo/.test(await text(a.page, '#feedStatus')) && /samostatnou verzi/.test(await text(a.page, '#feedLines')), await text(a.page, '#feedLines'));
  await a.context.close();
};
