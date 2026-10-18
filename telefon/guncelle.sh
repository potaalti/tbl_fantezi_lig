#!/data/data/com.termux/files/usr/bin/bash
# Telefonda 15 dakikada bir tetiklenir (Android daha sık izin vermez). Şarjı korumak için:
#   - Maç günleri (fikstürden okunur, Cuma dahil) 13:00-22:00 arası her tetiklemede çalışır.
#   - O sırada canlı maç varsa telefon uyanık kalır ve canlı maç bitene kadar 5 dakikada bir
#     günceller (wake lock); canlı maç kalmayınca ya da 22:00 olunca normal düzene ve uykuya döner.
#   - Maç olmayan günler 13:00-22:00 arası günde bir kez kısa kontrol yapar (fikstür ve TBL kadroları).
#   - Diğer saatlerde internete bile bağlanmadan hemen kapanır.
# Çalıştığında TBF'den (maç sırasında FIBA LiveStats'ten) VP verilerini çeker, değişiklik varsa
# GitHub'a gönderir; GitHub siteyi yayınlar.
# Elle deneme:  bash telefon/guncelle.sh tam   (saat sınırı olmadan, her şeyi günceller)
# Not: Termux arka planda açık kalmalı ("Exit"e basılırsa Android görevi tetiklemiyor).
DEPO="$HOME/tbl-fantezi"
DEPO_URL="https://github.com/potaalti/tbl_fantezi_lig.git"
LOG="$HOME/tbl-guncelle.log"
GUNLUK_KONTROL="$HOME/.tbl-son-gunluk-kontrol"
DONGU_PID="$HOME/.tbl-canli-dongu.pid"
BASLANGIC_SAATI=13
BITIS_SAATI=22
CANLI_ARALIK_SN=300

saat_araliginda() {
  local saat
  saat=$(date +%H)
  [ "$saat" -ge "$BASLANGIC_SAATI" ] && [ "$saat" -lt "$BITIS_SAATI" ]
}

calismali_mi() {
  [ "$1" = "tam" ] && return 0
  local bugun
  bugun=$(date +%F)
  saat_araliginda || return 1
  # Maç günü mü? (fikstür telefondaki son veride; internete çıkmadan okunur)
  grep -q "\"$bugun\"" "$DEPO/site/data/hafta/index.json" 2>/dev/null && return 0
  # Maç olmayan gün: günde bir kez
  [ "$(cat "$GUNLUK_KONTROL" 2>/dev/null)" = "$bugun" ] && return 1
  echo "$bugun" > "$GUNLUK_KONTROL"
  return 0
}

dongu_calisiyor_mu() {
  [ -f "$DONGU_PID" ] && kill -0 "$(cat "$DONGU_PID")" 2>/dev/null
}

canli_mac_var_mi() {
  grep -q '"durum": "canli"' "$DEPO"/site/data/hafta/*.json 2>/dev/null
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

# Canlı maç sürdükçe 5 dakikada bir güncelle; bu sırada telefon uyumasın
canli_dongu() {
  canli_mac_var_mi || return 0
  echo $$ > "$DONGU_PID"
  termux-wake-lock
  echo "=== $(date '+%H:%M') canlı maç var: ${CANLI_ARALIK_SN} sn'de bir güncellenecek ===" >> "$LOG"
  while canli_mac_var_mi && saat_araliginda; do
    sleep "$CANLI_ARALIK_SN"
    guncelle >> "$LOG" 2>&1
    kirp
  done
  echo "=== $(date '+%H:%M') canlı maç kalmadı, normal düzene dönüldü ===" >> "$LOG"
  termux-wake-unlock
  rm -f "$DONGU_PID"
}

# Hepsi tek satırda: git reset bu dosyayı çalışırken değiştirse bile bash dosyanın devamını okumaz.
# Canlı maç döngüsü zaten çalışıyorsa 15 dakikalık tetikleme hemen çıkar (aynı anda iki güncelleme olmasın).
dongu_calisiyor_mu && exit 0; calismali_mi "$1" || exit 0; guncelle "$1" >> "$LOG" 2>&1; kirp; [ "$1" = "tam" ] || canli_dongu; exit 0
