// Vietnamese text for the X Layer exit sheets (OKX Boost, DYORSwap). Same shape as HOW.en in ../../lib/xlayer.text.js; self-contained.
// v: { ready, date (already formatted for the user's time zone), got (e.g. "0.5 OKB") }. "Check again" = the results page button ("Kiểm tra lại").
export default {
  "okx-boost": (v) => ({
    title: "Lấy token đang khóa ra khỏi OKX Boost",
    note: `Đã khóa cho Plasma X Launch · ${v.ready ? "đã mở khóa từ" : "mở khóa vào"} ${v.date}`,
    status: v.ready ? { ok: true, head: `Đã mở khóa từ ${v.date}, có thể rút ngay`, text: "Không có hạn chót: có thể rút bất cứ lúc nào sau khi mở khóa." }
      : { ok: false, head: `Mở khóa vào ${v.date}`, text: "Trước thời điểm đó không rút được gì." },
    lead: "Để tham gia Plasma X Launch của OKX Boost, bạn phải khóa token trên X Layer trong 2 ngày. Token không tự quay về: bạn phải nhấn Unstake. Mã nguồn của hợp đồng khóa đã được xác minh trên trình khám phá OKX, hợp đồng không có quản trị viên, và tiền chỉ có thể trả về đúng địa chỉ của bạn.",
    steps: [
      { text: "Trong ứng dụng OKX: chọn Web3 ở trên cùng, mở tab khám phá ở dưới cùng, dán đường dẫn bên dưới vào ô tìm kiếm và nhấn vào kết quả trang web bên thứ ba. Khi một cửa sổ bật lên đề nghị dùng phiên bản ứng dụng, hãy nhấn nút in đậm để mở trong ứng dụng (bản web không kết nối được với ví bên trong ứng dụng).", copy: "https://web3.okx.com/boost/x-launch/plasma" },
      "Cuộn xuống phần chi tiết staking và nhấn nút hủy stake.",
      "Trang xác nhận hủy stake mở ra. Kiểm tra: mạng là X Layer, địa chỉ tương tác là 0xDA63…FD2b (OKX Boost), và số tiền có dấu cộng, nghĩa là bạn nhận được. Nếu có gì không khớp, hãy từ chối.",
      `Tiền về: ${v.got} sẽ hiện trong ví của bạn trên X Layer (dưới dạng chính OKB, không phải WOKB). Quay lại đây và nhấn Kiểm tra lại.`,
    ],
  }),
  dyorswap: (v) => ({
    title: "Lấy thanh khoản ra khỏi DYORSwap",
    note: "Pool USDT_Bridged / WOKB · token LP nằm trong ví của bạn",
    warn: "Vào tháng 9/2026, DYORSwap đã lỡ niêm yết một chuỗi giả và người dùng bị mất tiền qua một cầu nối giả (bản thân các hợp đồng của DYORSwap không bị hack). Chỉ dùng dyorswap.finance, chọn mạng X Layer, và đừng nhấn Bridge.",
    lead: "Đây là thanh khoản bạn đã thêm vào pool USDT_Bridged / WOKB trên DYORSwap (một bản fork của PancakeSwap). Rút ra cần hai lần xác nhận trong ví: trước tiên là một chữ ký chỉ cấp quyền cho phần LP bạn đang rút, sau đó là một giao dịch.",
    steps: [
      { text: "Mở đường dẫn này trong ví đang giữ địa chỉ của bạn, kết nối, và chọn mạng X Layer.", copy: "https://dyorswap.finance/find/?chainId=196" },
      "Nhấn Select a Token, chọn USDT (không phải USD₮0), rồi nhấn Manage this pool. Pool này không có trong danh sách mặc định của trang, nên nếu chỉ xem Your Liquidity thì sẽ thấy No liquidity found.",
      "Quay về danh sách, trước tiên hãy đổi độ trượt giá: nhấn bánh răng, chọn 1.0%, rồi nhấn × để đóng. Nếu bỏ qua bước này, lệnh rút sẽ thất bại với thông báo This transaction would fail: pool này trả về ít hơn một chút so với ước tính của trang, vượt mức mặc định 0.5%.",
      "Nhấn dòng USDT/OKB, nhấn Remove, rồi nhấn Max. Giữ mặc định là nhận cả USDT lẫn OKB; đừng chuyển sang chỉ nhận một loại token.",
      "Nhấn Enable. Ví sẽ yêu cầu một chữ ký (Permit). Kiểm tra: hợp đồng là DYOR LPs (0x35c1…cD25), spender là 0x1E69…6036 (router của DYORSwap), và số lượng là phần LP bạn đang rút.",
      `Nhấn Remove, rồi Confirm. Ví sẽ yêu cầu bạn xác nhận một giao dịch. Kiểm tra: giao dịch gửi đến 0x1E69…6036 và gửi 0 OKB. Bạn sẽ nhận khoảng ${v.got}; con số chính xác nằm trong cửa sổ bật lên.`,
      "Cuối cùng, mở trình quản lý cấp quyền trong ví và thu hồi quyền USDT bạn đã cấp cho 0x1E69…6036 khi thêm thanh khoản.",
    ],
    after: "USDT_Bridged bạn nhận lại là USDT cũ của X Layer, loại mà OKX đang dần loại bỏ. Muốn chuyển sang USDT0 mới, hãy nạp lên sàn OKX rồi rút ra lại.",
  }),
  foot: "Các bước này đã được đối chiếu với trang chính thức và các hợp đồng. Đây là bản bằng chữ.",
};
