// Vietnamese live-check text for the OKX Boost detector. Same shape as TEXT.en in ../okx-boost.text.js; self-contained.
// Numbers and dates arrive already formatted by okx-boost.js.
export default {
  row: {
    locked: (sym) => `${sym} đang khóa`,
    end: "Mở khóa lúc",
    ready: "Đã mở khóa, có thể rút ngay",
    wait: "Vẫn đang khóa, trước thời điểm đó không rút được gì",
    about: (usd) => `khoảng $${usd}`,
    noPrice: "Hiện chưa có giá USD",
  },
  total: "Bạn có thể lấy lại khoảng",
  line: {
    lock: (list) => `Hợp đồng khóa của OKX Boost 0xDA63…FD2b (Plasma X Launch): ${list}`,
    none: "Hợp đồng khóa của OKX Boost 0xDA63…FD2b (Plasma X Launch): không có gì đang khóa",
    done: (syms) => `Đã từng khóa ${syms}, giờ là 0 (đã rút)`,
    end: (d, ready) => `Mở khóa lúc: ${d}${ready ? " (đã mở khóa)" : " (vẫn đang khóa)"}`,
    gas: (x) => `OKB trong ví trên X Layer (để trả phí): ${x}`,
  },
  warn: {
    notYet: (d) => `Vẫn đang khóa: có thể rút sau ${d}`,
    lowGas: (x) => `Ví này chỉ có ${x} OKB trên X Layer, có thể không đủ trả phí. Trước tiên hãy gửi một ít OKB vào địa chỉ này trên X Layer (0.001 là dư)`,
  },
  head: {
    "can-unstake": "Token của bạn vẫn đang khóa trong OKX Boost",
    "not-yet": "Chưa mở khóa",
    "low-gas": "Hãy nạp thêm một ít OKB để trả phí trước",
    arrived: "Đã về",
    withdrawn: "Đã rút rồi",
    nothing: "Không có gì đang khóa ở đây",
  },
  say: {
    unstake: (x) => `${x} vẫn nằm trong hợp đồng khóa của OKX Boost, và đã mở khóa. Trong ứng dụng OKX, mở trang chương trình, cuộn xuống phần chi tiết staking và nhấn nút hủy stake.`,
    notYet: (d) => `Token của bạn mở khóa vào ${d}. Nhấn Unstake trước thời điểm đó sẽ không rút được gì.`,
    lowGas: (x) => `Ví này chỉ có ${x} OKB trên X Layer. Hủy stake cần một khoản phí nhỏ (dưới $0.01), nên trước tiên hãy gửi một ít OKB vào địa chỉ này trên X Layer (0.001 là dư), rồi quay lại.`,
    arrived: (list) => `Đã về: ${list}. Mọi thứ bạn có trong OKX Boost đã được rút ra.`,
    withdrawn: (syms) => `${syms} của bạn trong hợp đồng khóa giờ là 0 và bản ghi khóa vẫn còn, nghĩa là đã được hủy stake (chỉ bạn mới làm được việc đó, và tiền chỉ trả về đúng địa chỉ của bạn). Lần này không tìm thấy số lượng và thời gian chính xác: trong ứng dụng OKX, hãy mở ${syms} trong ví và tìm mục hủy stake từ OKX Boost trong lịch sử giao dịch.`,
    nothing: "Địa chỉ này không có gì đang khóa trong Plasma X Launch của OKX Boost. Hãy kiểm tra bạn có đang ở đúng tài khoản không: một ví OKX có thể chứa nhiều tài khoản.",
  },
  arr: {
    list: (items) => items.map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `${x} ${sym} từ hợp đồng khóa của OKX Boost 0xDA63…FD2b`,
  },
};
