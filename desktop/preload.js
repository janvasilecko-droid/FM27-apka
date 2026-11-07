/* Předává stránce aplikace jen to, že běží v desktopové aplikaci (verze, systém); žádné funkce Electronu ani Node.js stránka nedostane. */
'use strict';
const { contextBridge } = require('electron');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
};

contextBridge.exposeInMainWorld(
  'fm27desktop',
  Object.freeze({
    isDesktop: true,
    platform: process.platform,
    version: arg('fm27-version'),
    electron: process.versions.electron,
    // rozpoznávání řeči z Chromia v Electronu nefunguje (chybí klíče služby): hlasový vstup se v aplikaci vypne, hlasové čtení rad zůstává
    noSpeechRecognition: true,
  })
);
