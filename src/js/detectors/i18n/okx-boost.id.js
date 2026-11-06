// Indonesian live-check text for the OKX Boost detector. Same shape as TEXT.en in ../okx-boost.text.js; self-contained.
// Numbers and dates arrive already formatted by okx-boost.js.
export default {
  row: {
    locked: (sym) => `${sym} yang dikunci`,
    end: "Terbuka pada",
    ready: "Sudah terbuka, siap ditarik",
    wait: "Masih terkunci, tidak ada yang bisa keluar sebelum waktunya",
    about: (usd) => `sekitar $${usd}`,
    noPrice: "Harga USD belum tersedia saat ini",
  },
  total: "Anda bisa mendapatkan kembali sekitar",
  line: {
    lock: (list) => `Kontrak penguncian OKX Boost 0xDA63…FD2b (Plasma X Launch): ${list}`,
    none: "Kontrak penguncian OKX Boost 0xDA63…FD2b (Plasma X Launch): tidak ada yang dikunci",
    done: (syms) => `Pernah mengunci ${syms}, sekarang 0 (sudah ditarik)`,
    end: (d, ready) => `Terbuka pada: ${d}${ready ? " (sudah terbuka)" : " (masih terkunci)"}`,
    gas: (x) => `OKB di dompet di X Layer (untuk biaya): ${x}`,
  },
  warn: {
    notYet: (d) => `Masih terkunci: bisa ditarik setelah ${d}`,
    lowGas: (x) => `Dompet ini hanya punya ${x} OKB di X Layer, yang mungkin tidak cukup untuk biaya. Kirim dulu sedikit OKB ke alamat ini di X Layer (0.001 sudah lebih dari cukup)`,
  },
  head: {
    "can-unstake": "Token Anda masih terkunci di OKX Boost",
    "not-yet": "Belum terbuka",
    "low-gas": "Isi dulu sedikit OKB untuk biaya",
    arrived: "Sudah masuk",
    withdrawn: "Sudah ditarik",
    nothing: "Tidak ada yang dikunci di sini",
  },
  say: {
    unstake: (x) => `${x} masih ada di kontrak penguncian OKX Boost, dan sudah terbuka. Di aplikasi OKX, buka halaman kampanye, gulir ke bawah ke detail staking, lalu ketuk tombol unstake.`,
    notYet: (d) => `Token Anda terbuka pada ${d}. Mengetuk Unstake sebelum itu tidak akan mengeluarkan apa pun.`,
    lowGas: (x) => `Dompet ini hanya punya ${x} OKB di X Layer. Unstake butuh biaya kecil (di bawah $0.01), jadi kirim dulu sedikit OKB ke alamat ini di X Layer (0.001 sudah lebih dari cukup), lalu kembali.`,
    arrived: (list) => `Sudah masuk: ${list}. Semua yang Anda punya di OKX Boost sudah keluar.`,
    withdrawn: (syms) => `${syms} Anda di kontrak penguncian sekarang 0 dan catatan penguncian masih ada, jadi sudah di-unstake (hanya Anda yang bisa melakukannya, dan dana hanya kembali ke alamat Anda sendiri). Jumlah dan waktu pastinya tidak ditemukan kali ini: di aplikasi OKX, buka ${syms} di dompet Anda dan cari entri unstake dari OKX Boost di riwayat transaksinya.`,
    nothing: "Alamat ini tidak punya dana terkunci di Plasma X Launch OKX Boost. Pastikan Anda berada di akun yang benar: satu dompet OKX bisa berisi beberapa akun.",
  },
  arr: {
    list: (items) => items.map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `${x} ${sym} dari kontrak penguncian OKX Boost 0xDA63…FD2b`,
  },
};
