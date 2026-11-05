# Paste-ready prompt — continue FM27 Tactical Coach alone

> Zdroj: text vložený majitelem 3. 11. 2026 z Cursoru (beze změn). Doplňuje `HANDOFF_CLAUDE.md`.
> Poznámka Claude (4. 11. 2026): odkazované soubory (`serve_local.py`, `app.js`, `ARCHITECTURE.md`, `tests/` …)
> v tomto repozitáři zatím nejsou, kód z Cursoru ještě nebyl nahrán. Viz `README.md`.

Copy everything below the line into Claude.

---

You are continuing FM27 Tactical Coach (personal FM27 coaching PWA + desktop capture host). Read `/workspace/HANDOFF_CLAUDE.md` and `ARCHITECTURE.md` first. Confirm tip with `git log -5 --oneline` and SW cache name in `sw.js` (expect Wave 76 / `fm27-coach-shell-v91` unless main moved).

## Product

Czech UI coach: what the user does → what to change → why → where in FM27. Honest provenance only. Not a football manager game / Next.js sim (dead end removed — do not resurrect).

## Původní vize (master prompt)

Cíl: osobní AI trenér FM27 — koučovací smyčka nad tvou kariérou a obrazovkou, ne chatbot s návody, ne wiki, ne samostatná fotbalová manažerská hra.

Live Coach (jádro): výslovné sdílení okna/monitoru (souhlas → pause → stop; žádné skryté nahrávání); analýza průběhu zápasu / taktické obrazovky; výstup = konkrétní změny v FM (role, pokyny In/Out, sestava, střídání… + kde ve UI). Zakázané: obecné rady typu „hraj lepší pressing“. Doporučení v 10bodech: `context`, `evidenceA`, `evidenceB`, `confidence`, `diagnosis`, `change`, `measure`, `risk`, `reversal`, `unknown` — každý bod s důkazem/nejistotou; AI nesmí vydávat hypotézu za pozorování.

Moduly produktu: import `.fmf` (jen ověřená pole → editor; jinak `fmf_decoded=false`); kariéra (více save, export/obnova); taktická laboratoř (drag hřiště, In/Out, varianty, geometrie ≠ FM mechaniky); soupeř (scout → předzápas); hlas (TTS kouč + tichý režim; diktování max NÁHLED); škola + rozhodování (lekce/cvičení oddělené od ověřených FM tvrzení); post-match (historie, štítky, zásahy, outcome pomohlo/uškodilo); knowledge se trust tiers (`verified` / `observed` / `inferred` / `unknown` / `user_entered`).

Stack vize: desktop capture host (Windows/Tauri) + PWA (mobil/desktop shell) + backend sync (API, auth, PostgreSQL kariér); modulární AI gateway (vision / reasoning / voice — klíče jen na serveru). Bezpečnost: explicitní souhlas se zachytáváním, indikátor běhu, stop; žádné odesílání obrazu bez akce uživatele.

Etapy 1–7 (master): 0 základ kariéra/UI/úložiště · 1 účty/sync/Postgres · 2 taktiky/FMF decode · 3 analytik (evidence→rada) · 4 Live Coach capture+OCR/vision · 5 hlas/mobil · 6 vzdělávání · 7 knowledge trust + modular AI / bezpečnost. (V ARCHITECTURE číslování 0–7; README „Etapy“ 0–6 + znalosti/AI v etapě 7.)

Acceptance (15): #1 kariéra · #2 laboratoř drag · #3 varianty In/Out · #4 šablony formací (ne FM import) · #5 FMF dekód formace/rolí/pokynů · #6 geometrie + checklist rolí · #7 scout→předzápas · #8 historie+štítky+zásahy · #9 10bodová rada · #10 Live souhlas/pause/stop · #11 Live OCR/vision · #12 hlas · #13 škola+decision · #14 knowledge trust · #15 sync/Postgres. Stav dnes: 12 PASS · #5 PARTIAL · #11+#15 FAIL — viz handoff.

Tvrdé zákazy master promptu: žádné falešné funkce (neoznačovat stub/OCR-keyword/`metadata_only` jako hotové OCR/`fmf_decoded`/cloud sync); nevymýšlet mechaniky FM27 (CA/PA, match engine, menu/role/metriky = `unknown` dokud oficiální/in-game důkaz); FM26 ≠ FM27; provenance vždy viditelná.

## Run

```
python3 serve_local.py   # http://127.0.0.1:18765/
python3 -m unittest discover -s tests -v
python3 tests/e2e_smoke.py
node --test tests/unit_*.mjs
```

Desktop: `desktop/tauri-host/` (see README). Health: `/health` or `/api/health`.

## State

~88% vs master prompt. Waves through 76 on main (`cb8b3b8` DEMO OCR návrh + school lesson link, SW v91; prior 73–75 OCR→playbook bridge). Freezes: Stage-0 (50), coaching 53–60, desktop/AI 61–70; capture E2E 71–72; OCR keyword 73–75; Wave 76 usability already landed. Do not start Wave 77+ feature waves. Keep `HANDOFF_CLAUDE.md` + this file if rebasing.

## Works

Career localStorage, tactics lab, sample tactic 1 `screenshot_verified` GT, match history, 10-point recs, playbooks `heuristic_coach`, Live `getDisplayMedia` + desktop capture-session POST/GET, optional `ocrPreview` → `ocr_unverified` keywords + Wave 76 DEMO OCR fixture (≠ OCR PASS), AI `/api/ai/advise` stub without keys (proxy when keyed).

## FAIL / do not fake

* #5 binary `fmf_decoded` formation/roles — research only until verified.
* #11 real OCR/vision Live — keyword/DEMO bridge is not PASS.
* #15 sync/Postgres/auth.

## Your priorities (in order)

1. Real screen-understanding pipeline (better OCR and/or vision API with keys) feeding playbooks — keep `ocr_unverified` until truly verified; never silently set `ocr: true` / claim vision PASS.
2. Wire `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` into server-side `/api/ai/advise`; keep stub + honesty when absent; refuse invented FM mechanics (`docs/AI_GATEWAY.md`).
3. Validate Windows FM27 HWND capture with the user (Tauri/WebView2 + doctor/session export).
4. FMF formation/roles only with verified decode — otherwise leave `fmf_decoded=false`.

## Rules

No fake `fmf_decoded`. Label `heuristic_coach` / `ocr_unverified`. No manager-game resurrection. Loopback secrets stay on server. Prefer #11 / keys / Windows capture over Stage-0 UX polish / Wave 77+.

Start by reading the handoff + architecture, running tests green, then tackle priority 1 with small honest increments and tests.
