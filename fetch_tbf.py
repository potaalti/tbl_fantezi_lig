"""TBF sitesinden TBL maçlarını ve oyuncu verimlilik (VP) puanlarını çeker.

Çıktılar:
  site/data/hafta/<n>.json   -> başlangıç haftasından güncel haftaya kadar haftalık VP verisi
  site/data/hafta/index.json -> mevcut haftalar ve güncel hafta
  site/data/oyuncular.json   -> oyuncu rehberi (id, ad, TBL takımı, sezon ortalamaları)
  site/data/oyuncu/<id>.json -> oyuncunun sezon boyunca maç maç istatistikleri
  site/data/mac/<id>.json    -> maçın box score'u (iki takımın oyuncu istatistikleri, çeyrek skorları)
  site/data/maclar/<lig>-<n>.json -> Maçlar sekmesi: TBL'nin ve BSL'nin haftalık maç listesi

Biten maçların istatistikleri cache/ klasöründe saklanır, tekrar indirilmez.
Kullanım:  python fetch_tbf.py              -> her şeyi günceller
           python fetch_tbf.py --akilli     -> sadece maç saatlerinde çalışır (zamanlanmış görev için)
           python fetch_tbf.py --kadrolar   -> TBL takım kadrolarını da hemen yeniler
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE_DATA = ROOT / "site" / "data"
CACHE = ROOT / "cache"

API = "https://www.tbf.org.tr/api"
LIG_ID = 22215      # TBL 2026-2027
BSL_LIG_ID = 22214  # BSL 2026-2027 (sadece Maçlar sekmesinde gösterilir)
SEZON_ID = 174
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.tbf.org.tr/ligler/tbl-2026-2027/maclar",
}

TURKIYE = timezone(timedelta(hours=3))  # TBF maç saatleri Türkiye saatiyle
MAC_PENCERESI = timedelta(hours=4)       # başlama saatinden sonra bu süre boyunca sık güncellenir
REHBER_YENILEME_SN = 12 * 3600

# TBF matchStatusId: 1 = maç sonu, 4 = oynanmadı; diğerleri canlı kabul edilir
DURUM_BITTI, DURUM_OYNANMADI = 1, 4
STAT_LISTELERI = (("homeTopFive", "ev"), ("homeBenchPlayers", "ev"),
                  ("awayTopFive", "dep"), ("awayBenchPlayers", "dep"))


def api(yol, deneme=3):
    for i in range(deneme):
        try:
            req = urllib.request.Request(API + yol, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                veri = json.load(r)
            time.sleep(0.3)
            return veri["data"]
        except Exception as e:  # noqa: BLE001 - ağ hatalarında yeniden dene
            if i == deneme - 1:
                raise RuntimeError(f"TBF isteği başarısız: {yol} ({e})") from e
            time.sleep(2 * (i + 1))


def json_yaz(yol, veri):
    yol.parent.mkdir(parents=True, exist_ok=True)
    # newline="\n": Windows'ta da Linux satır sonu yaz; yoksa telefon ve bilgisayar her çalıştığında
    # aynı içerikli dosyalar satır sonu yüzünden değişmiş görünür
    yol.write_text(json.dumps(veri, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")


def saniye(sure):
    """'25:48' -> 1548"""
    try:
        dk, sn = (sure or "0:00").split(":")
        return int(dk) * 60 + int(sn)
    except ValueError:
        return 0


def durum_adi(status_id):
    if status_id == DURUM_BITTI:
        return "bitti"
    if status_id == DURUM_OYNANMADI:
        return "oynanmadi"
    return "canli"


def mac_verisi(uc, onek, mac_id, bitti):
    """Biten maçlar önbellekten okunur; canlı maçlar her seferinde yeniden çekilir."""
    cache_yol = CACHE / f"{onek}-{mac_id}.json"
    if bitti and cache_yol.exists():
        return json.loads(cache_yol.read_text(encoding="utf-8"))
    veri = api(f"/Match/{uc}?matchId={mac_id}")
    # TBF maçı "bitti" yapıp istatistikleri birkaç dakika geç yayınlayabiliyor: boş veriyi saklama
    dolu = (veri or {}).get("homeTopFive") or (veri or {}).get("homeTeamScore")
    if bitti and dolu:
        json_yaz(cache_yol, veri)
    return veri


# ---------- FIBA LiveStats: maç sırasındaki canlı veri ----------
# TBF maç sırasında oyuncu istatistiği yayınlamıyor (maç "oynanmadı" görünür, istatistik boştur).
# Başlamış bir maçın canlı verisi, TBF'nin de kullandığı FIBA LiveStats'in herkese açık akışından
# okunur; TBF maçı "bitti" diye işaretleyince kesin veri TBF'den alınır.
FIBA_URL = "https://fibalivestats.dcd.shared.geniussports.com/data/{}/data.json"
TR_HARF = str.maketrans({"ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u", "â": "a", "î": "i", "û": "u"})


def ad_anahtari(ad):
    """'Ali Işık (K)' ve 'ALI ISIK' aynı anahtara iner."""
    s = (ad or "").replace("İ", "i").replace("I", "ı").lower().translate(TR_HARF)
    return " ".join("".join(c if c.isalnum() else " " for c in s.replace("(k)", " ")).split())


def fiba_canli(genius_id):
    try:
        req = urllib.request.Request(FIBA_URL.format(genius_id), headers={"User-Agent": HEADERS["User-Agent"]})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except Exception as e:  # noqa: BLE001 - canlı veri yoksa maç "oynanmadı" kalır
        print(f"  FIBA canlı veri alınamadı ({genius_id}): {e}")
        return None


def fiba_sure(sure):
    """FIBA bazen '29:60' yazar -> '30:00'"""
    sn = saniye(sure)
    return f"{sn // 60}:{sn % 60:02d}"


def fiba_istatistik(d, takimlar, rehber):
    """FIBA verisini TBF mac-istatistik / mac-ozet biçimine çevirir. Oyuncular TBF kimliğiyle
    ad + takım üzerinden eşleştirilir (iki kaynak da TBF'nin oyuncu kayıtlarını kullanıyor)."""
    kimlik = {(ad_anahtari(v.get("ad")), v.get("takim")): pid for pid, v in rehber.items()}
    stat, ozet = {}, {}
    for tno, taraf, kisa in (("1", "home", "ev"), ("2", "away", "dep")):
        tm = d["tm"][tno]
        ilk5, yedek = [], []
        for p in (tm.get("pl") or {}).values():
            ad = f"{p.get('firstName', '')} {p.get('familyName', '')}".strip()
            pid = kimlik.get((ad_anahtari(ad), takimlar[kisa])) or "fiba-" + ad_anahtari(ad).replace(" ", "-")
            kayit = {
                "playerId": pid, "playerName": ad, "jerseyNumber": p.get("shirtNumber"),
                "isStarter": bool(p.get("starter")), "minutesPlayed": fiba_sure(p.get("sMinutes")),
                "points": p.get("sPoints", 0), "efficiency": p.get("eff_1", 0),
                "twoPointShots": p.get("sTwoPointersMade", 0), "twoPointShotAttempts": p.get("sTwoPointersAttempted", 0),
                "threePointShots": p.get("sThreePointersMade", 0), "threePointShotAttempts": p.get("sThreePointersAttempted", 0),
                "freeThrows": p.get("sFreeThrowsMade", 0), "freeThrowAttempts": p.get("sFreeThrowsAttempted", 0),
                "offensiveRebounds": p.get("sReboundsOffensive", 0), "defensiveRebounds": p.get("sReboundsDefensive", 0),
                "totalRebounds": p.get("sReboundsTotal", 0), "assists": p.get("sAssists", 0),
                "steals": p.get("sSteals", 0), "blocks": p.get("sBlocks", 0), "turnovers": p.get("sTurnovers", 0),
                "fouls": p.get("sFoulsPersonal", 0), "plusMinus": str(p.get("sPlusMinusPoints", 0)),
            }
            (ilk5 if kayit["isStarter"] else yedek).append(kayit)
        stat[f"{taraf}TopFive"], stat[f"{taraf}BenchPlayers"] = ilk5, yedek
        ozet[f"{taraf}TeamScore"] = [{"score": tm[k], "quarter": int(k[1:-6])}
                                     for k in tm if k.startswith("p") and k.endswith("_score") and k[1:-6].isdigit()]
    skorlar = {"ev": str(d["tm"]["1"].get("score", 0)), "dep": str(d["tm"]["2"].get("score", 0))}
    return stat, ozet, skorlar


def fiba_basladi(d):
    return any(saniye(p.get("sMinutes")) > 0 for t in d.get("tm", {}).values() for p in (t.get("pl") or {}).values())


def mac_saatinde(m):
    """Maçın başlamış olması beklenen zaman aralığında mıyız (başlama -10 dk ile +4 saat arası)."""
    baslama = datetime.fromisoformat(m["matchDate"])
    simdi = datetime.now(TURKIYE).replace(tzinfo=None)
    return baslama - timedelta(minutes=10) <= simdi <= baslama + MAC_PENCERESI


def mac_istatistik(mac_id, bitti):
    return mac_verisi("mac-istatistik", "mac", mac_id, bitti)


def mac_ozet(mac_id, bitti):
    """Çeyrek skorları için."""
    return mac_verisi("mac-ozet", "ozet", mac_id, bitti)


def kutu_skor(mac, stat, ozet):
    """Maç sayfası için box score: iki takımın oyuncu istatistikleri ve çeyrek skorları."""
    takimlar = {}
    for taraf, ilk5, bench, ceyrek in (("ev", "homeTopFive", "homeBenchPlayers", "homeTeamScore"),
                                       ("dep", "awayTopFive", "awayBenchPlayers", "awayTeamScore")):
        oyuncular = []
        for o in (stat.get(ilk5) or []) + (stat.get(bench) or []):
            oyuncular.append({
                "id": str(o["playerId"]), "ad": o["playerName"].strip(), "no": o.get("jerseyNumber"),
                "ilk5": bool(o.get("isStarter")), "sure": o["minutesPlayed"], "sayi": o["points"],
                "iki": [o["twoPointShots"], o["twoPointShotAttempts"]],
                "uc": [o["threePointShots"], o["threePointShotAttempts"]],
                "sa": [o["freeThrows"], o["freeThrowAttempts"]],
                "hr": o["offensiveRebounds"], "sr": o["defensiveRebounds"], "rib": o["totalRebounds"],
                "ast": o["assists"], "tc": o["steals"], "blk": o["blocks"], "tk": o["turnovers"],
                "faul": o["fouls"], "pm": o.get("plusMinus"), "vp": o["efficiency"],
            })
        takimlar[taraf] = {
            "ad": mac[taraf], "skor": mac[f"{taraf}Skor"], "oyuncular": oyuncular,
            "ceyrekler": [c["score"] for c in sorted((ozet or {}).get(ceyrek) or [], key=lambda c: c["quarter"])],
        }
    return {**mac, **takimlar}


def hafta_mac_listesi(hafta, guncel, lig_id=LIG_ID, onek="hafta"):
    """Haftanın maç listesi; tüm maçları bitmiş geçmiş haftalar önbellekten okunur."""
    cache_yol = CACHE / f"{onek}-{hafta}-maclar.json"
    if hafta < guncel and cache_yol.exists():
        return json.loads(cache_yol.read_text(encoding="utf-8"))
    maclar = api(f"/Match/get-all-matches-for-filter?ActivityId={lig_id}&WeekFilter={hafta}&Page=1&PageSize=-1")
    if hafta < guncel and all(m["matchStatusId"] == DURUM_BITTI for m in maclar):
        json_yaz(cache_yol, maclar)
    return maclar


def mac_kaydi(m, hafta, lig):
    """TBF maç kaydının sitedeki hali (fikstür ve skor)."""
    return {
        "id": m["matchId"], "lig": lig, "hafta": hafta, "tarih": m["matchDate"], "durum": durum_adi(m["matchStatusId"]),
        "ev": m["homeTeam"]["name"], "dep": m["awayTeam"]["name"],
        "evSkor": m["homeTeam"]["score"] or None, "depSkor": m["awayTeam"]["score"] or None,
        "salon": m.get("salonAdi"), "yayin": m.get("broadcastChannel"),
    }


def lig_haftasi_yaz(lig, hafta, maclar):
    """Maçlar sekmesinin haftalık listesi: site/data/maclar/<lig>-<hafta>.json"""
    json_yaz(SITE_DATA / "maclar" / f"{lig}-{hafta}.json", {"lig": lig, "hafta": hafta, "maclar": maclar})


def bsl_guncelle():
    """BSL maçları (fantezi puanına girmez, sadece Maçlar sekmesi için): fikstür, skorlar ve biten
    maçların box score'u. BSL'de canlı veri çekilmez; maç TBF'de bitince sonucu görünür."""
    haftalar = api(f"/League/get-league-weeks?leagueId={BSL_LIG_ID}&seasonId={SEZON_ID}")
    guncel = next((int(h["sezon_Hafta"]) for h in haftalar if h["isCurrentWeek"]), 1)
    son = guncel + 1 if any(int(h["sezon_Hafta"]) == guncel + 1 for h in haftalar) else guncel
    for hafta in range(1, son + 1):
        listesi = sorted(hafta_mac_listesi(hafta, guncel, BSL_LIG_ID, "bsl-hafta"), key=lambda x: x["matchDate"])
        maclar = [mac_kaydi(m, hafta, "bsl") for m in listesi]
        for mac in maclar:
            if mac["durum"] == "bitti":
                stat, ozet = mac_istatistik(mac["id"], True), mac_ozet(mac["id"], True)
                json_yaz(SITE_DATA / "mac" / f"{mac['id']}.json", kutu_skor(mac, stat, ozet))
        lig_haftasi_yaz("bsl", hafta, maclar)
    print(f"BSL: güncel hafta {guncel}, {son} haftanın maçları yazıldı")
    return {"haftalar": list(range(1, son + 1)), "guncel": guncel}


def guncelleme_gerekli(guncel):
    """--akilli modda: sadece maç saatlerinde ya da yeni biten maç varsa çalış."""
    if not (SITE_DATA / "hafta" / f"{guncel}.json").exists():
        return True
    simdi = datetime.now(TURKIYE).replace(tzinfo=None)
    for m in api(f"/Match/get-all-matches-for-filter?ActivityId={LIG_ID}&WeekFilter={guncel}&Page=1&PageSize=-1"):
        baslama = datetime.fromisoformat(m["matchDate"])
        if m["matchStatusId"] == DURUM_BITTI:
            if not (CACHE / f"mac-{m['matchId']}.json").exists():
                return True  # bitti ama son hali henüz çekilmedi
        elif baslama - timedelta(minutes=15) <= simdi <= baslama + MAC_PENCERESI:
            return True  # oynanıyor ya da başlamak üzere
    return False


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    akilli = "--akilli" in sys.argv
    ayarlar = json.loads((SITE_DATA / "ayarlar.json").read_text(encoding="utf-8"))
    baslangic = int(ayarlar["baslangicHaftasi"])

    haftalar = api(f"/League/get-league-weeks?leagueId={LIG_ID}&seasonId={SEZON_ID}")
    guncel = next((int(h["sezon_Hafta"]) for h in haftalar if h["isCurrentWeek"]), baslangic)
    print(f"Güncel TBL haftası: {guncel}")

    rehber_yol = SITE_DATA / "oyuncular.json"
    index_yol = SITE_DATA / "hafta" / "index.json"
    # Dosya tarihine bakılmaz: GitHub her çalışmada dosyaları yeniden indirir, tarih hep "şimdi" olur
    onceki_index = json.loads(index_yol.read_text(encoding="utf-8")) if index_yol.exists() else {}
    rehber_zamani = onceki_index.get("rehberGuncelleme")
    rehber_eski = (not rehber_yol.exists() or not rehber_zamani or
                   (datetime.now(timezone.utc) - datetime.fromisoformat(rehber_zamani)).total_seconds() > REHBER_YENILEME_SN)
    if akilli and not rehber_eski and not guncelleme_gerekli(guncel):
        print("Şu an oynanan ya da yeni biten maç yok, atlandı.")
        return

    rehber = json.loads(rehber_yol.read_text(encoding="utf-8")) if rehber_yol.exists() else {}
    gecmis = {}  # oyuncu id -> sezon boyunca maç maç istatistikleri
    # Oyuncu geçmişi için 1. haftadan itibaren tüm maçlar işlenir; biten haftalar ve maçlar
    # önbellekten okunduğu için TBF'ye sadece güncel/eksik haftalar için gidilir.
    for hafta in range(1, guncel + 1):
        hafta_maclar, hafta_oyuncular = [], {}
        for m in sorted(hafta_mac_listesi(hafta, guncel), key=lambda x: x["matchDate"]):
            mac = mac_kaydi(m, hafta, "tbl")
            takimlar = {"ev": mac["ev"], "dep": mac["dep"]}
            # TBF'de henüz "oynanmadı" görünen ama başlamış maç: canlı veri FIBA'dan
            canli = None
            if mac["durum"] != "bitti" and m.get("genuisId") and mac_saatinde(m):
                d = fiba_canli(m["genuisId"])
                if d and fiba_basladi(d):
                    canli = fiba_istatistik(d, takimlar, rehber)
                    mac.update(durum="canli", evSkor=canli[2]["ev"], depSkor=canli[2]["dep"])
                    # Son güncellemedeki çeyrek ve maç saati ("3. Çeyrek · 04:12")
                    mac["canliDurum"] = {"periyot": d.get("period"), "saat": d.get("clock"),
                                         "uzatma": d.get("periodType") == "OVERTIME"}
            durum, skorlar = mac["durum"], {"ev": mac["evSkor"], "dep": mac["depSkor"]}
            hafta_maclar.append(mac)
            if durum == "oynanmadi":
                continue
            if canli:
                stat, ozet = canli[0], canli[1]
            else:
                stat = mac_istatistik(m["matchId"], durum == "bitti")
                ozet = mac_ozet(m["matchId"], durum == "bitti")
            json_yaz(SITE_DATA / "mac" / f"{m['matchId']}.json", kutu_skor(mac, stat, ozet))
            for liste, taraf in STAT_LISTELERI:
                rakip_taraf = "dep" if taraf == "ev" else "ev"
                for o in stat.get(liste) or []:
                    pid = str(o["playerId"])
                    if not pid.startswith("fiba-"):  # TBF'de eşleşmeyen canlı oyuncu rehbere girmez
                        rehber.setdefault(pid, {}).update(ad=o["playerName"].strip(), takim=takimlar[taraf])
                    kayit = hafta_oyuncular.setdefault(pid, {
                        "ad": o["playerName"].strip(), "takim": takimlar[taraf], "vp": 0, "saniye": 0, "maclar": []})
                    kayit["vp"] += o["efficiency"] or 0
                    kayit["saniye"] += saniye(o["minutesPlayed"])
                    kayit["maclar"].append(m["matchId"])
                    gecmis.setdefault(pid, []).append({
                        "hafta": hafta, "mac": m["matchId"], "tarih": m["matchDate"], "durum": durum,
                        "takim": takimlar[taraf], "rakip": takimlar[rakip_taraf], "evde": taraf == "ev",
                        "skor": skorlar[taraf], "rakipSkor": skorlar[rakip_taraf],
                        "sure": o["minutesPlayed"], "sayi": o["points"], "rib": o["totalRebounds"],
                        "ast": o["assists"], "tc": o["steals"], "blk": o["blocks"], "tk": o["turnovers"],
                        "vp": o["efficiency"],
                    })

        if hafta == guncel:
            guncel_maclar = hafta_maclar
        lig_haftasi_yaz("tbl", hafta, hafta_maclar)
        if hafta >= baslangic:
            json_yaz(SITE_DATA / "hafta" / f"{hafta}.json",
                     {"hafta": hafta, "maclar": hafta_maclar, "oyuncular": hafta_oyuncular})
            biten = sum(1 for x in hafta_maclar if x["durum"] == "bitti")
            print(f"  Hafta {hafta}: {biten}/{len(hafta_maclar)} maç bitti, {len(hafta_oyuncular)} oyuncu")

    for pid, maclar in gecmis.items():
        json_yaz(SITE_DATA / "oyuncu" / f"{pid}.json", maclar)

    # Telefon hangi günler sık çalışacağını internete çıkmadan buradan okur (telefon/guncelle.sh):
    # bu haftanın ve gelecek haftanın maç günleri (Cuma maçları dahil)
    mac_gunleri = {m["tarih"][:10] for m in guncel_maclar}
    # Maç saatleri: telefon "şu an bir maç saatinde miyiz?" sorusunu internete çıkmadan bunlardan cevaplar
    mac_saatleri = [{"tarih": m["tarih"], "bitti": m["durum"] == "bitti"} for m in guncel_maclar]
    tbl_son = guncel
    if any(int(h["sezon_Hafta"]) == guncel + 1 for h in haftalar):
        sonraki = api(f"/Match/get-all-matches-for-filter?ActivityId={LIG_ID}&WeekFilter={guncel + 1}&Page=1&PageSize=-1")
        mac_gunleri |= {m["matchDate"][:10] for m in sonraki}
        mac_saatleri += [{"tarih": m["matchDate"], "bitti": m["matchStatusId"] == DURUM_BITTI} for m in sonraki]
        # Maçlar sekmesinde gelecek haftanın fikstürü de görünsün
        tbl_son = guncel + 1
        lig_haftasi_yaz("tbl", tbl_son, [mac_kaydi(m, tbl_son, "tbl") for m in sorted(sonraki, key=lambda x: x["matchDate"])])

    # Maçlar sekmesi: TBL'nin bütün haftaları ve BSL. BSL alınamazsa önceki BSL verisi kalır.
    maclar_index = {"tbl": {"haftalar": list(range(1, tbl_son + 1)), "guncel": guncel}}
    try:
        maclar_index["bsl"] = bsl_guncelle()
    except Exception as e:  # noqa: BLE001 - BSL hatası fantezi verisini engellemesin
        print(f"BSL maçları alınamadı: {e}")
        if onceki_index.get("maclar", {}).get("bsl"):
            maclar_index["bsl"] = onceki_index["maclar"]["bsl"]

    # Takım kadroları (günde iki kez): henüz maç kadrosuna girmemiş oyuncuları ekler, transferde
    # güncel takımı ve boştaki oyuncular listesi için sezon ortalamalarını verir.
    # Hiçbir TBL kadrosunda olmayan oyuncu (ligden ayrılan) aktif=False olur.
    if rehber_eski or "--kadrolar" in sys.argv:
        rehber_zamani = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for v in rehber.values():
            v["aktif"] = False
        for t in api(f"/Team/get-teams-by-leauge?leaugeId={LIG_ID}"):
            kadro = api(f"/Team/get-team-active-player-list-by-season-and-league?LeagueId={LIG_ID}"
                        f"&SeasonId={SEZON_ID}&TeamProcessId={t['teamProcessId']}&prefix=tbl") or []
            for o in kadro:
                pid = str(o["personId"])
                ad = rehber.get(pid, {}).get("ad") or f"{o['firstName']} {o['lastName']}".strip()
                rehber[pid] = {
                    "ad": ad, "takim": t["teamName"], "aktif": True,
                    "ulke": o.get("country") or "",  # haftalık eşitlikte Türk oyuncuların VP'si için
                    "mac": o.get("macSayisi") or 0,
                    "vpOrt": round(o.get("verimlilikPuani") or 0, 1),
                    "sayiOrt": round(o.get("sayi") or 0, 1),
                    "sureOrt": o.get("sure") or "00:00",
                }

    json_yaz(rehber_yol, dict(sorted(rehber.items(), key=lambda kv: kv[1]["ad"])))
    json_yaz(index_yol, {
        "haftalar": list(range(baslangic, guncel + 1)), "guncelHafta": guncel,
        "guncelleme": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rehberGuncelleme": rehber_zamani,
        "macGunleri": sorted(mac_gunleri),
        "macSaatleri": sorted(mac_saatleri, key=lambda x: x["tarih"]),
        "maclar": maclar_index,
    })
    print(f"Oyuncu rehberi: {len(rehber)} oyuncu. Tamamlandı.")


if __name__ == "__main__":
    main()
