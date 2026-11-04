# Původní zadání — MASTER PROMPT (FM27 Tactical Coach)

> Zdroj: text vložený majitelem do chatu 3. 11. 2026, uložený sem **beze změn**.
> Majitel k němu napsal „klidně ji upravuj libovolně“. Každou úpravu zapisuj do `POKRACOVANI.md` a zdůvodni.
> 4. 11. 2026 majitel upřesnil jádro: **autonomní aplikace, která radí a řeší s ním problémy, vychází hlavně z knih
> (teorie), ale umí hledat kontext.** Viz bod 12 (Znalostní databáze a zdroje) a bod 14 (AI architektura) níže.

---

**MASTER PROMPT – FM27 TACTICAL COACH**

**Vývoj kompletního AI fotbalového trenéra pro Football Manager 27**

Jsi seniorní vývojář, softwarový architekt, odborník na umělou inteligenci, počítačové vidění a zároveň profesionální fotbalový analytik se specializací na Football Manager.

Tvým úkolem je vytvořit kompletní, profesionální a skutečně funkční aplikaci s názvem FM27 TACTICAL COACH.

Nejde o obyčejnou aplikaci s návody, databázi taktik ani jednoduchého AI chatbota.

Jde o osobního fotbalového trenéra, který:

* Zná můj tým, hráče a taktiku.
* Rozumí herním mechanikám Football Manageru 27.
* Dokáže sledovat obrazovku počítače během hraní.
* Průběžně analyzuje průběh zápasu.
* Rozpoznává taktické problémy.
* Navrhuje konkrétní změny přímo v nastavení FM27.
* Vysvětluje, proč změny provést a jaké budou mít důsledky.
* Učí mě přemýšlet jako skutečný fotbalový trenér.
* Funguje na počítači i mobilním telefonu.

Hlavním cílem je, abych se postupně naučil vytvářet vlastní taktiky, analyzovat soupeře, číst zápasy a samostatně rozhodovat.

### 1. ZÁKLADNÍ KONCEPCE APLIKACE

Aplikace bude mít tři hlavní části:

1. Windows desktopová aplikace – hlavní pracovní prostředí a živé sledování FM27.
2. Mobilní aplikace – ovládání, hlasový trenér, fotografie a upozornění.
3. Společný backend – AI, databáze, synchronizace, znalostní základna a historie.

Preferovaná architektura:

* Windows desktop: Tauri nebo jiná vhodná technologie pro spolehlivé zachytávání obrazovky.
* Mobilní zařízení: responzivní PWA, instalovatelná na Android a použitelná na iOS.
* Backend: modulární API.
* Databáze: PostgreSQL.
* Úložiště: bezpečné ukládání taktik, profilů a analytických dat.
* AI: modulární systém umožňující výměnu poskytovatelů a modelů.

Technologie vybírej podle skutečných potřeb projektu. Nevytvářej zbytečně komplikovanou architekturu.

Obě platformy musí sdílet stejný účet, kariéry, taktiky, hráče a historii.

### 2. LIVE COACH – ŽIVÉ SLEDOVÁNÍ ZÁPASU

Toto je nejdůležitější funkce aplikace.

Chci mít možnost spustit Football Manager 27 na počítači, otevřít FM27 Tactical Coach, povolit sdílení obrazovky a následně nechat AI samostatně sledovat zápas.

Neměl bych muset během zápasu pořizovat screenshoty ani ručně zadávat statistiky.

**Zachytávání obrazovky**

Aplikace musí:

* Umožnit vybrat konkrétní okno Football Manageru.
* Vyžadovat výslovný souhlas uživatele.
* Zachytávat obrazovku průběžně.
* Umět rozpoznat změnu obrazovky.
* Rozpoznat herní obrazovku, statistiky, taktiku a analýzy.
* Přizpůsobovat frekvenci analýzy aktuální situaci.
* Omezovat zbytečné zpracování stejných snímků.
* Fungovat i při hraní v režimu okna.
* Umožnit pozastavení a ukončení sledování.

Neprováděj zbytečně nepřetržitou nákladnou analýzu každého snímku. Navrhni inteligentní systém, který vyhodnocuje změny a důležité události.

**Co musí AI během zápasu sledovat**

* Herní minuty a výsledek.
* Taktiku mého mužstva.
* Taktiku soupeře.
* Rozestavení obou týmů.
* Role a povinnosti hráčů.
* Individuální instrukce.
* Týmové instrukce.
* Statistiky zápasu.
* Heat mapy.
* Průměrné pozice.
* Mapy přihrávek.
* Mapy střel.
* xG, pokud je dostupné.
* Hodnocení hráčů.
* Zranění, karty a střídání.
* Únavu a pokles výkonu, pokud je viditelný.
* Změny v rozestavení a herním stylu soupeře.

AI musí chápat souvislosti mezi jednotlivými obrazovkami a sledovat vývoj situace v čase.

Nemá analyzovat každý screenshot izolovaně.

**Automatická taktická upozornění**

Příklady situací, které musí rozpoznávat:

* Soupeř opakovaně útočí za mým pravým obráncem.
* Můj útočník je izolovaný.
* Záložní řada je příliš vzdálená od útočníků.
* Soupeř získává převahu ve středu.
* Moji krajní obránci se dostávají do nevhodných prostorů.
* Soupeř začal používat jiný způsob rozehrávky.
* Můj presink nefunguje.
* Tým drží míč, ale nevytváří kvalitní příležitosti.
* Obrana je příliš vysoko vzhledem k rychlosti soupeřových útočníků.
* Hráči jsou unavení a jejich výkon klesá.

AI nesmí zaměňovat pouhou statistickou odchylku za skutečný taktický problém.

### 3. KONKRÉTNÍ TAKTICKÉ RADY

Zásadní pravidlo:

ZAKÁZÁNO poskytovat pouze obecné rady.

Špatně:

* Zlepši podporu útočníka.
* Změň presink.
* Uprav střed zálohy.
* Hraj více do šířky.

Správně:

Příklad:

Problém:
Útočník je izolovaný a nedostává dostatek podpory.

Důkazy:

* Heat mapa útočníka.
* Průměrné pozice záložníků.
* Počet přihrávek do útočné třetiny.
* Vzdálenosti mezi jednotlivými řadami.
* Dostupné mapy přihrávek.

Příčina:
Záložníci zůstávají příliš hluboko a krajní hráči nedoplňují pokutové území.

Konkrétní řešení:

1. Otevři Taktika.
2. Vyber konkrétního středního záložníka.
3. Zkontroluj jeho aktuální roli a povinnost.
4. Navrhni konkrétní alternativní roli, pokud odpovídá problému.
5. Vysvětli, jak se změní jeho pohyb.
6. Upozorni na prostor, který tím může vzniknout za ním.
7. Navrhni kontrolu po změně.

AI musí znát skutečné názvy rolí, instrukcí a ovládacích prvků FM27.

Pokud nezná přesnou navigaci nebo si není jistá existencí určitého nastavení, musí to přiznat a ověřit.

**Povinná struktura každého doporučení**

1. Co jsem zjistil.
2. Jaké důkazy to potvrzují.
3. Proč problém vzniká.
4. Co přesně změnit.
5. Kterého hráče se změna týká.
6. Kde přesně změnu provést v FM27.
7. Jaký výsledek očekávám.
8. Jaká jsou rizika.
9. Co po změně sledovat.
10. Kdy provést další vyhodnocení.

Preferuj jednu nebo dvě cílené změny před kompletní přestavbou taktiky.

Po změně musí AI sledovat, jestli se situace skutečně zlepšila.

### 4. IMPORT TAKTIKY Z FOOTBALL MANAGERU

Aplikace musí umět načítat exportované soubory taktik FM27.

Primárně prověř formát exportovaných taktických souborů, včetně případné přípony .fmf. Nehádej jejich interní strukturu.

Postup:

1. Uživatel nahraje soubor.
2. Aplikace ověří formát a strukturu.
3. Pokusí se získat dostupná data.
4. Rozpozná formaci.
5. Načte hráčské pozice.
6. Načte role a povinnosti.
7. Načte týmové instrukce.
8. Načte individuální instrukce.
9. Načte mentalitu a herní nastavení.
10. Vytvoří kompletní profil taktiky.

Pokud soubor některé údaje neobsahuje nebo není podporován, aplikace:

* Upozorní na chybějící údaje.
* Nabídne doplnění screenshotem.
* Umožní ruční doplnění.
* Označí, které informace jsou ověřené a které ne.

Nesmí tvrdit, že načetla informace, které ve skutečnosti nezískala.

### 5. OSOBNÍ DATABÁZE KARIÉRY

Každá kariéra musí mít vlastní oddělený profil.

Ukládej:

* Název klubu.
* Soutěž.
* Soupisku.
* Atributy hráčů.
* Pozice a jejich vhodnost.
* Preferované role.
* Silné a slabé stránky.
* Zranění a únavu, pokud jsou dostupné.
* Taktiky.
* Alternativní taktiky.
* Historii utkání.
* Provedené změny.
* Výsledky analýz.
* Zkušenosti získané z předchozích zápasů.

AI musí rozpoznat, že například doporučení pro Chelsea nemusí být vhodné pro tým s úplně jinými hráči.

Při změně soupisky musí být možné profil aktualizovat.

### 6. TAKTICKÁ LABORATOŘ

Vytvoř vizuální taktické hřiště.

Musí umožnit:

* Zobrazit vlastní rozestavení.
* Přidávat a přesouvat hráče.
* Měnit role a povinnosti.
* Zobrazovat vazby mezi hráči.
* Zobrazovat útočné a obranné prostory.
* Porovnávat dvě taktiky.
* Zobrazovat možné taktické konflikty.

AI musí umět posoudit:

* Prostorové rozložení.
* Vertikální vzdálenosti.
* Horizontální vzdálenosti.
* Obsazení jednotlivých zón.
* Počet hráčů v útočných a obranných prostorech.
* Zajištění při ztrátě míče.
* Možné přečíslení soupeřem.

Musí vysvětlovat, proč některé role spolupracují dobře a proč jiné mohou vytvářet prostorové konflikty.

### 7. ANALYTIK SOUPEŘE

Samostatný modul pro předzápasovou přípravu.

AI musí umět analyzovat:

* Soupeřovo rozestavení.
* Role soupeřových hráčů.
* Silné a slabé stránky.
* Způsob rozehrávky.
* Obranný blok.
* Výšku presinku.
* Útoky po stranách.
* Prostor za obranou.
* Standardní situace.
* Klíčové hráče.

Výsledkem musí být konkrétní předzápasový plán.

Například:

* Jak soupeře napadat.
* Kde získávat míč.
* Kterou stranu využívat.
* Které prostory obsazovat.
* Kterého hráče omezit.
* Jaké riziko bude mít zvolený přístup.

### 8. HLASOVÝ TRENÉR

Aplikace musí mít hlasový režim.

Chci, aby mě AI během zápasu mohla upozornit například:

„Pozor, soupeř začal opakovaně využívat prostor za pravým obráncem. Doporučuji změnit jeho povinnost na obranu. Zároveň tím omezíš naši útočnou šířku na pravé straně.“

Požadavky:

* Český jazyk.
* Přirozený hlas.
* Krátká upozornění během zápasu.
* Možnost hlasově položit otázku.
* Možnost nechat si vysvětlit doporučení podrobněji.
* Nastavit hlasitost a četnost upozornění.
* Možnost přepnout do tichého režimu.

Hlasový trenér nesmí zahlcovat uživatele komentáři.

### 9. ŠKOLA FOTBALOVÉ TAKTIKY

Vytvoř kompletní výukový systém od začátečníka po pokročilého trenéra.

Tematické okruhy:

**A. Základy taktiky:**

* Rozestavení.
* Role a povinnosti.
* Týmové instrukce.
* Individuální instrukce.
* Mentalita.

**B. Útočná fáze:**

* Poziční hra.
* Šířka a hloubka.
* Přetěžování prostorů.
* Kombinační hra.
* Průnikové přihrávky.
* Pohyb bez míče.

**C. Obranná fáze:**

* Vysoký presink.
* Střední blok.
* Nízký blok.
* Presinkové pasti.
* Kompaktnost.
* Bránění prostoru.

**D. Přechodové fáze:**

* Gegenpressing.
* Protiútok.
* Reakce po ztrátě míče.
* Zajištění obrany.

**E. Pokročilá taktika:**

* Asymetrická rozestavení.
* Invertovaní krajní obránci.
* Falešná devítka.
* Meziprostory.
* Přetěžování stran.
* Taktické pasti.
* Adaptace během zápasu.

Každá lekce musí obsahovat:

* Vysvětlení principu.
* Praktický příklad z FM27.
* Grafické znázornění.
* Konkrétní použití ve hře.
* Nejčastější chyby.
* Praktické cvičení.
* Ověření znalostí.

### 10. TRENÉR ROZHODOVÁNÍ

AI nesmí jen automaticky radit.

Musí mě také učit samostatně rozhodovat.

Příklady:

* Soupeř začal vysoký presink. Co uděláš?
* Útočník je izolovaný. Jak zlepšíš jeho podporu?
* Prohráváš 0:1 v 70. minutě. Jak upravíš taktiku?
* Soupeř hraje s deseti hráči. Jak využiješ prostor?
* Tvoje mužstvo má vysoké držení míče, ale nízké xG. Proč?

Nejdříve mi dovol vybrat řešení a následně mi vysvětli správný postup.

Sleduj moje chyby a přizpůsobuj obtížnost.

### 11. ANALÝZA PO ZÁPASE

Po každém utkání vytvoř podrobnou zprávu.

Obsah:

* Co fungovalo.
* Co nefungovalo.
* Které taktické změny pomohly.
* Které změny situaci zhoršily.
* Jak hráli jednotliví hráči.
* Kde měl soupeř převahu.
* Jaké chyby se opakovaly.
* Co změnit pro příští utkání.

Porovnávej dostupná data před změnou a po změně.

Nezaměňuj časovou souvislost za důkaz příčiny.

### 12. ZNALOSTNÍ DATABÁZE A ZDROJE

Toto je kritická část projektu.

AI musí čerpat z kvalitních zdrojů a udržovat znalosti aktuální.

Prověřuj zejména:

**Oficiální zdroje:**

* Football Manager.
* Sports Interactive.
* SEGA.
* Oficiální návody a vysvětlení herních mechanik.

**Komunitní zdroje:**

* FM Scout.
* Sortitoutsi.
* Passion4FM.
* Reddit – Football Manager.
* Ověřené taktické rozbory.
* Komunitní testování herních mechanik.

**Fotbalová taktika:**

* Knihy o moderní fotbalové taktice.
* Analýzy skutečných fotbalových trenérů.
* Poziční hra.
* Gegenpressing.
* Moderní obranné systémy.
* Analýzy profesionálních mužstev.

Každý zdroj musí mít:

* Název.
* Odkaz.
* Datum.
* Verzi FM, které se týká.
* Typ zdroje.
* Důvěryhodnost.
* Oblast použití.

Rozlišuj:

1. Ověřené mechaniky FM27.
2. Ověřené principy skutečného fotbalu.
3. Komunitní zkušenosti.
4. Hypotézy AI.

Starší verze FM nesmí být automaticky považovány za totožné s FM27.

Respektuj autorská práva, podmínky webů a dostupnost zdrojů. Nevydávej komunitní tvrzení za oficiální dokumentaci.

### 13. DESIGN A UŽIVATELSKÉ ROZHRANÍ

Vytvoř profesionální tmavé rozhraní inspirované moderními fotbalovými analytickými systémy.

Nechci obyčejnou šablonu administrace.

Design musí být:

* Moderní.
* Přehledný.
* Profesionální.
* Rychlý.
* Optimalizovaný pro dotykové ovládání.
* Responzivní.

Hlavní menu:

1. LIVE COACH.
2. Můj tým.
3. Moje taktiky.
4. Analýza soupeře.
5. Taktická laboratoř.
6. Škola taktiky.
7. Historie zápasů.
8. Osobní trenér.
9. Zdroje znalostí.
10. Nastavení.

LIVE COACH musí být nejvýraznější část aplikace.

### 14. AI ARCHITEKTURA

Navrhni systém, který umožňuje kombinovat různé AI modely.

Potřebuji:

* Model pro analýzu obrázků.
* Model pro odborné taktické uvažování.
* Model pro výuku.
* Model pro hlasovou komunikaci.
* Databázi ověřených znalostí.
* Systém dlouhodobé paměti kariéry.

Nesmí být nutné přepisovat aplikaci při výměně AI poskytovatele.

Podporuj například API poskytovatelů OpenAI a Anthropic, pokud jejich aktuální rozhraní umožňuje požadované funkce.

Optimalizuj náklady:

* Neodesílej zbytečně totožné snímky.
* Používej OCR a předzpracování obrazu.
* Rozlišuj jednoduché a složité analýzy.
* Nákladnější model používej pro důležité taktické rozhodování.
* Umožni uživateli sledovat spotřebu API.

API klíče nikdy neukládej do veřejného klientského kódu.

### 15. BEZPEČNOST A SOUKROMÍ

* Výslovné povolení sdílení obrazovky.
* Viditelný indikátor aktivního sledování.
* Možnost okamžitého zastavení.
* Šifrovaný přenos.
* Bezpečné ukládání osobních dat.
* Možnost smazání kariéry a historie.
* Žádné skryté nahrávání.
* Žádné automatické ovládání hry bez samostatného výslovného povolení.

Primární funkcí je analýza a poradenství, nikoliv automatické hraní hry.

### 16. VÝVOJ A TESTOVÁNÍ

Nejdříve prozkoumej existující projekt, pokud nějaký dostaneš.

Nenič existující funkční části.

Pokud projekt neexistuje, vytvoř jeho strukturu a technickou dokumentaci.

Rozděl vývoj do etap:

**ETAPA 1 – ZÁKLAD**

* Architektura.
* Databáze.
* Přihlášení.
* Základní design.
* Synchronizace.

**ETAPA 2 – TAKTIKY**

* Import souborů.
* Rozpoznávání taktik.
* Taktické hřiště.
* Databáze hráčů.

**ETAPA 3 – AI TRENÉR**

* Chat.
* Obrazová analýza.
* Znalostní databáze.
* Konkrétní doporučení.

**ETAPA 4 – LIVE COACH**

* Windows desktop klient.
* Sdílení obrazovky.
* Průběžné rozpoznávání.
* Analýza zápasu.
* Automatická upozornění.

**ETAPA 5 – HLAS**

* Hlasový vstup.
* Hlasové odpovědi.
* Hlasová upozornění.

**ETAPA 6 – MOBIL**

* Mobilní rozhraní.
* Synchronizace.
* Notifikace.
* Sdílení screenshotů.

**ETAPA 7 – VZDĚLÁVÁNÍ**

* Škola taktiky.
* Praktická cvičení.
* Hodnocení znalostí.
* Osobní rozvoj.

Každou etapu:

* Implementuj.
* Otestuj.
* Oprav chyby.
* Dokumentuj.
* Teprve poté pokračuj.

Nevytvářej pouze maketu nebo demonstraci. Funkce musí být skutečně implementované.

Nepoužívej falešná data jako náhradu za neimplementované funkce, pokud nejsou výslovně označena jako demo.

### 17. AKCEPTAČNÍ TESTY

Projekt není dokončen, dokud nebude možné prokázat následující:

1. Uživatel se přihlásí na počítači i telefonu.
2. Nahraje skutečný exportovaný soubor taktiky.
3. Aplikace zobrazí rozpoznané taktické údaje.
4. Uživatel doplní soupisku.
5. AI zná uloženou taktiku a hráče.
6. Uživatel povolí sdílení obrazovky FM27.
7. Aplikace rozpozná dostupné informace na obrazovce.
8. AI dokáže vyhodnotit taktické problémy.
9. AI navrhne konkrétní změnu a vysvětlí její provedení.
10. AI požádá o další informace, pokud je potřebuje.
11. Po změně vyhodnotí její účinek.
12. Uživatel dostane hlasové upozornění.
13. Historie zápasu se uloží.
14. Změny se synchronizují s telefonem.
15. Systém správně rozlišuje ověřené informace, odhady a neznámé údaje.

Všechny zásadní funkce musí mít automatizované testy a praktické ověření.

### 18. ZÁVĚREČNÉ POKYNY PRO PROGRAMOVACÍHO AGENTA

Přemýšlej jako seniorní vývojář a odborník na fotbalovou taktiku.

Nezjednodušuj zadání na obyčejného chatbota.

Nevytvářej jen hezké grafické rozhraní bez funkčnosti.

Nepředstírej funkce, které nejsou implementované.

Nevymýšlej herní mechaniky FM27.

Pokud něco technicky není možné, vysvětli proč a navrhni funkční alternativu.

Pokud potřebuješ skutečný exportovaný soubor, screenshot nebo přístup k FM27 pro ověření, vyžádej si ho.

Nejdříve připrav technický plán a architekturu. Potom začni skutečnou implementaci.

Pracuj samostatně, postupně a důsledně. Nezastavuj se po vytvoření první obrazovky.

**KONEČNÝ CÍL:**

Vytvořit nejlepšího osobního AI trenéra pro Football Manager 27, který dokáže sledovat zápas společně se mnou, rozumí mé taktice, pozná chyby, poradí konkrétní změny, vysvětlí jejich fotbalový význam a postupně mě naučí být lepším fotbalovým manažerem.
