// Vietnamese live-check text for the DYORSwap detector. Same shape as TEXT.en in ../dyorswap.text.js; self-contained.
// Numbers arrive already formatted by dyorswap.js.
export default {
  row: {
    usdt: "USDT bạn có thể rút",
    okb: "OKB bạn có thể rút",
    about: (usd) => `khoảng $${usd}`,
    noPrice: "Hiện chưa có giá USD",
  },
  total: "Bạn có thể lấy lại khoảng",
  line: {
    lp: (x) => `Trong pool USDT/OKB của DYORSwap, bạn có thể rút: ${x}`,
    none: "Pool USDT/OKB của DYORSwap: địa chỉ này không có LP",
    approval: "Quyền USDT bạn đã cấp cho router của DYORSwap khi thêm thanh khoản vẫn còn hiệu lực",
    gas: (x) => `OKB trong ví trên X Layer (để trả phí): ${x}`,
  },
  warn: {
    slip: (x) => `Pool này hiện trả về ít hơn ${x}% so với ước tính của trang, nên độ trượt giá 1% trong hướng dẫn này có thể không đủ và lệnh rút sẽ thất bại. Tiền của bạn vẫn an toàn: tạm thời đừng làm theo hướng dẫn. Nhấn "Bị kẹt?" ở góc trên bên phải và gửi báo cáo cho chúng tôi`,
    lowGas: (x) => `Ví này chỉ có ${x} OKB trên X Layer, có thể không đủ trả phí. Trước tiên hãy gửi một ít OKB vào địa chỉ này trên X Layer (0.001 là dư)`,
  },
  head: {
    "in-pool": "Bạn vẫn còn LP trong pool này",
    partial: "Một phần đã được rút",
    "need-slip": "Tạm thời đừng làm theo hướng dẫn",
    "low-gas": "Hãy nạp thêm một ít OKB để trả phí trước",
    arrived: "Đã về",
    "no-lp": "Hiện không có LP trong pool này",
    "old-approval": "Có một quyền cũ bạn có thể hủy",
    nothing: "Không tìm thấy LP trong pool này",
  },
  say: {
    inPool: (x) => `Bạn vẫn còn LP trong pool này, và có thể rút ${x} ngay bây giờ. Trên chuỗi không thấy được bạn đã làm đến đâu: nếu chưa xong, hãy tiếp tục làm theo hướng dẫn; nếu vừa xác nhận, hãy chờ một phút và đừng nhấn lại; nếu trang báo lỗi lúc nhấn Confirm, hãy xem các tình huống thường gặp bên dưới.`,
    partial: (done, left) => `Trong vài phút gần đây đã có một lệnh rút thành công: ${done} đã về. Bạn vẫn còn LP và có thể rút ${left} ngay bây giờ. Muốn rút hết, hãy làm lại theo hướng dẫn; hoặc cứ để đó, tiền vẫn là của bạn.`,
    lowGas: (x) => `Ví này chỉ có ${x} OKB trên X Layer. Rút tiền cần một khoản phí nhỏ (dưới $0.01), nên trước tiên hãy gửi một ít OKB vào địa chỉ này trên X Layer (0.001 là dư), rồi quay lại.`,
    arrived: (list) => `Đã về: ${list}. LP của bạn trong pool này đã được rút hết.`,
    noLp: "Địa chỉ này hiện không có LP trong pool này, và trước đây đã từng rút bằng chữ ký. Chúng tôi không xác nhận được số tiền đã về (chúng tôi chỉ thấy được các lệnh rút trong vài phút gần đây): trong ứng dụng OKX, hãy mở OKB hoặc USDT trong ví và xem lịch sử giao dịch.",
    approval: "Quyền USDT bạn đã cấp cho router của DYORSwap 0x1E69…6036 khi thêm thanh khoản vẫn còn hiệu lực. Bạn không cần nó nữa: hãy hủy trong tab cấp quyền ở trang chủ ví (tốn một khoản phí nhỏ). Dù hủy hay không, tiền của bạn vẫn an toàn.",
    nothing: "Địa chỉ này không có LP trong pool USDT/OKB của DYORSwap. Hãy kiểm tra bạn có đang ở đúng tài khoản không: một ví OKX có thể chứa nhiều tài khoản. Hướng dẫn này chưa được kiểm tra cho các pool khác.",
  },
  arr: {
    list: (items) => items.map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `${x} ${sym} từ hợp đồng router của DYORSwap 0x1E69…6036`,
  },
};
