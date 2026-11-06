// Diagnóstico ao vivo do OKX Boost, em português do Brasil (você). Mesmo formato de TEXT.en em ../okx-boost.text.js:
// os números e datas chegam já calculados e formatados pelo okx-boost.js. Sem imports.
export default {
  row: {
    locked: (sym) => `${sym} bloqueado`,
    end: "Desbloqueia",
    ready: "Desbloqueado, pronto para sacar",
    wait: "Ainda bloqueado; antes disso nada sai",
    about: (usd) => `cerca de $${usd}`,
    noPrice: "Preço em USD indisponível agora",
  },
  total: "Você pode receber de volta cerca de",
  line: {
    lock: (list) => `Contrato de bloqueio do OKX Boost 0xDA63…FD2b (Plasma X Launch): ${list}`,
    none: "Contrato de bloqueio do OKX Boost 0xDA63…FD2b (Plasma X Launch): nada bloqueado",
    done: (syms) => `Tinha ${syms} bloqueado, agora 0 (sacado)`,
    end: (d, ready) => `Desbloqueia: ${d}${ready ? " (desbloqueado)" : " (ainda bloqueado)"}`,
    gas: (x) => `OKB na carteira na X Layer (para as taxas): ${x}`,
  },
  warn: {
    notYet: (d) => `Ainda bloqueado: pode ser sacado depois de ${d}`,
    lowGas: (x) => `Só há ${x} OKB na X Layer nesta carteira, o que pode não cobrir a taxa. Primeiro envie um pouco de OKB para este endereço na X Layer (0.001 é mais que suficiente)`,
  },
  head: {
    "can-unstake": "Os seus tokens ainda estão bloqueados no OKX Boost",
    "not-yet": "Ainda não desbloqueou",
    "low-gas": "Adicione primeiro um pouco de OKB para a taxa",
    arrived: "Chegou",
    withdrawn: "Já sacado",
    nothing: "Nada bloqueado aqui",
  },
  say: {
    unstake: (x) => `Ainda há ${x} no contrato de bloqueio do OKX Boost, e já desbloqueou. No app da OKX, abra a página da campanha, role até os detalhes do staking e toque no botão de retirar do staking.`,
    notYet: (d) => `Os seus tokens desbloqueiam em ${d}. Tocar em “Unstake” antes disso não tira nada.`,
    lowGas: (x) => `Só há ${x} OKB na X Layer nesta carteira. Retirar do staking exige uma pequena taxa (menos de $0.01), então primeiro envie um pouco de OKB para este endereço na X Layer (0.001 é mais que suficiente) e depois volte.`,
    arrived: (list) => `Chegou: ${list}. Tudo o que você tinha no OKX Boost já saiu.`,
    withdrawn: (syms) => `O seu ${syms} no contrato de bloqueio agora está em 0 e o registro do bloqueio continua lá, então ele foi retirado do staking (só você pode fazer isso, e o dinheiro só volta para o seu próprio endereço). Desta vez não encontramos o valor exato nem o horário: no app da OKX, abra ${syms} na sua carteira e procure no histórico de transações a retirada do staking do OKX Boost.`,
    nothing: "Este endereço não tem nada bloqueado no Plasma X Launch do OKX Boost. Confira se você está na conta certa: uma carteira da OKX pode ter várias.",
  },
  arr: {
    list: (items) => (items || []).map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `${x} ${sym} do contrato de bloqueio do OKX Boost 0xDA63…FD2b`,
  },
};
