// OKX Boost のリアルタイム確認の文言(日本語)。形と関数の引数は okx-boost.text.js の TEXT.en と同じ。
// 数字は okx-boost.js が計算・整形して渡す。
export default {
  row: {
    locked: (sym) => `ロック中の${sym}`,
    end: "ロック解除",
    ready: "ロック解除済み、引き出せます",
    wait: "まだロック中で、それまでは何も取り出せません",
    about: (usd) => `約$${usd}`,
    noPrice: "今はドル価格を取得できません",
  },
  total: "取り戻せる額 約",
  line: {
    lock: (list) => `OKX Boostのロックコントラクト0xDA63…FD2b（Plasma X Launch）：${list}`,
    none: "OKX Boostのロックコントラクト0xDA63…FD2b（Plasma X Launch）：ロックされているものはありません",
    done: (syms) => `${syms}をロックしていましたが、今は0です（引き出し済み）`,
    end: (d, ready) => `ロック解除：${d}${ready ? "（解除済み）" : "（まだロック中）"}`,
    gas: (x) => `X Layer上のウォレットのOKB（手数料用）：${x}`,
  },
  warn: {
    notYet: (d) => `まだロック中です：${d}以降に引き出せます`,
    lowGas: (x) => `このウォレットにはX Layer上のOKBが${x}しかなく、手数料が足りないかもしれません。先にX Layerでこのアドレスに少しOKBを送ってください（0.001あれば十分です）`,
  },
  head: {
    "can-unstake": "トークンはまだOKX Boostにロックされています",
    "not-yet": "まだロックが解除されていません",
    "low-gas": "先に手数料用のOKBを少し足してください",
    arrived: "届きました",
    withdrawn: "引き出し済みです",
    nothing: "ここにロックされているものはありません",
  },
  say: {
    unstake: (x) => `${x}がまだOKX Boostのロックコントラクトにあり、ロックは解除されています。OKXアプリでキャンペーンページを開き、下にスクロールしてステーキングの詳細からステーキング解除ボタンを押してください。`,
    notYet: (d) => `トークンのロックは${d}に解除されます。それより前に「Unstake」を押しても何も出てきません。`,
    lowGas: (x) => `このウォレットにはX Layer上のOKBが${x}しかありません。ステーキング解除には少額の手数料（$0.01未満）がかかるので、先にX Layerでこのアドレスに少しOKBを送ってから（0.001あれば十分です）、戻ってきてください。`,
    arrived: (list) => `届きました：${list}。OKX Boostにあったものは、すべて取り出せました。`,
    withdrawn: (syms) => `ロックコントラクトにある${syms}は今0で、ロックの記録は残っているので、ステーキングは解除されています（解除できるのは本人だけで、お金は本人のアドレスにしか戻りません）。今回は正確な金額と時刻は見つかりませんでした：OKXアプリのウォレットで${syms}を開き、取引履歴でOKX Boostからのステーキング解除を探してください。`,
    nothing: "このアドレスには、OKX BoostのPlasma X Launchでロックしているものがありません。正しいアカウントか確認してください：OKXウォレットには複数のアカウントを持てます。",
  },
  arr: {
    list: (items) => items.map((x) => `${x.amount} ${x.sym}`).join("、"),
    item: (x, sym) => `OKX Boostのロックコントラクト0xDA63…FD2bからの${x} ${sym}`,
  },
};
