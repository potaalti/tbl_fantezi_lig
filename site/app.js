import { haftaSiralamasi, takimHaftaPuani, genelKlasman, haftaDurumu } from './scoring.js';

const YENILEME_MS = 60_000;
const SECIM_ANAHTARI = 'tbl-fantezi-takimim';
const veri = { ayarlar: null, kadrolar: [], index: null, haftalar: new Map() };
const icerik = document.getElementById('icerik');

// ---------- yardımcılar ----------
const kacis = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// "KİPAŞ K.B.B." -> "Kipaş K.B.B."; 3 harf ve altı kısaltmalar (MKE, OGM, TED) ve
// zaten küçük harf içeren kelimeler (iLab) olduğu gibi kalır
const baslik = s => String(s ?? '').split(' ').map(k =>
  k !== k.toLocaleUpperCase('tr') || k.replace(/\./g, '').length <= 3 ? k
    : k.toLocaleLowerCase('tr').replace(/(^|[.\-])(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('tr'))
).join(' ');

const dakika = sn => `${Math.floor(sn / 60)}:${String(sn % 60).padStart(2, '0')}`;
const tarihSaat = iso => new Date(iso).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const takimLinki = (ad, n) => `#/takim/${encodeURIComponent(ad)}/${n}`;

// Seçilen takım bu cihazda saklanır; depolama kapalıysa her açılışta yeniden sorulur
let seciliTakim = null;
try { seciliTakim = localStorage.getItem(SECIM_ANAHTARI); } catch { /* depolama yok */ }
function takimSec(ad) {
  seciliTakim = ad;
  try { localStorage.setItem(SECIM_ANAHTARI, ad); } catch { /* depolama yok */ }
}

async function json(yol) {
  const r = await fetch(`${yol}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${yol} yüklenemedi (${r.status})`);
  return r.json();
}

async function haftaYukle(n, zorla = false) {
  if (!zorla && veri.haftalar.has(n)) return veri.haftalar.get(n);
  const h = await json(`data/hafta/${n}.json`);
  veri.haftalar.set(n, h);
  return h;
}

async function kadrolariYukle() {
  const { haftalar } = await json('data/kadro/index.json');
  const kadrolar = await Promise.all(haftalar.map(n => json(`data/kadro/${n}.json`)));
  veri.kadrolar = haftalar.map((n, i) => ({ hafta: n, takimlar: kadrolar[i] }));
}

async function hepsiniYukle() {
  [veri.ayarlar, veri.index, veri.rehber] = await Promise.all([
    json('data/ayarlar.json'), json('data/hafta/index.json'), json('data/oyuncular.json'), kadrolariYukle(),
  ]);
  await Promise.all([...veri.index.haftalar.map(n => haftaYukle(n)), siradakiYukle()]);
}

// Sıradaki haftanın (henüz başlamamış) fikstürü; takım sayfalarında o haftanın kadrosu için
async function siradakiYukle() {
  const s = veri.index.siradaki;
  if (!s || veri.index.haftalar.includes(s.hafta)) return;
  try { await haftaYukle(s.hafta, true); } catch { /* dosya yoksa sıradaki hafta gösterilmez */ }
}

const sonHafta = () => veri.index.haftalar.at(-1);
const haftaListesi = () => veri.index.haftalar.map(n => veri.haftalar.get(n));
// Fantezi ligi TBL'nin başlangıç haftasında 1. hafta olarak başlar (TBL 7. hafta = 1. hafta).
// Adreslerde ve veride TBL hafta numarası kullanılır; ekranda fantezi hafta numarası gösterilir.
const fHafta = n => n - veri.ayarlar.baslangicHaftasi + 1;
// Haftalık eşitlikte Türk oyunculara bakılır; KKTC'li oyuncular da Türk sayılır
const TURK_ULKELER = new Set(['TÜRKİYE', 'KKTC']);
const turkMu = id => TURK_ULKELER.has(veri.rehber[id]?.ulke);
const haftaSirasi = n => haftaSiralamasi(kadroBul(n), veri.haftalar.get(n), veri.ayarlar.puanTablosu, turkMu);
const klasmanHesapla = haftalar => genelKlasman(kadroBul, haftalar, veri.ayarlar.puanTablosu, turkMu);
// Bir hafta, o haftadan önce kaydedilmiş en son kadroyla puanlanır
const kadroBul = n => (veri.kadrolar.findLast(k => k.hafta <= n) ?? veri.kadrolar[0]).takimlar;
const sonKadro = () => veri.kadrolar.at(-1).takimlar;
// Bu hafta bitmişse, sıradaki haftanın ilk maçından önceki Perşembe'den itibaren Haftalık ve takım
// sayfaları sıradaki haftayı gösterir (Genel klasman ve geçmiş haftalar değişmez)
function siradakiHafta() {
  const s = veri.index.siradaki;
  if (!s || !veri.haftalar.has(s.hafta) || veri.index.haftalar.includes(s.hafta) || new Date() < new Date(s.gosterim)) return null;
  return haftaDurumu(veri.haftalar.get(sonHafta())).tamamlandi ? s.hafta : null;
}
const gorunenHaftalar = () => siradakiHafta() ? [...veri.index.haftalar, siradakiHafta()] : veri.index.haftalar;
// Haftalık, Takımım ve Genel'deki takım bağlantıları güncel hafta yerine (Perşembe'den itibaren) sıradaki haftayı açar
const acilisHaftasi = n => n === sonHafta() && siradakiHafta() ? siradakiHafta() : n;

// ---------- ortak parçalar ----------
function haftaSecici(n, rota, h = veri.index.haftalar) {
  const i = h.indexOf(n);
  const d = haftaDurumu(veri.haftalar.get(n));
  const durum = !veri.index.haftalar.includes(n) ? 'Sıradaki hafta'
    : d.tamamlandi ? 'Tamamlandı' : `${d.bitti}/${d.toplam} maç bitti${d.canli ? ' · canlı' : ''}`;
  const [ust, alt] = [`${fHafta(n)}. Hafta`, `TBL ${n}. hafta · ${durum}`];
  const ok = (hedef, isaret) => hedef === undefined ? `<span class="pasif">${isaret}</span>` : `<a href="#/${rota}/${hedef}" aria-label="Hafta ${fHafta(hedef)}">${isaret}</a>`;
  return `<div class="hafta-secici">
    ${ok(h[i - 1], '‹')}
    <div class="baslik"><strong>${ust}</strong><small>${alt}</small></div>
    ${ok(h[i + 1], '›')}
  </div>`;
}

// Geçmiş haftalara hızlı geçiş düğmeleri (birden fazla hafta varsa)
function haftaCipleri(n, rota) {
  const h = gorunenHaftalar();
  if (h.length < 2) return '';
  return `<div class="secenekler hafta-cipleri">${h.map(k =>
    `<a class="secenek ${k === n ? 'aktif' : ''}" href="#/${rota}/${k}">${fHafta(k)}. hafta</a>`).join('')}</div>`;
}

const siraRozeti = sira => `<span class="sira ${sira <= 3 ? 's' + sira : ''}">${sira}</span>`;
const benimMi = ad => ad === seciliTakim ? 'benim' : '';

// ---------- ekranlar ----------
function secimEkrani() {
  const liste = [...sonKadro()].sort((a, b) => a.ad.localeCompare(b.ad, 'tr')).map(t => `
    <a class="satir ${benimMi(t.ad)}" href="#/sec/${encodeURIComponent(t.ad)}">
      <div class="ad"><strong>${kacis(t.ad)}</strong>${t.sahibi ? `<small>${kacis(t.sahibi)}</small>` : ''}</div>
      <span class="ok">›</span>
    </a>`).join('');
  return `<div class="karsilama"><strong>Takımını seç</strong><small>Seçimin bu telefonda hatırlanır, sonra değiştirebilirsin.</small></div>
    <section class="kart">${liste}</section>`;
}

// Hafta sürerken: puanı sayılan oyunculardan kaçının maçı başladı/bitti ("4/5 oynadı · 1 canlı").
// Takımı bay geçen ya da süre almayıp yerine kimse giremeyen oyuncunun puanı da belli olduğu için oynamış sayılır.
function ilerlemeYazisi(s) {
  const sayilan = [...s.aslar, ...s.yedekler].filter(o => o.sayildi);
  const oynadi = sayilan.filter(o => o.macDurumu !== 'oynanmadi').length;
  const canli = sayilan.filter(o => o.macDurumu === 'canli').length;
  return `${oynadi}/${sayilan.length} oynadı${canli ? ` · ${canli} canlı` : ''}`;
}

function haftalikEkran(n) {
  // Sıradaki hafta henüz başlamadı: sıra ve puan yok, takımlar alfabetik
  const siradaki = !veri.index.haftalar.includes(n);
  if (siradaki) {
    const satirlar = [...kadroBul(n)].sort((a, b) => a.ad.localeCompare(b.ad, 'tr')).map(t => `
    <a class="satir ${benimMi(t.ad)}" href="${takimLinki(t.ad, n)}">
      <span class="sira">–</span>
      <div class="ad"><strong>${kacis(t.ad)}</strong>${t.sahibi ? `<small>${kacis(t.sahibi)}</small>` : ''}</div>
      <div class="sayi"><strong>0</strong><small>VP</small></div>
    </a>`).join('');
    return `${haftaSecici(n, 'hafta', gorunenHaftalar())}${haftaCipleri(n, 'hafta')}
      <section class="kart"><h2>Maçlar başlayınca sıralama oluşur</h2>${satirlar}</section>`;
  }
  const siralama = haftaSirasi(n);
  const haftaBitti = haftaDurumu(veri.haftalar.get(n)).tamamlandi;
  const satirlar = siralama.map(s => {
    // Eşit VP'de sırayı en yüksek VP'li Türk oyuncu belirler; bunu satırda göster
    const esitlik = !s.vpEsitligi ? '' : s.enIyiTurk
      ? `Eşitlik: ${s.enIyiTurk.ad} ${s.enIyiTurk.vp} VP` : 'Eşitlik: Türk oyuncu yok';
    // İlerleme ve eşitlik notu ayrı satırlarda (aynı satırda telefonda sığmıyor)
    const alt = [[s.sahibi, haftaBitti ? '' : ilerlemeYazisi(s)].filter(Boolean).join(' · '), esitlik]
      .filter(Boolean).map(satir => `<small>${kacis(satir)}</small>`).join('');
    return `
    <a class="satir ${benimMi(s.ad)}" href="${takimLinki(s.ad, n)}">
      ${siraRozeti(s.sira)}
      <div class="ad"><strong>${kacis(s.ad)}</strong>${alt}</div>
      <div class="sayi"><strong>${s.toplam}</strong><small>VP</small></div>
      <span class="cip">+${s.puan}</span>
    </a>`;
  }).join('');
  return `${haftaSecici(n, 'hafta', gorunenHaftalar())}${haftaCipleri(n, 'hafta')}${paylasDugmesi('hafta', n)}<section class="kart"><h2>VP sıralaması · kazanılan puan</h2>${satirlar}</section>`;
}

function genelEkran() {
  const haftalar = haftaListesi();
  const klasman = klasmanHesapla(haftalar);
  // Önceki haftaya göre sıra değişimi
  const onceki = haftalar.length > 1 ? klasmanHesapla(haftalar.slice(0, -1)) : null;
  const oncekiSira = new Map(onceki?.map(s => [s.ad, s.sira]) ?? []);
  const satirlar = klasman.map((s, i) => {
    const fark = oncekiSira.has(s.ad) ? oncekiSira.get(s.ad) - s.sira : 0;
    const degisim = fark > 0 ? `<span class="degisim yukari">▲${fark}</span>` : fark < 0 ? `<span class="degisim asagi">▼${-fark}</span>` : '';
    // Toplam VP sadece puan eşitliğinde (sırayı o belirlediği için) gösterilir
    const puanEsitligi = [klasman[i - 1], klasman[i + 1]].some(k => k && k.puan === s.puan);
    const alt = puanEsitligi ? `<small>Eşitlik: toplam ${s.vp} VP</small>` : '';
    return `
    <a class="satir ${benimMi(s.ad)}" href="${takimLinki(s.ad, acilisHaftasi(sonHafta()))}">
      ${siraRozeti(s.sira)}
      <div class="ad"><strong>${kacis(s.ad)} ${degisim}</strong>${alt}</div>
      <div class="sayi"><strong>${s.puan}</strong><small>puan</small></div>
    </a>`;
  }).join('');
  const ilk = fHafta(haftalar[0]?.hafta), son = fHafta(haftalar.at(-1)?.hafta);
  const aralik = !haftalar.length ? '' : ilk === son ? `${ilk}. hafta` : `${ilk}–${son}. haftalar`;
  return `<div class="hafta-secici"><span></span><div class="baslik"><strong>Genel Klasman</strong><small>${aralik}</small></div><span></span></div>
    ${paylasDugmesi('genel')}
    <section class="kart"><h2>Haftalık puanların toplamı</h2>${satirlar}</section>`;
}

function oyuncuSatiri(o) {
  let durum;
  if (o.eslesmedi) durum = "TBF'de bulunamadı";
  else if (o.macDurumu === 'bay') durum = 'Takımı bay';
  else if (o.macDurumu === 'oynanmadi') durum = o.mac ? tarihSaat(o.mac.tarih) : 'Maç yok';
  else if (o.saniye === 0) durum = o.macDurumu === 'canli' ? 'Henüz süre almadı' : 'Süre almadı';
  else durum = `${dakika(o.saniye)} dk`;
  if (o.macDurumu === 'canli' && o.mac?.canliDurum) durum += ` · ${canliYazisi(o.mac, true)}`;

  let etiket = '';
  if (o.rol === 'as' && !o.sayildi) etiket = `<span class="etiket cikti">yerine ${kacis(o.yerineGiren)}</span>`;
  if (o.rol === 'yedek' && o.sayildi) etiket = `<span class="etiket girdi">${kacis(o.yerineGirdigi)} yerine</span>`;
  if (o.macDurumu === 'canli') etiket += '<span class="etiket canli-e">canlı</span>';
  const takim = o.tblTakim ? `${kacis(baslik(o.tblTakim))} · ` : '';

  const etiketAc = o.id ? `a href="#/oyuncu/${o.id}"` : 'div';
  return `<${etiketAc} class="satir oyuncu ${o.sayildi ? '' : 'sayilmadi'}">
    <div class="ad"><strong>${kacis(o.ad)}${etiket}</strong><small>${takim}${durum}</small></div>
    <div class="sayi"><strong>${o.vp}</strong><small>VP</small></div>
  </${o.id ? 'a' : 'div'}>`;
}

function takimEkrani(ad, n, kendi) {
  const takim = kadroBul(n).find(t => t.ad === ad);
  if (!takim) return '<p class="bos">Takım bulunamadı.</p>';
  const hafta = veri.haftalar.get(n);
  const sonuc = takimHaftaPuani(takim, hafta);
  const sira = haftaSirasi(n).find(s => s.ad === ad);
  const siradaki = !veri.index.haftalar.includes(n);
  const genel = klasmanHesapla(haftaListesi()).find(s => s.ad === ad);
  const rota = kendi ? 'takimim' : 'takim/' + encodeURIComponent(ad);
  const gecmis = genel.haftalar.slice().reverse().map(h => `
    <a class="satir" href="#/${rota}/${h.hafta}">
      <div class="ad"><strong>${fHafta(h.hafta)}. Hafta</strong><small>${h.vp} VP</small></div>
      <div class="sayi"><strong>${h.sira}.</strong></div>
      <span class="cip">+${h.puan}</span>
    </a>`).join('');
  const ust = kendi
    ? `<a class="geri" href="#/secim">Takım değiştir</a>`
    : geriLinki(`#/hafta/${n}`);

  return `${ust}
    <section class="kart">
      <div class="takim-baslik"><strong>${kacis(sonuc.ad)}</strong>${sonuc.sahibi ? `<small>${kacis(sonuc.sahibi)}</small>` : ''}</div>
      <div class="ozet">
        <div><strong>${siradaki ? '–' : sonuc.toplam}</strong><small>Hafta VP</small></div>
        <div><strong>${siradaki ? '–' : sira.sira + '.'}</strong><small>Hafta sırası</small></div>
        <div><strong>${genel.sira}.</strong><small>Genel (${genel.puan} p)</small></div>
      </div>
    </section>
    ${haftaSecici(n, rota, gorunenHaftalar())}
    <section class="kart"><h2>As kadro</h2>${sonuc.aslar.map(oyuncuSatiri).join('')}</section>
    <section class="kart"><h2>Yedekler</h2>${sonuc.yedekler.map(oyuncuSatiri).join('')}</section>
    <section class="kart"><h2>Haftalar</h2>${gecmis}</section>`;
}

// Boştaki oyuncular: aktif TBL kadrolarında olup hiçbir fantezi takımında olmayanlar
const SIRALAMALAR = {
  vp: { ad: 'VP ort.', fn: (a, b) => b.vpOrt - a.vpOrt },
  hafta: { ad: 'Bu hafta', fn: (a, b) => (b.buHafta ?? -99) - (a.buHafta ?? -99) },
  sayi: { ad: 'Sayı ort.', fn: (a, b) => b.sayiOrt - a.sayiOrt },
};
let arama = '';
const aramaNorm = s => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');

function bostakiOyuncular() {
  const sahipli = new Set(sonKadro().flatMap(t => [...t.as, ...t.yedek]).map(o => o.id).filter(Boolean));
  const hafta = veri.haftalar.get(sonHafta());
  return Object.entries(veri.rehber)
    .filter(([id, o]) => o.aktif && !sahipli.has(id))
    .map(([id, o]) => ({ id, ...o, buHafta: hafta.oyuncular[id]?.vp ?? null }));
}

function bostakiListesi(oyuncular) {
  const q = aramaNorm(arama.trim());
  const liste = q ? oyuncular.filter(o => aramaNorm(`${o.ad} ${o.takim}`).includes(q)) : oyuncular;
  if (!liste.length) return '<p class="bos">Oyuncu bulunamadı.</p>';
  return liste.map(o => `
    <a class="satir" href="#/oyuncu/${o.id}">
      <div class="ad"><strong>${kacis(o.ad)}</strong><small>${kacis(baslik(o.takim))} · ${o.mac} maç · ${o.sayiOrt} sayı</small></div>
      <div class="sayi ikincil"><strong>${o.buHafta ?? '–'}</strong><small>bu hafta</small></div>
      <div class="sayi"><strong>${o.vpOrt}</strong><small>VP ort.</small></div>
    </a>`).join('');
}

const gecerliSiralama = anahtar => SIRALAMALAR[anahtar] ? anahtar : 'vp';
const siraliBostakiler = anahtar => bostakiOyuncular().sort(SIRALAMALAR[gecerliSiralama(anahtar)].fn);

function bostakilerEkrani(siralamaAnahtari) {
  const siralama = gecerliSiralama(siralamaAnahtari);
  const oyuncular = siraliBostakiler(siralama);
  const secenekler = Object.entries(SIRALAMALAR).map(([k, s]) =>
    `<a class="secenek ${k === siralama ? 'aktif' : ''}" href="#/bostakiler/${k}">${s.ad}</a>`).join('');
  return `<div class="karsilama"><strong>Boştaki oyuncular</strong><small>${oyuncular.length} oyuncu hiçbir takımda değil. Transfer için lig yöneticisine bildir.</small></div>
    <input id="arama" class="arama" type="search" placeholder="Oyuncu ya da TBL takımı ara" value="${kacis(arama)}" autocomplete="off">
    <div class="secenekler">${secenekler}</div>
    <section class="kart" id="bostaki-liste">${bostakiListesi(oyuncular)}</section>`;
}

function bostakilerBagla(siralamaAnahtari) {
  const girdi = document.getElementById('arama');
  girdi.addEventListener('input', () => {
    arama = girdi.value;
    document.getElementById('bostaki-liste').innerHTML = bostakiListesi(siraliBostakiler(siralamaAnahtari));
  });
}

// Oyuncu detayı: TBL haftalarına göre maç maç istatistikler
const sureSn = s => { const [dk, sn] = String(s || '0:00').split(':').map(Number); return (dk || 0) * 60 + (sn || 0); };
const geriLinki = yedek => `<a class="geri" href="${yedek}" onclick="if (history.length > 1) { history.back(); return false; }">‹ Geri</a>`;

function oyuncuSahibi(id) {
  for (const t of sonKadro()) {
    if (t.as.some(o => o.id === id)) return `${t.ad} · As`;
    if (t.yedek.some(o => o.id === id)) return `${t.ad} · Yedek`;
  }
  return 'Boşta';
}

// BSL oyuncularının adı ve takımı rehberde yok; sayfa, oyuncunun BSL dosyası gelince doldurulur
function oyuncuEkrani(id, lig = 'tbl') {
  const o = lig === 'tbl' ? veri.rehber[id] : { ad: '…', takim: '' };
  if (!o) return '<p class="bos">Oyuncu bulunamadı.</p>';
  const alt = lig === 'tbl' ? `${kacis(baslik(o.takim))} · ${kacis(oyuncuSahibi(id))}` : 'BSL';
  return `${geriLinki(lig === 'tbl' ? '#/bostakiler' : '#/maclar/bsl')}
    <section class="kart">
      <div class="takim-baslik" id="oyuncu-baslik"><strong>${kacis(o.ad)}</strong><small>${alt}</small></div>
      <div class="ozet" id="oyuncu-ozet"><div><strong>…</strong><small>Maç</small></div><div><strong>…</strong><small>VP ort.</small></div><div><strong>…</strong><small>Sayı ort.</small></div></div>
    </section>
    <section class="kart"><h2>${LIGLER[lig]} haftaları</h2><div id="oyuncu-maclar"><p class="bos">Yükleniyor…</p></div></section>`;
}

// Oyuncunun o hafta istatistiği yoksa nedeni (sadece maç listesi elimizde olan haftalar için bilinir)
function macYokAciklamasi(lig, h, tblTakim) {
  const maclar = haftaMaclari(lig, h);
  if (!maclar || !tblTakim) return 'Maç kaydı yok';
  const mac = maclar.find(m => m.ev === tblTakim || m.dep === tblTakim);
  if (!mac) return 'Takımı bay';
  if (mac.durum === 'oynanmadi') return `${mac.ev === tblTakim ? 'vs' : '@'} ${kacis(baslik(mac.ev === tblTakim ? mac.dep : mac.ev))} · ${tarihSaat(mac.tarih)}`;
  return 'Maç kadrosunda yok';
}

async function oyuncuGecmisiDoldur(id, lig = 'tbl') {
  let maclar = [], takim = veri.rehber[id]?.takim;
  try {
    if (lig === 'tbl') maclar = await json(`data/oyuncu/${id}.json`);
    else {
      const d = await json(`data/bsl-oyuncu/${id}.json`);
      ({ maclar, takim } = d);
      const ust = document.getElementById('oyuncu-baslik');
      if (ust) ust.innerHTML = `<strong>${kacis(d.ad)}</strong><small>${kacis(baslik(d.takim))} · BSL</small>`;
    }
  } catch {
    // Dosya yoksa oyuncu bu sezon hiç maç kadrosuna girmemiştir
  }
  const ozet = document.getElementById('oyuncu-ozet');
  const liste = document.getElementById('oyuncu-maclar');
  if (!ozet || !liste) return; // bu arada başka sayfaya geçildi

  const oynanan = maclar.filter(m => sureSn(m.sure) > 0);
  const ort = alan => oynanan.length ? (oynanan.reduce((t, m) => t + m[alan], 0) / oynanan.length).toFixed(1) : '–';
  ozet.innerHTML = `
    <div><strong>${oynanan.length}</strong><small>Maç</small></div>
    <div><strong>${ort('vp')}</strong><small>VP ort.</small></div>
    <div><strong>${ort('sayi')}</strong><small>Sayı ort.</small></div>`;

  const haftaya = new Map();
  for (const m of maclar) haftaya.set(m.hafta, [...(haftaya.get(m.hafta) ?? []), m]);
  const satirlar = [];
  for (let h = ligBilgisi(lig).guncel; h >= 1; h--) {
    const hm = haftaya.get(h);
    if (!hm) {
      satirlar.push(`<div class="satir oyuncu sayilmadi"><div class="ad"><strong>${h}. Hafta</strong><small>${macYokAciklamasi(lig, h, takim)}</small></div></div>`);
      continue;
    }
    for (const m of hm) {
      const oynadi = sureSn(m.sure) > 0;
      const skor = m.skor !== null ? `${Number(m.skor) > Number(m.rakipSkor) ? 'G' : 'M'} ${m.skor}-${m.rakipSkor} · ` : '';
      const detay = oynadi
        ? `${m.sure} dk · ${m.sayi} sy · ${m.rib} rb · ${m.ast} as`
        : 'Süre almadı';
      const canli = m.durum === 'canli' ? '<span class="etiket canli-e">canlı</span>' : '';
      const [ac, kapa] = m.mac ? [`<a href="#/mac/${m.mac}"`, '</a>'] : ['<div', '</div>'];
      satirlar.push(`${ac} class="satir oyuncu ${oynadi ? '' : 'sayilmadi'}">
        <div class="ad"><strong>${h}. Hafta <span class="rakip">${m.evde ? 'vs' : '@'} ${kacis(baslik(m.rakip))}</span>${canli}</strong>
          <small>${m.durum === 'canli' ? '' : skor}${detay}</small></div>
        <div class="sayi"><strong>${m.vp}</strong><small>VP</small></div>
      ${kapa}`);
    }
  }
  liste.innerHTML = satirlar.join('');
}

// ---------- maçlar ----------
const gunBasligi = iso => new Date(iso).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
// TBF saati henüz belli olmayan maçları 00:00 olarak verir
const saatYazisi = iso => iso.endsWith('T00:00:00') ? 'Saat belli değil'
  : new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const kazananSinifi = (m, taraf) => {
  if (m.durum !== 'bitti') return '';
  const ev = Number(m.evSkor), dep = Number(m.depSkor);
  return (taraf === 'ev' ? ev > dep : dep > ev) ? 'kazanan' : '';
};

// Canlı maçın son güncellemedeki durumu: "3. Çeyrek · 04:12", "Devre arası", "Maç sonu · kesinleşiyor"
// kisa: dar yerler için "3.Ç · 04:12"
function canliYazisi(m, kisa = false) {
  const c = m?.canliDurum;
  if (!c?.periyot) return 'Canlı';
  const periyotSonu = c.saat === '00:00';
  if (c.uzatma) {
    const u = c.periyot - 4;
    const ad = kisa ? `${u}.U` : `${u}. Uzatma`;
    return periyotSonu ? `${ad} sonu` : `${ad} · ${c.saat}`;
  }
  if (periyotSonu) {
    if (c.periyot === 2) return 'Devre arası';
    if (c.periyot >= 4) return Number(m.evSkor) !== Number(m.depSkor) ? (kisa ? 'Maç sonu' : 'Maç sonu · kesinleşiyor') : '4. Çeyrek sonu';
    return `${c.periyot}. Çeyrek sonu`;
  }
  return kisa ? `${c.periyot}.Ç · ${c.saat}` : `${c.periyot}. Çeyrek · ${c.saat}`;
}

function macSatiri(m) {
  const orta = m.durum === 'oynanmadi'
    ? `<strong>${saatYazisi(m.tarih)}</strong>${m.yayin ? `<small>${kacis(m.yayin)}</small>` : ''}`
    : `<strong>${m.evSkor ?? 0} - ${m.depSkor ?? 0}</strong><small>${m.durum === 'canli' ? `<span class="canli-yazi">${canliYazisi(m, true)}</span>` : 'MS'}</small>`;
  return `<a class="mac" href="#/mac/${m.id}">
    <span class="${kazananSinifi(m, 'ev')}">${kacis(baslik(m.ev))}</span>
    <span class="skor">${orta}</span>
    <span class="dep ${kazananSinifi(m, 'dep')}">${kacis(baslik(m.dep))}</span>
  </a>`;
}

// Maçlar sekmesinde TBL ve BSL gösterilir (BSL fantezi puanına girmez). Seçilen lig bu cihazda hatırlanır.
const LIGLER = { tbl: 'TBL', bsl: 'BSL' };
const LIG_ANAHTARI = 'tbl-fantezi-maclar-lig';
const ligMaclari = new Map(); // 'bsl-4' -> o haftanın maçları (fantezi haftaları dışındakiler, gerektikçe yüklenir)
const ligBilgisi = lig => veri.index.maclar?.[lig] ?? { haftalar: veri.index.haftalar, guncel: veri.index.guncelHafta };
let seciliLig = 'tbl';
let gosterilenMaclar = null; // ekrandaki lig-hafta; yükleme bitince başka sayfaya geçilmişse yazılmaz
try { seciliLig = LIGLER[localStorage.getItem(LIG_ANAHTARI)] ? localStorage.getItem(LIG_ANAHTARI) : 'tbl'; } catch { /* depolama yok */ }

// Fantezi haftalarının TBL maçları zaten yüklü (canlıyken her dakika yenilenir); diğerleri dosyadan gelir
const haftaMaclari = (lig, n) => lig === 'tbl' && veri.haftalar.has(n) ? veri.haftalar.get(n).maclar : ligMaclari.get(`${lig}-${n}`);

function ligHaftaSecici(lig, n, maclar) {
  const h = ligBilgisi(lig).haftalar;
  const i = h.indexOf(n);
  const bitti = maclar.filter(m => m.durum === 'bitti').length;
  const durum = bitti === maclar.length ? 'Tamamlandı'
    : `${bitti}/${maclar.length} maç bitti${maclar.some(m => m.durum === 'canli') ? ' · canlı' : ''}`;
  const fantezi = lig === 'tbl' && fHafta(n) >= 1 ? `Fantezi ${fHafta(n)}. hafta · ` : '';
  const ok = (hedef, isaret) => hedef === undefined ? `<span class="pasif">${isaret}</span>`
    : `<a href="#/maclar/${lig}/${hedef}" aria-label="${LIGLER[lig]} ${hedef}. hafta">${isaret}</a>`;
  return `<div class="hafta-secici">
    ${ok(h[i - 1], '‹')}
    <div class="baslik"><strong>${LIGLER[lig]} ${n}. Hafta</strong><small>${fantezi}${durum}</small></div>
    ${ok(h[i + 1], '›')}
  </div>`;
}

function ligCipleri(lig, n) {
  const ligler = Object.entries(LIGLER).filter(([l]) => l === 'tbl' || veri.index.maclar?.[l]);
  const ligSecimi = ligler.length < 2 ? '' : `<div class="secenekler lig-secici">${ligler.map(([l, ad]) =>
    `<a class="secenek ${l === lig ? 'aktif' : ''}" href="#/maclar/${l}">${ad}</a>`).join('')}</div>`;
  const haftalar = `<div class="secenekler hafta-cipleri kaydir-ortala">${ligBilgisi(lig).haftalar.map(k =>
    `<a class="secenek ${k === n ? 'aktif' : ''}" href="#/maclar/${lig}/${k}">${k}. hafta</a>`).join('')}</div>`;
  return ligSecimi + haftalar;
}

function macListesi(lig, n, maclar) {
  const gunler = new Map();
  for (const m of maclar) {
    const gun = m.tarih.slice(0, 10);
    gunler.set(gun, [...(gunler.get(gun) ?? []), m]);
  }
  const bloklar = [...gunler.values()].map(g =>
    `<section class="kart"><h2>${gunBasligi(g[0].tarih)}</h2>${g.map(macSatiri).join('')}</section>`).join('');
  // Bay geçen takımlar: TBL takımları oyuncu rehberinden bilinir
  let bayNotu = '';
  if (lig === 'tbl') {
    const oynayan = new Set(maclar.flatMap(m => [m.ev, m.dep]));
    const tumTakimlar = new Set(Object.values(veri.rehber).filter(o => o.aktif).map(o => o.takim));
    const bay = [...tumTakimlar].filter(t => !oynayan.has(t));
    if (bay.length) bayNotu = `<p class="guncelleme">Bay: ${bay.map(t => kacis(baslik(t))).join(', ')}</p>`;
  }
  return `${ligHaftaSecici(lig, n, maclar)}${bloklar || '<p class="bos">Bu haftanın maçları henüz belli değil.</p>'}${bayNotu}`;
}

function maclarEkrani(lig, n) {
  const maclar = haftaMaclari(lig, n);
  return `${ligCipleri(lig, n)}<div id="lig-maclar">${maclar ? macListesi(lig, n, maclar) : '<p class="bos">Yükleniyor…</p>'}</div>`;
}

// #/maclar/bsl/4, #/maclar/bsl (güncel hafta), #/maclar (son seçilen lig) ve eski #/maclar/7 adresleri
function macRotasi(a, b) {
  let lig = LIGLER[a] ? a : (a ? 'tbl' : seciliLig);
  if (!veri.index.maclar?.[lig]) lig = 'tbl';
  if (LIGLER[a]) {
    seciliLig = lig;
    try { localStorage.setItem(LIG_ANAHTARI, lig); } catch { /* depolama yok */ }
  }
  const istenen = Number(LIGLER[a] ? b : a);
  return { lig, n: ligBilgisi(lig).haftalar.includes(istenen) ? istenen : ligVarsayilanHaftasi(lig) };
}

// Bu hafta bittiyse, sıradaki haftanın ilk maçından önceki Perşembe'den itibaren sıradaki hafta açılır
function ligVarsayilanHaftasi(lig) {
  const { haftalar, guncel, guncelBitti, siradaki } = ligBilgisi(lig);
  // TBL'nin güncel haftası canlı veriyle yüklü; bitip bitmediği oradan daha taze
  const bitti = lig === 'tbl' && veri.haftalar.has(guncel) ? haftaDurumu(veri.haftalar.get(guncel)).tamamlandi : guncelBitti;
  if (siradaki && bitti && haftalar.includes(siradaki.hafta) && new Date() >= new Date(siradaki.gosterim)) return siradaki.hafta;
  return haftalar.includes(guncel) ? guncel : haftalar.at(-1);
}

// Yüklenmemiş ya da henüz bitmemiş haftanın maçlarını dosyadan getirir
async function ligMaclariDoldur(lig, n) {
  const onceki = haftaMaclari(lig, n);
  if (onceki && onceki.every(m => m.durum === 'bitti')) return;
  let maclar;
  try {
    maclar = (await json(`data/maclar/${lig}-${n}.json`)).maclar;
  } catch {
    maclar = onceki ?? [];
  }
  if (!(lig === 'tbl' && veri.haftalar.has(n))) ligMaclari.set(`${lig}-${n}`, maclar);
  const kutu = document.getElementById('lig-maclar');
  if (kutu && gosterilenMaclar === `${lig}-${n}`) kutu.innerHTML = macListesi(lig, n, haftaMaclari(lig, n));
}

// Seçili hafta çipi ortada görünsün (uzun listede sağda kalabilir)
function haftaCipiniGoster() {
  const aktif = document.querySelector('.kaydir-ortala .aktif');
  if (!aktif) return;
  const satir = aktif.parentElement;
  satir.scrollLeft = aktif.offsetLeft - satir.offsetLeft - (satir.clientWidth - aktif.offsetWidth) / 2;
}

function macBul(id) {
  const listeler = [...[...veri.haftalar.values()].map(h => h.maclar), ...ligMaclari.values()];
  for (const maclar of listeler) {
    const m = maclar.find(x => String(x.id) === String(id));
    if (m) return m;
  }
  return null;
}

function macEkrani() {
  return `${geriLinki('#/maclar')}<div id="mac-detay"><p class="bos">Yükleniyor…</p></div>`;
}

const atis = ([b, d]) => `${b}/${d}`;
const KUTU_SUTUNLARI = [
  ['Dk', o => o.sure], ['Sy', o => o.sayi], ['2S', o => atis(o.iki)], ['3S', o => atis(o.uc)], ['SA', o => atis(o.sa)],
  ['Rb', o => o.rib], ['As', o => o.ast], ['Tç', o => o.tc], ['Bl', o => o.blk], ['Tk', o => o.tk], ['F', o => o.faul], ['VP', o => o.vp],
];

function kutuSkorTablosu(takim, lig = 'tbl') {
  const benim = sonKadro().find(t => t.ad === seciliTakim);
  const benimkiler = new Set([...(benim?.as ?? []), ...(benim?.yedek ?? [])].map(o => o.id));
  const satirlar = takim.oyuncular.map(o => {
    const oynadi = sureSn(o.sure) > 0;
    return `<tr class="${oynadi ? '' : 'oynamadi'} ${benimkiler.has(o.id) ? 'benim-oyuncu' : ''}">
      <th><a href="#/oyuncu/${o.id}${lig === 'bsl' ? '/bsl' : ''}">${o.ilk5 ? '<b>' : ''}${kacis(o.ad)}${o.ilk5 ? '</b>' : ''}</a></th>
      ${KUTU_SUTUNLARI.map(([, f]) => `<td>${kacis(f(o))}</td>`).join('')}
    </tr>`;
  }).join('');
  const topla = alan => takim.oyuncular.reduce((t, o) => t + (Number(o[alan]) || 0), 0);
  const toplaAtis = alan => atis([0, 1].map(i => takim.oyuncular.reduce((t, o) => t + o[alan][i], 0)));
  const toplam = `<tr class="toplam"><th>Toplam</th><td></td><td>${topla('sayi')}</td><td>${toplaAtis('iki')}</td>
    <td>${toplaAtis('uc')}</td><td>${toplaAtis('sa')}</td><td>${topla('rib')}</td><td>${topla('ast')}</td>
    <td>${topla('tc')}</td><td>${topla('blk')}</td><td>${topla('tk')}</td><td>${topla('faul')}</td><td>${topla('vp')}</td></tr>`;
  return `<section class="kart"><h2>${kacis(baslik(takim.ad))}</h2>
    <div class="tablo-kaydir"><table class="kutu">
      <thead><tr><th>Oyuncu</th>${KUTU_SUTUNLARI.map(([b]) => `<td>${b}</td>`).join('')}</tr></thead>
      <tbody>${satirlar}${toplam}</tbody>
    </table></div></section>`;
}

function macBasligi(m) {
  const durum = m.durum === 'canli' ? `<span class="canli-yazi">Canlı · ${canliYazisi(m)}</span>` : m.durum === 'bitti' ? 'Maç sonu' : saatYazisi(m.tarih);
  const skor = m.durum === 'oynanmadi' ? '–' : `${m.evSkor ?? 0} - ${m.depSkor ?? 0}`;
  const bilgi = [gunBasligi(m.tarih), m.salon, m.yayin].filter(Boolean).map(kacis).join(' · ');
  return `<section class="kart mac-baslik">
    <div class="mac-takimlar">
      <strong class="${kazananSinifi(m, 'ev')}">${kacis(baslik(m.ev))}</strong>
      <div class="mac-skor"><strong>${skor}</strong><small>${durum}</small></div>
      <strong class="${kazananSinifi(m, 'dep')}">${kacis(baslik(m.dep))}</strong>
    </div>
    <p class="mac-bilgi">${m.hafta ? `${LIGLER[m.lig ?? 'tbl']} ${m.hafta}. Hafta · ` : ''}${bilgi}</p>
  </section>`;
}

function ceyrekTablosu(d) {
  const n = Math.max(d.ev.ceyrekler.length, d.dep.ceyrekler.length);
  if (!n) return '';
  const baslikHucre = i => i < 4 ? `Ç${i + 1}` : `U${i - 3}`;
  const satir = t => `<tr><th>${kacis(baslik(t.ad))}</th>${Array.from({ length: n }, (_, i) => `<td>${t.ceyrekler[i] ?? '–'}</td>`).join('')}<td><b>${t.skor ?? 0}</b></td></tr>`;
  return `<section class="kart"><div class="tablo-kaydir"><table class="kutu ceyrek">
    <thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<td>${baslikHucre(i)}</td>`).join('')}<td>T</td></tr></thead>
    <tbody>${satir(d.ev)}${satir(d.dep)}</tbody></table></div></section>`;
}

async function macDetayDoldur(id) {
  let d = null;
  try {
    d = await json(`data/mac/${id}.json`);
  } catch {
    // Maç henüz oynanmadıysa box score dosyası yoktur
  }
  const kutu = document.getElementById('mac-detay');
  if (!kutu) return; // bu arada başka sayfaya geçildi
  // Box score dosyasında ev/dep takım nesnesidir; başlık için takım adları gerekir
  const mac = d ? { ...d, ev: d.ev.ad, dep: d.dep.ad } : macBul(id);
  if (!mac) {
    kutu.innerHTML = '<p class="bos">Maç bulunamadı.</p>';
    return;
  }
  kutu.innerHTML = macBasligi(mac) + (d
    ? ceyrekTablosu(d) + kutuSkorTablosu(d.ev, mac.lig) + kutuSkorTablosu(d.dep, mac.lig)
      + '<p class="guncelleme">Kalın: ilk 5 · 2S/3S/SA: isabet/deneme</p>'
    : `<p class="bos">${mac.durum === 'oynanmadi' ? 'Maç henüz oynanmadı.' : 'İstatistikler henüz gelmedi.'}</p>`);
}

// ---------- +/- sıralaması (yönetici modu) ----------
// TBL ve BSL oyuncularının haftalık ya da sezon boyu +/- toplamı, ilk 10. Eşit +/-'de takımının skor
// farkı daha kötü olan üstte (takımı 10 farkla kaybederken +21, takımı 7 farkla kazanırken +21'den değerli).
const artieksiVerisi = new Map(); // lig -> { zaman, veri }
let gosterilenArtieksi = null;
const isaretli = pm => pm > 0 ? `+${pm}` : String(pm);

function artieksiRotasi(a, b) {
  const lig = a === 'bsl' && veri.index.maclar?.bsl ? 'bsl' : 'tbl';
  return { lig, donem: b === 'sezon' ? 'sezon' : Number(b) || null }; // null: son oynanan hafta
}

// Veri zaten sıralı gelir (+/-, sonra takım farkı) ve sırayla numaralanır. 10. ile aynı +/- yapanlar da
// listeye girer (11, 12, ...); aralarındaki sıra yine takım farkına göredir.
function artieksiListesi(d, donem) {
  const tum = (donem === 'sezon' ? d.sezon : d.haftalar[donem]) ?? [];
  const onuncu = tum[9];
  const liste = onuncu ? tum.filter((k, i) => i < 10 || k.pm === onuncu.pm) : tum;
  return liste.map((k, i) => ({ ...k, sira: i + 1 }));
}

function artieksiEkrani(lig, donem) {
  if (!yoneticiModu) return '<p class="bos">Bu sayfa yönetici modunda açılır.</p>';
  const d = artieksiVerisi.get(lig)?.veri;
  return `<div id="artieksi">${d ? artieksiIcerik(lig, donem, d) : '<p class="bos">Yükleniyor…</p>'}</div>`;
}

function artieksiIcerik(lig, donem, d) {
  const haftalar = Object.keys(d.haftalar).map(Number);
  const secili = donem === 'sezon' || haftalar.includes(donem) ? donem : haftalar.at(-1) ?? 'sezon';
  const ligler = Object.entries(LIGLER).filter(([l]) => l === 'tbl' || veri.index.maclar?.[l]);
  const ligSecimi = `<div class="secenekler lig-secici">${ligler.map(([l, ad]) =>
    `<a class="secenek ${l === lig ? 'aktif' : ''}" href="#/artieksi/${l}/${secili === 'sezon' ? 'sezon' : ''}">${ad}</a>`).join('')}</div>`;
  const donemler = `<div class="secenekler hafta-cipleri kaydir-ortala">${['sezon', ...haftalar].map(k =>
    `<a class="secenek ${k === secili ? 'aktif' : ''}" href="#/artieksi/${lig}/${k}">${k === 'sezon' ? 'Sezon' : `${k}. hafta`}</a>`).join('')}</div>`;
  const anahtar = `${lig}-${secili}`;
  const dugmeler = `<div class="paylas-satiri">
      <button class="paylas" data-tur="artieksi" data-hafta="${anahtar}" data-islem="paylas">📤 Paylaş</button>
      <button class="paylas" data-tur="artieksi" data-hafta="${anahtar}" data-islem="indir">⬇️ İndir</button>
    </div>`;
  const satirlar = artieksiListesi(d, secili).map(k => {
    const sayfa = k.id.startsWith('fiba-') ? '' : `#/oyuncu/${k.id}${lig === 'bsl' ? '/bsl' : ''}`;
    const [ac, kapa] = sayfa ? [`<a class="satir" href="${sayfa}">`, '</a>'] : ['<div class="satir">', '</div>'];
    return `${ac}
      ${siraRozeti(k.sira)}
      <div class="ad"><strong>${kacis(k.ad)}</strong><small>${kacis(baslik(k.takim))}${secili === 'sezon' ? ` · ${k.mac} maç` : ''}</small></div>
      <div class="sayi"><strong>${isaretli(k.pm)}</strong><small>+/-</small></div>
    ${kapa}`;
  }).join('');
  const donemAdi = secili === 'sezon' ? 'Sezon' : `${secili}. Hafta`;
  return `${ligSecimi}${donemler}${dugmeler}
    <section class="kart"><h2>${LIGLER[lig]} · ${donemAdi} · +/- ilk 10</h2>${satirlar || '<p class="bos">Henüz veri yok.</p>'}</section>`;
}

async function artieksiDoldur(lig, donem) {
  const onbellek = artieksiVerisi.get(lig);
  if (onbellek && Date.now() - onbellek.zaman < YENILEME_MS) return;
  try {
    artieksiVerisi.set(lig, { zaman: Date.now(), veri: await json(`data/artieksi/${lig}.json`) });
  } catch {
    if (onbellek) return;
    artieksiVerisi.set(lig, { zaman: Date.now(), veri: { haftalar: {}, sezon: [] } });
  }
  const kutu = document.getElementById('artieksi');
  if (!kutu || gosterilenArtieksi !== `${lig}-${donem}`) return; // bu arada başka sayfaya geçildi
  kutu.innerHTML = artieksiIcerik(lig, donem, artieksiVerisi.get(lig).veri);
  paylasDugmeleriniBagla(kutu);
  haftaCipiniGoster();
}

function artieksiGorselVerisi(anahtar) {
  const [lig, donem] = anahtar.split('-');
  const d = artieksiVerisi.get(lig).veri;
  const sezon = donem === 'sezon';
  const haftalar = Object.keys(d.haftalar);
  return {
    baslik: `${LIGLER[lig]} +/- Sıralaması`,
    altBaslik: sezon ? `Sezon · ${haftalar[0]}–${haftalar.at(-1)}. haftalar` : `${donem}. Hafta`,
    adBasligi: 'OYUNCU',
    sutunlar: ['+/-'],
    satirlar: artieksiListesi(d, sezon ? 'sezon' : Number(donem)).map(k => ({
      sira: k.sira, ad: k.ad, degerler: [isaretli(k.pm)],
      not: `${baslik(k.takim)}${sezon ? ` · ${k.mac} maç` : ''}`,
    })),
  };
}

// ---------- yönlendirme ----------
function ciz() {
  const [, sekme = '', a, b] = location.hash.split('/');
  if (sekme === 'sec' && a) {
    takimSec(decodeURIComponent(a));
    location.replace('#/takimim');
    return;
  }
  const secimGecerli = sonKadro().some(t => t.ad === seciliTakim);
  const gecerliGorunen = n => gorunenHaftalar().includes(n) ? n : acilisHaftasi(sonHafta());

  let html, aktif = sekme, macHaftasi = null, artieksiSecimi = null;
  if (sekme === 'secim' || (!secimGecerli && sekme !== 'takim')) { html = secimEkrani(); aktif = 'takimim'; }
  else if (sekme === 'genel') html = genelEkran();
  else if (sekme === 'hafta') html = haftalikEkran(gecerliGorunen(Number(a)));
  else if (sekme === 'takim') html = takimEkrani(decodeURIComponent(a ?? ''), gecerliGorunen(Number(b)), false);
  else if (sekme === 'bostakiler') html = bostakilerEkrani(a);
  else if (sekme === 'oyuncu') html = oyuncuEkrani(a, b === 'bsl' ? 'bsl' : 'tbl');
  else if (sekme === 'maclar') {
    macHaftasi = macRotasi(a, b);
    gosterilenMaclar = `${macHaftasi.lig}-${macHaftasi.n}`;
    html = maclarEkrani(macHaftasi.lig, macHaftasi.n);
  }
  else if (sekme === 'mac') { html = macEkrani(); aktif = 'maclar'; }
  else if (sekme === 'artieksi') {
    artieksiSecimi = artieksiRotasi(a, b);
    gosterilenArtieksi = `${artieksiSecimi.lig}-${artieksiSecimi.donem}`;
    html = artieksiEkrani(artieksiSecimi.lig, artieksiSecimi.donem);
    aktif = 'hafta';
  }
  else { html = takimEkrani(seciliTakim, gecerliGorunen(Number(a)), true); aktif = 'takimim'; }
  // Otomatik yenileme arama kutusuna yazarken odağı kaçırmasın
  const aramaOdakta = document.activeElement?.id === 'arama';
  icerik.innerHTML = html;
  if (aktif === 'bostakiler') {
    bostakilerBagla(a);
    if (aramaOdakta) document.getElementById('arama').focus();
  }
  if (sekme === 'oyuncu') oyuncuGecmisiDoldur(a, b === 'bsl' ? 'bsl' : 'tbl');
  if (sekme === 'mac') macDetayDoldur(a);
  if (artieksiSecimi && yoneticiModu) {
    haftaCipiniGoster();
    artieksiDoldur(artieksiSecimi.lig, artieksiSecimi.donem);
  }
  if (macHaftasi) {
    haftaCipiniGoster();
    ligMaclariDoldur(macHaftasi.lig, macHaftasi.n);
  }
  paylasDugmeleriniBagla(icerik);

  document.querySelectorAll('.alt-menu a').forEach(el => el.classList.toggle('aktif', el.dataset.sekme === aktif));
  document.getElementById('canli').hidden = !haftaDurumu(veri.haftalar.get(sonHafta())).canli;
  document.getElementById('guncelleme').textContent =
    `Son veri: ${new Date(veri.index.guncelleme).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

// ---------- sıralamayı görsel olarak paylaşma ----------
// Sıralamanın tamamı tek bir PNG'ye çizilir ve telefonun paylaşım menüsüyle (WhatsApp vb.) gönderilir.
const GORSEL = {
  genislik: 1080, kenar: 40, baslikYuk: 210, sutunYuk: 64, satirYuk: 84, altYuk: 96,
  zemin: '#eef4f5', kart: '#ffffff', yazi: '#0f1f22', soluk: '#5f7377', cizgi: '#e3ecee', vurgu: '#097a88',
  madalya: ['#ca8a04', '#8a8f98', '#b0662f'], yazi_tipi: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

function yuvarlakDikdortgen(ctx, sol, ust, gen, yuk, r) {
  ctx.beginPath();
  ctx.moveTo(sol + r, ust);
  ctx.arcTo(sol + gen, ust, sol + gen, ust + yuk, r);
  ctx.arcTo(sol + gen, ust + yuk, sol, ust + yuk, r);
  ctx.arcTo(sol, ust + yuk, sol, ust, r);
  ctx.arcTo(sol, ust, sol + gen, ust, r);
  ctx.closePath();
}

// satirlar: [{ sira, ad, not, degerler: [...] }], sutunlar: ['VP', 'Puan']
async function siralamaGorseli({ baslik, altBaslik, sutunlar, satirlar, adBasligi = 'TAKIM' }) {
  const g = GORSEL;
  const yukseklik = g.baslikYuk + g.sutunYuk + satirlar.length * g.satirYuk + g.altYuk + g.kenar;
  const tuval = document.createElement('canvas');
  tuval.width = g.genislik;
  tuval.height = yukseklik;
  const ctx = tuval.getContext('2d');
  const font = (agirlik, boyut) => `${agirlik} ${boyut}px ${g.yazi_tipi}`;

  ctx.fillStyle = g.zemin;
  ctx.fillRect(0, 0, g.genislik, yukseklik);

  // Başlık bandı: logodaki turkuazdan koyu petrole
  const degrade = ctx.createLinearGradient(0, 0, g.genislik, g.baslikYuk);
  degrade.addColorStop(0, '#0a8a99');
  degrade.addColorStop(1, '#06505b');
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, g.genislik, g.baslikYuk);
  try {
    const logo = new Image();
    logo.src = 'icon-192.png';
    // Logo takılırsa paylaşım beklemede kalmasın: 3 saniyede gelmezse logosuz çizilir
    await Promise.race([logo.decode(), new Promise((_, hata) => setTimeout(() => hata(new Error('logo')), 3000))]);
    // Logonun kare zemini şeritten farklı renkte; sadece siyah yuvarlak kısmı kesilip çizilir
    // (ikonda siyah daire kenarın %47'si kadar yarıçapta)
    ctx.save();
    ctx.beginPath();
    ctx.arc(g.kenar + 60, 105, 120 * 0.465, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, g.kenar, 45, 120, 120);
    ctx.restore();
  } catch { /* logo yüklenemezse görsel yine oluşur */ }
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(800, 46);
  ctx.fillText(baslik, g.kenar + 150, 100);
  ctx.fillStyle = '#d6f4f6';
  ctx.font = font(500, 32);
  ctx.fillText(altBaslik, g.kenar + 150, 148);

  // Liste kartı
  const kartUst = g.baslikYuk + 16;
  const kartYuk = g.sutunYuk + satirlar.length * g.satirYuk + 8;
  ctx.fillStyle = g.kart;
  yuvarlakDikdortgen(ctx, g.kenar - 16, kartUst, g.genislik - 2 * (g.kenar - 16), kartYuk, 24);
  ctx.fill();

  // Sütun başlıkları: değer sütunları sağa yaslı
  const sutunX = sutunlar.map((_, i) => g.genislik - g.kenar - 10 - (sutunlar.length - 1 - i) * 150);
  ctx.fillStyle = g.soluk;
  ctx.font = font(700, 24);
  ctx.textAlign = 'left';
  ctx.fillText(adBasligi, g.kenar + 80, kartUst + 44);
  ctx.textAlign = 'right';
  sutunlar.forEach((s, i) => ctx.fillText(s.toLocaleUpperCase('tr'), sutunX[i], kartUst + 44));

  satirlar.forEach((s, i) => {
    const ust = kartUst + g.sutunYuk + i * g.satirYuk;
    const orta = ust + g.satirYuk / 2;
    ctx.strokeStyle = g.cizgi;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(g.kenar, ust);
    ctx.lineTo(g.genislik - g.kenar, ust);
    ctx.stroke();
    // Sıra rozeti
    ctx.fillStyle = s.sira <= 3 ? g.madalya[s.sira - 1] : g.zemin;
    ctx.beginPath();
    ctx.arc(g.kenar + 30, orta, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s.sira <= 3 ? '#ffffff' : g.yazi;
    ctx.font = font(800, 26);
    ctx.textAlign = 'center';
    ctx.fillText(String(s.sira), g.kenar + 30, orta + 9);
    // Takım adı ve varsa eşitlik notu
    ctx.textAlign = 'left';
    ctx.fillStyle = g.yazi;
    ctx.font = font(800, 31);
    ctx.fillText(s.ad, g.kenar + 80, s.not ? orta - 4 : orta + 11);
    if (s.not) {
      ctx.fillStyle = g.soluk;
      ctx.font = font(500, 22);
      ctx.fillText(s.not, g.kenar + 80, orta + 26);
    }
    // Değerler; son sütun (puan) turkuaz
    ctx.textAlign = 'right';
    s.degerler.forEach((d, j) => {
      const son = j === s.degerler.length - 1;
      ctx.fillStyle = son ? g.vurgu : g.yazi;
      ctx.font = font(800, son ? 34 : 31);
      ctx.fillText(String(d), sutunX[j], orta + 11);
    });
  });

  // Alt bilgi
  ctx.textAlign = 'center';
  ctx.fillStyle = g.soluk;
  ctx.font = font(500, 24);
  const zaman = new Date().toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  ctx.fillText(`${location.host}${location.pathname.replace(/\/$/, '')} · ${zaman}`, g.genislik / 2, yukseklik - g.kenar - 10);

  return new Promise(ok => tuval.toBlob(ok, 'image/png'));
}

function haftalikGorselVerisi(n) {
  const d = haftaDurumu(veri.haftalar.get(n));
  return {
    baslik: veri.ayarlar.ligAdi,
    altBaslik: `${fHafta(n)}. Hafta · ${d.tamamlandi ? 'Kesin sonuç' : `Ara sonuç (${d.bitti}/${d.toplam} maç bitti)`}`,
    sutunlar: ['VP', 'Puan'],
    satirlar: haftaSirasi(n).map(s => ({
      sira: s.sira, ad: s.ad, degerler: [s.toplam, `+${s.puan}`],
      not: s.vpEsitligi ? (s.enIyiTurk ? `Eşitlik: ${s.enIyiTurk.ad} ${s.enIyiTurk.vp} VP` : 'Eşitlik: Türk oyuncu yok') : '',
    })),
  };
}

function genelGorselVerisi() {
  const haftalar = haftaListesi();
  const klasman = klasmanHesapla(haftalar);
  const ilk = fHafta(haftalar[0].hafta), son = fHafta(haftalar.at(-1).hafta);
  return {
    baslik: veri.ayarlar.ligAdi,
    altBaslik: `Genel Klasman · ${ilk === son ? `${ilk}. hafta` : `${ilk}–${son}. haftalar`}`,
    sutunlar: ['Puan'],
    satirlar: klasman.map((s, i) => ({
      sira: s.sira, ad: s.ad, degerler: [s.puan],
      not: [klasman[i - 1], klasman[i + 1]].some(k => k && k.puan === s.puan) ? `Eşitlik: toplam ${s.vp} VP` : '',
    })),
  };
}

// button.paylas: aynı sınıfı kullanan İstatistikler bağlantısı (<a>) değil, Paylaş / İndir düğmeleri
function paylasDugmeleriniBagla(kok) {
  kok.querySelectorAll('button.paylas').forEach(d => d.addEventListener('click',
    () => siralamayiPaylas(d, d.dataset.tur, d.dataset.hafta, d.dataset.islem === 'indir')));
}

// Telefonlar paylaşım menüsünü ancak dokunuştan hemen sonra açtırır. Görsel hazırlanırken bu süre
// dolarsa (NotAllowedError) hazır görsel saklanır ve düğmeye ikinci dokunuşta hemen paylaşılır.
const PAYLAS_YAZISI = '📤 Paylaş';
let hazirGorsel = null; // { anahtar, zaman, dosya, bilgi }

function gorselVerisi(tur, n) {
  if (tur === 'genel') return { bilgi: genelGorselVerisi(), dosyaAdi: 'pota-alti-genel-klasman.png' };
  if (tur === 'artieksi') return { bilgi: artieksiGorselVerisi(n), dosyaAdi: `pota-alti-arti-eksi-${n}.png` };
  return { bilgi: haftalikGorselVerisi(Number(n)), dosyaAdi: `pota-alti-${fHafta(Number(n))}-hafta.png` };
}

function gorseliIndir(dosya) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(dosya);
  a.download = dosya.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// indir: paylaşım menüsü yerine görseli doğrudan cihaza kaydeder
async function siralamayiPaylas(dugme, tur, n, indir = false) {
  const anahtar = `${tur}-${n}`;
  let hazir = hazirGorsel?.anahtar === anahtar && Date.now() - hazirGorsel.zaman < 60_000 ? hazirGorsel : null;
  const ilkYazi = dugme.textContent;
  let sonYazi = indir ? ilkYazi : PAYLAS_YAZISI;
  dugme.disabled = true;
  try {
    if (!hazir) {
      dugme.textContent = 'Hazırlanıyor…';
      const { bilgi, dosyaAdi } = gorselVerisi(tur, n);
      const blob = await siralamaGorseli(bilgi);
      hazir = hazirGorsel = { anahtar, zaman: Date.now(), dosya: new File([blob], dosyaAdi, { type: 'image/png' }), bilgi };
    }
    const { dosya, bilgi } = hazir;
    if (!indir && navigator.canShare?.({ files: [dosya] })) {
      try {
        await navigator.share({ files: [dosya], title: bilgi.baslik, text: `${bilgi.baslik} · ${bilgi.altBaslik}` });
        hazirGorsel = null;
      } catch (e) {
        if (e?.name === 'NotAllowedError') {
          sonYazi = '📤 Hazır, paylaşmak için dokun';
        } else if (e?.name === 'AbortError') {
          hazirGorsel = null; // kullanıcı paylaşımı iptal etti
        } else {
          throw e;
        }
      }
    } else {
      // İndir düğmesi ya da paylaşım menüsü yoksa (ör. bilgisayar) görseli indir
      gorseliIndir(dosya);
      hazirGorsel = null;
    }
  } catch (e) {
    hazirGorsel = null;
    alert('Paylaşılamadı: ' + (e?.message ?? e));
  } finally {
    dugme.disabled = false;
    dugme.textContent = sonYazi;
  }
}

// Paylaş düğmesi sadece yönetici modunda görünür. Yönetici modu, başlığa 5 saniye içinde 5 kez
// dokunarak o cihazda açılıp kapanır (giriş sistemi yok; amaç düğmeyi herkesin önünden kaldırmak).
const YONETICI_ANAHTARI = 'tbl-fantezi-yonetici';
const ISTATISTIK_ADRESI = 'https://potaalti.goatcounter.com';
let yoneticiModu = false;
try { yoneticiModu = localStorage.getItem(YONETICI_ANAHTARI) === '1'; } catch { /* depolama yok */ }

// Yöneticinin kendi girişleri ziyaretçi sayacına eklenmesin (GoatCounter "skipgc" ayarına bakar)
function sayacAyari() {
  try {
    if (yoneticiModu) localStorage.setItem('skipgc', 't');
    else localStorage.removeItem('skipgc');
  } catch { /* depolama yok */ }
}
sayacAyari();

const paylasDugmesi = (tur, n = '') => !yoneticiModu ? ''
  : `<div class="paylas-satiri">
      <a class="paylas" href="#/artieksi">± +/-</a>
      <a class="paylas" href="${ISTATISTIK_ADRESI}" target="_blank" rel="noopener">📊 İstatistikler</a>
      <button class="paylas" data-tur="${tur}" data-hafta="${n}">📤 Paylaş</button>
    </div>`;

function yoneticiModunuBagla() {
  let dokunmalar = [];
  // pointerdown: parmak değdiği an sayılır (telefonlarda click gecikmeli/eksik gelebiliyor)
  document.querySelector('.ust').addEventListener('pointerdown', () => {
    const simdi = Date.now();
    dokunmalar = [...dokunmalar.filter(z => simdi - z < 5000), simdi];
    if (dokunmalar.length < 5) return;
    dokunmalar = [];
    yoneticiModu = !yoneticiModu;
    try { localStorage.setItem(YONETICI_ANAHTARI, yoneticiModu ? '1' : '0'); } catch { /* depolama yok */ }
    sayacAyari();
    bildirim(yoneticiModu ? 'Yönetici modu açık: Paylaş ve İstatistikler görünür, girişlerin sayılmaz' : 'Yönetici modu kapalı');
    ciz();
  });
}

function bildirim(metin) {
  const kutu = document.createElement('div');
  kutu.className = 'bildirim';
  kutu.textContent = metin;
  document.body.appendChild(kutu);
  setTimeout(() => kutu.remove(), 2500);
}

// ---------- telefona uygulama olarak yükleme ----------
// Android/Chrome yükleme penceresini kendisi açabilir; iPhone'da Apple buna izin vermediği için
// "Ana Ekrana Ekle" yönergesi gösterilir. Uygulama olarak açıldığında ya da kapatıldığında gizlenir.
const YUKLE_KAPALI = 'tbl-fantezi-yukle-kapali';
const uygulamaModunda = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let yuklemeIstegi = null;

function yuklemeBandi() {
  const kutu = document.getElementById('yukle');
  let kapali = false;
  try { kapali = localStorage.getItem(YUKLE_KAPALI) === '1'; } catch { /* depolama yok */ }
  const ua = navigator.userAgent;
  let mesaj = '';
  if (uygulamaModunda() || kapali) mesaj = '';
  else if (yuklemeIstegi) mesaj = `<span>Pota Altı'nı telefonuna <b>uygulama</b> olarak yükle.</span><button class="yukle-dugme">Yükle</button>`;
  else if (/iphone|ipad|ipod/i.test(ua)) mesaj = `<span>Uygulama olarak eklemek için Safari'de <b>Paylaş</b> düğmesine, sonra <b>Ana Ekrana Ekle</b>'ye dokun.</span>`;
  else if (/android/i.test(ua)) mesaj = `<span>Uygulama olarak eklemek için tarayıcı menüsünden (⋮) <b>Uygulamayı yükle</b> ya da <b>Ana ekrana ekle</b>'yi seç.</span>`;
  kutu.innerHTML = mesaj ? `<div class="yukle-bandi">${mesaj}<button class="kapat" aria-label="Kapat">×</button></div>` : '';
  kutu.querySelector('.yukle-dugme')?.addEventListener('click', async () => {
    yuklemeIstegi.prompt();
    const { outcome } = await yuklemeIstegi.userChoice;
    yuklemeIstegi = null;
    if (outcome === 'accepted') yuklemeBandiniKapat();
    else yuklemeBandi();
  });
  kutu.querySelector('.kapat')?.addEventListener('click', yuklemeBandiniKapat);
}

function yuklemeBandiniKapat() {
  try { localStorage.setItem(YUKLE_KAPALI, '1'); } catch { /* depolama yok */ }
  document.getElementById('yukle').innerHTML = '';
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  yuklemeIstegi = e;
  yuklemeBandi();
});
window.addEventListener('appinstalled', () => {
  yuklemeIstegi = null;
  yuklemeBandiniKapat();
});

function uyarilar() {
  const u = [];
  if (veri.ayarlar.ornekKadrolar) u.push('Örnek kadrolar gösteriliyor. Gerçek kadrolar eklenince değişecek.');
  if (veri.ayarlar.puanTablosuGecici) u.push('Sıralama puanları geçici.');
  document.getElementById('uyarilar').innerHTML = u.map(m => `<div class="uyari">${m}</div>`).join('');
}

// Güncel hafta bitmediyse veriyi periyodik olarak yenile
async function yenile() {
  try {
    const eskiSon = sonHafta();
    veri.index = await json('data/hafta/index.json');
    await haftaYukle(sonHafta(), true);
    if (eskiSon !== sonHafta()) await Promise.all(veri.index.haftalar.map(n => haftaYukle(n)));
    await siradakiYukle();
    ciz();
  } catch (e) {
    console.warn('Yenileme başarısız', e);
  }
}

async function basla() {
  try {
    await hepsiniYukle();
  } catch (e) {
    icerik.innerHTML = `<p class="bos">Veriler yüklenemedi.<br>${kacis(e.message)}</p>`;
    return;
  }
  document.getElementById('lig-adi').textContent = veri.ayarlar.ligAdi;
  uyarilar();
  yuklemeBandi();
  yoneticiModunuBagla();
  window.addEventListener('hashchange', () => { ciz(); window.scrollTo(0, 0); });
  ciz();
  setInterval(() => {
    if (!document.hidden && !haftaDurumu(veri.haftalar.get(sonHafta())).tamamlandi) yenile();
  }, YENILEME_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) yenile(); });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
basla();
