#!/data/data/com.termux/files/usr/bin/bash
# TBL Fantezi telefon kurulumu (Termux). Bir kez çalıştırılır:
#   pkg upgrade -y && pkg install -y curl && curl -sLO https://raw.githubusercontent.com/Joganita/TBL-FANTEZ-/main/telefon/kurulum.sh && bash kurulum.sh
# Gerekli paketleri kurar, GitHub'a giriş yaptırır, depoyu indirir ve 15 dakikalık görevi kurar.
set -e
DEPO_URL="https://github.com/Joganita/TBL-FANTEZ-.git"
DEPO="$HOME/tbl-fantezi"

echo
echo "[1/5] Paketler kuruluyor (birkaç dakika sürebilir)..."
echo "      Bir soru çıkarsa Enter'a basmanız yeterli."
# Yarım güncelleme kütüphane uyuşmazlığı yapar (ör. curl/openssl); önce hepsini güncelle
pkg upgrade -y
pkg install -y python git gh termux-api

echo
echo "[2/5] GitHub girişi"
if ! gh auth status >/dev/null 2>&1; then
  echo "      Ekranda 8 haneli bir kod çıkacak. Tarayıcıda github.com/login/device"
  echo "      adresini açıp kodu girin ve 'Authorize' deyin."
  gh auth login --hostname github.com --git-protocol https --web
fi
gh auth setup-git

echo
echo "[3/5] Depo indiriliyor..."
if [ ! -d "$DEPO/.git" ]; then
  git clone -q "$DEPO_URL" "$DEPO"
fi
cd "$DEPO"
git config user.name "tbl-fantezi-telefon"
git config user.email "tbl-fantezi-telefon@users.noreply.github.com"
# chmod izin değişikliğini Git yerel değişiklik saymasın (yoksa git pull reddeder)
git config core.fileMode false
chmod +x telefon/guncelle.sh

echo
echo "[4/5] İlk güncelleme yapılıyor (ilk seferde 1-2 dakika sürer)..."
bash telefon/guncelle.sh || true
tail -n 12 "$HOME/tbl-guncelle.log"

echo
echo "[5/5] 15 dakikada bir çalışacak görev kuruluyor..."
termux-job-scheduler --job-id 1 --script "$DEPO/telefon/guncelle.sh" \
  --period-ms 900000 --network any --persisted true
termux-job-scheduler --pending

echo
echo "Kurulum tamam. Telefon artık 15 dakikada bir TBF verilerini kontrol edecek."
echo "Son çalışmaları görmek için:  tail -n 30 ~/tbl-guncelle.log"
