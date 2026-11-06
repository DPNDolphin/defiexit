// X Layer exit sheet texts, Turkish. Same shape as HOW.en in ../../lib/xlayer.text.js.
// v: { ready (unlocked or not), date (already formatted for the user), got (expected amount, e.g. "0.5 OKB") }
// Sentences are built so that no Turkish suffix is attached directly to a variable.
export default {
  "okx-boost": (v) => {
    const { date = "?", ready = false, got = "?" } = v || {};
    return {
      title: "Kilitli tokenlarınızı OKX Boost'tan çıkarın",
      note: `Plasma X Launch için kilitlendi · ${ready ? `kilidi ${date} tarihinden beri açık` : `kilit ${date} tarihinde açılıyor`}`,
      status: ready ? { ok: true, head: `Kilidi ${date} tarihinden beri açık, çekilebilir`, text: "Son tarih yok: kilit açıldıktan sonra istediğiniz zaman çekilebilir." }
        : { ok: false, head: `Kilit ${date} tarihinde açılıyor`, text: "O zamana kadar hiçbir şey çıkmaz." },
      lead: "OKX Boost'un Plasma X Launch kampanyasına katılmak için X Layer ağında 2 günlüğüne token kilitlemeniz gerekiyordu. Bunlar kendiliğinden geri gelmez: “Unstake” düğmesine dokunmanız gerekir. Kilit sözleşmesinin kaynak kodu OKX blok gezgininde doğrulanmış; sözleşmenin yöneticisi yok ve para yalnızca kendi adresinize dönebilir.",
      steps: [
        { text: "OKX uygulamasında: üstte Web3 seçin, alttaki keşfet sekmesini açın, aşağıdaki bağlantıyı arama kutusuna yapıştırın ve “üçüncü taraf web sitesi” sonucuna dokunun. Bir açılır pencere uygulama sürümünü önerdiğinde, uygulamada açmak için kalın düğmeye dokunun (web sürümü uygulamanın içindeki cüzdana bağlanamaz).", copy: "https://web3.okx.com/boost/x-launch/plasma" },
        "Aşağı kaydırıp staking ayrıntılarına gelin ve stake'ten çıkarma düğmesine dokunun.",
        "Stake'ten çıkarma onayı açılır. Kontrol edin: ağ X Layer, etkileşim adresi 0xDA63…FD2b (OKX Boost) ve tutarın önünde artı işareti var; yani bu tutarı alırsınız. Herhangi bir şey uymuyorsa reddedin.",
        `Varış: ${got}, cüzdanınızda X Layer ağında görünür (WOKB değil, OKB'nin kendisi olarak). Buraya dönün ve “Tekrar kontrol et” düğmesine dokunun.`,
      ],
    };
  },
  dyorswap: (v) => {
    const { got = "?" } = v || {};
    return {
      title: "Likiditenizi DYORSwap'tan çıkarın",
      note: "USDT_Bridged / WOKB havuzu · LP tokenları cüzdanınızda",
      warn: "Eylül 2026'da DYORSwap yanlışlıkla sahte bir zinciri listeledi ve kullanıcılar sahte bir köprü yüzünden para kaybetti (DYORSwap'ın kendi sözleşmeleri hacklenmedi). Yalnızca dyorswap.finance adresini kullanın, X Layer ağını seçin ve “Bridge” düğmesine dokunmayın.",
      lead: "Bu, DYORSwap'ta (bir PancakeSwap çatalı) USDT_Bridged / WOKB havuzuna eklediğiniz likidite. Çekmek için cüzdanınızda iki onay gerekir: önce yalnızca çektiğiniz LP'yi onaylayan bir imza, sonra bir işlem.",
      steps: [
        { text: "Bu bağlantıyı adresinizi tutan cüzdanda açın, bağlanın ve X Layer ağını seçin.", copy: "https://dyorswap.finance/find/?chainId=196" },
        "“Select a Token” seçeneğine dokunun, USDT seçin (USD₮0 değil), sonra “Manage this pool” seçeneğine dokunun. Bu havuz sitenin varsayılan listesinde olmadığı için “Your Liquidity” tek başına “No liquidity found” gösterir.",
        "Listeye dönünce önce kaymayı değiştirin: dişli simgesine dokunun, 1.0% seçin ve kapatmak için × işaretine dokunun. Bunu atlarsanız çekim “This transaction would fail” hatasıyla başarısız olur: bu havuz sitenin tahmininden biraz daha az öder, bu da varsayılan 0.5% kaymadan fazladır.",
        "USDT/OKB satırına dokunun, “Remove”, sonra “Max” düğmesine dokunun. Hem USDT hem OKB alma varsayılanını koruyun; tek bir tokena geçmeyin.",
        "“Enable” düğmesine dokunun. Cüzdanınız bir imza (Permit) ister. Kontrol edin: sözleşme DYOR LPs (0x35c1…cD25), spender 0x1E69…6036 (DYORSwap yönlendiricisi) ve tutar çektiğiniz LP.",
        `“Remove”, sonra “Confirm” düğmesine dokunun. Cüzdanınız bir işlemi onaylamanızı ister. Kontrol edin: işlem 0x1E69…6036 adresine gidiyor ve 0 OKB gönderiyor. Yaklaşık ${got} almalısınız; kesin rakamlar açılır pencerededir.`,
        "Son olarak cüzdanınızın onay yönetimini açın ve likidite eklerken 0x1E69…6036 adresine verdiğiniz USDT onayını iptal edin.",
      ],
      after: "Geri aldığınız USDT_Bridged, X Layer ağının eski USDT'sidir ve OKX bunu aşamalı olarak kullanımdan kaldırıyor. Yeni USDT0'a geçmek için OKX borsasına yatırıp yeniden çekin.",
    };
  },
  foot: "Bu adımlar resmi site ve sözleşmelerle karşılaştırılarak kontrol edildi. Bu, metin sürümüdür.",
};
