# FM27 Tactical Coach

Osobní AI trenér pro Football Manager 27: radí z tvých knih o taktice, zná tvůj tým a taktiku, čte snímky obrazovky,
sleduje zápas, upozorňuje hlasem, vede historii zápasů, učí taktiku a **sám hledá zdroje na webu** (vždy označené jako neověřené). Co neví, to řekne; **nikdy nepředstírá, že FM27 vidí**.
Zadání (doslova): [`docs/ZADANI_MASTER_PROMPT.md`](./docs/ZADANI_MASTER_PROMPT.md).

## Stav k 5. 11. 2026

Aplikace je implementovaná podle zadání (deset sekcí, sedm etap) a prochází přes tisíc automatických zkoušek (578 testů jádra, 141 + 11 v Pythonu, 622 kontrol v prohlížeči; několik se bez doplňkových knihoven přeskočí). Kód prošel nezávislou revizí dvou AI revizorů, jejich nálezy jsou opravené: [`docs/REVIZE_NEZAVISLA_2026-11-04.md`](./docs/REVIZE_NEZAVISLA_2026-11-04.md). **Z cloudu nejde ověřit
skutečného Claude, skutečné FM27 ani okno hry**, proto je u každého bodu zadání zvlášť napsáno, co je ověřené a co čeká na tebe:
[`docs/AKCEPTACNI_MATICE.md`](./docs/AKCEPTACNI_MATICE.md).

| Co | Kde |
|---|---|
| **Stránka v Claude** (hned použitelná, bez klíče) | https://claude.ai/artifact/3VXcYYiJMzjAUYeg22csxh (soukromý odkaz) |
| **Samostatná aplikace** (sdílení okna hry, hlasová otázka, instalace; vlastní klíč AI) | **běží**: https://janvasilecko-droid.github.io/FM27-apka/ (nasazuje se samo po každé změně na `main`) |
| Popis aplikace, sestavení, zkoušky | [`trener/README.md`](./trener/README.md) |
| Architektura a pravidla poctivosti | [`docs/ARCHITEKTURA_V2.md`](./docs/ARCHITEKTURA_V2.md) |
| Co dál a co potřebuju od tebe | [`POKRACOVANI.md`](./POKRACOVANI.md) |

## Co je v repozitáři

| Složka | Obsah |
|---|---|
| `trener/` | **aplikace** (jedna kódová základna, dvě sestavení: stránka v Claude a samostatná PWA) a její zkoušky |
| `ai_gateway/` | serverové AI jádro v Pythonu (kontrola poctivosti, čtení obrazovky, náklady); validátor z něj je přeložený do `trener/src/core.js`. 141 testů, živé API neověřeno |
| `fmf_research/` | opravený inspektor souborů `.fmf` (11 testů); originál zůstává beze změny v `reference/` |
| `docs/` | zadání, architektura, akceptační matice, revize souborů z Cursoru, popis `ai_gateway` |
| `reference/` | starší soubory z původní složky, jen pro srovnání |
| `HANDOFF_CLAUDE.md`, `PROMPT_CLAUDE_CONTINUE.md` | předání z Cursoru, beze změn |

**Kód z Cursoru (Wave 76) v repozitáři nikdy nebyl**, takže aplikace v `trener/` je nová implementace podle původního zadání, ne
pokračování toho kódu. Kdyby se kód z Cursoru našel, porovná se s ní, nepřepíše se.

## Zkoušky

```bash
node --test trener/test/*.test.mjs                     # 578 testů jádra a úložiště
python3 -m unittest discover -s ai_gateway/tests -t .  # 141 testů (16 se bez doplňkových knihoven přeskočí) a hlídání klíčů v repu
python3 -m unittest discover -s fmf_research/tests -t . # 11 testů, potřebují `pip install zstandard`
```

Zkoušky celé aplikace v Chromiu (622 kontrol, 15 scénářů) a jejich spuštění: `trener/README.md`.
Zkoušky volají jen zkušební náhražky a zachycený přenos, žádné placené API.

## Pravidla

- Repozitář je **veřejný**: nikdy do něj nedávej klíče, tokeny, hesla ani texty knih (hlídá to test `test_no_secrets`).
- Klíč AI patří jen do Nastavení v aplikaci, nikdy do chatu ani do repozitáře.
- Nic se nemaže a nehádá; názvy rolí, nastavení a cest v menu FM27 jsou v aplikaci vždy označené jako neověřené, dokud je nepotvrdí
  tvůj screenshot nebo oficiální zdroj FM27.
