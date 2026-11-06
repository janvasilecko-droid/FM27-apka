# Architektura v2: FM27 Tactical Coach podle původního zadání

Technický plán (zadání § 18: „nejdříve technický plán a architektura“). Stav a ověření jednotlivých částí je v `trener/README.md`
a v akceptační matici (`docs/AKCEPTACNI_MATICE.md`). Tento dokument popisuje, **jak je to postavené**; plán byl psán před implementací
a po ní doplněn o to, co přibylo (moduly, typy dokumentů, samostatná verze).

## 1. Rozhodnutí a jejich důvod

| Požadavek zadání | Rozhodnutí | Proč |
|---|---|---|
| Desktop + mobil + backend + PostgreSQL (§ 1) | **Jedna webová aplikace ve dvou sestaveních** ze stejného kódu | Majitel nechce spravovat servery ani klíče. Zadání výslovně říká „vybírej podle skutečných potřeb, nevytvářej zbytečně komplikovanou architekturu“. |
| Sestavení **A: stránka v Claude** (artefakt) | AI přes schopnost `sample` z účtu majitele, data přes `db` (synchronizace počítač ↔ telefon, soukromá podsložka `data/users/<id>`), identita přes `user` | Žádný klíč, žádný server, hned funguje. Omezení: stránka v Claude nesmí zapnout sdílení obrazovky, mikrofon ani notifikace. |
| Sestavení **B: samostatná webová aplikace (PWA)** | AI přímo z prohlížeče s klíčem, který si majitel zadá lokálně; sdílení obrazovky (`getDisplayMedia`), hlasový vstup, notifikace, instalace jako aplikace | Jediná cesta ke skutečnému „Live Coach bez screenshotů“ bez nativní instalace. Klíč se nikdy nedává do kódu ani do chatu. |
| Windows klient v Tauri (§ 1, etapa 4) | **Nahrazeno** sdílením okna v prohlížeči Chrome/Edge | Výběr konkrétního okna, výslovný souhlas a indikátor sdílení řeší prohlížeč. Tauri z cloudu nejde ověřit a nepřidává to, co zadání potřebuje. Zadání dovoluje „jinou vhodnou technologii“. |
| PostgreSQL (§ 1) | Artefakt: dokumentová `db` Claude. Samostatná verze: jen lokálně (IndexedDB) + export | Hostovaná Postgres databáze (Supabase) by vyžadovala účty a klíče majitele. Možná pozdější varianta (viz `POKRACOVANI.md`). |
| Výměna poskytovatele AI (§ 14) | Rozhraní `provider` (`json`, `text`, `limits`) a adaptéry: `sample` v Claude, Anthropic, OpenAI-kompatibilní | Aplikace volá jen rozhraní; model se volí podle náročnosti (`quick`, `default`, `complex`). |

## 2. Mapa modulů

Čisté moduly (bez DOM, UMD, testované v Node): `core.js` (text, hledání, kontrola poctivosti, prompty), `websources.js` (zdroje z webu:
druh zdroje podle domény, verze FM, čtení výsledků hledání, plány hledání), `providers.js`, `tactics.js`,
`analysis.js`, `school.js`, `alerts.js` (pravidla hlasových upozornění), `opponent.js`, `report.js` (rozbor zápasu), `labexplain.js`
(vysvětlení rozestavení), `zstd.js` (vlastní dekodér zstd s omezenou prací), `fmfglue.js` (lepidlo mezi čtečkami a dekodérem: přesně jeden rámec, rozpočty bloků a výstupu na jedno čtení souboru),
`fmfcontainer.js` (čtečka kontejneru `.fmf`: AES-CTR, zstd, kontrolní součty) a `fmftac.js` (stavba payloadu taktiky; význam čísel se nečte); další čisté moduly (přestupy, sestava, tabulky, klub) vyjmenovává `PURE` v `trener/build.mjs`.
Rozhraní a data (prohlížeč): `ui.js`, `store.js` (UMD, testovaný v Node), `library.js` (knihy, pdf.js), `ai.js` (poskytovatel, spotřeba,
„zeptej se, zkontroluj, jednou oprav“), `web.js` (hledání na webu: konektor Parallel Search nebo web search přes klíč Anthropic, paměť,
limity, hlášky, karta zdroje), `context.js` (kontext kariéry a paměť pro AI), `voice.js` (hlasový výstup a vstup, systémová
oznámení), `widgets.js`, `advice.js` (rada a její vykreslení), `live.js` (relace zápasu a sdílení obrazovky), `app.js` (jádro aplikace a směrování),
`boot.js`, `standalone.js` (jen samostatná verze) a `screens/*.js` (jedna obrazovka na soubor; `zz_stubs.js` poctivě zachytí sekci
bez obrazovky). `build.mjs` všechno slepí; pořadí je v něm výslovně uvedené (`PURE`, `UI`, obrazovky podle abecedy, `standalone.js`, `boot.js`).

Hlavní menu (zadání § 13), adresy v `#hash` (ASCII, nikdy `settings`, `downloads`, `customize`, `upgrade`, `sidebar`, `comment-*`):

| # | Sekce | hash | Modul |
|---|---|---|---|
| 1 | LIVE COACH | `live` | `screens/live.js`, `analysis.js` |
| 2 | Můj tým | `tym` | `screens/team.js` |
| 3 | Moje taktiky | `taktiky` | `screens/tactics.js`, `tactics.js` |
| 4 | Analýza soupeře | `soupere` | `screens/opponent.js` |
| 5 | Taktická laboratoř | `laborator` | `screens/lab.js`, `tactics.js` |
| 6 | Škola taktiky | `skola` | `screens/school.js`, `school.js` |
| 7 | Historie zápasů | `historie` | `screens/history.js`, `analysis.js` |
| 8 | Osobní trenér | `trener` | `screens/coach.js` |
| 9 | Zdroje znalostí | `zdroje` | `screens/sources.js` |
| 10 | Nastavení | `nastaveni` | `screens/settings.js` |

## 3. Pravidla poctivosti (platí pro každý modul a každou obrazovku)

Vychází z `trener/src/core.js` (zdroj pravdy) a ze zadání § 12, § 16, § 18.

- **Úrovně důvěry** (`TIERS`): `verified` (jen oficiální zdroj výslovně pro FM27), `observed` (ověřený screenshot), `user_entered`
  (zadal uživatel), `inferred` (odhad, strojové čtení, heuristika, teorie z knihy), `unknown`.
- **Štítky původu** (`LABELS`): `screenshot_verified` → observed, `user_entered` → user_entered, `ocr_unverified`, `vision_unverified`,
  `heuristic_coach`, `ai_advise` → inferred, `stub` → unknown. Strojové čtení obrazu je **vždy** `vision_unverified`, dokud ho uživatel
  výslovně nepotvrdí (potom `screenshot_verified`).
- Úroveň tvrzení **nesmí být silnější než nejslabší důkaz**, na který odkazuje (`checkClaim`, `validateAdvice10` v `core.js`).
- **Úryvek z knihy (`bk:…`) je teorie obecného fotbalu**: nejvýš `inferred`, nikdy důkaz o aktuálním zápase a nikdy tvrzení, jak funguje FM27.
- **Úryvek z webu (`web:…`) je výtah z hledání, ne celý text stránky**: nejvýš `inferred`, **i když jde o oficiální web hry** (aplikace
  nemůže ověřit, že výtah odpovídá celému článku). Druh zdroje se pozná jen podle celé domény (`footballmanager.com.jiny.cz` není oficiální),
  verze FM z adresy a názvu (silný důkaz) nebo z textu výtahu (slabý); starší verze je označená „NENÍ FM27“. Jen adresy `https`, text se
  čistí od značek a neviditelných znaků a do promptu jde jako data na jednom řádku (`oneLine`, `WEB_RULE_CS`). Zdroj z webu uložený mezi
  „moje zdroje“ je v registru vždy neoficiální. Hledá se jen na pokyn uživatele (kliknutí), nikdy samo při načtení.
- **Nevymýšlet mechaniky FM27** (CA/PA, match engine, skryté atributy; `core.scanMechanics`). Názvy rolí, nastavení a cest v menu FM27
  jsou neověřené, dokud je nepotvrdí screenshot nebo oficiální zdroj FM27. Role a instrukce jsou volný text zadaný uživatelem.
- **Statistická odchylka není taktický problém.** Detektor potřebuje minimální vzorek (viz `analysis.js`), jinak jen „sleduj“.
- **Časová souvislost není důkaz příčiny.** Vyhodnocení změny vždy nese upozornění a nikdy netvrdí příčinu bez opory.
- **Prahy geometrie a detektorů jsou heuristiky této aplikace**, ne pravidla FM27. Každý nález říká, z čeho vyplývá a jaký práh použil.
- Žádná „ukázková“ data vydávaná za skutečná. Ukázka musí být označená.
- Texty pro uživatele jsou česky; názvy proměnných a klíčů anglicky. Žádný klíč, token ani text knihy nesmí do gitu, testů ani záznamů.

## 4. Datový model

Každý uložený dokument: `{id, type, careerId?, updatedAt, deleted?, data}`; `type` ∈ `career`, `player`, `tactic`, `match`, `opponent`, `memory`,
`progress`, `settings`, `advice`, `source`, `roleprofile`, `weightprofile`, `candidate`, `recommendation` (závazný seznam je `TYPES` v `trener/src/store.js`; tvar prvních deseti
je rozepsaný níže, `weightprofile`, `candidate` a `recommendation` popisuje `docs/PLAN_ROZSIRENI.md`, část 2, a metodika M16, M23 a M26 v `docs/ANALYTICS_METHODOLOGY.md`, `roleprofile` je profil role z M1).
Id jsou `[a-z0-9]` (kvůli cestám v `db`). Úložiště (`store.js`) řeší lokální uložení
(IndexedDB `fm27-data`) a zrcadlení do `db`: jeden dokument na entitu, klíč `type_id`, poslední zápis vyhrává podle `updatedAt`, smazání
je náhrobek bez dat, dokument nejvýš 240 kB, zápisy se slučují a řadí, vzdálené změny přicházejí jedním `onSnapshot`.
**Texty knih a lekce z nich se nesynchronizují**: knihy jsou v IndexedDB `fm27-trener` (schéma z první verze se nemění), lekce v `localStorage`
(`fm27.lessons`). Klíč AI je jen v `localStorage` (`fm27.aiConfig`).

```text
Career    {id, club, competition, season, activeTacticId, createdAt}
Player    {id, careerId, name, positions[], role, duty, foot, age, attributes{název: číslo|null}, strengths[], weaknesses[],
           flags{injury,fatigue}, notes, source: 'manual'|'plan'|'screenshot', prov{pole: štítek původu}}
Tactic    {id, careerId, name, kind: 'primary'|'alternative', formation: '4-3-3', mentality, teamInstructions[], notes,
           slots[{key, pos, x, y, ox, oy, playerId, role, duty}],            // (x,y) s míčem, (ox,oy) bez míče
           source{type: 'manual'|'plan_json'|'fmf'|'screenshot', fileName, importedAt, fields{pole: štítek původu|'unknown'}}}
Match     {id, careerId, opponent, date, competition, mySide: 'home'|'away'|null, status: 'live'|'finished', result{home,away}|null,
           timeline[Snapshot], changes[Change], notes, analysis|null}
Snapshot  {id, at, minute|null, score{home,away}|null, screen: 'match'|'stats'|'tactics'|'squad'|'analysis'|'other',
           stats{home{…}, away{…}}, events[{minute,type,team,text}], provenance: 'vision_unverified'|'screenshot_verified'|'user_entered', notes}
Change    {id, at, minute|null, summary, items[advice.change.items], baselineIds[], recheckAfterMinutes, adviceRef}
Opponent  {id, careerId, name, formation, fields{klíč: {value, prov}}, plan|null}
Memory    {id, careerId, lessons[{id, at, text, source, matchId?}]}               // „zkušenosti z předchozích zápasů“, nejvýš 40
Progress  {school{lessons{id: {status,bestScore,attempts,lastAt}}}, skills{téma: {rating,seen,correct}}, mistakes[…]}
Advice    {id, careerId|null, at, question, advice(10 částí), passages{id: {id,title,where}} (bez textů), observations, warnings[], needs_verification,
           source: 'trener'|'live'}                                          // historie rad, nejvýš 40
Source    {id, title, url, date, fmVersion, type, category, area, claims, addedAt}   // vlastní zdroj uživatele, vždy neoficiální (nikdy „verified“)
Settings  {voice{enabled, volume, rate, frequency: 'low'|'normal'|'high', quiet, voiceURI}, live{baseIntervalSec, maxPerHour, maxPerMatch, autoAlerts},
           notify{enabled}, coach{deep}}
```

Souřadnice hřiště: `x` 0–100 zleva doprava, `y` 0–100 shora dolů; `y = 0` je branka soupeře, `y = 100` vlastní brankářská čára,
vlastní tým útočí nahoru (shodně s `reference/codex-2026-11-01/takticky-plan.json`).

Pozorování pro poradce: `{id, label, minute|null, text, scope?}` (viz `core.normalizeObservations`; `scope: 'live'` mají čísla ze sledování zápasu a ta nikdy nedokazují cestu v menu hry; text je v promptu vždy na jednom řádku, `core.oneLine`). Geometrické nálezy a detektory se do něj převádějí
jako `heuristic_coach`, soupiska a taktika uživatele jako `user_entered`, čtení obrazu jako `vision_unverified`.

## 5. Kontrakty čistých modulů

Společně: UMD obálka jako `core.js` (v Node `module.exports`, v prohlížeči `window.Trener<Name>`), závislost na jádru
`factory(typeof module === 'object' ? require('./core.js') : root.TrenerCore)`. Žádné DOM, žádná síť, žádné `Date.now()` ani `Math.random()`
bez parametru (`now`, `rand`), aby šlo vše testovat deterministicky. Chyby uživatelského vstupu jako vrácené `errors`, ne výjimky, kromě
výslovně uvedených. Texty nálezů česky.

### 5.1 `tactics.js` → `TrenerTactics`

```text
FORMATIONS: [{id:'4-3-3', label:'4–3–3', slots:[{pos, x, y} × 11]}]      // 4-4-2, 4-3-3, 4-2-3-1, 4-1-4-1, 4-4-1-1, 4-3-2-1, 4-1-2-1-2, 3-5-2, 3-4-3, 5-3-2, 5-4-1
normalizeFormationId(text) → '4-3-3'|null          // '4–3–3', '433', '4 3 3'
formationById(id) → formation|null
makeTactic({id, name, formation, kind}) → Tactic    // klíče slotů 's1'…'s11', role/duty '', playerId null, ox=x, oy=y
lineOf(pos) → 'gk'|'def'|'mid'|'att'
importPlanJson(plan) → {tactic, players, report}   // formát 'fm27-tactical-coach-manual-plan' v1; vše je user_entered
normalizeTacticExtraction(raw) → {ok, read:{name, formation, formationRaw, mentality, instructions[], roles[{pos,role,duty,player}], notes}, issues}
   // taktika přečtená z OBRAZOVKY hry: jen návrh; neznámá formace → null a věta „vyber ručně“ (nikdy se nenahradí jinou)
tacticFromExtraction(read, {name, careerId, kind, fileName, now}) → {tactic|null, unplaced[], issues}
   // role se dosadí jen k pozici s jedním hráčem a jednou rolí v odpovědi; zbytek do poznámky; zdroj {type:'screenshot', fields}
exportPlanJson(tactic, players, {club}) → plan     // kruhově zpět importovatelný
analyzeShape(tactic, {phase:'in'|'out', thresholds}) → analysis
   // {lines:[{name,keys,avgY,minY,maxY}], gaps:[{between:[a,b], gap}], width:{overall,perLine}, depth, thirds:{def,mid,att},
   //  channels:{left,leftHalf,centre,rightHalf,right}, zones:{[third+'/'+channel]: n}, restDefence:n, compactness:{depth,width}}
shapeFacts(analysis, {phase}) → [{id, kind, severity:'info'|'watch'|'warn', text, values}]      // jen geometrie
findConflicts(tactic, {phase, thresholds}) → [{id, kind, severity, text, slots:[key], values, basis}]
   // druhy: line_gap, isolated_forward, overlap, empty_channel, thin_rest_defence, width_imbalance
compareTactics(a, b, {phase}) → {summary:[text], metrics:{a,b,delta}, newConflicts, resolvedConflicts}
opponentOverloads(own, opp, {phase}) → [{id, channel, third, own, opp, diff, text}]   // soupeř zrcadlově (x'=100-x, y'=100-y)
factsToObservations(items, {prefix}) → [{id, label:'heuristic_coach', minute:null, text}]
DEFAULT_THRESHOLDS                                   // exportované, každý práh s komentářem a odůvodněním
inspectFmf(bytes, {decompress}) → {ok, size, header{hex, matchesObserved}, frames[{offset, ok, size, manifestLike}],
   manifest{tokens[], tacticNameGuess}, tacticFields{status:'not_decoded'}, verified[], unknown[], warnings[]}
   // port fmf_research/fmf_inspect_v2.py; `decompress(bytes) → Uint8Array|null` se předává zvenku (zstd), nic se nehádá
```

### 5.2 `analysis.js` → `TrenerAnalysis` (časová osa zápasu, detektory, vyhodnocení změny, brána snímků)

```text
STAT_KEYS                                            // possession, shots, shotsOnTarget, xg, passes, passAccuracy, tackles, fouls, corners, offsides, saves
buildExtractionPrompt({mySide, knownMinute}) → string       // pokyny pro čtení snímku modelem: jen viditelné, jinak null
normalizeExtraction(raw, {id, at}) → {snapshot|null, issues[]}   // kontrola čísel (možnost 0–100, minuta 0–130, skóre celé číslo…), provenance vždy 'vision_unverified'
makeSnapshot(fields) → Snapshot ; sortTimeline(list) → list
windowStats(timeline, fromMinute, toMinute, {mySide}) → {minutes, mine{rates na 10 min, share}, opp{…}, snapshots[ids]} | null
detectProblems(timeline, {mySide, thresholds, now}) → findings[{id, kind, severity:'watch'|'alert', title, text, evidence:[snapshotIds],
   metrics, evidenceTier:'inferred'|'user_entered'|'observed', episode, basis}]   // minimální vzorek: bez dvou snímků ≥ 10 min od sebe nejvýš 'watch'
   // evidenceTier = nejslabší snímek (ručně zadané údaje nejsou ověřený snímek); episode = trvající stav, hlásí se jednou
   // druhy: possession_without_chances, opponent_chance_dominance, opponent_shots_trend, trailing_without_threat, red_card, rating_drop
findingsToObservations(findings, {prefix}) → [{id, label:'heuristic_coach', minute, text}]
evaluateChange(timeline, change, {mySide, thresholds}) → {status:'insufficient_data'|'ready', before, after, deltas, notes[], causalityNote}
   // před/po z rozdílů kumulativních statistik; nikdy netvrdí příčinu; 'insufficient_data' dokud po změně není ≥ minAfterMinutes
summarizeMatch(timeline, changes, {mySide, windowMinutes}) → {periods[], totals, changes[with evaluation], notes[]}
createFrameGate(opts) → gate {check(gray, nowMs) → {process, reason, diff, intervalMs}, noteResult({important}), pause(), resume(), stats()}
downscaleGray(rgba, w, h, outW, outH) → Uint8Array ; frameDiff(a, b) → 0..1
```

### 5.3 `school.js` → `TrenerSchool`

```text
CURRICULUM {groups:[{id:'A'…'E', title, lessons:[{id:'A1', title, level:1|2|3, keywords{cs[],en[]}, prerequisites[]}]}]}   // témata A–E ze zadání § 9
lessonById(id) ; allLessons()
buildLessonPrompt({lesson, passages, careerContext, level}) → turns      // jen z dodaných úryvků; FM27 příklad označit jako neověřený
validateLesson(lesson, {passages:Set}) → {ok, errors, warnings}           // 7 povinných částí, odkazy existují, žádné mechaniky FM27
validateDiagram(spec) → {ok, errors} ; renderDiagramSvg(spec, {width}) → SVG řetězec (všechno escapované, barvy přes CSS proměnné)
gradeQuiz(quiz, answers) → {score, correct, total, perQuestion[]}
newProgress() ; recordLessonResult(progress, lessonId, {correct,total,at}) ; recordDecision(progress, {scenarioId, topic, difficulty, correct, at})
topicRating(progress, topic) ; adaptiveDifficulty(progress, topic) → 1|2|3 ; recommendNext(progress, {now}) → {lessonId, reviewTopics[], reason}
SCENARIOS [{id, topic, title, situation, difficulty}]                    // pět ze zadání § 10 a další
buildScenarioPrompt({scenario, difficulty, passages, careerContext}) → turns ; validateScenario(s, {passages}) → {ok, errors, warnings}
chooseScenario(progress, scenarios, {now, rand}) → scenario                // slabá témata a chyby častěji, obtížnost podle úspěšnosti
```

### 5.4 `providers.js` → `TrenerProviders`

```text
TIER_MODELS.anthropic {quick:'claude-haiku-5-5', default:'claude-sonnet-5-5', complex:'claude-opus-5-5'} ; PRICES_USD_PER_MTOK
createAnthropicProvider({apiKey, fetch, models, baseUrl}) ; createOpenAICompatibleProvider({apiKey, baseUrl, models, fetch}) ; wrapSample(sample)
provider: {name, kind, limits() → {maxPromptBytes, images?{maxCount,maxInputBytes,mediaTypes}},
           json(input, opts) → hodnota, text(input, opts) → {text, truncated}}      // input: řetězec | [{role,content}]; opts: modelTier, images, signal, onText
chyby jsou objekty {code, message, text?}: not_granted, rate_limited, upstream_error, prompt_too_large, invalid_request, cancelled, invalid_json, refused, empty_completion, network_error
extractJson(text) ; withLedger(provider, ledger) ; createLedger({now}) → {record, summary({sinceMs}), toJSON, load} ; estimateTokens(text) ; estimateCostUsd(entry)
```

### 5.5 Další čisté moduly (stručně)

```text
websources.js classify(url) → {kind: official|community|theory|reference|media|video|other, label, trust, category} ; detectFmVersion({url,title,text})
              parseSearchPayload(payload, via) // tolerantní čtení odpovědi konektoru (objekt, pole, text, obálka MCP); recognizesShape(payload)
              parseAnthropicResponse(response) // výsledky z bloků web_search_tool_result, doslovné citace (cited_text), chyby nástroje, pause_turn
              rank(results) ; describe(result) ; toPassage(result) ; lightPassage(passage) ; toSourceDoc(result, now)
              planForLesson(lesson) ; planForAdvice({question, bookQueries}) ; planForTopic(topic) ; planStarter() ; cacheKey(plan) ; buildToolInput(schema, plan)
alerts.js     createAlertPolicy() → {decide(alert, settings, now) → {speak, reason, text}, record, reset}
              // odstup mezi hlášeními podle četnosti (nízká 180 s, běžná 75 s, častá 30 s), naléhavé nejdřív po 15 s, ostatní nejvýš 2/4/8 za 10 minut,
              // stejné upozornění nejdřív po 5 minutách; důvody ne-mluvení: voice_off, quiet, empty, too_minor, duplicate, gap, rate
              shortenForSpeech(text, max) → věta nebo dvě
opponent.js   FIELDS, profileToObservations, buildPlanTurns, searchSeeds, validatePlan, planToText, EXTRACTION_PROMPT, normalizeExtraction
report.js     buildReportTurns, validateReport (zákaz příčinných slov, povinná opatrná formulace, kontrola změn), reportToText
labexplain.js buildExplainTurns, validateExplain   // vysvětlení rozestavení: jen z geometrických nálezů, o chování hráčů ve FM27 nic netvrdí
zstd.js       decompress, decompressFrame, readFrameHeader        // vlastní dekodér zstd (RFC 8878): bez závislostí, se stropy výstupu, bloku, okna a počtu bloků
fmfglue.js    makeFrameDecompressor, makeFirstFrameDecompressor, makeWebAesCtr   // lepidlo čteček .fmf: přesně jeden rámec (s rozpočty bloků a výstupu na jedno čtení souboru) / první rámec (nejvýš 64 bloků), AES-CTR přes WebCrypto
```

Rozhraní AI v prohlížeči (`ai.js`): `FM27.ai.structured({turns, validate, tier, images, signal, purpose, onStep})` → `{status: 'ok'|'needs_more_info', value, verdict}`;
chyby poskytovatele se vyhazují (`errorText` je převede na českou větu; u vlastního klíče je to hláška adaptéru bez klíče a s číslem HTTP).

## 6. Etapy a akceptační testy zadání (§ 17)

| Etapa | Obsah | Akceptační testy |
|---|---|---|
| 1 Základ | menu, kariéry, `store` se synchronizací, nastavení | 1, 14 |
| 2 Taktiky | import (`inspectFmf`, plán JSON), soupiska, hřiště | 2, 3, 4, 5 |
| 3 AI trenér | rada s kontextem kariéry, čtení obrázků, zdroje | 5, 9, 10, 15 |
| 4 Live Coach | snímky, brána změn, časová osa, detektory, vyhodnocení změny | 6, 7, 8, 11 |
| 5 Hlas | hlasová upozornění, hlasový vstup | 12 |
| 6 Mobil | responzivní rozhraní, synchronizace, sdílení snímků | 14 |
| 7 Vzdělávání | škola, cvičení, hodnocení, osobní rozvoj | – |
| průřezově | historie zápasů | 13 |

Co z cloudu **nelze** ověřit (živé volání Claude, sdílení okna FM27 na Windows, `.fmf` z jiné verze hry než ze tří dodaných exportů, skutečná synchronizace mezi zařízeními)
je v akceptační matici označeno výslovně i s kroky pro majitele.

## 7. Samostatná verze (PWA)

- **Úložiště klíče**: `localStorage` (trvale) nebo `sessionStorage` (jen do zavření záložky); na `*.github.io` je výchozí druhá možnost, protože
  `github.io` sdílí úložiště prohlížeče se všemi dalšími stránkami téhož účtu.
- **Poskytovatel AI**: `providers.js`, adaptér Anthropic (`x-api-key`, hlavička `anthropic-dangerous-direct-browser-access`, verze rozhraní z
  konstanty) a OpenAI-kompatibilní (`/chat/completions`, názvy modelů zadává uživatel, v aplikaci označeno jako neověřené). Klíč se zadává
  v Nastavení, ukládá se jen do `localStorage` tohoto prohlížeče a v chybových textech se zakrývá (`makeRedactor`).
- **Service worker** (`standalone/sw.js`): kostra aplikace se uloží při instalaci; stránka a ostatní soubory ze stejného původu se berou
  nejdřív ze sítě a při výpadku z mezipaměti; volání AI service worker nechytá. Nová verze se projeví při dalším otevření.
- **Instalace**: událost `beforeinstallprompt` se zachytí a v Nastavení se nabídne tlačítko; jinak karta radí ruční postup.
- **Sdílení obrazovky** (`live.js`): `getDisplayMedia` bez zvuku, kontrola změn po 1,5 s, `createFrameGate` rozhoduje, co se pošle (ustálení,
  rozdíl, limity za hodinu a za zápas). Skryté nebo zakryté okno prohlížeč zpomaluje; aplikace na to upozorní, obejít to neumí.
- **Hlas a oznámení** (`voice.js`): `speechSynthesis` (česky), `SpeechRecognition` (jen samostatná verze), `Notification` jen při skrytém okně a
  jen pro důležité upozornění. Oznámení na zavřený telefon (push) nejsou: potřebovala by server.
- **Nasazení**: `.github/workflows/pages.yml` se spouští ručně a automaticky po pushi na `main`, když se změní `trener/**`, `reference/codex-2026-11-01/**` (čtou je sestavení a zkoušky jádra), `ai_gateway/costs.py`
  (zkouška ceníku v `trener/test/providers.test.mjs` ho porovnává s ceníkem v JS) nebo samotné workflow. Kroky: testy jádra (`node --test trener/test/*.test.mjs`), `STRICT=1` sestavení, nahrání `trener/dist/standalone`
  a nasazení na Pages. **Věštírna libzstd se v bráně nasazení nepoužije**: testy jádra tam běží s `ZSTD_ORACLE_PYTHON=/nonexistent/python`, takže se přeskočí porovnání s libzstd přes věštírnu; rozbalení rámců napsaných libzstd z Node a srovnání s dekodérem libzstd z Node (`zlib.zstdDecompressSync`) v kontejneru běží dál. Důvod: systémový `python3` na runneru má
  balíček `zstandard` nepřipnuté verze a změna obrazu runneru by mohla zablokovat nasazení bez jakékoli změny v repozitáři.
- **Porovnání dekodéru zstd s libzstd**: samostatné workflow `.github/workflows/zstd-oracle.yml` se spouští ručně a po pushi na `main`, když se změní `trener/src/zstd.js`, `trener/src/fmfglue.js`, `trener/test/zstd.test.mjs`,
  `trener/test/fixtures/zstd_*` nebo samotné workflow. Nainstaluje Python balíček `zstandard==0.25.0` (libzstd 1.5.7, na které se zkoušky ladily) a pustí `trener/test/zstd.test.mjs` s povinnou věštírnou
  (`ZSTD_ORACLE_REQUIRED=1`): bez balíčku nebo při selhání věštírny zkouška selže, nepřeskočí se. Na nasazení stránky nemá vliv (a nasazení na ní nezávisí).
- **Co v CI neběží**: Pythonové zkoušky (`ai_gateway`, `fmf_research`, včetně hlídání klíčů v repozitáři) a zkoušky v prohlížeči (Playwright); pouštějí se ručně (`trener/README.md`, `README.md`).
- **Známé omezení CI (neopraveno)**: GitHub při každém běhu varuje, že akce `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5`, `actions/upload-pages-artifact@v3` (varování jmenuje `actions/upload-artifact@v4`, kterou tato akce volá) a `actions/deploy-pages@v4` míří
  na zastaralé Node.js 20 a že je runner nuceně spouští na Node.js 24. Běhy procházejí, ale spoléhají na toto přechodové chování runneru. Verze akcí se zatím nezměnily, protože novější hlavní verze nešlo ověřit.

