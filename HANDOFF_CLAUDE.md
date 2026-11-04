# HANDOFF → Claude — FM27 Tactical Coach

**STOP:** Feature waves are frozen after Wave 76. Do **not** start Wave 77+ UX/feature churn. Sibling Wave 76 already landed on `main` (`cb8b3b8`, SW v91); this handoff sits on top. If `main` moves again, **rebase** and keep these two docs intact.

**Companion paste prompt:** [`PROMPT_CLAUDE_CONTINUE.md`](./PROMPT_CLAUDE_CONTINUE.md)

---

## Product (what this is)

**FM27 Tactical Coach** — personal Football Manager 2027 coaching PWA + optional desktop capture host.

- Czech UI coach: observe what the user does → what to change → why → where in FM27.
- Continuous honesty: no invented FM mechanics; label provenance (`heuristic_coach`, `ocr_unverified`, `ai_advise`, `user_entered`, `screenshot_verified`).
- **Not** a football manager game / Next.js match sim. That mistaken dead end was removed. Do not resurrect it.

### Původní vize (master prompt)

Osobní **AI trenér FM27** (ne chatbot/návody): Live Coach se sdílením okna → analýza zápasu → **konkrétní změny v FM** (zakázané obecné rady) ve **10bodech** (`context`…`unknown`). Moduly: `.fmf`, kariéra, laboratoř, soupeř, hlas, škola, rozhodování, post-match, knowledge s **trust tiers**. Cílová architektura: desktop + PWA + backend sync, modulární AI, souhlas / žádné skryté nahrávání. Etapy **0–7**; acceptance **15** (#5 PARTIAL, #11+#15 FAIL). Zákaz falešných funkcí a vymýšlení mechanik FM27. Plná hustá verze: [`PROMPT_CLAUDE_CONTINUE.md`](./PROMPT_CLAUDE_CONTINUE.md) § *Původní vize*.

---

## Exact state (main at handoff)

| Field | Value |
|---|---|
| Tip of `main` (pre-handoff code) | `cb8b3b8` — Wave 76: DEMO OCR návrh + school lesson link, SW v91 |
| Handoff commit | `docs: add Claude handoff and continue prompt` (this file + prompt + README pointer) |
| Prior | Wave 75 `0491301` (SW v90), Wave 74 `5ea22e9` (SW v89), Wave 73 `fa4bbde` (SW v88), Wave 72–71 capture |
| Service worker | `fm27-coach-shell-v91` in `sw.js` |
| Master-prompt match | **~88 %** (Stage-0 local PWA feature-complete; remaining ~12 % needs external inputs) |
| Acceptance | **12 PASS · 1 PARTIAL (#5) · 2 FAIL (#11, #15)** |

Always re-check before coding:

```bash
git log -5 --oneline
# CACHE name in sw.js; status narrative in ARCHITECTURE.md
# GET http://127.0.0.1:18765/api/health  (or /health) after serve_local.py
```

### Freezes already on main

| Freeze | Waves | Meaning |
|---|---|---|
| Stage-0 | Wave 50 | Local PWA Stage-0 closed (~88 %, smoke X/12, FAIL chips) |
| Coaching loop | Waves 53–60 | Playbooks / advice history / outcomes / palette — frozen |
| Desktop / AI bridge | Waves 61–70 | Tauri doctor, AI advise contract/stub, status flags — frozen |
| Capture E2E | Waves 71–72 | Capture-session POST/GET, X11 E2E, optional `ocrPreview` |
| OCR keyword bridge | Waves 73–75 | `ocrPreview` → heuristic playbook tags (`ocr_unverified`), confidence, chips, dismiss |
| Capture→coach usability | Wave 76 (sibling, already on main) | DEMO OCR návrh fixture + school lesson link; still ≠ OCR PASS; SW v91 |

**Do not open Wave 77+ feature waves.** Prefer deep quality on screen understanding + real AI keys + Windows HWND validation.

---

## How to run

```bash
python3 serve_local.py
# → http://127.0.0.1:18765/
```

Tests:

```bash
python3 -m unittest discover -s tests -v
python3 tests/e2e_smoke.py
node --test tests/unit_*.mjs
```

Desktop capture host (Windows WebView2 + capture CLI):

- `desktop/tauri-host/` — see `desktop/tauri-host/README.md`, `desktop/README.md`, `docs/desktop/*` (served aliases).

Key docs: `ARCHITECTURE.md`, `CONTRIBUTING.md`, `docs/AI_GATEWAY.md`, `docs/FMF_FORMAT.md`, `desktop/capture-plan.md`.

---

## What works

- **Careers** — localStorage, multi-career, export/import, DEMO seed, ZIP STORE bundle (local only).
- **Tactics lab** — drag pitch, In/Out phases, variants, geometry heuristics (not FM mechanics), formation templates (labeled, not FMF import).
- **GYR Beast** — `screenshot_verified` ground truth → editor path; GG/Underdog still `awaiting_screenshots` / pending.
- **Match history** — tags, interventions, calendar, compare, season narrative (heuristic), 10-point recommendation template (`user_entered`).
- **Coach playbooks** — `coach_playbooks.js`, provenance **`heuristic_coach`**: Co změnit / Proč / Kde v FM, multi-tag, advice history, outcomes, opposition tweak.
- **Live Coach** — `getDisplayMedia` local preview + hash timeline + canvas PNG; **desktop capture session** `POST`/`GET` `/api/desktop/capture-session` (meta/hashes/paths only; `ocr: false`).
- **Optional `ocrPreview`** — unverified text; keyword → playbook suggest labeled **`ocr_unverified`** (Wave 73–75). Wave 76 adds a clearly labeled **DEMO OCR návrh** fixture + school lesson deep-link (still not real OCR). **Does not** flip FAIL #11 to PASS.
- **AI** — `/api/ai/status` + `/api/ai/advise`: **stub without keys**; with `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in server env → safety-proxied advise (`docs/AI_GATEWAY.md`). Client never sees keys.
- **FMF inspect** — `metadata_only` / research probes; **`fmf_decoded=false`**; never claim binary formation/roles.

---

## What does NOT work / FAIL

| # | Status | Gap |
|---|---|---|
| **#5** | PARTIAL | Binary **`fmf_decoded`** formation / roles / instructions. Name + GYR screenshot_verified only. |
| **#11** | **FAIL** | Real OCR / vision Live screen understanding (keyword bridge ≠ vision PASS). |
| **#15** | **FAIL** | Sync / Postgres / auth across devices (stub + manual merge only). |

Also: GG/Underdog PNG ground truth still missing; `fm27-tac-payload.bin` remains `unknown_binary`.

---

## User intent (non-negotiable)

1. Coach loop: analyze what they do → what to change → why → where in FM27 UI.
2. Czech UI.
3. Continuous honesty — no invented mechanics, no fake decode/OCR claims.
4. Personal tool (PWA + desktop host), not a manager game.

---

## Next priorities (for Claude — not Wave 77+ features)

1. **Real screen-understanding pipeline** — improve OCR quality and/or vision API (with keys) so output feeds playbooks with honest labels (`ocr_unverified` until verified; never silent upgrade to `ocr` / vision PASS).
2. **Wire OPENAI / ANTHROPIC keys** into `/api/ai/advise` in the user’s env; exercise advice10 schema + refuse invented FM mechanics; keep stub path when keys absent.
3. **Windows FM27 HWND capture validation with the user** — Tauri/WebView2 + capture CLI against a real FM27 window; document doctor JSON / session export.
4. **FMF only with verified decode** — no wiring of formation/roles until offsets/strings are proven; keep research harness separate from coaching path.

---

## Hard rules

- **No fake `fmf_decoded`.** Capture-session and advise paths must keep `fmfDecoded` / decode claims false unless proven.
- **Label** `heuristic_coach` / `ocr_unverified` / stubs honestly in UI and JSON.
- **Do not resurrect** the Next.js / football-manager-game dead end.
- Loopback-only server (`127.0.0.1:18765`); no shipping secrets to the client.
- Prefer fixing #11 / AI keys / Windows capture over new Stage-0 UX waves.
- If `origin/main` moves again, rebase and **preserve** `HANDOFF_CLAUDE.md` + `PROMPT_CLAUDE_CONTINUE.md`.

---

## Layout cheat sheet

```text
index.html, styles.css, app.js   # PWA shell (CS)
coach_playbooks.js               # heuristic_coach playbooks
desktop_capture.js               # capture-session schema + Live poll
desktop_doctor.js                # doctor report paste/validate
serve_local.py                   # static allow-list + FMF inspect + AI + capture-session
sw.js                            # fm27-coach-shell-v91
desktop/tauri-host/              # Windows WebView2 capture host
docs/AI_GATEWAY.md, docs/FMF_FORMAT.md, ARCHITECTURE.md
tests/                           # unittest + e2e_smoke.py + unit_*.mjs
```

---

## Handoff meta

- Written to stop Cursor feature-wave thrash and let Claude continue alone.
- Further Wave **77+** feature work is **stopped**. Sibling Wave 76 is already merged; do not stack more wave UX.
- Confirm health SW version and `git log -5` before assuming this tip is still HEAD.
