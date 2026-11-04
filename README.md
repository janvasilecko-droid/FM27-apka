# FM27 Tactical Coach

Osobní AI trenér pro Football Manager 27 (PWA + desktopový capture host). Zadání a pravidla:
[`PROMPT_CLAUDE_CONTINUE.md`](./PROMPT_CLAUDE_CONTINUE.md) a [`HANDOFF_CLAUDE.md`](./HANDOFF_CLAUDE.md).

## Stav k 4. 11. 2026 — přečti první

**Kód aplikace z Cursoru (Wave 76: `serve_local.py`, `app.js`, `sw.js`, `desktop/`, `tests/` …) v tomto repozitáři zatím NENÍ.**
Je jen v Cursoru a nikam se nenahrál, takže soubory, na které odkazuje `HANDOFF_CLAUDE.md`, tu neexistují.
Údaje o stavu aplikace (≈ 88 %, 12 z 15 akceptačních testů) jsou převzaté z handoffu a já je neověřil.

| Co | Stav |
|---|---|
| `HANDOFF_CLAUDE.md`, `PROMPT_CLAUDE_CONTINUE.md` | předání z Cursoru, beze změn |
| `reference/codex-2026-11-01/` | starší soubory z původní složky (1. 11.), jen reference, starší než Wave 76 |
| `ai_gateway/` | **nové:** serverový AI trenér (Claude) s kontrolou poctivosti, čtení obrazovky, náklady. 126 testů prochází; živé API zatím neověřeno (chybí klíč) |
| `fmf_research/` | **nové:** opravený inspektor FMF (11 testů). Originál je beze změny v `reference/` |
| `docs/AI_GATEWAY_V2.md` | jak gateway zapojit a co s klíčem ověřit |
| `docs/REVIZE_CLAUDE_2026-11-04.md` | kontrola souborů z Cursoru: nálezy, důkazy, návrhy |
| `POKRACOVANI.md` | co dál a co od majitele potřebuju |

## Jak sem nahrát kód z Cursoru

1. Na PC otevři `cmd` a spusť `dir /s /b "%USERPROFILE%\serve_local.py"`. Vypíše cestu ke složce s aplikací.
2. Obsah té složky přetáhni na https://github.com/janvasilecko-droid/FM27-apka/upload/main a dole dej „Commit changes“.
   Nenahrávej `.git`, `node_modules`, `target` ani žádný `.env`. GitHub bere najednou nejvýš 100 souborů, případně nahraj ve dvou dávkách.

Pokud `dir` nic nenajde, kód je jen v cloudu Cursoru a je potřeba ho odtamtud nejdřív dostat ven.
Repozitář je **veřejný**: nikdy do něj nedávej klíče (hlídá to test `test_no_secrets`).

## Testy

```bash
pip install anthropic zstandard    # volitelné; bez nich se příslušné testy přeskočí
python3 -m unittest discover -s ai_gateway/tests -t . -v
python3 -m unittest discover -s fmf_research/tests -t . -v
python3 -m ai_gateway.demo         # ukázka formátu rady (DEMO, žádná AI ani síť)
```

Testy volají jen falešného poskytovatele a zachycený HTTP přenos, žádné placené API.
Skutečné ověření s klíčem: `python3 -m ai_gateway.live_check --yes` (viz `docs/AI_GATEWAY_V2.md`).
