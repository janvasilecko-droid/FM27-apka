import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const CS = require('../src/fm27cs.js');
const K = require('../src/fm27know.js');
const RF = require('../src/rolefit.js');
const PA = require('../src/posattrs.js');
const D = require('../src/dwrs.js');

// Vzory jsou opsané z obrazovek české hry FM27 (průzkum 7. 11. 2026): názvy a rozložení, žádná jména ani čísla cizích hráčů.

test('atributy: všech 36 hráčů z pole z profilu hráče se převede na kanonický anglický název (a je to vzájemně jednoznačné)', () => {
  const seen = {
    Technika: ['Centry', 'Hlavičky', 'Obranné zákroky', 'Obsazování', 'Přihrávky', 'Střely z dálky', 'Technika', 'Vedení míče', 'Zakončování', 'Zpracování'],
    'Standardní situace': ['Dlouhé hody', 'Penalty', 'Rohy', 'Volné kopy'],
    Psychika: ['Agresivita', 'Bez míče', 'Koncentrace', 'Nasazení', 'Nepředvídatelnost', 'Odhodlání', 'Odvaha', 'Poziční hra', 'Představivost', 'Předvídavost', 'Rozhodování', 'Týmová hra', 'Vůdcovství', 'Vyrovnanost'],
    Fyzička: ['Fyzička', 'Hbitost', 'Rovnováha', 'Rychlost', 'Síla', 'Výdrž', 'Výskok', 'Zrychlení'],
  };
  const all = Object.values(seen).flat();
  assert.equal(all.length, 36);
  const english = new Set();
  for (const cs of all) {
    const en = CS.canonAttr(cs);
    assert.notEqual(en, cs.trim(), `${cs} se nepřevedlo`);
    assert.ok(CS.isKnownAttr(cs) && CS.isKnownAttr(en));
    english.add(en);
  }
  assert.equal(english.size, 36, 'dva české názvy se převedly na stejný anglický');
  for (const en of D.GROUPS ? ['Heading', 'Tackling', 'Marking', 'Passing', 'Finishing', 'First Touch', 'Dribbling', 'Off The Ball', 'Work Rate', 'Flair', 'Vision', 'Natural Fitness', 'Jumping Reach', 'Acceleration', 'Pace'] : []) {
    assert.ok(english.has(en), `chybí ${en}`);
  }
});

test('attrKey: česky i anglicky dá stejný klíč, takže hráč z české obrazovky sedí na profil role i na tabulky pozic zadané anglicky', () => {
  assert.equal(CS.attrKey('Hlavičky'), CS.attrKey('Heading'));
  assert.equal(CS.attrKey('Poziční hra'), CS.attrKey('positioning'));
  assert.equal(RF.attrKey('Obranné zákroky'), RF.attrKey('Tackling'));
  assert.equal(PA.attrKey('Výskok'), PA.attrKey('Jumping Reach'));
  // neznámý název zůstane nepřeložený (jen sloučený do klíče)
  assert.equal(CS.canonAttr('Něco jiného'), 'Něco jiného');
});

test('PosAttrs a DWRS: hráč přečtený z české obrazovky se ohodnotí stejně jako týž hráč zadaný anglicky', () => {
  const cs = { Hlavičky: 15, 'Obranné zákroky': 16, Obsazování: 16, 'Poziční hra': 16, Předvídavost: 15, Síla: 15, Výskok: 16, Zrychlení: 11 };
  const en = { Heading: 15, Tackling: 16, Marking: 16, Positioning: 16, Anticipation: 15, Strength: 15, 'Jumping Reach': 16, Acceleration: 11 };
  const mapOf = (obj) => new Map(Object.entries(obj).map(([k, v]) => [PA.attrKey(k), v]));
  assert.deepEqual(PA.score(mapOf(cs), 'CB'), PA.score(mapOf(en), 'CB'));
  assert.deepEqual([...D.playerAttributes({ attributes: cs }).entries()].sort(), [...D.playerAttributes({ attributes: en }).entries()].sort());
});

test('normalizeAttributes: české názvy na kanonické, jen čísla 1 až 20, duplicita se nesloučí', () => {
  const r = CS.normalizeAttributes({ Hlavičky: 15, Heading: 14, Síla: 'x', Rychlost: 21, 'Obranné zákroky': 16 });
  assert.deepEqual(r.attributes, { Heading: 15, Tackling: 16 });
  assert.equal(r.issues.length, 3);
  assert.deepEqual(CS.normalizeAttributes(null), { attributes: {}, issues: [] });
});

test('pozice: seznamy ze sloupce Pozice a z hřiště (česky) se převedou na kódy pozic', () => {
  const t = (txt, codes) => assert.deepEqual(CS.parsePositions(txt).codes, codes, txt);
  t('B', ['GK']);
  t('O (S)', ['DC']);
  t('O/KO (L)', ['DL', 'WBL']);
  t('O/KO/Z/OZ (P)', ['DR', 'WBR', 'MR', 'AMR']);
  t('DZ, Z (S)', ['DM', 'MC']);
  t('Z/OZ (PL)', ['MR', 'ML', 'AMR', 'AML']);
  t('Z/OZ (S), ÚT (S)', ['MC', 'AMC', 'ST']);
  t('Z (PL), OZ (PLS)', ['MR', 'ML', 'AMR', 'AML', 'AMC']);
  t('OZ (LS), ÚT (S)', ['AML', 'AMC', 'ST']);
  t('O (S), DZ', ['DC', 'DM']);
  t('ÚT (S)', ['ST']);
  // anglicky a lavička
  t('GK, DC', ['GK', 'DC']);
  t('D (C)', ['DC']);
  t('AM (RLC)', ['AMR', 'AML', 'AMC']);
  t('S1', []);
  assert.deepEqual(CS.normalizePositions(['O (S)', 'DZ']).codes, ['DC', 'DM']);
  assert.deepEqual(CS.normalizePositions('nic nedává smysl'), { codes: [], unknown: ['nic nedává smysl'] });
  // role bez strany se nehádá
  const noSide = CS.parsePositions('O');
  assert.deepEqual(noSide.codes, []);
  assert.equal(noSide.unknown.length, 1);
});

test('kódy míst z pokynů k soupeři: všech 22 míst z obrazovky „Všechny pozice“ se rozpozná', () => {
  assert.equal(CS.OPPOSITION_SLOT_CODES.length, 22);
  const expected = { B: 'GK', OP: 'DR', OL: 'DL', OS: 'DC', OSL: 'DC', OSP: 'DC', KOP: 'WBR', KOL: 'WBL', DZS: 'DM', DZSL: 'DM', DZSP: 'DM', ZP: 'MR', ZL: 'ML', ZS: 'MC', ZSL: 'MC', ZSP: 'MC', OZP: 'AMR', OZL: 'AML', OZS: 'AMC', OZSL: 'AMC', OZSP: 'AMC', 'ÚTS': 'ST' };
  for (const code of CS.OPPOSITION_SLOT_CODES) {
    const p = CS.parseSlotCode(code);
    assert.ok(p, code);
    assert.equal(p.fm, expected[code], code);
  }
  assert.equal(CS.parseSlotCode('OSP').side, 'RC');
  assert.equal(CS.parseSlotCode('DZSL').side, 'LC');
  assert.equal(CS.parseSlotCode('KO'), null);
  assert.equal(CS.parseSlotCode('XYZ'), null);
  // každý kód pozice má aspoň jedno místo v rozestavení
  for (const fm of new Set(Object.values(expected))) assert.ok(CS.SLOTS_BY_FM[fm] && CS.SLOTS_BY_FM[fm].length, fm);
});

test('týmové instrukce: všech 27 názvů z obrazovky hry (18 s míčem, 9 bez míče) se pozná a patří k id slovníku', () => {
  assert.equal(CS.INSTR.filter((i) => i.phase === 'in').length, 18);
  assert.equal(CS.INSTR.filter((i) => i.phase === 'out').length, 9);
  for (const i of CS.INSTR) {
    const t = K.TEAM_BY_ID.get(i.id);
    assert.ok(t, `id ${i.id} není ve slovníku`);
    assert.equal(t.phase, i.phase);
  }
  // pozorované dvojice název + hodnota (přesně jak je hra píše)
  const seen = [
    ['Přímočarost přihrávek', 'Mnohem kratší', 'passingDirectness', 'Much Shorter'],
    ['Tempo', 'Vyšší', 'tempo', 'Higher'],
    ['Šířka při útočení', 'Užší', 'attackingWidth', 'Narrower'],
    ['Šířka při útočení', 'Širší', 'attackingWidth', 'Wider'],
    ['Přechod do útoku', 'Protiútok', 'attackingTransition', 'Counter-Attack'],
    ['Tvůrčí volnost', 'Vyrovnaný', 'creativeFreedom', 'Balanced'],
    ['Šetření času', 'Standardní', 'timeWasting', 'Standard'],
    ['Hrát na standardky', 'Udržet míč ve hře', 'playForSetPieces', 'Keep Ball in Play'],
    ['Hrát na standardky', 'Hrát na standardky', 'playForSetPieces', 'Play For Set Pieces'],
    ['Trpělivost', 'Standardní', 'patience', 'Standard'],
    ['Střely z dálky', 'Povzbuzovat', 'shotsFromDistance', 'Encourage'],
    ['Styl centrování', 'Načechrané centry', 'crossingStyle', 'Floated Crosses'],
    ['Vedení míče', 'Vyvážený', 'dribbling', 'Balanced'],
    ['Doprovodné akce', 'Vyvážené', 'supportActions', 'Balanced'],
    ['Doprovodné akce', 'Obě strany', 'supportActions', 'Both Flanks'],
    ['Pokrok prostřednictvím', 'Levá', 'progressThrough', 'Left'],
    ['Pokrok prostřednictvím', 'Obě strany', 'progressThrough', 'Both Flanks'],
    ['Příjem přihrávek', 'Přihrávat do prostoru', 'passReception', 'Pass Into Space'],
    ['Strategie výstavby', 'Obejít pressink', 'buildUpStrategy', 'Bypass Press'],
    ['Odkopy od brány', 'Krátké', 'goalKicks', 'Short'],
    ['BR Rozehrávka (rychlost)', 'Vyvážená', 'gkDistributionSpeed', 'Balanced'],
    ['Rozehrávka brankáře', 'Vyvážený', 'gkDistribution', 'Balanced'],
    ['Linie napadání', 'Nízký blok', 'lineOfEngagement', 'Low Block'],
    ['Výška obranná linie', 'Vyšší', 'defensiveLine', 'Higher'],
    ['Výška obranné linie', 'Vyšší', 'defensiveLine', 'Higher'],
    ['Chování obranné linie', 'Vyvážené', 'defensiveLineBehaviour', 'Balanced'],
    ['Napadání', 'Častěji', 'triggerPress', 'More Often'],
    ['Obranný přechod', 'Kontrapresink', 'defensiveTransition', 'Counter-Press'],
    ['Obranný zákrok', 'Standardní', 'tackling', 'Standard'],
    ['Obranný zákrok', 'Přitvrdit hru', 'tackling', 'Get Stuck In'],
    ['Krátká rozehrávka brankáře', 'Ne', 'shortGkDistribution', 'No'],
    ['Presinková past', 'Past na krajích', 'pressingTrap', 'Trap Outside'],
  ];
  for (const [label, value, id, en] of seen) {
    for (const text of [`${label}: ${value}`, `${label} ${value}`, `S míčem: ${label} ${value}`]) {
      const p = CS.parseInstruction(text);
      assert.ok(p, text);
      assert.equal(p.id, id, text);
      assert.equal(p.value, en, text);
      assert.equal(p.seen, true, `${text}: hodnota je pozorovaná`);
    }
    // a stejný výsledek přes slovník, který používá celá aplikace
    const k = K.parseInstruction(`${label}: ${value}`);
    assert.ok(k, `${label}: ${value}`);
    assert.equal(k.id, id);
    assert.equal(k.value, en);
    assert.ok(K.TEAM_BY_ID.get(id).values.includes(en), `${id}: ${en} není mezi hodnotami slovníku`);
  }
});

test('instrukce: každá česká hodnota má kanonickou anglickou hodnotu, která existuje ve slovníku; odvozené (nepozorované) jsou označené', () => {
  let derived = 0;
  for (const [id, list] of Object.entries(CS.VALUES)) {
    const t = K.TEAM_BY_ID.get(id);
    assert.ok(t, id);
    for (const v of list) {
      assert.ok(t.values.includes(v.en), `${id}: „${v.en}“ není ve slovníku`);
      if (!v.seen) derived++;
    }
  }
  assert.ok(derived > 0, 'odvozené hodnoty musí být označené seen=false');
  assert.equal(CS.valueSeen('tempo', 'Higher'), true);
  assert.equal(CS.valueSeen('tempo', 'Much Higher'), false);
  assert.equal(CS.valueSeen('tempo', 'Nothing'), null);
  assert.equal(CS.labelCs('defensiveLine'), 'Výška obranná linie');
  assert.equal(CS.valueCs('tempo', 'Higher'), 'Vyšší');
  assert.equal(CS.valueCs('crossEngagement', 'Invite Crosses'), null, 'hodnoty Zapojení centrů hra neukázala, nehádá se');
});

test('instrukce: neznámý název nebo hodnota vrací null (nehádá se); delší název vyhrává („Linie napadání“ není „Napadání“)', () => {
  assert.equal(CS.parseInstruction('Něco: jiného'), null);
  assert.equal(CS.parseInstruction('Tempo: Rychlé jak blesk'), null);
  assert.equal(CS.parseInstruction('Vyšší'), null, 'hodnota bez názvu se nepozná');
  assert.equal(CS.parseInstruction('Zapojení centrů: Využívat centry'), null, 'hodnotu této instrukce hra v překladu neukázala jednoznačně');
  assert.equal(CS.parseInstruction('')?.id, undefined);
  const a = CS.parseInstruction('Linie napadání Nízký blok');
  assert.equal(a.id, 'lineOfEngagement');
  const b = CS.parseInstruction('Napadání Častěji');
  assert.equal(b.id, 'triggerPress');
});

test('anglický zápis se dál čte starým slovníkem (česká cesta ho nerozbije)', () => {
  assert.equal(K.parseInstruction('Tempo: Higher').value, 'Higher');
  assert.equal(K.parseInstruction('Defensive Line: Much Higher').value, 'Much Higher');
  assert.equal(K.parseInstruction('Out of Possession: Counter-Press').value, 'Counter-Press');
});

test('mentalita a styl: sedm mentalit a jedenáct stylů z obrazovky hry, česky i anglicky', () => {
  const m = ['Velmi defenzivní', 'Obranný', 'Opatrný', 'Vyvážený', 'Aktivní', 'Útočný', 'Velmi útočný'];
  assert.deepEqual(m.map((x) => K.parseMentality(x)), K.MENTALITIES);
  assert.equal(K.parseMentality('Vyvážený Herní systém'), 'Balanced');
  assert.equal(K.parseMentality('Very Defensive'), 'Very Defensive');
  assert.equal(K.parseMentality('Nic'), null);
  const styles = ['Držení míče', 'Gegenpress', 'Tiki-taka', 'Vertikální tiki-taka', 'Hra na křídla', 'Nakopávané míče', 'Plynulý protiútok', 'Přímočarý protiútok', 'Catenaccio', 'Zaparkovaný autobus', 'Čistý štít'];
  assert.equal(K.STYLES.length, 11);
  assert.deepEqual(styles.map((x) => K.parseStyle(x)), K.STYLES.map((s) => s.name));
  assert.equal(K.parseStyle('Čistý štít Styl'), 'Clean Sheet');
  assert.equal(K.parseStyle('Vertikální tiki-taka'), 'Vertical Tiki-Taka', 'delší název vyhrává');
  assert.equal(K.parseStyle(''), null);
});

test('role: celé české seznamy rolí z profilu hráče (stoper, defenzivní záložník, útočník) se převedou na role slovníku', () => {
  for (const [cs, en] of CS.ROLE_CS_IN) {
    const r = K.findRole(cs, 'in');
    assert.ok(r, `s míčem: ${cs}`);
    assert.equal(r.name, en);
  }
  for (const [cs, en] of CS.ROLE_CS_OUT) {
    const r = K.findRole(cs, 'out');
    assert.ok(r, `bez míče: ${cs}`);
    assert.equal(r.name, en);
  }
  // počty z obrazovky: stoper 6 + 6, defenzivní záložník 5 + 5, útočník 6 + 4
  const inCount = (grp) => CS.ROLE_CS_IN.filter(([, en]) => K.findRole(en, 'in').groups.includes(grp)).length;
  const outCount = (grp) => CS.ROLE_CS_OUT.filter(([, en]) => K.findRole(en, 'out').groups.includes(grp)).length;
  assert.equal(inCount('D (C)'), 6);
  assert.equal(outCount('D (C)'), 6);
  assert.equal(inCount('DM'), 5);
  assert.equal(outCount('DM'), 5);
  assert.equal(inCount('ST (C)'), 6);
  assert.equal(outCount('ST (C)'), 4);
});

test('role: zkratky ze štítků tabulky Tvar týmu se překládají jen tam, kde se dvojice ověřila; ostatní zůstanou neznámé', () => {
  assert.equal(K.findRole('BCB', 'in').name, 'Ball-Playing Centre-Back');
  assert.equal(K.findRole('CFD', 'out').name, 'Centre Forward');
  assert.equal(K.findRole('CB', 'out').name, 'Centre-Back');
  assert.equal(K.findRole('CB', 'in').name, 'Centre-Back');
  assert.equal(K.findRole('GK', 'in').name, 'Goalkeeper');
  for (const chip of ['KH', 'PHH', 'FR', 'KO', 'O']) assert.equal(K.findRole(chip, 'in'), null, `${chip} nemá ověřený překlad`);
  assert.equal(K.findRole('TWM', 'out'), null);
  assert.equal(CS.roleFromChip('ZTH', 'in'), null, 'ZTH je jen odhad podle iniciál');
});

test('slovník: 29 instrukcí (28 z veřejných zdrojů + Doprovodné akce ze hry), 11 stylů; jen Clean Sheet nemá doporučenou mentalitu', () => {
  assert.equal(K.TEAM_INSTRUCTIONS.length, 29);
  assert.equal(K.TEAM_INSTRUCTIONS.filter((t) => t.gameOnly).length, 1);
  assert.deepEqual([...K.THIRD_PARTY_ONLY], ['overlap', 'underlap']);
  assert.equal(K.GAME_INSTRUCTION_COUNT, 27, 've hře je 18 + 9 nastavení');
  assert.equal(K.TEAM_BY_ID.get('supportActions').phase, 'in');
  assert.deepEqual(K.STYLES.filter((s) => s.mentality === null).map((s) => s.name), ['Clean Sheet']);
});

test('Tactical Effectiveness, trénink a tweaky: názvy tak, jak je hra ukázala', () => {
  assert.deepEqual(CS.TE.gauges, ['Intenzita', 'Complexity', 'Effectiveness']);
  assert.deepEqual(CS.TE.pillars.map((p) => p.name), ['Tactical Understanding', 'Player Ability', 'Player Buy-In', 'Next Match Info']);
  assert.equal(CS.TE.pillars.find((p) => p.id === 'understanding').factors.length, 10);
  assert.equal(CS.TRAINING.tacticalUnderstanding.length, 8);
  assert.equal(CS.TRAINING.matchPreparation.length, 7);
  assert.equal(CS.TRAINING.categories.length, 5);
  assert.equal(CS.TWEAKS.length, 15);
  assert.deepEqual(CS.OPPOSITION_COLUMNS.map((c) => c.label), ['Těsné obsazování', 'Napadání', 'Obranné zákroky', 'Nutit hrát nohou']);
  assert.deepEqual(CS.OPPOSITION_COLUMNS.filter((c) => c.valuesSeen).map((c) => c.id), ['tightMarking', 'closingDown']);
  assert.equal(K.TE, CS.TE);
});

test('modul se dá načíst i bez Node (prohlížeč / sandbox) a dává stejné odpovědi', () => {
  const coreSrc = readFileSync(new URL('../src/core.js', import.meta.url), 'utf8');
  const src = readFileSync(new URL('../src/fm27cs.js', import.meta.url), 'utf8');
  const sandbox = { self: {} };
  vm.runInNewContext(coreSrc, sandbox);
  vm.runInNewContext(src, sandbox);
  const sb = sandbox.self.TrenerFm27Cs;
  assert.equal(typeof sb.parseInstruction, 'function');
  assert.equal(sb.parseInstruction('Tempo: Vyšší').value, 'Higher');
  assert.deepEqual(JSON.parse(JSON.stringify(sb.parsePositions('Z (PL), OZ (PLS)'))), CS.parsePositions('Z (PL), OZ (PLS)'));
});

// ---------------------------------------------------------------- nezávislá revize 7. 11. 2026 (nálezy A2, B2, B4)
test('sameName: křestní nebo jednoslovné jméno se nespáruje s plným jménem; iniciála a příjmení sedí; Ł, Ø a Đ se skládají', () => {
  // dřív true: chybná shoda křestního jména a iniciály příjmení
  assert.equal(CS.sameName('Gabriel', 'Gabriel Jesus'), false, 'křestní jméno není příjmení');
  assert.equal(CS.sameName('Pedro', 'Pedro Neto'), false);
  assert.equal(CS.sameName('Jan N.', 'Jan Novotný'), false, 'iniciála příjmení není příjmení');
  assert.equal(CS.sameName('Gabriel Jesus', 'Gabriel Martinelli'), false);
  assert.equal(CS.sameName('Ł. Skorupski', 'Marcin Skorupski'), false, 'Ł je iniciála jiného jména než M');
  assert.equal(CS.sameName('Dijk', 'Virgil van Dijk'), false, 'samotné příjmení se s plným jménem nepáruje');
  // dřív false: písmena bez rozkladu v Unicode
  assert.equal(CS.sameName('Martin Ødegaard', 'Martin Odegaard'), true);
  assert.equal(CS.sameName('Łukasz Fabiański', 'Lukasz Fabianski'), true);
  assert.equal(CS.sameName('Ł. Fabiański', 'Łukasz Fabiański'), true);
  assert.equal(CS.sameName('Luka Modrić', 'Luka Modric'), true);
  assert.equal(CS.sameName('Đ. Đorđević', 'Đorđe Đorđević'), true);
  // beze změny
  assert.equal(CS.sameName('Gabriel', 'Gabriel'), true, 'stejné jednoslovné jméno je stejné jméno');
  assert.equal(CS.sameName('L. Horáček', 'Lukáš Horáček'), true);
  assert.equal(CS.sameName('Virgil van Dijk', 'V. van Dijk'), true);
  assert.equal(CS.sameName('T. Alexander-Arnold', 'Trent Alexander-Arnold'), true);
  assert.equal(CS.sameName('Jan Novák', 'Jiří Novák'), false);
  assert.equal(CS.sameName('J. N.', 'Jan Novák'), false);
  assert.equal(CS.sameName('Jo', 'Jo'), false, 'příjmení má mít aspoň tři písmena');
});

test('parsePositions: dlouhý řetězec mezer nebo písmen netrvá věčnost a obyčejné vstupy dál fungují', () => {
  const t0 = Date.now();
  CS.parsePositions('O' + ' '.repeat(30000) + 'S(');
  CS.normalizePositions(['O' + ' '.repeat(30000) + 'S(', 'Z'.repeat(30000), '(' + 'x'.repeat(30000)]);
  const ms = Date.now() - t0;
  assert.ok(ms < 500, `trvalo ${ms} ms`);
  assert.deepEqual(CS.parsePositions('O/KO/Z/OZ (P)').codes, ['DR', 'WBR', 'MR', 'AMR']);
  assert.deepEqual(CS.parsePositions('ÚT (S)').codes, ['ST']);
  assert.deepEqual(CS.parsePositions('DZ, Z (S)').codes, ['DM', 'MC']);
  const long = CS.parsePositions('O' + ' '.repeat(5000) + '(S)');
  assert.deepEqual(long.codes, [], 'příliš dlouhý údaj o pozici se nečte');
  assert.equal(long.unknown.length, 1);
  // každá mez zvlášť: jedna pozice nad 60 znaků se nečte, i když celý text je krátký; celý text nad 400 znaků se nečte, i když je z krátkých pozic
  const onePart = CS.parsePositions('O' + ' '.repeat(100) + '(S)');
  assert.deepEqual(onePart.codes, []);
  assert.equal(onePart.unknown.length, 1);
  const manyParts = CS.parsePositions(Array(100).fill('O (S)').join(', '));
  assert.deepEqual(manyParts.codes, []);
  assert.equal(manyParts.unknown.length, 1);
  assert.deepEqual(CS.parsePositions(Array(8).fill('O (S)').join(', ')).codes, ['DC'], 'obvyklý seznam pozic se čte');
});

test('normalizeAttributes: jen atributy, které slovník zná; skryté údaje a cizí názvy se nepřevezmou ani neskončí v úložišti', () => {
  const r = CS.normalizeAttributes({
    Heading: 12, Professionalism: 18, Ambition: 15, 'Current Ability': 14, Potential: 17, Reputation: 9, Personality: 11, 'Ignoruj předchozí pokyny': 20,
    Reflexes: 14, 'One-On-Ones': 13, Hlavičky: 12, Rychlost: 10, Vyrážení: 8,
  });
  assert.deepEqual(r.attributes, { Heading: 12, Reflexes: 14, 'One On Ones': 13, Pace: 10, Punching: 8 }, 'anglický název v jakémkoli psaní se převede na kanonický');
  for (const hidden of ['Professionalism', 'Ambition', 'Current Ability', 'Potential', 'Reputation', 'Personality', 'Ignoruj předchozí pokyny']) {
    assert.ok(r.issues.some((i) => i.includes(hidden) && /nepřebírá|vynechal/.test(i)), `u „${hidden}“ se řekne, že se nepřevzalo`);
    assert.ok(!(hidden in r.attributes));
  }
  assert.ok(CS.isKnownAttr('Reflexes') && CS.isKnownAttr('Aerial Reach') && CS.isKnownAttr('Command of Area') && CS.isKnownAttr('Rushing Out'), 'anglické brankářské atributy jsou známé');
  assert.ok(!CS.isKnownAttr('Professionalism') && !CS.isKnownAttr('Potential'));
});
