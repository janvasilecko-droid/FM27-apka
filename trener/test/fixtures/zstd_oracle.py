"""Přísná věštírna pro zkoušky zstd.test.mjs: libzstd přes Python balíček `zstandard`.
Čte ze vstupu řádky s šestnáctkovými rámci a pro každý napíše "ERR" nebo šestnáctkový výstup.
Úspěch jen když je rámec kompletní a za ním nejsou žádné bajty (Node `zlib.zstdDecompressSync` je na useknutých rámcích shovívavý, proto nestačí).
Spuštění: python3 zstd_oracle.py < řádky.txt  (proměnná ZSTD_ORACLE_PYTHON ve zkoušce určí interpret; bez balíčku `zstandard` se zkouška přeskočí)."""
import sys
import zstandard
out = []
for line in sys.stdin:
    line = line.strip()
    if not line:
        out.append('ERR'); continue
    data = bytes.fromhex(line)
    try:
        d = zstandard.ZstdDecompressor().decompressobj()
        res = d.decompress(data)
        if not d.eof or len(d.unused_data) != 0:
            out.append('ERR')
        else:
            out.append(res.hex())
    except Exception as e:
        out.append('ERR')
sys.stdout.write('\n'.join(out) + '\n')
