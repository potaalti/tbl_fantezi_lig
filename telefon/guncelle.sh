#!/data/data/com.termux/files/usr/bin/bash
# Telefonda 15 dakikada bir tetiklenir (Android daha sık izin vermez). Şarjı korumak için:
#   - Maç saatlerinde (bir maçın başlamasına 10 dk kala, o maç TBF'de kesinleşene kadar; en fazla
#     4 saat): telefon uyanık kalır ve 3 dakikada bir günceller (wake lock). Maç saatleri telefondaki
#     son veriden okunur (bu ve gelecek hafta, Cuma maçları dahil).
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
GUNLUK_SAATLER="12 23"
MAC_ARALIK_SN=180

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

dongu_calisiyor_mu() {
  [ -f "$DONGU_PID" ] && kill -0 "$(cat "$DONGU_PID")" 2>/dev/null
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
    git fetch -q origin || return 1
    git reset -q --hard origin/main
    if [ "$1" = "tam" ]; then
      python fetch_tbf.py || return 1
    else
      python fetch_tbf.py --akilli || return 1
    fi
    git add -A
    git diff --cached --quiet && return 0
    git commit -q -m "Veriler güncellendi (telefon)"
    if git push -q; then
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

# Maç saatleri boyunca 3 dakikada bir güncelle; bu sırada telefon uyumasın
mac_dongusu() {
  echo $$ > "$DONGU_PID"
  termux-wake-lock
  echo "=== $(date '+%H:%M') maç saati: ${MAC_ARALIK_SN} sn'de bir güncellenecek ===" >> "$LOG"
  while mac_saatinde_mi; do
    guncelle >> "$LOG" 2>&1
    kirp
    sleep "$MAC_ARALIK_SN"
  done
  echo "=== $(date '+%H:%M') maç saati bitti, normal düzene dönüldü ===" >> "$LOG"
  termux-wake-unlock
  rm -f "$DONGU_PID"
}

# Hepsi tek komut: git reset bu dosyayı çalışırken değiştirse bile bash dosyanın devamını okumaz.
# Maç döngüsü zaten çalışıyorsa 15 dakikalık tetikleme hemen çıkar (aynı anda iki güncelleme olmasın).
if [ "$1" = "tam" ]; then
  guncelle tam >> "$LOG" 2>&1; kirp
elif dongu_calisiyor_mu; then
  :
elif mac_saatinde_mi; then
  mac_dongusu
elif gunluk_guncelleme_zamani_mi; then
  guncelle tam >> "$LOG" 2>&1; kirp
fi; exit 0
