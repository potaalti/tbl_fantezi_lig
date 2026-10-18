#!/data/data/com.termux/files/usr/bin/bash
# Telefonda 15 dakikada bir çalışır: TBF'den VP verilerini çeker (maç saatleri dışında
# kendini atlar), değişiklik varsa GitHub'a gönderir. GitHub da siteyi yeniden yayınlar.
DEPO="$HOME/tbl-fantezi"
LOG="$HOME/tbl-guncelle.log"

guncelle() {
  echo "=== $(date '+%Y-%m-%d %H:%M') ==="
  cd "$DEPO" || return 1
  # Android'de dosya izinleri farklı görünebilir; Git bunları değişiklik saymasın
  git config core.fileMode false
  if ! git pull --rebase -q; then
    git rebase --abort 2>/dev/null
    return 1
  fi
  python fetch_tbf.py --akilli || return 1
  git add -A
  if ! git diff --cached --quiet; then
    git commit -q -m "Veriler güncellendi (telefon)"
    # Bu arada GitHub'da kadro değişikliği olduysa bir kez daha çekip tekrar dene
    git push -q || { git pull --rebase -q && git push -q; }
    echo "GitHub'a gönderildi."
  fi
}

guncelle >> "$LOG" 2>&1

# Log dosyası büyümesin
tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
