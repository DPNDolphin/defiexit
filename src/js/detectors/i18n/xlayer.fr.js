// Fenêtre « Sortir les fonds » pour X Layer : textes en français (vouvoiement). Même forme que HOW.en dans ../../lib/xlayer.text.js.
// v : { ready (débloqué ou non), date (déjà formatée), got (montant attendu, par exemple « 0.5 OKB ») }.
const s = (x) => (x == null ? "" : x);

export default {
  "okx-boost": (v) => {
    const x = v || {};
    return {
      title: "Sortir vos jetons bloqués d'OKX Boost",
      note: `Bloqués pour le Plasma X Launch · ${x.ready ? "débloqués depuis le" : "déblocage le"} ${s(x.date)}`,
      status: x.ready ? { ok: true, head: `Débloqués depuis le ${s(x.date)}, prêts à être retirés`, text: "Il n'y a pas de date limite : ils peuvent être retirés à tout moment après le déblocage." }
        : { ok: false, head: `Déblocage le ${s(x.date)}`, text: "Rien ne sort avant cette date." },
      lead: "Pour participer au Plasma X Launch d'OKX Boost, il fallait bloquer des jetons sur X Layer pendant 2 jours. Ils ne reviennent pas tout seuls : vous devez toucher « Unstake ». Le code source du contrat de blocage est vérifié sur l'explorateur d'OKX ; il n'a pas d'administrateur, et les fonds ne peuvent revenir qu'à votre propre adresse.",
      steps: [
        { text: "Dans l'application OKX : choisissez « Web3 » en haut, ouvrez l'onglet d'exploration en bas, collez le lien ci-dessous dans le champ de recherche et touchez le résultat signalé comme site web tiers. Quand une fenêtre propose la version de l'application, touchez le bouton en gras pour l'ouvrir dans l'application (la version web ne peut pas se connecter au portefeuille de l'application).", copy: "https://web3.okx.com/boost/x-launch/plasma" },
        "Faites défiler jusqu'aux détails du staking et touchez le bouton de retrait du staking.",
        "La confirmation du retrait du staking s'ouvre. Vérifiez : le réseau est X Layer, l'adresse d'interaction est 0xDA63…FD2b (OKX Boost), et le montant porte un signe plus, ce qui signifie que vous le recevez. Si quelque chose ne correspond pas, refusez.",
        `Arrivée : ${s(x.got)} apparaît dans votre portefeuille sur X Layer (en OKB proprement dit, pas en WOKB). Revenez ici et touchez « Vérifier à nouveau ».`,
      ],
    };
  },
  dyorswap: (v) => {
    const x = v || {};
    return {
      title: "Sortir votre liquidité de DYORSwap",
      note: "Pool USDT_Bridged / WOKB · jetons LP dans votre portefeuille",
      warn: "En septembre 2026, DYORSwap a référencé par erreur une fausse chaîne, et des utilisateurs ont perdu des fonds à cause d'un faux pont (les contrats de DYORSwap eux-mêmes n'ont pas été piratés). N'utilisez que dyorswap.finance, choisissez le réseau X Layer, et ne touchez pas « Bridge ».",
      lead: "Il s'agit de la liquidité que vous avez ajoutée au pool USDT_Bridged / WOKB de DYORSwap (un fork de PancakeSwap). Le retrait demande deux confirmations dans votre portefeuille : d'abord une signature qui autorise uniquement les LP que vous retirez, puis une transaction.",
      steps: [
        { text: "Ouvrez ce lien dans le portefeuille qui détient votre adresse, connectez-vous et choisissez le réseau X Layer.", copy: "https://dyorswap.finance/find/?chainId=196" },
        "Touchez « Select a Token », choisissez USDT (pas USD₮0), puis touchez « Manage this pool ». Ce pool n'est pas dans la liste par défaut du site : « Your Liquidity » seul affiche « No liquidity found ».",
        "De retour sur la liste, modifiez d'abord le slippage : touchez l'engrenage, choisissez 1.0%, puis touchez × pour fermer. Sinon, le retrait échoue avec « This transaction would fail » : ce pool rend un peu moins que l'estimation du site, plus que les 0.5% par défaut.",
        "Touchez la ligne USDT/OKB, touchez « Remove », puis « Max ». Gardez le réglage par défaut, qui reçoit à la fois l'USDT et l'OKB ; ne passez pas à un seul jeton.",
        "Touchez « Enable ». Votre portefeuille demande une signature (Permit). Vérifiez : le contrat est DYOR LPs (0x35c1…cD25), le spender est 0x1E69…6036 (le routeur de DYORSwap), et le montant correspond aux LP que vous retirez.",
        `Touchez « Remove », puis « Confirm ». Votre portefeuille vous demande de confirmer une transaction. Vérifiez : elle va vers 0x1E69…6036 et envoie 0 OKB. Vous devriez recevoir environ ${s(x.got)} ; la fenêtre affiche les chiffres exacts.`,
        "Pour finir, ouvrez le gestionnaire d'autorisations de votre portefeuille et révoquez l'autorisation USDT que vous avez donnée à 0x1E69…6036 en ajoutant de la liquidité.",
      ],
      after: "L'USDT_Bridged que vous récupérez est l'ancien USDT de X Layer, qu'OKX retire progressivement. Pour passer au nouvel USDT0, déposez-le sur la plateforme d'échange OKX et retirez-le de nouveau.",
    };
  },
  foot: "Ces étapes ont été vérifiées sur le site officiel et sur les contrats. Ceci est la version texte.",
};
