// Vérification en direct DYORSwap : textes en français (vouvoiement). Même forme que TEXT.en dans ../dyorswap.text.js.
// Les nombres arrivent déjà formatés par dyorswap.js ; on ne les touche pas.
export default {
  row: {
    usdt: "USDT que vous pouvez retirer",
    okb: "OKB que vous pouvez retirer",
    about: (usd) => `environ $${usd}`,
    noPrice: "Prix en USD indisponible pour l'instant",
  },
  total: "Vous pouvez récupérer environ",
  line: {
    lp: (x) => `Dans le pool USDT/OKB de DYORSwap, vous pouvez retirer : ${x}`,
    none: "Pool USDT/OKB de DYORSwap : aucun LP à cette adresse",
    approval: "L'autorisation USDT que vous avez donnée au routeur de DYORSwap en ajoutant de la liquidité est toujours active",
    gas: (x) => `OKB dans le portefeuille sur X Layer (pour les frais) : ${x}`,
  },
  warn: {
    slip: (x) => `Ce pool rend actuellement ${x}% de moins que l'estimation du site : le slippage de 1% de ce guide risque de ne pas suffire, et le retrait échouerait. Votre argent est en sécurité : ne suivez pas le guide pour l'instant. Touchez « Un problème ? » en haut à droite et envoyez-nous le rapport`,
    lowGas: (x) => `Il n'y a que ${x} OKB sur X Layer dans ce portefeuille, ce qui risque de ne pas couvrir les frais. Envoyez d'abord un peu d'OKB à cette adresse sur X Layer (0.001 suffit largement)`,
  },
  head: {
    "in-pool": "Vous détenez encore des LP dans ce pool",
    partial: "Une partie est sortie",
    "need-slip": "Ne suivez pas le guide pour l'instant",
    "low-gas": "Ajoutez d'abord un peu d'OKB pour les frais",
    arrived: "C'est arrivé",
    "no-lp": "Aucun LP dans ce pool pour l'instant",
    "old-approval": "Une ancienne autorisation peut être annulée",
    nothing: "Aucun LP trouvé dans ce pool",
  },
  say: {
    inPool: (x) => `Vous détenez encore des LP dans ce pool, et vous pouvez retirer ${x} dès maintenant. La blockchain ne montre pas où vous en êtes : si vous n'avez pas terminé, continuez à suivre le guide ; si vous venez de confirmer, attendez une minute et ne touchez plus rien ; si la page a affiché une erreur au moment de « Confirm », voyez les cas courants ci-dessous.`,
    partial: (done, left) => `Un retrait est passé ces dernières minutes. Arrivé : ${done}. Vous détenez encore des LP et pouvez retirer ${left} dès maintenant. Pour tout sortir, refaites le guide ; ou laissez-les, ils vous appartiennent toujours.`,
    lowGas: (x) => `Il n'y a que ${x} OKB sur X Layer dans ce portefeuille. Le retrait demande de petits frais (moins de $0.01) : envoyez d'abord un peu d'OKB à cette adresse sur X Layer (0.001 suffit largement), puis revenez.`,
    arrived: (list) => `Arrivé : ${list}. Vos LP dans ce pool sont entièrement retirés.`,
    noLp: "Cette adresse n'a aucun LP dans ce pool pour l'instant, et elle a déjà fait un retrait avec une signature. Nous n'avons pas pu confirmer ce qui est arrivé (nous ne voyons que les retraits des dernières minutes) : dans l'application OKX, ouvrez OKB ou USDT dans votre portefeuille et regardez son historique des transactions.",
    approval: "L'autorisation USDT que vous avez donnée au routeur de DYORSwap 0x1E69…6036 en ajoutant de la liquidité est toujours active. Vous n'en avez plus besoin : annulez-la dans l'onglet des autorisations de l'accueil de votre portefeuille (cela coûte de petits frais). Votre argent est en sécurité dans les deux cas.",
    nothing: "Cette adresse n'a aucun LP dans le pool USDT/OKB de DYORSwap. Vérifiez que vous êtes sur le bon compte : un portefeuille OKX peut en contenir plusieurs. Ce guide n'a pas été vérifié pour d'autres pools.",
  },
  arr: {
    list: (items) => (items || []).map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `${x} ${sym} depuis le contrat routeur de DYORSwap 0x1E69…6036`,
  },
};
