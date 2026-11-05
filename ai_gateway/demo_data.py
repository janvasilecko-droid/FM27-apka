"""DEMO data pro testy a ukázku formátu. NEJSOU to skutečná pozorování ani skutečná rada.

Záměr ukázky: když aplikace nezná názvy rolí a menu ve tvé verzi FM27, poctivá rada to přizná
(`where_tier: unknown`) a požádá o screenshot, místo aby názvy vymyslela.
"""

from __future__ import annotations

import copy

DEMO_BANNER = "DEMO: ukázkový výstup z falešného poskytovatele, NE skutečná AI a NE skutečná data z FM27."

DEMO_REQUEST = {
    "question": "Útočník je od 25. minuty bez podpory. Co mám změnit?",
    "observations": [
        {
            "id": "obs-1",
            "label": "ocr_unverified",
            "minute": 34,
            "text": "DEMO: z obrazovky statistik strojově vyčteno „Střely 11:3“ a „Držení míče 62 %“.",
        },
        {
            "id": "obs-2",
            "label": "user_entered",
            "minute": 34,
            "text": "DEMO: uživatel píše, že útočník je od 25. minuty bez podpory záložníků.",
        },
    ],
}

DEMO_ADVICE = {
    "context": {
        "text": "Uživatel hlásí, že útočník je od 25. minuty bez podpory záložníků.",
        "tier": "user_entered",
        "refs": ["obs-2"],
    },
    "evidenceA": {
        "text": "Strojově vyčtené statistiky ukazují převahu ve střelách (11:3) a držení míče (62 %); samy o sobě izolaci útočníka nedokazují.",
        "tier": "inferred",
        "refs": ["obs-1"],
    },
    "evidenceB": {
        "text": "Uživatel popisuje izolovaného útočníka od 25. minuty.",
        "tier": "user_entered",
        "refs": ["obs-2"],
    },
    "confidence": {
        "level": "medium",
        "text": "Dva různé zdroje (strojové čtení a popis uživatele), ale žádný ověřený screenshot pozic hráčů.",
    },
    "diagnosis": {
        "text": "Možná příčina: záložní řada zůstává hluboko. Je to hypotéza, kterou je nutné ověřit na obrazovce s průměrnými pozicemi.",
        "tier": "inferred",
        "refs": ["obs-1", "obs-2"],
    },
    "change": {
        "text": "Jedna cílená změna u středního záložníka, aby nabízel útočníkovi blízkou podporu.",
        "items": [
            {
                "player": "střední záložník (vyber ve hře)",
                "setting": "role nebo povinnost (přesný název ověř ve své verzi hry)",
                "from": "současná povinnost (zjisti ve hře)",
                "to": "útočnější povinnost ze seznamu, který hra nabízí",
                "where": [
                    "Otevři obrazovku Taktika",
                    "Vyber konkrétního středního záložníka",
                    "Zkontroluj jeho aktuální roli a povinnost",
                ],
                "where_tier": "unknown",
                "refs": [],
                "why": {
                    "text": "Útočník je od záložní řady daleko, proto bez blízké podpory dostává málo přihrávek; útočnější záložník zkrátí vzdálenost a nabídne přihrávku.",
                    "refs": [],
                },
            }
        ],
    },
    "measure": {
        "text": "Po změně sleduj, jestli se záložníci přiblížili k útočníkovi a přibylo přihrávek do útočné třetiny.",
        "checks": ["Průměrné pozice záložníků vůči útočníkovi", "Počet přihrávek do útočné třetiny"],
        "recheck_after_minutes": 15,
    },
    "risk": {
        "text": "Záložník postoupí výš a za ním může vzniknout volný prostor.",
        "items": ["Volný prostor za záložníkem po ztrátě míče"],
    },
    "reversal": {"text": "Vrať původní roli a povinnost, kterou sis zapsal v kroku „Zkontroluj aktuální roli“."},
    "unknown": {
        "text": "Neověřeno ve hře.",
        "items": [
            "Přesný název role a povinnosti a cesta v menu ve tvé verzi FM27 (pošli screenshot obrazovky Taktika)",
            "Průměrné pozice hráčů (pošli screenshot statistik zápasu)",
        ],
    },
}


def demo_advice() -> dict:
    return copy.deepcopy(DEMO_ADVICE)


def demo_request() -> dict:
    return copy.deepcopy(DEMO_REQUEST)
