"""TBF sitesinden TBL maçlarını ve oyuncu verimlilik (VP) puanlarını çeker.

Çıktılar:
  site/data/hafta/<n>.json   -> başlangıç haftasından güncel haftaya kadar haftalık VP verisi
  site/data/hafta/index.json -> mevcut haftalar ve güncel hafta
  site/data/oyuncular.json   -> oyuncu rehberi (id, ad, TBL takımı, sezon ortalamaları)
  site/data/oyuncu/<id>.json -> oyuncunun sezon boyunca maç maç istatistikleri
  site/data/mac/<id>.json    -> maçın box score'u (iki takımın oyuncu istatistikleri, çeyrek skorları)
  site/data/maclar/<lig>-<n>.json -> Maçlar sekmesi: TBL'nin ve BSL'nin haftalık maç listesi
  site/data/bsl-oyuncu/<id>.json  -> BSL oyuncusunun adı, takımı ve maç maç istatistikleri
  site/data/artieksi/<lig>.json   -> TBL ve BSL oyuncularının haftalık ve sezon boyu +/- toplamları

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


def oyuncu_maci(o, mac, taraf):
    """Oyuncu sayfası için bir maçtaki istatistikleri."""
    rakip = "dep" if taraf == "ev" else "ev"
    return {
        "hafta": mac["hafta"], "mac": mac["id"], "tarih": mac["tarih"], "durum": mac["durum"],
        "takim": mac[taraf], "rakip": mac[rakip], "evde": taraf == "ev",
        "skor": mac[f"{taraf}Skor"], "rakipSkor": mac[f"{rakip}Skor"],
        "sure": o["minutesPlayed"], "sayi": o["points"], "rib": o["totalRebounds"],
        "ast": o["assists"], "tc": o["steals"], "blk": o["blocks"], "tk": o["turnovers"],
        "vp": o["efficiency"],
    }


def sonraki_hafta_basladi(haftalar, guncel, lig_id=LIG_ID):
    """TBF güncel haftayı sıradaki haftanın maçları başladıktan sonra değiştirebiliyor: sıradaki haftanın
    ilk maçının saati geldiyse (10 dk kala) o hafta güncel sayılır, canlı verisi kaçmasın."""
    if not any(int(h["sezon_Hafta"]) == guncel + 1 for h in haftalar):
        return False
    simdi = datetime.now(TURKIYE).replace(tzinfo=None)
    maclar = api(f"/Match/get-all-matches-for-filter?ActivityId={lig_id}&WeekFilter={guncel + 1}&Page=1&PageSize=-1")
    return any(datetime.fromisoformat(m["matchDate"]) - timedelta(minutes=10) <= simdi
               for m in maclar if not m["matchDate"].endswith("T00:00:00"))  # 00:00 = saati belli değil


def canli_mac(mac, m, rehber):
    """TBF'de henüz "oynanmadı" görünen ama başlamış maçın canlı verisi FIBA'dan: mac sözlüğünü
    günceller, (stat, ozet) döndürür; canlı veri yoksa None."""
    if mac["durum"] == "bitti" or not m.get("genuisId") or not mac_saatinde(m):
        return None
    d = fiba_canli(m["genuisId"])
    if not d or not fiba_basladi(d):
        return None
    stat, ozet, skorlar = fiba_istatistik(d, {"ev": mac["ev"], "dep": mac["dep"]}, rehber)
    mac.update(durum="canli", evSkor=skorlar["ev"], depSkor=skorlar["dep"])
    # Son güncellemedeki çeyrek ve maç saati ("3. Çeyrek · 04:12")
    mac["canliDurum"] = {"periyot": d.get("period"), "saat": d.get("clock"),
                         "uzatma": d.get("periodType") == "OVERTIME"}
    return stat, ozet


def artieksi_ekle(tablo, hafta, pid, mac, taraf, o):
    """+/- sıralaması için: oyuncunun o haftaki +/- toplamı ve takımının o maçlardaki skor farkı
    (süre almadıysa sayılmaz). Eşit +/-'de takımı daha kötü sonuç alan üstte: takımı 10 farkla
    kaybederken +21 yapan, takımı 7 farkla kazanırken +21 yapandan daha değerli."""
    if saniye(o["minutesPlayed"]) == 0:
        return
    rakip = "dep" if taraf == "ev" else "ev"
    fark = int(mac[f"{taraf}Skor"] or 0) - int(mac[f"{rakip}Skor"] or 0)
    try:
        pm = int(str(o.get("plusMinus") or 0).replace("+", ""))
    except ValueError:
        pm = 0
    k = tablo.setdefault(hafta, {}).setdefault(pid, {
        "id": pid, "ad": o["playerName"].strip(), "takim": mac[taraf], "pm": 0, "fark": 0, "mac": 0})
    k["pm"] += pm
    k["fark"] += fark
    k["mac"] += 1


def bsl_ulkeleri(yenile):
    """BSL oyuncularının ülkesi (TBF takım kadrolarından, günde iki kez yenilenir)."""
    yol = CACHE / "bsl-ulkeler.json"
    if yol.exists() and not yenile:
        return json.loads(yol.read_text(encoding="utf-8"))
    ulkeler = {}
    for t in api(f"/Team/get-teams-by-leauge?leaugeId={BSL_LIG_ID}"):
        for o in api(f"/Team/get-team-active-player-list-by-season-and-league?LeagueId={BSL_LIG_ID}"
                     f"&SeasonId={SEZON_ID}&TeamProcessId={t['teamProcessId']}&prefix=bsl") or []:
            ulkeler[str(o["personId"])] = o.get("country") or ""
    json_yaz(yol, ulkeler)
    return ulkeler


def artieksi_yaz(lig, tablo, ulkeler):
    """site/data/artieksi/<lig>.json: haftalık ve sezon boyu +/- (yönetici modundaki sıralama için).
    Ülke, paylaşılan görselde ismin Türkçe mi yazılacağı için (Ali -> ALİ, Mike -> MIKE)."""
    for kayitlar in tablo.values():
        for pid, k in kayitlar.items():
            k["ulke"] = ulkeler.get(pid, "")
    sezon = {}
    for hafta in sorted(tablo):
        for pid, k in tablo[hafta].items():
            t = sezon.setdefault(pid, {**k, "pm": 0, "fark": 0, "mac": 0})
            t.update(ad=k["ad"], takim=k["takim"])  # transfer olduysa son takımı
            t["pm"] += k["pm"]
            t["fark"] += k["fark"]
            t["mac"] += k["mac"]

    def sirala(kayitlar):
        # +/- büyükten küçüğe; eşitse takımın skor farkı küçük olan (takımına göre daha çok katkı) üstte
        return sorted(kayitlar, key=lambda k: (-k["pm"], k["fark"], k["ad"]))
    json_yaz(SITE_DATA / "artieksi" / f"{lig}.json", {
        "haftalar": {str(h): sirala(v.values()) for h, v in sorted(tablo.items())},
        "sezon": sirala(sezon.values()),
    })


def gelecek_haftalar(lig, lig_id, tbf_haftalar, son, yenile):
    """Sezonun kalan haftalarının fikstürü (Maçlar sekmesi). Uzak haftalar sık değişmediği için
    günde iki kez (yenile) ya da dosyası yoksa çekilir. Fikstürü yazılmış bütün haftaları döndürür."""
    hepsi = sorted(int(h["sezon_Hafta"]) for h in tbf_haftalar)
    for hafta in (h for h in hepsi if h > son):
        if yenile or not (SITE_DATA / "maclar" / f"{lig}-{hafta}.json").exists():
            maclar = api(f"/Match/get-all-matches-for-filter?ActivityId={lig_id}&WeekFilter={hafta}&Page=1&PageSize=-1")
            lig_haftasi_yaz(lig, hafta, [mac_kaydi(m, hafta, lig) for m in sorted(maclar or [], key=lambda x: x["matchDate"])])
    return [h for h in hepsi if h <= son or (SITE_DATA / "maclar" / f"{lig}-{h}.json").exists()]


def persembe(maclar):
    """Haftanın ilk maçından önceki Perşembe (o haftanın gösterilmeye başlayacağı gün)."""
    ilk = datetime.fromisoformat(min(m["tarih"] for m in maclar))
    gun = ilk.date() - timedelta(days=(ilk.weekday() - 3) % 7)
    return f"{gun.isoformat()}T00:00:00+03:00"


def lig_ozeti(haftalar, guncel, guncel_maclar, sonraki_maclar):
    """Maçlar sekmesinin lig bilgisi. Bu hafta bittiyse, sıradaki haftanın ilk maçından önceki
    Perşembe'den itibaren sıradaki hafta açılır."""
    ozet = {"haftalar": haftalar, "guncel": guncel,
            "guncelBitti": all(m["durum"] == "bitti" for m in guncel_maclar)}
    if sonraki_maclar:
        ozet["siradaki"] = {"hafta": guncel + 1, "gosterim": persembe(sonraki_maclar)}
    return ozet


def mac_saati(mac):
    """Telefonun "şu an maç saatinde miyiz?" listesi için."""
    return {"tarih": mac["tarih"], "bitti": mac["durum"] == "bitti", "lig": mac["lig"]}


def lig_haftasi_yaz(lig, hafta, maclar):
    """Maçlar sekmesinin haftalık listesi: site/data/maclar/<lig>-<hafta>.json"""
    json_yaz(SITE_DATA / "maclar" / f"{lig}-{hafta}.json", {"lig": lig, "hafta": hafta, "maclar": maclar})


def bsl_guncelle(yenile):
    """BSL maçları (fantezi puanına girmez; Maçlar sekmesi, BSL oyuncu sayfaları ve +/- için): fikstür,
    skorlar, box score'lar, BSL oyuncularının maç maç istatistikleri. Maç sırasında canlı veri TBL'deki
    gibi FIBA LiveStats'ten gelir. Döndürür: (lig özeti, telefonun maç saatleri listesi)"""
    haftalar = api(f"/League/get-league-weeks?leagueId={BSL_LIG_ID}&seasonId={SEZON_ID}")
    guncel = next((int(h["sezon_Hafta"]) for h in haftalar if h["isCurrentWeek"]), 1)
    if sonraki_hafta_basladi(haftalar, guncel, BSL_LIG_ID):
        guncel += 1
    son = guncel + 1 if any(int(h["sezon_Hafta"]) == guncel + 1 for h in haftalar) else guncel
    oyuncular = {}  # oyuncu id -> {ad, takim, maclar}: BSL oyuncu sayfaları için
    artieksi = {}
    hafta_maclari = {}
    for hafta in range(1, son + 1):
        listesi = sorted(hafta_mac_listesi(hafta, guncel, BSL_LIG_ID, "bsl-hafta"), key=lambda x: x["matchDate"])
        maclar = []
        for m in listesi:
            mac = mac_kaydi(m, hafta, "bsl")
            maclar.append(mac)
            # Canlı maçta oyuncular, daha önce oynadıkları BSL maçlarındaki TBF kimliğiyle eşleşir
            canli = canli_mac(mac, m, oyuncular)
            if mac["durum"] == "oynanmadi":
                continue
            if canli:
                stat, ozet = canli
            else:
                bitti = mac["durum"] == "bitti"
                stat, ozet = mac_istatistik(mac["id"], bitti), mac_ozet(mac["id"], bitti)
            json_yaz(SITE_DATA / "mac" / f"{mac['id']}.json", kutu_skor(mac, stat, ozet))
            for liste, taraf in STAT_LISTELERI:
                for o in stat.get(liste) or []:
                    pid = str(o["playerId"])
                    artieksi_ekle(artieksi, hafta, pid, mac, taraf, o)
                    if pid.startswith("fiba-"):  # TBF kimliği bilinmeyen canlı oyuncunun sayfası olmaz
                        continue
                    kayit = oyuncular.setdefault(pid, {"maclar": []})
                    # Ad ve takım en son maçtan (transfer olduysa yeni takımı)
                    kayit.update(ad=o["playerName"].strip(), takim=mac[taraf])
                    kayit["maclar"].append(oyuncu_maci(o, mac, taraf))
        hafta_maclari[hafta] = maclar
        lig_haftasi_yaz("bsl", hafta, maclar)
    for pid, kayit in oyuncular.items():
        json_yaz(SITE_DATA / "bsl-oyuncu" / f"{pid}.json", kayit)
    try:
        ulkeler = bsl_ulkeleri(yenile)
    except Exception as e:  # noqa: BLE001 - ülke bilinmezse isim yine yazılır
        print(f"BSL kadroları alınamadı: {e}")
        ulkeler = {}
    artieksi_yaz("bsl", artieksi, ulkeler)
    tum_haftalar = gelecek_haftalar("bsl", BSL_LIG_ID, haftalar, son, yenile)
    sonraki = hafta_maclari.get(guncel + 1, [])
    saatler = [mac_saati(m) for m in hafta_maclari.get(guncel, []) + sonraki]
    print(f"BSL: güncel hafta {guncel}, {len(tum_haftalar)} haftanın maçları yazıldı")
    return lig_ozeti(tum_haftalar, guncel, hafta_maclari.get(guncel, []), sonraki), saatler


def guncelleme_gerekli(guncel, onceki_index):
    """--akilli modda: sadece maç saatlerinde ya da yeni biten maç varsa çalış."""
    if not (SITE_DATA / "hafta" / f"{guncel}.json").exists():
        return True
    simdi = datetime.now(TURKIYE).replace(tzinfo=None)
    # BSL maçları: son veride kayıtlı maç saatlerinden
    for m in onceki_index.get("macSaatleri", []):
        baslama = datetime.fromisoformat(m["tarih"])
        if m.get("lig") == "bsl" and not m["bitti"] and baslama - timedelta(minutes=15) <= simdi <= baslama + MAC_PENCERESI:
            return True
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
    if sonraki_hafta_basladi(haftalar, guncel):
        guncel += 1
    print(f"Güncel TBL haftası: {guncel}")

    rehber_yol = SITE_DATA / "oyuncular.json"
    index_yol = SITE_DATA / "hafta" / "index.json"
    # Dosya tarihine bakılmaz: GitHub her çalışmada dosyaları yeniden indirir, tarih hep "şimdi" olur
    onceki_index = json.loads(index_yol.read_text(encoding="utf-8")) if index_yol.exists() else {}
    rehber_zamani = onceki_index.get("rehberGuncelleme")
    rehber_eski = (not rehber_yol.exists() or not rehber_zamani or
                   (datetime.now(timezone.utc) - datetime.fromisoformat(rehber_zamani)).total_seconds() > REHBER_YENILEME_SN)
    if akilli and not rehber_eski and not guncelleme_gerekli(guncel, onceki_index):
        print("Şu an oynanan ya da yeni biten maç yok, atlandı.")
        return

    rehber = json.loads(rehber_yol.read_text(encoding="utf-8")) if rehber_yol.exists() else {}
    gecmis = {}  # oyuncu id -> sezon boyunca maç maç istatistikleri
    artieksi = {}  # hafta -> oyuncu id -> +/- (yönetici modundaki sıralama için)
    # Oyuncu geçmişi için 1. haftadan itibaren tüm maçlar işlenir; biten haftalar ve maçlar
    # önbellekten okunduğu için TBF'ye sadece güncel/eksik haftalar için gidilir.
    for hafta in range(1, guncel + 1):
        hafta_maclar, hafta_oyuncular = [], {}
        for m in sorted(hafta_mac_listesi(hafta, guncel), key=lambda x: x["matchDate"]):
            mac = mac_kaydi(m, hafta, "tbl")
            takimlar = {"ev": mac["ev"], "dep": mac["dep"]}
            canli = canli_mac(mac, m, rehber)
            durum = mac["durum"]
            hafta_maclar.append(mac)
            if durum == "oynanmadi":
                continue
            if canli:
                stat, ozet = canli
            else:
                stat = mac_istatistik(m["matchId"], durum == "bitti")
                ozet = mac_ozet(m["matchId"], durum == "bitti")
            json_yaz(SITE_DATA / "mac" / f"{m['matchId']}.json", kutu_skor(mac, stat, ozet))
            for liste, taraf in STAT_LISTELERI:
                for o in stat.get(liste) or []:
                    pid = str(o["playerId"])
                    if not pid.startswith("fiba-"):  # TBF'de eşleşmeyen canlı oyuncu rehbere girmez
                        rehber.setdefault(pid, {}).update(ad=o["playerName"].strip(), takim=takimlar[taraf])
                    kayit = hafta_oyuncular.setdefault(pid, {
                        "ad": o["playerName"].strip(), "takim": takimlar[taraf], "vp": 0, "saniye": 0, "maclar": []})
                    kayit["vp"] += o["efficiency"] or 0
                    kayit["saniye"] += saniye(o["minutesPlayed"])
                    kayit["maclar"].append(m["matchId"])
                    gecmis.setdefault(pid, []).append(oyuncu_maci(o, mac, taraf))
                    artieksi_ekle(artieksi, hafta, pid, mac, taraf, o)

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
    artieksi_yaz("tbl", artieksi, {pid: v.get("ulke", "") for pid, v in rehber.items()})

    # Maç saatleri: telefon "şu an bir maç saatinde miyiz?" sorusunu internete çıkmadan bunlardan cevaplar
    # (bu haftanın ve gelecek haftanın TBL ve BSL maçları)
    mac_saatleri = [mac_saati(m) for m in guncel_maclar]
    tbl_son, siradaki, sonraki_maclar = guncel, None, []
    if any(int(h["sezon_Hafta"]) == guncel + 1 for h in haftalar):
        sonraki = api(f"/Match/get-all-matches-for-filter?ActivityId={LIG_ID}&WeekFilter={guncel + 1}&Page=1&PageSize=-1")
        tbl_son = guncel + 1
        sonraki_maclar = [mac_kaydi(m, tbl_son, "tbl") for m in sorted(sonraki, key=lambda x: x["matchDate"])]
        mac_saatleri += [mac_saati(m) for m in sonraki_maclar]
        lig_haftasi_yaz("tbl", tbl_son, sonraki_maclar)
        # Takım sayfaları, sıradaki haftanın ilk maçından önceki Perşembe'den itibaren o haftanın
        # kadrosunu gösterir (puanlamaya girmez; hafta başlayınca bu dosya gerçek veriyle yazılır)
        if sonraki_maclar and tbl_son >= baslangic:
            json_yaz(SITE_DATA / "hafta" / f"{tbl_son}.json", {"hafta": tbl_son, "maclar": sonraki_maclar, "oyuncular": {}})
            siradaki = {"hafta": tbl_son, "gosterim": persembe(sonraki_maclar)}

    # Maçlar sekmesi: TBL'nin ve BSL'nin sezon boyu bütün haftaları. BSL alınamazsa önceki BSL verisi kalır.
    fikstur_yenile = rehber_eski or "--kadrolar" in sys.argv
    maclar_index = {"tbl": lig_ozeti(gelecek_haftalar("tbl", LIG_ID, haftalar, tbl_son, fikstur_yenile),
                                     guncel, guncel_maclar, sonraki_maclar)}
    try:
        maclar_index["bsl"], bsl_saatleri = bsl_guncelle(fikstur_yenile)
        mac_saatleri += bsl_saatleri
    except Exception as e:  # noqa: BLE001 - BSL hatası fantezi verisini engellemesin
        print(f"BSL maçları alınamadı: {e}")
        if onceki_index.get("maclar", {}).get("bsl"):
            maclar_index["bsl"] = onceki_index["maclar"]["bsl"]
        mac_saatleri += [m for m in onceki_index.get("macSaatleri", []) if m.get("lig") == "bsl"]
    mac_gunleri = {m["tarih"][:10] for m in mac_saatleri}

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
        "siradaki": siradaki,
    })
    print(f"Oyuncu rehberi: {len(rehber)} oyuncu. Tamamlandı.")


if __name__ == "__main__":
    main()
