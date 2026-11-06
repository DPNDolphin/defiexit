// X Layer 의 OKX Boost·DYORSwap 꺼내기 안내(한국어, 글로 된 버전). 모양과 인자는 lib/xlayer.text.js 의 HOW.en 과 같다.
// 인자 v: { ready 잠금이 풀렸는지, date 해제 시각(이미 형식을 맞춘 문자열), got 받을 금액(예: "0.5 OKB") }
// 자리표시 바로 뒤에는 받침에 따라 바뀌는 조사를 붙이지 않는다. 단계 수와 copy 의 주소는 영어판과 같다.
export default {
  "okx-boost": (v) => ({
    title: "OKX Boost에 잠근 토큰 꺼내기",
    note: `Plasma X Launch용 잠금 · ${v.ready ? `${v.date}부터 잠금 해제됨` : `${v.date}에 잠금 해제`}`,
    status: v.ready ? { ok: true, head: `${v.date}부터 잠금이 풀려 출금할 수 있어요`, text: "마감은 없어요. 잠금이 풀린 뒤에는 언제든 출금할 수 있어요." }
      : { ok: false, head: `${v.date}에 잠금이 풀려요`, text: "그 전에는 아무것도 나오지 않아요." },
    lead: "OKX Boost의 Plasma X Launch에 참여하려면 X Layer에 토큰을 2일 동안 잠가야 했어요. 토큰은 저절로 돌아오지 않으니 직접 ‘Unstake’를 눌러야 해요. 잠금 컨트랙트의 소스 코드는 OKX 익스플로러에서 검증돼 있고, 관리자가 없으며, 자금은 본인 주소로만 돌아갈 수 있어요.",
    steps: [
      { text: "OKX 앱에서: 위쪽에서 Web3를 고르고, 아래쪽의 탐색 탭을 열어 검색창에 아래 링크를 붙여 넣은 뒤 서드파티 웹사이트 결과를 누르세요. 앱 버전을 권하는 팝업이 뜨면 굵은 글씨 버튼을 눌러 앱에서 여세요(웹 버전은 앱 안의 지갑과 연결되지 않아요).", copy: "https://web3.okx.com/boost/x-launch/plasma" },
      "아래로 내려 스테이킹 내역에서 스테이킹 해제 버튼을 누르세요.",
      "스테이킹 해제 확인 화면이 열려요. 확인하세요: 네트워크는 X Layer, 상호작용 주소는 0xDA63…FD2b(OKX Boost), 금액에는 플러스 부호가 있어야 해요(내가 받는다는 뜻). 하나라도 맞지 않으면 거절하세요.",
      `입금: X Layer의 내 지갑에 ${v.got} 입금이 보여요(WOKB가 아니라 OKB 그 자체로). 이곳으로 돌아와 ‘다시 점검’을 누르세요.`,
    ],
  }),
  dyorswap: (v) => ({
    title: "DYORSwap에서 유동성 꺼내기",
    note: "USDT_Bridged / WOKB 풀 · 지갑 안의 LP 토큰",
    warn: "2026년 9월 DYORSwap이 실수로 가짜 체인을 올렸고, 사용자들이 가짜 브릿지로 자금을 잃었어요(DYORSwap 자체 컨트랙트가 해킹된 것은 아니에요). dyorswap.finance만 쓰고, X Layer 네트워크를 고르고, ‘Bridge’는 누르지 마세요.",
    lead: "DYORSwap(PancakeSwap 포크)의 USDT_Bridged / WOKB 풀에 넣은 유동성이에요. 출금에는 지갑에서 확인이 두 번 필요해요. 먼저 출금하는 LP에만 해당하는 승인 서명, 그다음 거래예요.",
    steps: [
      { text: "주소가 들어 있는 지갑에서 이 링크를 열고, 연결한 뒤 X Layer 네트워크를 고르세요.", copy: "https://dyorswap.finance/find/?chainId=196" },
      "‘Select a Token’을 누르고 USDT(USD₮0 아님)를 고른 뒤 ‘Manage this pool’을 누르세요. 이 풀은 사이트 기본 목록에 없어서, Your Liquidity만 보면 No liquidity found라고 나와요.",
      "목록으로 돌아와 먼저 슬리피지를 바꾸세요: 톱니바퀴를 누르고 1.0%를 고른 뒤 ×를 눌러 닫으세요. 이걸 건너뛰면 출금이 This transaction would fail로 실패해요. 이 풀은 사이트 예상보다 조금 적게 지급하는데, 그 차이가 기본값 0.5%보다 커요.",
      "USDT/OKB 줄을 누르고 ‘Remove’, 그다음 ‘Max’를 누르세요. USDT와 OKB를 둘 다 받는 기본 설정은 그대로 두고, 한 가지 토큰으로 바꾸지 마세요.",
      "‘Enable’을 누르세요. 지갑이 서명(Permit)을 요청해요. 확인하세요: 컨트랙트는 DYOR LPs(0x35c1…cD25), spender는 0x1E69…6036(DYORSwap 라우터), 금액은 출금하는 LP만큼이에요.",
      `‘Remove’, 그다음 ‘Confirm’을 누르세요. 지갑이 거래 확인을 요청해요. 확인하세요: 보내는 곳은 0x1E69…6036이고, 전송 금액은 0 OKB예요. 받는 금액은 약 ${v.got} 정도이고, 정확한 숫자는 팝업에 나와요.`,
      "마지막으로 지갑의 승인 관리 화면을 열고, 유동성을 넣을 때 0x1E69…6036에 준 USDT 승인을 취소하세요.",
    ],
    after: "돌려받는 USDT_Bridged는 X Layer의 옛 USDT로, OKX가 단계적으로 없애고 있어요. 새 USDT0 토큰으로 바꾸려면 OKX 거래소에 입금했다가 다시 출금하세요.",
  }),
  foot: "이 단계는 공식 사이트와 컨트랙트에 대조해 확인했어요. 이것은 글로 된 버전이에요.",
};
