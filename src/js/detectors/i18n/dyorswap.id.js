// Indonesian live-check text for the DYORSwap detector. Same shape as TEXT.en in ../dyorswap.text.js; self-contained.
// Numbers arrive already formatted by dyorswap.js.
export default {
  row: {
    usdt: "USDT yang bisa Anda tarik",
    okb: "OKB yang bisa Anda tarik",
    about: (usd) => `sekitar $${usd}`,
    noPrice: "Harga USD belum tersedia saat ini",
  },
  total: "Anda bisa mendapatkan kembali sekitar",
  line: {
    lp: (x) => `Di pool USDT/OKB DYORSwap, Anda bisa menarik: ${x}`,
    none: "Pool USDT/OKB DYORSwap: tidak ada LP di alamat ini",
    approval: "Izin USDT yang Anda berikan ke router DYORSwap saat menambahkan likuiditas masih aktif",
    gas: (x) => `OKB di dompet di X Layer (untuk biaya): ${x}`,
  },
  warn: {
    slip: (x) => `Saat ini pool ini membayar ${x}% lebih sedikit dari perkiraan situs, jadi slippage 1% di panduan ini mungkin tidak cukup dan penarikannya akan gagal. Dana Anda aman: untuk sementara jangan ikuti panduan. Ketuk "Ada kendala?" di kanan atas dan kirimkan laporannya kepada kami`,
    lowGas: (x) => `Dompet ini hanya punya ${x} OKB di X Layer, yang mungkin tidak cukup untuk biaya. Kirim dulu sedikit OKB ke alamat ini di X Layer (0.001 sudah lebih dari cukup)`,
  },
  head: {
    "in-pool": "Anda masih memegang LP di pool ini",
    partial: "Sebagian sudah keluar",
    "need-slip": "Jangan ikuti panduan untuk sementara",
    "low-gas": "Isi dulu sedikit OKB untuk biaya",
    arrived: "Sudah masuk",
    "no-lp": "Saat ini tidak ada LP di pool ini",
    "old-approval": "Ada izin lama yang bisa Anda batalkan",
    nothing: "Tidak ada LP di pool ini",
  },
  say: {
    inPool: (x) => `Anda masih memegang LP di pool ini, dan bisa menarik ${x} sekarang. Chain tidak menunjukkan sejauh mana Anda sudah melangkah: jika belum selesai, lanjutkan mengikuti panduan; jika baru saja konfirmasi, tunggu satu menit dan jangan ketuk lagi; jika halaman menampilkan error saat Confirm, lihat situasi umum di bawah.`,
    partial: (done, left) => `Ada penarikan yang berhasil dalam beberapa menit terakhir: ${done} sudah masuk. Anda masih memegang LP dan bisa menarik ${left} sekarang. Untuk mengeluarkan semuanya, ulangi panduan; atau biarkan saja, dana itu tetap milik Anda.`,
    lowGas: (x) => `Dompet ini hanya punya ${x} OKB di X Layer. Penarikan butuh biaya kecil (di bawah $0.01), jadi kirim dulu sedikit OKB ke alamat ini di X Layer (0.001 sudah lebih dari cukup), lalu kembali.`,
    arrived: (list) => `Sudah masuk: ${list}. LP Anda di pool ini sudah ditarik semuanya.`,
    noLp: "Alamat ini saat ini tidak punya LP di pool ini, dan sebelumnya pernah menarik dengan tanda tangan. Kami tidak bisa memastikan apa yang sudah masuk (kami hanya bisa melihat penarikan dalam beberapa menit terakhir): di aplikasi OKX, buka OKB atau USDT di dompet Anda dan lihat riwayat transaksinya.",
    approval: "Izin USDT yang Anda berikan ke router DYORSwap 0x1E69…6036 saat menambahkan likuiditas masih aktif. Anda tidak memerlukannya lagi: batalkan di tab izin di beranda dompet Anda (memakan biaya kecil). Dana Anda tetap aman dibatalkan atau tidak.",
    nothing: "Alamat ini tidak punya LP di pool USDT/OKB DYORSwap. Pastikan Anda berada di akun yang benar: satu dompet OKX bisa berisi beberapa akun. Panduan ini belum dicek untuk pool lain.",
  },
  arr: {
    list: (items) => items.map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `${x} ${sym} dari kontrak router DYORSwap 0x1E69…6036`,
  },
};
