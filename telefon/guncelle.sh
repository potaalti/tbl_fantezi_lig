#!/data/data/com.termux/files/usr/bin/bash
# Telefonda 15 dakikada bir tetiklenir. Şarjı korumak için:
#   - 23:00-12:00 arası hiç çalışmaz (internete bağlanmaz).
#   - Maç olan günler (Cuma/Cumartesi/Pazar; fikstürden okunur) 12:00-23:00 arası her seferinde çalışır.
#   - Maç olmayan günler 12:00'den sonra günde bir kez kısa kontrol yapar (fikstür ve TBL kadroları).
# Çalıştığında TBF'den VP verilerini çeker, değişiklik varsa GitHub'a gönderir; GitHub siteyi yayınlar.
# Elle deneme:  bash telefon/guncelle.sh tam   (saat sınırı olmadan, her şeyi günceller)
DEPO="$HOME/tbl-fantezi"
LOG="$HOME/tbl-guncelle.log"
GUNLUK_KONTROL="$HOME/.tbl-son-gunluk-kontrol"

calismali_mi() {
  [ "$1" = "tam" ] && return 0
  local saat bugun
  saat=$(date +%H)
  bugun=$(date +%F)
  # Gece ve sabah: hiç çalışma
  [ "$saat" -lt 12 ] || [ "$saat" -ge 23 ] && return 1
  # Maç günü mü? (fikstür telefondaki son veride; internete çıkmadan okunur)
  grep -q "\"$bugun\"" "$DEPO/site/data/hafta/index.json" 2>/dev/null && return 0
  # Maç olmayan gün: günde bir kez
  [ "$(cat "$GUNLUK_KONTROL" 2>/dev/null)" = "$bugun" ] && return 1
  echo "$bugun" > "$GUNLUK_KONTROL"
  return 0
}

guncelle() {
  echo "=== $(date '+%Y-%m-%d %H:%M') ==="
  cd "$DEPO" || return 1
  # Android'de dosya izinleri farklı görünebilir; Git bunları değişiklik saymasın
  git config core.fileMode false
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

# Hepsi tek satırda: git reset bu dosyayı çalışırken değiştirse bile bash dosyanın devamını okumaz
calismali_mi "$1" || exit 0; guncelle "$1" >> "$LOG" 2>&1; kirp; exit 0
