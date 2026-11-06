// OKX Boost live check, Turkish. Same shape as TEXT.en in ../okx-boost.text.js; numbers and dates arrive already formatted.
// Sentences are built so that no Turkish suffix is attached directly to a variable.
const listOf = (items) => (Array.isArray(items) ? items : []).map((x) => `${x?.amount} ${x?.sym}`).join(", ");

export default {
  row: {
    locked: (sym) => `Kilitli ${sym}`,
    end: "Kilit açılışı",
    ready: "Kilidi açıldı, çekilebilir",
    wait: "Hâlâ kilitli; o zamana kadar hiçbir şey çıkmaz",
    about: (usd) => `yaklaşık $${usd}`,
    noPrice: "Dolar fiyatı şu an alınamıyor",
  },
  total: "Geri alabileceğiniz yaklaşık tutar",
  line: {
    lock: (list) => `OKX Boost kilit sözleşmesi 0xDA63…FD2b (Plasma X Launch): ${list}`,
    none: "OKX Boost kilit sözleşmesi 0xDA63…FD2b (Plasma X Launch): kilitli bir şey yok",
    done: (syms) => `Kilitli olan: ${syms}; şimdi 0 (çekildi)`,
    end: (d, ready) => `Kilit açılışı: ${d}${ready ? " (kilidi açıldı)" : " (hâlâ kilitli)"}`,
    gas: (x) => `Cüzdanda X Layer ağındaki OKB (ücretler için): ${x}`,
  },
  warn: {
    notYet: (d) => `Hâlâ kilitli: ${d} tarihinden sonra çekilebilir`,
    lowGas: (x) => `Bu cüzdanda X Layer ağında yalnızca ${x} OKB var; ücrete yetmeyebilir. Önce bu adrese X Layer ağında biraz OKB gönderin (0.001 fazlasıyla yeter)`,
  },
  head: {
    "can-unstake": "Tokenlarınız hâlâ OKX Boost'ta kilitli",
    "not-yet": "Kilit henüz açılmadı",
    "low-gas": "Önce ücret için biraz OKB ekleyin",
    arrived: "Ulaştı",
    withdrawn: "Zaten çekildi",
    nothing: "Burada kilitli bir şey yok",
  },
  say: {
    unstake: (x) => `Şunlar hâlâ OKX Boost kilit sözleşmesinde ve kilidi açıldı: ${x}. OKX uygulamasında kampanya sayfasını açın, aşağı kaydırıp staking ayrıntılarına gelin ve stake'ten çıkarma düğmesine dokunun.`,
    notYet: (d) => `Tokenlarınızın kilidi ${d} tarihinde açılıyor. Ondan önce “Unstake” düğmesine dokunmak hiçbir şey çıkarmaz.`,
    lowGas: (x) => `Bu cüzdanda X Layer ağında yalnızca ${x} OKB var. Stake'ten çıkarma küçük bir ücret gerektirir ($0.01 altında); bu yüzden önce bu adrese X Layer ağında biraz OKB gönderin (0.001 fazlasıyla yeter), sonra geri gelin.`,
    arrived: (list) => `Ulaştı: ${list}. OKX Boost'taki her şeyiniz çıktı.`,
    withdrawn: (syms) => `Kilit sözleşmesindeki bakiyeniz (${syms}) artık 0 ve kilit kaydı hâlâ duruyor; yani stake'ten çıkarılmış (bunu yalnızca siz yapabilirsiniz ve para yalnızca kendi adresinize döner). Kesin tutar ve zaman bu sefer bulunamadı: OKX uygulamasında cüzdanınızda şunu açın: ${syms}; ardından işlem geçmişinde OKX Boost'tan gelen stake'ten çıkarma kaydını arayın.`,
    nothing: "Bu adresin OKX Boost Plasma X Launch kampanyasında kilitli bir şeyi yok. Doğru hesapta olduğunuzu kontrol edin: bir OKX cüzdanında birkaç hesap olabilir.",
  },
  arr: {
    list: (items) => listOf(items),
    item: (x, sym) => `OKX Boost kilit sözleşmesi 0xDA63…FD2b adresinden ${x} ${sym}`,
  },
};
