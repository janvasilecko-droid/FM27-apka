/* Sekce, které ještě nejsou hotové: poctivě to řeknou. Každá hotová obrazovka se hlásí dřív (soubory se načítají
   podle abecedy) a tady se přeskočí. Nic se tu netváří jako funkční. */
(function () {
  'use strict';
  const FM27 = window.FM27;
  const { h } = FM27.ui;
  const STUBS = [
    ['live', 1, 'LIVE COACH', 'Sledování zápasu: snímky, časová osa, upozornění a vyhodnocení změn.'],
    ['tym', 2, 'Můj tým', 'Soupiska hráčů s pozicemi, rolemi, atributy, silnými a slabými stránkami.'],
    ['taktiky', 3, 'Moje taktiky', 'Uložené a alternativní taktiky, import souboru a plánu.'],
    ['soupere', 4, 'Analýza soupeře', 'Profil soupeře a předzápasový plán.'],
    ['laborator', 5, 'Taktická laboratoř', 'Hřiště s přesouváním hráčů a rozborem prostoru.'],
    ['skola', 6, 'Škola taktiky', 'Lekce z tvých knih, cvičení a kvízy.'],
    ['historie', 7, 'Historie zápasů', 'Uložené zápasy a rozbor po zápase.'],
  ];
  for (const [hash, order, label, what] of STUBS) {
    if (FM27.screens.get(hash)) continue;
    FM27.screens.register({
      id: hash,
      hash,
      label,
      order,
      render(root) {
        root.replaceChildren(h('section', { class: 'card' }, h('h2', { text: label }), h('p', { class: 'lead', text: what }), h('div', { class: 'banner warn' }, h('b', { text: 'Tahle část se právě staví' }), h('span', { text: 'Zatím tu nic není. Nic z toho se nepředstírá.' }))));
      },
    });
  }
})();
