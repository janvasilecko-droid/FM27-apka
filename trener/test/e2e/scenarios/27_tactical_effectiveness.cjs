/* Scénář 27: KARTA TACTICAL EFFECTIVENESS (Moje taktiky). Hra ukazuje měřidla jen jako barevné pruhy bez čísel, proto uživatel zadá úroveň pilířů slovně a aplikace vysvětlí,
   poradí podle klíčových faktorů, odhadne složitost taktiky a doporučí sezení z tréninkového rozvrhu.
   Co se zkouší: tok v prohlížeči, názvy pilířů a faktorů ze hry, priority podle úrovní, sezení podle věty asistenta, odhad složitosti s výpisem instrukcí, poctivé texty,
   mobilní šířka. Co se NEzkouší: že rady v zápase zabírají (to nikdo nezměřil) a skutečné pruhy ve hře. */
module.exports = async function run(env) {
  const { browser, check, h } = env;
  const { newContext, open, nav, text } = h;

  const c = await newContext(browser, {});
  const page = c.page;
  await open(page, 'taktiky');
  await page.fill('#careerClub', 'Chelsea');
  await page.click('#careerCreate');
  await page.waitForSelector('#tacReadCard');
  await page.evaluate(async () => {
    const app = window.FM27.app;
    const careerId = app.career().id;
    const t = window.TrenerTactics.makeTactic({ formation: '4-3-3', name: 'Moje 4-3-3', careerId });
    t.mentality = 'Vyvážený';
    t.teamInstructions = ['Přímočarost přihrávek: Mnohem kratší', 'Tempo: Vyšší', 'Šířka při útočení: Užší', 'Přechod do útoku: Protiútok', 'Hrát na standardky: Hrát na standardky', 'Střely z dálky: Povzbuzovat', 'Styl centrování: Načechrané centry', 'Strategie výstavby: Obejít pressink'];
    const saved = await app.store.put('tactic', t);
    const career = app.store.draft(app.career());
    career.activeTacticId = saved.id;
    await app.store.put('career', career);
  });
  await nav(page, 'tym');
  await nav(page, 'taktiky');
  await page.waitForSelector('#teCard');

  const card = await text(page, '#teCard');
  check('27 karta ukazuje čtyři pilíře pod jejich názvy ve hře a českým významem', /Tactical Understanding \(Porozumění taktice\)/.test(card) && /Player Ability \(Schopnost hráčů\)/.test(card) && /Player Buy-In \(Ochota hráčů\)/.test(card) && /Next Match Info \(Informace o příštím zápase\)/.test(card), card.slice(0, 400));
  check('27 karta říká, že hra ukazuje jen barevné pruhy bez čísel, takže úrovně zadáváš sám', /barevné pruhy bez čísel/.test(card) && /zadáš sám/.test(card));
  check('27 výběr oblasti od asistenta nabízí osm sezení Tactical Understanding', (await page.locator('#teHint option').count()) === 9);
  check('27 před zadáním úrovní není žádný výsledek', (await page.locator('#tePriority').count()) === 0);

  await page.selectOption('#te-understanding', 'low');
  await page.selectOption('#te-ability', 'high');
  await page.selectOption('#te-buyIn', 'mid');
  await page.selectOption('#te-nextMatch', 'low');
  await page.selectOption('#te-overall', 'mid');
  await page.selectOption('#teHint', 'Build Up');
  await page.fill('#teOpp', '5');
  await page.click('#teRun');
  await page.waitForSelector('#tePriority');
  check('27 priority: nejdřív nízké pilíře (porozumění, informace o příštím zápase), pak střední (ochota), vysoký se vynechá', /Tactical Understanding \(nízká\) → Next Match Info \(nízká\) → Player Buy-In \(střední\)/.test(await text(page, '#tePriority')) && !/Player Ability \(vysoká\)/.test(await text(page, '#tePriority')), await text(page, '#tePriority'));
  const understanding = await page.evaluate(() => document.querySelector('#te-block-understanding').textContent);
  check('27 u nízkého porozumění jsou rady k deseti klíčovým faktorům (Build Up, Tactical Complexity…) pod jejich názvy ve hře', /Build Up/.test(understanding) && /Tactical Complexity/.test(understanding) && /Pressing Trap/.test(understanding) && (await page.locator('#te-block-understanding li').count()) === 10, understanding.slice(0, 300));
  const ability = await page.evaluate(() => document.querySelector('#te-block-ability').textContent);
  check('27 u vysoké schopnosti jsou jen názvy faktorů bez rad a je tam poznámka, ať se taktika nezhoršuje', (await page.locator('#te-block-ability li').count()) === 2 && !/Rozbor sestavy/.test(ability) && /Player Capability/.test(ability) && /Úroveň je vysoká/.test(ability), ability);
  const comp = await text(page, '#teComplexity');
  check('27 složitost říká, kolik instrukcí je přečteno (dolní odhad), a že výchozí hodnoty aplikace ve FM27 neověřila', /Přečteno \d+ z 27 týmových instrukcí/.test(comp) && /nejméně/.test(comp) && /Výchozí hodnoty instrukcí aplikace ve FM27 neověřila/.test(comp), comp);
  check('27 složitost taktiky: 8 instrukcí mimo výchozí + 5 pokynů k soupeři = 13 → vysoká, označeno jako odhad autora aplikace', /vysoká/.test(comp) && /Instrukcí mimo výchozí hodnotu: 8/.test(comp) && /pokynů k soupeři: 5/.test(comp) && /celkem 13/.test(comp) && /odhad/i.test(comp) && /Vzorec hry neznáme/.test(comp), comp);
  const list = await page.evaluate(() => document.querySelector('#teComplexityList').textContent);
  check('27 výpis instrukcí je česky, jak je hra píše', /Tempo: Vyšší/.test(list) && /Přímočarost přihrávek: Mnohem kratší/.test(list), list);
  const sessions = await text(page, '#teSessions');
  check('27 sezení: Build Up podle věty asistenta (radí hra) a Zápasová příprava s odkazem na kartu Příprava na zápas', /Tactical Understanding: Build Up/.test(sessions) && /radí hra/.test(sessions) && /Zápasová příprava/.test(sessions) && /Příprava na zápas/.test(sessions), sessions);
  const warn = await text(page, '#teWarnings');
  check('27 upozornění: každá změna snižuje porozumění (Tactical Tweak Pending) a úrovně zadává uživatel', /Tactical Tweak Pending/.test(warn) && /zadáváš ty/.test(warn), warn);
  const unknown = await page.evaluate(() => document.querySelector('#teUnknown').textContent);
  check('27 aplikace přizná, co neví: měřidlo Intenzita a stupnici pruhů', /Intenzita/.test(unknown) && /stupnice/.test(unknown), unknown);

  // úrovně přežijí překreslení obrazovky a bez zadání se nic nepředstírá
  await nav(page, 'tym');
  await nav(page, 'taktiky');
  await page.waitForSelector('#teCard');
  check('27 zadané úrovně přežijí překreslení obrazovky', (await page.inputValue('#te-understanding')) === 'low' && (await page.inputValue('#teHint')) === 'Build Up' && (await page.inputValue('#teOpp')) === '5');
  await page.selectOption('#te-understanding', 'unknown');
  await page.selectOption('#te-ability', 'unknown');
  await page.selectOption('#te-buyIn', 'unknown');
  await page.selectOption('#te-nextMatch', 'unknown');
  await page.selectOption('#teHint', '');
  await page.fill('#teOpp', '');
  await page.click('#teRun');
  await page.waitForSelector('#tePriority');
  check('27 bez zadaných úrovní karta říká „Úroveň jsi nezadal“ u všech čtyř pilířů a nic nepředstírá', (await page.locator('#teResult .finding', { hasText: 'Úroveň jsi nezadal' }).count()) === 4, await text(page, '#tePriority'));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const ovf = await h.overflow(page);
  check('27 na telefonu (390 px) nic nepřetéká do šířky', ovf.sw <= ovf.cw + 1, ovf);
  await c.context.close();
};
