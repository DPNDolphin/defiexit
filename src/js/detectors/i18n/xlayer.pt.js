// Como tirar dois tipos de posição da X Layer (versão em texto), em português do Brasil (você).
// Mesmo formato de HOW.en em ../../lib/xlayer.text.js. Parâmetro v: { ready, date, got }. Sem imports.
export default {
  "okx-boost": (v) => {
    const x = v || {};
    return {
      title: "Tire do OKX Boost os seus tokens bloqueados",
      note: `Bloqueados para o Plasma X Launch · ${x.ready ? `desbloqueados desde ${x.date}` : `desbloqueiam em ${x.date}`}`,
      status: x.ready ? { ok: true, head: `Desbloqueados desde ${x.date}, prontos para sacar`, text: "Não há prazo: dá para sacar a qualquer momento depois do desbloqueio." }
        : { ok: false, head: `Desbloqueiam em ${x.date}`, text: "Antes disso, nada sai." },
      lead: "Para participar do Plasma X Launch do OKX Boost, era preciso bloquear tokens na X Layer por 2 dias. Eles não voltam sozinhos: você precisa tocar em “Unstake”. O código-fonte do contrato de bloqueio está verificado no explorador da OKX, ele não tem administrador, e os fundos só podem voltar para o seu próprio endereço.",
      steps: [
        { text: "No app da OKX: escolha “Web3” no topo, abra a aba de explorar embaixo, cole o link abaixo na busca e toque no resultado de site de terceiros. Quando um pop-up oferecer a versão do app, toque no botão em negrito para abrir no app (a versão web não consegue se conectar à carteira dentro do app).", copy: "https://web3.okx.com/boost/x-launch/plasma" },
        "Role até os detalhes do staking e toque no botão de retirar do staking.",
        "Abre a confirmação de retirada do staking. Confira: a rede é X Layer, o endereço de interação é 0xDA63…FD2b (OKX Boost) e o valor tem sinal de mais, ou seja, é você quem recebe. Se algo não bater, rejeite.",
        `Recebimento: ${x.got} aparece na sua carteira na X Layer (como OKB mesmo, não WOKB). Volte aqui e toque em “Verificar de novo”.`,
      ],
    };
  },
  dyorswap: (v) => {
    const x = v || {};
    return {
      title: "Tire a sua liquidez da DYORSwap",
      note: "Pool USDT_Bridged / WOKB · tokens LP na sua carteira",
      warn: "Em setembro de 2026, a DYORSwap listou por engano uma rede falsa, e usuários perderam fundos com uma ponte falsa (os contratos da própria DYORSwap não foram hackeados). Use só dyorswap.finance, escolha a rede X Layer e não toque em “Bridge”.",
      lead: "Esta é a liquidez que você colocou no pool USDT_Bridged / WOKB da DYORSwap (um fork da PancakeSwap). Sacar exige duas confirmações na sua carteira: primeiro uma assinatura que aprova só o LP que você está sacando, depois uma transação.",
      steps: [
        { text: "Abra este link na carteira que tem o seu endereço, conecte e escolha a rede X Layer.", copy: "https://dyorswap.finance/find/?chainId=196" },
        "Toque em “Select a Token”, escolha USDT (não USD₮0) e depois toque em “Manage this pool”. Este pool não está na lista padrão do site, então “Your Liquidity” sozinho mostra “No liquidity found”.",
        "De volta à lista, mude primeiro o slippage: toque na engrenagem, escolha 1.0% e toque em × para fechar. Se pular isso, o saque falha com “This transaction would fail”: este pool paga um pouco menos do que o site estima, mais do que os 0.5% padrão.",
        "Toque na linha USDT/OKB, toque em “Remove” e depois em “Max”. Mantenha o padrão de receber USDT e OKB; não mude para um só token.",
        "Toque em “Enable”. A sua carteira pede uma assinatura (Permit). Confira: o contrato é DYOR LPs (0x35c1…cD25), o spender é 0x1E69…6036 (o router da DYORSwap) e o valor é o LP que você está sacando.",
        `Toque em “Remove” e depois em “Confirm”. A sua carteira pede para você confirmar uma transação. Confira: ela vai para 0x1E69…6036 e envia 0 OKB. Você deve receber cerca de ${x.got}; o pop-up tem os números exatos.`,
        "Para terminar, abra o gerenciador de aprovações da sua carteira e revogue a aprovação de USDT que você deu a 0x1E69…6036 quando colocou liquidez.",
      ],
      after: "O USDT_Bridged que você recebe é o USDT antigo da X Layer, que a OKX está tirando de circulação aos poucos. Para trocar pelo novo USDT0, deposite na exchange da OKX e saque de novo.",
    };
  },
  foot: "Estes passos foram conferidos com o site oficial e os contratos. Esta é a versão em texto.",
};
