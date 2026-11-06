// OKX Boost 실시간 확인 문구(한국어). 모양과 함수 인자는 okx-boost.text.js 의 TEXT.en 과 같다.
// 숫자는 okx-boost.js 가 계산하고 형식을 맞춰 넘겨준다. 자리표시 바로 뒤에는 받침에 따라 바뀌는 조사를 붙이지 않는다.
export default {
  row: {
    locked: (sym) => `잠근 ${sym}`,
    end: "잠금 해제 시점",
    ready: "잠금이 풀려서 출금할 수 있어요",
    wait: "아직 잠겨 있어요. 그 전에는 아무것도 꺼낼 수 없어요",
    about: (usd) => `약 $${usd}`,
    noPrice: "지금은 달러 가격을 알 수 없어요",
  },
  total: "되찾을 수 있는 금액 약",
  line: {
    lock: (list) => `OKX Boost 잠금 컨트랙트 0xDA63…FD2b(Plasma X Launch): ${list}`,
    none: "OKX Boost 잠금 컨트랙트 0xDA63…FD2b(Plasma X Launch): 잠긴 것 없음",
    done: (syms) => `잠겨 있던 ${syms}, 지금은 0(출금됨)`,
    end: (d, ready) => `잠금 해제: ${d}${ready ? " (풀림)" : " (아직 잠김)"}`,
    gas: (x) => `X Layer 지갑의 OKB(수수료용): ${x}`,
  },
  warn: {
    notYet: (d) => `아직 잠겨 있어요: ${d} 이후에 출금할 수 있어요`,
    lowGas: (x) => `이 지갑의 X Layer OKB가 ${x}뿐이라 수수료가 모자랄 수 있어요. 먼저 X Layer 네트워크로 이 주소에 OKB를 조금 보내세요(0.001이면 충분해요)`,
  },
  head: {
    "can-unstake": "토큰이 아직 OKX Boost에 잠겨 있어요",
    "not-yet": "아직 잠금이 풀리지 않았어요",
    "low-gas": "먼저 수수료로 쓸 OKB를 조금 채우세요",
    arrived: "들어왔어요",
    withdrawn: "이미 출금했어요",
    nothing: "여기에는 잠긴 것이 없어요",
  },
  say: {
    unstake: (x) => `아직 OKX Boost 잠금 컨트랙트에 ${x} 있고, 잠금이 풀렸어요. OKX 앱에서 캠페인 페이지를 열고, 아래로 내려 스테이킹 내역에서 스테이킹 해제 버튼을 누르세요.`,
    notYet: (d) => `토큰은 ${d}에 잠금이 풀려요. 그 전에 ‘Unstake’를 눌러도 아무것도 나오지 않아요.`,
    lowGas: (x) => `이 지갑의 X Layer OKB가 ${x}뿐이에요. 스테이킹 해제에는 작은 수수료($0.01 미만)가 드니, 먼저 X Layer 네트워크로 이 주소에 OKB를 조금 보낸 뒤(0.001이면 충분해요) 돌아오세요.`,
    arrived: (list) => `들어왔어요: ${list}. OKX Boost에 있던 것은 모두 빠져나왔어요.`,
    withdrawn: (syms) => `잠금 컨트랙트의 ${syms} 잔액이 이제 0이고 잠금 기록은 남아 있으니, 스테이킹이 해제된 거예요(그건 본인만 할 수 있고, 돈은 본인 주소로만 돌아가요). 이번에는 정확한 금액과 시각을 찾지 못했어요. OKX 앱의 지갑에서 ${syms} 항목을 열고, 거래 내역에서 OKX Boost의 스테이킹 해제 기록을 찾아보세요.`,
    nothing: "이 주소에는 OKX Boost의 Plasma X Launch에 잠긴 것이 없어요. 맞는 계정인지 확인하세요. OKX 지갑에는 계정이 여러 개 있을 수 있어요.",
  },
  arr: {
    list: (items) => items.map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `OKX Boost 잠금 컨트랙트 0xDA63…FD2b에서 온 ${x} ${sym}`,
  },
};
