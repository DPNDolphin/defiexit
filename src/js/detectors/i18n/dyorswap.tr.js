// DYORSwap live check, Turkish. Same shape as TEXT.en in ../dyorswap.text.js; numbers arrive already formatted.
// Sentences are built so that no Turkish suffix is attached directly to a variable.
const listOf = (items) => (Array.isArray(items) ? items : []).map((x) => `${x?.amount} ${x?.sym}`).join(", ");

export default {
  row: {
    usdt: "Çekebileceğiniz USDT",
    okb: "Çekebileceğiniz OKB",
    about: (usd) => `yaklaşık $${usd}`,
    noPrice: "Dolar fiyatı şu an alınamıyor",
  },
  total: "Geri alabileceğiniz yaklaşık tutar",
  line: {
    lp: (x) => `DYORSwap USDT/OKB havuzunda çekebileceğiniz: ${x}`,
    none: "DYORSwap USDT/OKB havuzu: bu adreste LP yok",
    approval: "Likidite eklerken DYORSwap yönlendiricisine verdiğiniz USDT onayı hâlâ geçerli",
    gas: (x) => `Cüzdanda X Layer ağındaki OKB (ücretler için): ${x}`,
  },
  warn: {
    slip: (x) => `Bu havuz şu an sitenin tahmininden ${x}% daha az ödüyor; bu yüzden rehberdeki 1% kayma yetmeyebilir ve çekim başarısız olur. Paranız güvende: şimdilik rehberi izlemeyin. Sağ üstteki “Takıldınız mı?” düğmesine dokunun ve raporu bize gönderin`,
    lowGas: (x) => `Bu cüzdanda X Layer ağında yalnızca ${x} OKB var; ücrete yetmeyebilir. Önce bu adrese X Layer ağında biraz OKB gönderin (0.001 fazlasıyla yeter)`,
  },
  head: {
    "in-pool": "Bu havuzda hâlâ LP'niz var",
    partial: "Bir kısmı çıktı",
    "need-slip": "Şimdilik rehberi izlemeyin",
    "low-gas": "Önce ücret için biraz OKB ekleyin",
    arrived: "Ulaştı",
    "no-lp": "Şu an bu havuzda LP yok",
    "old-approval": "İptal edebileceğiniz eski bir onay var",
    nothing: "Bu havuzda LP bulunamadı",
  },
  say: {
    inPool: (x) => `Bu havuzda hâlâ LP'niz var ve şu an çekebileceğiniz tutar: ${x}. Zincir, ne kadar ilerlediğinizi gösteremiyor: bitirmediyseniz rehberi izlemeye devam edin; az önce onayladıysanız bir dakika bekleyin ve yeniden dokunmayın; “Confirm” adımında sayfa bir hata gösterdiyse aşağıdaki sık görülen durumlara bakın.`,
    partial: (done, left) => `Son birkaç dakikada bir çekim gerçekleşti; ulaşan: ${done}. Hâlâ LP'niz var ve şu an çekebileceğiniz tutar: ${left}. Hepsini çıkarmak için rehberi yeniden izleyin; ya da bırakın, hâlâ sizin.`,
    lowGas: (x) => `Bu cüzdanda X Layer ağında yalnızca ${x} OKB var. Çekim küçük bir ücret gerektirir ($0.01 altında); bu yüzden önce bu adrese X Layer ağında biraz OKB gönderin (0.001 fazlasıyla yeter), sonra geri gelin.`,
    arrived: (list) => `Ulaştı: ${list}. Bu havuzdaki LP'niz tamamen çekildi.`,
    noLp: "Bu adresin şu an bu havuzda LP'si yok ve daha önce imzayla çekim yapmış. Neyin ulaştığını doğrulayamadık (yalnızca son birkaç dakikadaki çekimleri görebiliyoruz): OKX uygulamasında cüzdanınızda OKB ya da USDT'yi açın ve işlem geçmişine bakın.",
    approval: "Likidite eklerken DYORSwap yönlendiricisi 0x1E69…6036 adresine verdiğiniz USDT onayı hâlâ geçerli. Artık ona ihtiyacınız yok: cüzdan ana ekranınızdaki onaylar sekmesinden iptal edin (küçük bir ücret tutar). Paranız her iki durumda da güvende.",
    nothing: "Bu adresin DYORSwap USDT/OKB havuzunda LP'si yok. Doğru hesapta olduğunuzu kontrol edin: bir OKX cüzdanında birkaç hesap olabilir. Bu rehber başka havuzlar için kontrol edilmedi.",
  },
  arr: {
    list: (items) => listOf(items),
    item: (x, sym) => `DYORSwap yönlendirici sözleşmesi 0x1E69…6036 adresinden ${x} ${sym}`,
  },
};
