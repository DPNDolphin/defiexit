// Diagnóstico ao vivo da DYORSwap, em português do Brasil (você). Mesmo formato de TEXT.en em ../dyorswap.text.js:
// os números chegam já calculados e formatados pelo dyorswap.js. Sem imports.
export default {
  row: {
    usdt: "USDT que você pode sacar",
    okb: "OKB que você pode sacar",
    about: (usd) => `cerca de $${usd}`,
    noPrice: "Preço em USD indisponível agora",
  },
  total: "Você pode receber de volta cerca de",
  line: {
    lp: (x) => `No pool USDT/OKB da DYORSwap, você pode sacar: ${x}`,
    none: "Pool USDT/OKB da DYORSwap: nenhum LP neste endereço",
    approval: "A aprovação de USDT que você deu ao router da DYORSwap ao colocar liquidez continua ativa",
    gas: (x) => `OKB na carteira na X Layer (para as taxas): ${x}`,
  },
  warn: {
    slip: (x) => `Agora este pool paga ${x}% a menos do que o site estima, então o slippage de 1% deste guia pode não ser suficiente e o saque falharia. O seu dinheiro está seguro: por enquanto, não siga o guia. Toque em “Travou?” no canto superior direito e mande o relatório para a gente`,
    lowGas: (x) => `Só há ${x} OKB na X Layer nesta carteira, o que pode não cobrir a taxa. Primeiro envie um pouco de OKB para este endereço na X Layer (0.001 é mais que suficiente)`,
  },
  head: {
    "in-pool": "Você ainda tem LP neste pool",
    partial: "Uma parte já saiu",
    "need-slip": "Por enquanto, não siga o guia",
    "low-gas": "Adicione primeiro um pouco de OKB para a taxa",
    arrived: "Chegou",
    "no-lp": "Nenhum LP neste pool agora",
    "old-approval": "Há uma aprovação antiga que você pode cancelar",
    nothing: "Nenhum LP encontrado neste pool",
  },
  say: {
    inPool: (x) => `Você ainda tem LP neste pool e pode sacar ${x} agora. A blockchain não mostra até onde você chegou: se não terminou, continue seguindo o guia; se acabou de confirmar, espere um minuto e não toque de novo; se a página mostrou um erro ao tocar em “Confirm”, veja as situações comuns abaixo.`,
    partial: (done, left) => `Um saque passou nos últimos minutos: chegaram ${done}. Você ainda tem LP e pode sacar ${left} agora. Para tirar tudo, siga o guia de novo; ou deixe, continua sendo seu.`,
    lowGas: (x) => `Só há ${x} OKB na X Layer nesta carteira. Sacar exige uma pequena taxa (menos de $0.01), então primeiro envie um pouco de OKB para este endereço na X Layer (0.001 é mais que suficiente) e depois volte.`,
    arrived: (list) => `Chegou: ${list}. Todo o seu LP neste pool foi sacado.`,
    noLp: "Este endereço não tem LP neste pool agora, e já sacou antes com uma assinatura. Não conseguimos confirmar o que chegou (só vemos os saques dos últimos minutos): no app da OKX, abra OKB ou USDT na sua carteira e veja o histórico de transações.",
    approval: "A aprovação de USDT que você deu ao router da DYORSwap 0x1E69…6036 ao colocar liquidez continua ativa. Você não precisa mais dela: cancele na aba de aprovações do início da sua carteira (custa uma pequena taxa). O seu dinheiro está seguro de qualquer jeito.",
    nothing: "Este endereço não tem LP no pool USDT/OKB da DYORSwap. Confira se você está na conta certa: uma carteira da OKX pode ter várias. Este guia não foi conferido para outros pools.",
  },
  arr: {
    list: (items) => (items || []).map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `${x} ${sym} do contrato router da DYORSwap 0x1E69…6036`,
  },
};
