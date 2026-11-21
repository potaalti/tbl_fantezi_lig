#!/data/data/com.termux/files/usr/bin/bash
# Telefonda 15 dakikada bir tetiklenir (Android daha sık izin vermez). Şarjı korumak için:
#   - Maç günü: o günün ilk maçından 3 saat önceden son maç bitene kadar telefon uyanık kalır (wake lock)
#     ve maç saatlerinde (bir maçın başlamasına 10 dk kala, o maç TBF'de kesinleşene kadar; en fazla 4 saat)
#     dakikada bir günceller; maç aralarında bekler. 2026-11-21: Android telefonu uyutunca 15 dakikalık görev
#     saatlerce tetiklenmedi (10:13'ten sonra hiç), 13:00 maçının döngüsü hiç başlamadı; artık maçtan 3 saat
#     önceki herhangi bir tetikleme yeter. Maç saatleri telefondaki son veriden okunur (TBL ve BSL'nin bu ve
#     gelecek haftası, Cuma maçları dahil). Döngü maç saatinde Pota Altı App'in telefon görevini de (BSL
#     Fantezi canlı VP) çalıştırır.
#   - Maç yokken: günde 2 güncelleme, 12:00'de (fikstür, maç saatleri, TBL kadroları) ve 23:00'te
#     (maç sonrası kesin sonuçlar).
#   - Diğer bütün tetiklemeler internete bile bağlanmadan hemen kapanır.
# Güncelleme: TBF'den (maç sırasında FIBA LiveStats'ten) VP verilerini çeker, değişiklik varsa
# GitHub'a gönderir; GitHub siteyi yayınlar.
# Elle deneme:  bash telefon/guncelle.sh tam   (saat sınırı olmadan, her şeyi günceller)
# Not: Termux arka planda açık kalmalı ("Exit"e basılırsa Android görevi tetiklemiyor).
DEPO="$HOME/tbl-fantezi"
DEPO_URL="https://github.com/potaalti/tbl_fantezi_lig.git"
LOG="$HOME/tbl-guncelle.log"
GUNLUK_KAYIT="$HOME/.tbl-gunluk-guncellemeler"
DONGU_PID="$HOME/.tbl-mac-dongusu.pid"
# Maç döngüsünün nabzı: her adımda dokunulur. 10 dakikadır dokunulmadıysa döngü takılmıştır (2026-11-09: 12:12'den sonra
# hiç veri gitmedi, Karşıyaka–Beşiktaş canlı güncellenmedi); sonraki tetikleme onu durdurup yeniden başlatır.
# Pota Altı App'in telefon görevi de (pota-alti-app/telefon/guncelle.sh) aynı dosyaya bakıp takılan döngüyü durdurur.
NABIZ="$HOME/.tbl-mac-dongusu.nabiz"
NABIZ_SINIR_SN=600
GUNLUK_SAATLER="12 23"
MAC_ARALIK_SN=60  # 2026-11-21: 3 dakikadan 1 dakikaya (kullanıcı: her alanda en hızlısı)

# Şu an bir maç saatinde miyiz? (telefondaki veriden, internete çıkmadan)
mac_saatinde_mi() {
  python - "$DEPO/site/data/hafta/index.json" <<'PY'
import json, os, sys
from datetime import datetime, timedelta
try:
    maclar = json.load(open(sys.argv[1], encoding="utf-8")).get("macSaatleri", [])
except Exception:
    sys.exit(1)
simdi = datetime.fromisoformat(os.environ["TBL_SIMDI"]) if os.environ.get("TBL_SIMDI") else datetime.now()
for m in maclar:
    if m.get("bitti") or m["tarih"].endswith("T00:00:00"):  # 00:00 = TBF'de saati belli olmayan maç
        continue
    baslama = datetime.fromisoformat(m["tarih"])
    if baslama - timedelta(minutes=10) <= simdi <= baslama + timedelta(hours=4):
        sys.exit(0)
sys.exit(1)
PY
}

# Maç günü penceresinde miyiz? Bugün bitmemiş (saati belli) maç varsa: ilk maçtan 3 saat önceden son maçın
# başlamasından 4 saat sonrasına kadar (bitmiş maçlar sayılmaz: hepsi bitince pencere kapanır)
mac_gunu_mu() {
  python - "$DEPO/site/data/hafta/index.json" <<'PY'
import json, os, sys
from datetime import datetime, timedelta
try:
    maclar = json.load(open(sys.argv[1], encoding="utf-8")).get("macSaatleri", [])
except Exception:
    sys.exit(1)
simdi = datetime.fromisoformat(os.environ["TBL_SIMDI"]) if os.environ.get("TBL_SIMDI") else datetime.now()
bugun = [datetime.fromisoformat(m["tarih"]) for m in maclar
         if not m.get("bitti") and not m["tarih"].endswith("T00:00:00") and m["tarih"].startswith(simdi.strftime("%Y-%m-%d"))]
sys.exit(0 if bugun and min(bugun) - timedelta(hours=3) <= simdi <= max(bugun) + timedelta(hours=4) else 1)
PY
}

# Günde 2 güncelleme: 12:00 ve 23:00'ten sonraki ilk tetiklemede (o gün yapılmadıysa)
gunluk_guncelleme_zamani_mi() {
  local saat bugun s
  saat=$(date +%H)
  bugun=$(date +%F)
  for s in $GUNLUK_SAATLER; do
    if [ "$saat" -ge "$s" ] && ! grep -qx "$bugun-$s" "$GUNLUK_KAYIT" 2>/dev/null; then
      echo "$bugun-$s" >> "$GUNLUK_KAYIT"
      tail -n 20 "$GUNLUK_KAYIT" > "$GUNLUK_KAYIT.tmp" && mv "$GUNLUK_KAYIT.tmp" "$GUNLUK_KAYIT"
      return 0
    fi
  done
  return 1
}

nabiz() { touch "$NABIZ"; }

# Döngü çalışıyor mu? Süreç yaşıyor ama nabız 10 dakikadan eskiyse takılmıştır: durdurulur, "çalışmıyor" sayılır
dongu_calisiyor_mu() {
  [ -f "$DONGU_PID" ] || return 1
  local pid yas
  pid=$(cat "$DONGU_PID")
  if ! kill -0 "$pid" 2>/dev/null; then rm -f "$DONGU_PID"; return 1; fi
  yas=$(( $(date +%s) - $(stat -c %Y "$NABIZ" 2>/dev/null || stat -c %Y "$DONGU_PID") ))
  [ "$yas" -le "$NABIZ_SINIR_SN" ] && return 0
  echo "=== $(date '+%H:%M') maç döngüsü ${yas} sn'dir takılı: durduruldu, yeniden başlıyor ===" >> "$LOG"
  pkill -P "$pid" 2>/dev/null
  kill "$pid" 2>/dev/null
  rm -f "$DONGU_PID"
  return 1
}

guncelle() {
  echo "=== $(date '+%Y-%m-%d %H:%M') ==="
  cd "$DEPO" || return 1
  # Android'de dosya izinleri farklı görünebilir; Git bunları değişiklik saymasın
  git config core.fileMode false
  # Depo taşınırsa/adı değişirse telefon kendini yeni adrese çevirsin
  git remote set-url origin "$DEPO_URL"
  git rebase --abort 2>/dev/null
  local deneme
  for deneme in 1 2 3; do
    # GitHub'daki son hali al. Telefondaki veriler her çalışmada TBF'den yeniden üretildiği için
    # yerel farklar güvenle atılabilir; böylece çakışmada takılıp kalmaz.
    # Her adımın süre sınırı var (timeout): takılan bir istek döngüyü kilitlemesin
    nabiz
    timeout 120 git fetch -q origin || return 1
    git reset -q --hard origin/main
    nabiz
    # Bilgisayar açıkken asıl kaynak o (pota-alti-app/veri/pc_dongu.py, maç saatinde 2 dakikada bir, günde 4 kez de
    # kadrolarla tam '(pc)' gönderir): canlı turda son 5 dakikada, günlük tam güncellemede son 30 dakikada bilgisayardan
    # gönderim varsa telefon atlar (2026-11-14 12:12'de telefonun çektiği eski TBF kadroları transferleri geri almıştı).
    # Elle "tam" her zaman çalışır. Bilgisayar kapanınca telefon kendiliğinden devralır.
    if [ "$1" != "tam" ]; then
      son_pc=$(git log -1 --format=%ct --grep='(pc)$' origin/main)
      sinir=300
      [ "$1" = "gunluk" ] && sinir=1800
      if [ -n "$son_pc" ] && [ $(( $(date +%s) - son_pc )) -lt $sinir ]; then
        echo "Bilgisayar çekiyor; telefon bu turu atladı."
        return 0
      fi
    fi
    if [ "$1" = "tam" ] || [ "$1" = "gunluk" ]; then
      timeout 900 python fetch_tbf.py || return 1
    else
      timeout 300 python fetch_tbf.py --akilli || return 1
    fi
    nabiz
    git add -A
    git diff --cached --quiet && return 0
    git commit -q -m "Veriler güncellendi (telefon)"
    if timeout 120 git push -q; then
      echo "GitHub'a gönderildi."
      return 0
    fi
    echo "Gönderilemedi; GitHub'daki son hali alıp tekrar deneniyor ($deneme/3)."
  done
  return 1
}

kirp() {
  tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
}

# Maç günü penceresi boyunca telefon uyumasın; maç saatlerinde dakikada bir güncelle (TBL/BSL canlı skor ve
# Pota Altı App'in BSL Fantezi canlı VP'si), maç aralarında dakikada bir bak. 12:00/23:00 günlük güncellemesi de
# döngü içinde yapılır (döngü çalışırken 15 dakikalık tetikleme hemen çıkar).
mac_dongusu() {
  echo $$ > "$DONGU_PID"
  nabiz
  termux-wake-lock
  echo "=== $(date '+%H:%M') maç günü: telefon uyanık, maç saatlerinde ${MAC_ARALIK_SN} sn'de bir güncellenecek ===" >> "$LOG"
  while mac_saatinde_mi || mac_gunu_mu; do
    nabiz
    if mac_saatinde_mi; then
      tur_basi=$(date +%s)
      guncelle >> "$LOG" 2>&1
      nabiz
      # Süre sınırı nabız sınırının (10 dk) altında: uzun sürse de bekçi döngüyü takıldı sanmasın
      [ -f "$HOME/pota-alti-app/telefon/guncelle.sh" ] && timeout 480 bash "$HOME/pota-alti-app/telefon/guncelle.sh"
      kirp
      # Turun kendisi de sürer: dakikanın kalanı kadar beklenir (tur dakikayı aştıysa hemen sonraki tur)
      kalan=$(( MAC_ARALIK_SN - ($(date +%s) - tur_basi) ))
      [ "$kalan" -gt 0 ] && sleep "$kalan"
    else
      if gunluk_guncelleme_zamani_mi; then guncelle gunluk >> "$LOG" 2>&1; kirp; fi
      sleep 60
    fi
  done
  echo "=== $(date '+%H:%M') maç saati bitti, normal düzene dönüldü ===" >> "$LOG"
  termux-wake-unlock
  rm -f "$DONGU_PID" "$NABIZ"
}

# Hepsi tek komut: git reset bu dosyayı çalışırken değiştirse bile bash dosyanın devamını okumaz.
# Maç döngüsü zaten çalışıyorsa 15 dakikalık tetikleme hemen çıkar (aynı anda iki güncelleme olmasın).
if [ "$1" = "tam" ]; then
  guncelle tam >> "$LOG" 2>&1; kirp
elif dongu_calisiyor_mu; then
  :
elif mac_saatinde_mi || mac_gunu_mu; then
  mac_dongusu
elif gunluk_guncelleme_zamani_mi; then
  guncelle gunluk >> "$LOG" 2>&1; kirp
fi; exit 0
