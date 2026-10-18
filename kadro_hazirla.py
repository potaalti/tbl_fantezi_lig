"""kadrolar.csv dosyasını okuyup oyuncuları TBF oyuncu kimlikleriyle eşleştirir.

CSV sütunları (ayırıcı ; veya ,):
  Takım ; Sahibi ; Oyuncu ; Rol (As/Yedek) ; TBL Takımı (isteğe bağlı, aynı isimli oyuncular için)

Her takımda 5 As ve 2 Yedek olmalı. Hatalı satır varsa dosya yazılmaz; TBF'de bulunamayan oyuncu
uyarıyla kaydedilir ve süre almamış sayılır.

Kadrolar hafta hafta saklanır (site/data/kadro/<hafta>.json). Bir hafta, o hafta için kaydedilmiş
en son kadroyla puanlanır; böylece kadro değişikliği geçmiş haftaları etkilemez.
Hafta verilmezse: güncel TBL haftasında henüz maç başlamadıysa o hafta, başladıysa bir sonraki hafta.

Önce `python fetch_tbf.py` çalıştırılmış olmalı (oyuncu rehberi için).
Kullanım:  python kadro_hazirla.py [kadrolar.csv] [--hafta N]
"""
import csv
import difflib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE_DATA = ROOT / "site" / "data"
TR = str.maketrans({"İ": "i", "I": "ı", "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u",
                    "â": "a", "î": "i", "û": "u", "é": "e", "ć": "c", "č": "c", "š": "s", "ž": "z"})


def norm(s):
    s = (s or "").replace("İ", "i").replace("I", "ı").lower().translate(TR)
    s = re.sub(r"\(k\)", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def esnek_uyum(a, b):
    """'erik pratt' ~ 'erik jamal pratt', 'sam sessoms' ~ 'samuel lee sessoms':
    kısa ismin kelimeleri uzun isimde aynı sırayla geçer (kelime başı eşleşmesi de kabul)."""
    kisa, uzun = sorted((a.split(), b.split()), key=len)
    if len(kisa) < 2:
        return False
    i = 0
    for k in uzun:
        if i < len(kisa) and (k == kisa[i] or (min(len(k), len(kisa[i])) >= 3 and (k.startswith(kisa[i]) or kisa[i].startswith(k)))):
            i += 1
    return i == len(kisa)


def satirlari_oku(yol):
    metin = yol.read_text(encoding="utf-8-sig")
    ayirici = ";" if metin.count(";") >= metin.count(",") else ","
    satirlar = list(csv.reader(metin.splitlines(), delimiter=ayirici))
    return [[h.strip() for h in s] for s in satirlar[1:] if any(h.strip() for h in s)]


def degisiklikleri_yaz(kadro_dizin, haftalar, hafta, yeni):
    """Bir önceki kayıtlı kadroya göre neyin değiştiğini ekrana yazar."""
    onceki = [h for h in haftalar if h < hafta]
    if not onceki:
        return
    eski = {t["ad"]: t for t in json.loads((kadro_dizin / f"{onceki[-1]}.json").read_text(encoding="utf-8"))}
    print(f"{onceki[-1]}. haftaya göre değişiklikler:")
    degisti = False
    for t in yeni:
        e = eski.get(t["ad"])
        if not e:
            print(f"  + Yeni takım: {t['ad']}")
            degisti = True
            continue
        for rol in ("as", "yedek"):
            eski_adlar = {o["ad"] for o in e[rol]}
            yeni_adlar = {o["ad"] for o in t[rol]}
            for ad in sorted(yeni_adlar - eski_adlar):
                print(f"  {t['ad']}: {ad} -> {rol}")
                degisti = True
            for ad in sorted(eski_adlar - yeni_adlar - {o['ad'] for o in t['as'] + t['yedek']}):
                print(f"  {t['ad']}: {ad} kadrodan çıktı")
                degisti = True
    if not degisti:
        print("  (değişiklik yok)")


def gecerli_hafta():
    """Değişikliğin geçerli olacağı hafta: başlamış bir haftanın kadrosu değiştirilmez."""
    guncel = json.loads((SITE_DATA / "hafta" / "index.json").read_text(encoding="utf-8"))["guncelHafta"]
    hafta_yol = SITE_DATA / "hafta" / f"{guncel}.json"
    if hafta_yol.exists():
        maclar = json.loads(hafta_yol.read_text(encoding="utf-8"))["maclar"]
        if any(m["durum"] != "oynanmadi" for m in maclar):
            return guncel + 1
    return guncel


def argumanlar():
    args, hafta = sys.argv[1:], None
    if "--hafta" in args:
        i = args.index("--hafta")
        hafta = int(args[i + 1])
        del args[i:i + 2]
    csv_yol = Path(args[0]) if args else ROOT / "kadrolar.csv"
    return csv_yol, hafta


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    csv_yol, hafta = argumanlar()
    hafta_verildi = hafta is not None
    hafta = hafta or gecerli_hafta()
    rehber = json.loads((SITE_DATA / "oyuncular.json").read_text(encoding="utf-8"))

    isimden = {}
    for pid, o in rehber.items():
        isimden.setdefault(norm(o["ad"]), []).append(pid)

    takimlar, hatalar, uyarilar = {}, [], []
    for no, s in enumerate(satirlari_oku(csv_yol), start=2):
        s += [""] * (5 - len(s))
        takim, sahibi, oyuncu, rol, tbl = s[:5]
        rol_n = norm(rol)
        if rol_n not in ("as", "yedek"):
            hatalar.append(f"Satır {no}: Rol 'As' veya 'Yedek' olmalı ('{rol}')")
            continue
        t = takimlar.setdefault(takim, {"ad": takim, "sahibi": sahibi, "as": [], "yedek": []})
        adaylar = isimden.get(norm(oyuncu), [])
        if not adaylar:  # TBF tam adı kullanıyor olabilir (ör. ikinci isim)
            adaylar = [p for isim, pidler in isimden.items() if esnek_uyum(norm(oyuncu), isim) for p in pidler]
        if tbl and len(adaylar) > 1:
            adaylar = [p for p in adaylar if norm(tbl) in norm(rehber[p]["takim"])]
        if len(adaylar) != 1:
            if adaylar:
                secenekler = ", ".join(f"{rehber[p]['ad']} ({rehber[p]['takim']})" for p in adaylar)
                hatalar.append(f"Satır {no}: '{oyuncu}' birden fazla oyuncuya uyuyor: {secenekler}. TBL Takımı sütununu doldurun.")
                continue
            # TBF'de bulunamayan oyuncu kadroda kalır ama hiç süre almamış sayılır
            oneri = difflib.get_close_matches(norm(oyuncu), list(isimden), n=3, cutoff=0.6)
            ipucu = ", ".join(rehber[isimden[o][0]]["ad"] for o in oneri) or "öneri yok"
            uyarilar.append(f"Satır {no}: '{oyuncu}' TBF'de bulunamadı, süre almamış sayılacak. Benzerler: {ipucu}")
            t[rol_n].append({"id": None, "ad": oyuncu, "tblTakim": None, "eslesmedi": True})
            continue
        pid = adaylar[0]
        t[rol_n].append({"id": pid, "ad": rehber[pid]["ad"], "tblTakim": rehber[pid]["takim"]})

    sahipler = {}
    for t in takimlar.values():
        for o in t["as"] + t["yedek"]:
            if o["id"]:
                sahipler.setdefault(o["id"], []).append(t["ad"])
    for pid, tl in sahipler.items():
        if len(tl) > 1:
            uyarilar.append(f"{rehber[pid]['ad']} birden fazla takımda: {', '.join(tl)}")

    for t in takimlar.values():
        if len(t["as"]) != 5 or len(t["yedek"]) != 2:
            hatalar.append(f"'{t['ad']}': {len(t['as'])} As, {len(t['yedek'])} Yedek var (5 As + 2 Yedek olmalı)")

    if hatalar:
        print("Kadrolar kaydedilmedi, şu sorunları düzeltin:")
        print("\n".join("  - " + h for h in hatalar))
        sys.exit(1)

    kadro_dizin = SITE_DATA / "kadro"
    kadro_dizin.mkdir(parents=True, exist_ok=True)
    yeni = list(takimlar.values())
    kayitli = sorted(int(p.stem) for p in kadro_dizin.glob("*.json") if p.stem.isdigit())
    if kayitli and not hafta_verildi:
        son = json.loads((kadro_dizin / f"{kayitli[-1]}.json").read_text(encoding="utf-8"))
        if son == yeni:
            print(f"Kadrolarda değişiklik yok ({kayitli[-1]}. hafta kadrosuyla aynı), bir şey yazılmadı.")
            return
    (kadro_dizin / f"{hafta}.json").write_text(json.dumps(yeni, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    haftalar = sorted(int(p.stem) for p in kadro_dizin.glob("*.json") if p.stem.isdigit())
    (kadro_dizin / "index.json").write_text(json.dumps({"haftalar": haftalar}), encoding="utf-8", newline="\n")
    print(f"{len(takimlar)} takım kaydedildi, {hafta}. haftadan itibaren geçerli -> site/data/kadro/{hafta}.json")
    if any(h > hafta for h in haftalar):
        uyarilar.append(f"{hafta}. haftadan sonrası için de kayıtlı kadro var ({[h for h in haftalar if h > hafta]}); "
                        "o haftalar kendi kayıtlı kadrolarıyla puanlanmaya devam eder.")
    degisiklikleri_yaz(kadro_dizin, haftalar, hafta, yeni)
    if uyarilar:
        print("Uyarılar:")
        print("\n".join("  - " + u for u in uyarilar))


if __name__ == "__main__":
    main()
