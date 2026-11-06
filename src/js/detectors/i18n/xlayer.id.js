// Indonesian text for the X Layer exit sheets (OKX Boost, DYORSwap). Same shape as HOW.en in ../../lib/xlayer.text.js; self-contained.
// v: { ready, date (already formatted for the user's time zone), got (e.g. "0.5 OKB") }. "Check again" = the results page button ("Cek ulang").
export default {
  "okx-boost": (v) => ({
    title: "Keluarkan token terkunci Anda dari OKX Boost",
    note: `Dikunci untuk Plasma X Launch · ${v.ready ? "terbuka sejak" : "terbuka pada"} ${v.date}`,
    status: v.ready ? { ok: true, head: `Terbuka sejak ${v.date}, siap ditarik`, text: "Tidak ada tenggat: bisa ditarik kapan saja setelah terbuka." }
      : { ok: false, head: `Terbuka pada ${v.date}`, text: "Tidak ada yang bisa keluar sebelum itu." },
    lead: "Untuk ikut Plasma X Launch OKX Boost, Anda harus mengunci token di X Layer selama 2 hari. Token itu tidak kembali dengan sendirinya: Anda harus mengetuk Unstake. Kode sumber kontrak penguncian sudah terverifikasi di explorer OKX, kontrak ini tidak punya admin, dan dana hanya bisa kembali ke alamat Anda sendiri.",
    steps: [
      { text: "Di aplikasi OKX: pilih Web3 di bagian atas, buka tab jelajah di bagian bawah, tempel tautan di bawah ke kotak pencarian, lalu ketuk hasil situs web pihak ketiga. Saat muncul pop-up yang menawarkan versi aplikasi, ketuk tombol tebal untuk membukanya di aplikasi (versi web tidak bisa terhubung ke dompet di dalam aplikasi).", copy: "https://web3.okx.com/boost/x-launch/plasma" },
      "Gulir ke bawah ke detail staking dan ketuk tombol unstake.",
      "Konfirmasi unstake terbuka. Periksa: jaringannya X Layer, alamat interaksinya 0xDA63…FD2b (OKX Boost), dan jumlahnya bertanda plus, artinya Anda yang menerima. Jika ada yang tidak cocok, tolak.",
      `Dana masuk: ${v.got} muncul di dompet Anda di X Layer (sebagai OKB itu sendiri, bukan WOKB). Kembali ke sini dan ketuk Cek ulang.`,
    ],
  }),
  dyorswap: (v) => ({
    title: "Keluarkan likuiditas Anda dari DYORSwap",
    note: "Pool USDT_Bridged / WOKB · token LP ada di dompet Anda",
    warn: "Pada September 2026, DYORSwap keliru mencantumkan chain palsu dan pengguna kehilangan dana lewat bridge palsu (kontrak DYORSwap sendiri tidak diretas). Gunakan hanya dyorswap.finance, pilih jaringan X Layer, dan jangan ketuk Bridge.",
    lead: "Ini likuiditas yang Anda tambahkan ke pool USDT_Bridged / WOKB di DYORSwap (fork dari PancakeSwap). Penarikan butuh dua konfirmasi di dompet Anda: pertama tanda tangan yang hanya memberi izin untuk LP yang Anda tarik, lalu sebuah transaksi.",
    steps: [
      { text: "Buka tautan ini di dompet yang memegang alamat Anda, hubungkan, lalu pilih jaringan X Layer.", copy: "https://dyorswap.finance/find/?chainId=196" },
      "Ketuk Select a Token, pilih USDT (bukan USD₮0), lalu ketuk Manage this pool. Pool ini tidak ada di daftar default situs, jadi kalau hanya melihat Your Liquidity, yang tampil adalah No liquidity found.",
      "Kembali di daftar, ubah dulu slippage: ketuk ikon roda gigi, pilih 1.0%, lalu ketuk × untuk menutup. Jika langkah ini dilewati, penarikan gagal dengan This transaction would fail: pool ini membayar sedikit lebih kecil dari perkiraan situs, melebihi default 0.5%.",
      "Ketuk baris USDT/OKB, ketuk Remove, lalu ketuk Max. Biarkan default menerima USDT dan OKB sekaligus; jangan beralih ke satu token saja.",
      "Ketuk Enable. Dompet Anda meminta tanda tangan (Permit). Periksa: kontraknya DYOR LPs (0x35c1…cD25), spender-nya 0x1E69…6036 (router DYORSwap), dan jumlahnya adalah LP yang Anda tarik.",
      `Ketuk Remove, lalu Confirm. Dompet Anda meminta Anda mengonfirmasi transaksi. Periksa: transaksinya ke 0x1E69…6036 dan mengirim 0 OKB. Anda akan mendapat sekitar ${v.got}; angka pastinya ada di pop-up.`,
      "Terakhir, buka pengelola izin di dompet Anda dan cabut izin USDT yang Anda berikan ke 0x1E69…6036 saat menambahkan likuiditas.",
    ],
    after: "USDT_Bridged yang Anda terima adalah USDT lama X Layer, yang sedang dihapus bertahap oleh OKX. Untuk beralih ke USDT0 yang baru, deposit ke exchange OKX lalu tarik lagi.",
  }),
  foot: "Langkah-langkah ini sudah dicocokkan dengan situs resmi dan kontraknya. Ini versi teks.",
};
