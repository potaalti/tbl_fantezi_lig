// Fantezi lig puanlama kuralları.
//
// - Her takımın 5 As oyuncusunun haftalık VP toplamı takım puanıdır.
// - Bir As oyuncu hafta içinde hiç süre almazsa (maçı bitti ve 0 dk oynadı, ya da takımı bay geçti),
//   yedeklerden o hafta en yüksek VP alan oyuncu onun yerine sayılır. İki As süre almazsa iki yedek de girer.
// - Yedeklerin puanı her zaman gösterilir ama yalnızca bir As yerine girdiğinde toplama eklenir.
// - Haftalık sıralamadaki yer, ayarlardaki puan tablosuna göre lig puanı verir.
//   Eşit VP'de, sayılan 5 oyuncu içindeki en yüksek VP'li Türk oyuncusu daha yüksek olan takım
//   üstte yer alır (sayılan 5'te Türk oyuncu yoksa o takım alta düşer).
//   Bu da eşitse iki takım aynı sırayı ve aynı puanı paylaşır.
// - Genel klasmanda eşit puanlı takımlardan tüm haftaların toplam VP'si yüksek olan üstte yer alır.
//   Toplam VP de eşitse aynı sırayı paylaşırlar (alfabetik dizilirler).

// Oyuncunun o haftaki durumu: VP, süre ve maçının durumu
function oyuncuDurumu(oyuncu, hafta) {
  const stat = hafta.oyuncular[oyuncu.id];
  const tblTakim = stat?.takim ?? oyuncu.tblTakim;
  const maclar = hafta.maclar.filter(m => m.ev === tblTakim || m.dep === tblTakim);
  let macDurumu;
  if (maclar.length === 0) macDurumu = 'bay';
  else if (maclar.some(m => m.durum === 'canli')) macDurumu = 'canli';
  else if (maclar.every(m => m.durum === 'bitti')) macDurumu = 'bitti';
  else if (maclar.some(m => m.durum === 'bitti')) macDurumu = 'canli'; // haftada 2 maç, biri bitti
  else macDurumu = 'oynanmadi';

  const saniye = stat?.saniye ?? 0;
  const sureAlmadi = macDurumu === 'bay' || (macDurumu === 'bitti' && saniye === 0);
  return {
    ...oyuncu,
    tblTakim,
    vp: stat?.vp ?? 0,
    saniye,
    macDurumu,
    sureAlmadi,
    mac: maclar[0] ?? null,
  };
}

export function takimHaftaPuani(takim, hafta) {
  const aslar = takim.as.map(o => ({ ...oyuncuDurumu(o, hafta), rol: 'as', sayildi: true }));
  const yedekler = takim.yedek
    .map(o => ({ ...oyuncuDurumu(o, hafta), rol: 'yedek', sayildi: false }))
    .sort((a, b) => b.vp - a.vp);

  const bosYedekler = [...yedekler];
  for (const as of aslar) {
    if (!as.sureAlmadi || bosYedekler.length === 0) continue;
    const yedek = bosYedekler.shift();
    as.sayildi = false;
    as.yerineGiren = yedek.ad;
    yedek.sayildi = true;
    yedek.yerineGirdigi = as.ad;
  }

  const toplam = [...aslar, ...yedekler].filter(o => o.sayildi).reduce((t, o) => t + o.vp, 0);
  return { ...takim, toplam, aslar, yedekler };
}

// turkMu(oyuncuId): oyuncu Türk mü (eşitlik kuralı için)
export function haftaSiralamasi(takimlar, hafta, puanTablosu, turkMu = () => false) {
  const sonuclar = takimlar.map(t => {
    const s = takimHaftaPuani(t, hafta);
    const turkler = [...s.aslar, ...s.yedekler].filter(o => o.sayildi && turkMu(o.id)).sort((a, b) => b.vp - a.vp);
    s.enIyiTurk = turkler[0] ?? null;
    s.turkVp = s.enIyiTurk ? s.enIyiTurk.vp : -Infinity;
    return s;
  // turkVp -Infinity olabilir; çıkarma yerine karşılaştırma (iki -Infinity farkı NaN olur)
  }).sort((a, b) => b.toplam - a.toplam || (b.turkVp > a.turkVp) - (b.turkVp < a.turkVp));
  sonuclar.forEach((s, i) => {
    const onceki = sonuclar[i - 1];
    const tamEsit = onceki && s.toplam === onceki.toplam && s.turkVp === onceki.turkVp;
    s.sira = tamEsit ? onceki.sira : i + 1;
    s.puan = puanTablosu[s.sira - 1] ?? 0;
  });
  // Türk VP'siyle ayrılan eşitlikleri ekranda belirtmek için
  sonuclar.forEach((s, i) => {
    s.vpEsitligi = [sonuclar[i - 1], sonuclar[i + 1]].some(k => k && k.toplam === s.toplam);
  });
  return sonuclar;
}

export function haftaDurumu(hafta) {
  const bitti = hafta.maclar.filter(m => m.durum === 'bitti').length;
  const canli = hafta.maclar.some(m => m.durum === 'canli');
  return { bitti, toplam: hafta.maclar.length, canli, tamamlandi: bitti === hafta.maclar.length };
}

// Genel klasman: haftalık lig puanlarının toplamı; eşitlikte toplam VP, o da eşitse aynı sıra.
// kadroBul(haftaNo) o hafta geçerli olan kadroları döndürür (kadro değişiklikleri geçmişi etkilemez).
export function genelKlasman(kadroBul, haftalar, puanTablosu, turkMu) {
  const tablo = new Map();
  for (const hafta of haftalar) {
    for (const s of haftaSiralamasi(kadroBul(hafta.hafta), hafta, puanTablosu, turkMu)) {
      if (!tablo.has(s.ad)) tablo.set(s.ad, { ad: s.ad, sahibi: s.sahibi, puan: 0, vp: 0, haftalar: [] });
      const k = tablo.get(s.ad);
      k.puan += s.puan;
      k.vp += s.toplam;
      k.haftalar.push({ hafta: hafta.hafta, sira: s.sira, puan: s.puan, vp: s.toplam });
    }
  }
  const sonuc = [...tablo.values()].sort((a, b) => b.puan - a.puan || b.vp - a.vp || a.ad.localeCompare(b.ad, 'tr'));
  sonuc.forEach((s, i) => {
    const onceki = sonuc[i - 1];
    s.sira = onceki && onceki.puan === s.puan && onceki.vp === s.vp ? onceki.sira : i + 1;
  });
  return sonuc;
}
