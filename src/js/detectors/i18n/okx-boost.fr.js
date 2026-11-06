// Vérification en direct OKX Boost : textes en français (vouvoiement). Même forme que TEXT.en dans ../okx-boost.text.js.
// Les nombres et les dates arrivent déjà formatés par okx-boost.js ; on ne les touche pas.
export default {
  row: {
    locked: (sym) => `${sym} bloqué`,
    end: "Déblocage",
    ready: "Débloqué, prêt à être retiré",
    wait: "Encore bloqué, rien ne sort avant cette date",
    about: (usd) => `environ $${usd}`,
    noPrice: "Prix en USD indisponible pour l'instant",
  },
  total: "Vous pouvez récupérer environ",
  line: {
    lock: (list) => `Contrat de blocage d'OKX Boost 0xDA63…FD2b (Plasma X Launch) : ${list}`,
    none: "Contrat de blocage d'OKX Boost 0xDA63…FD2b (Plasma X Launch) : rien de bloqué",
    done: (syms) => `Vous aviez des ${syms} bloqués ; il en reste 0 (retirés)`,
    end: (d, ready) => `Déblocage : ${d}${ready ? " (débloqué)" : " (encore bloqué)"}`,
    gas: (x) => `OKB dans le portefeuille sur X Layer (pour les frais) : ${x}`,
  },
  warn: {
    notYet: (d) => `Encore bloqué : retrait possible après le ${d}`,
    lowGas: (x) => `Il n'y a que ${x} OKB sur X Layer dans ce portefeuille, ce qui risque de ne pas couvrir les frais. Envoyez d'abord un peu d'OKB à cette adresse sur X Layer (0.001 suffit largement)`,
  },
  head: {
    "can-unstake": "Vos jetons sont encore bloqués dans OKX Boost",
    "not-yet": "Pas encore débloqué",
    "low-gas": "Ajoutez d'abord un peu d'OKB pour les frais",
    arrived: "C'est arrivé",
    withdrawn: "Déjà retiré",
    nothing: "Rien de bloqué ici",
  },
  say: {
    unstake: (x) => `Il reste ${x} dans le contrat de blocage d'OKX Boost, et le déblocage a eu lieu. Dans l'application OKX, ouvrez la page de la campagne, faites défiler jusqu'aux détails du staking et touchez le bouton de retrait du staking.`,
    notYet: (d) => `Vos jetons se débloquent le ${d}. Toucher « Unstake » avant cette date ne fait rien sortir.`,
    lowGas: (x) => `Il n'y a que ${x} OKB sur X Layer dans ce portefeuille. Le retrait du staking demande de petits frais (moins de $0.01) : envoyez d'abord un peu d'OKB à cette adresse sur X Layer (0.001 suffit largement), puis revenez.`,
    arrived: (list) => `Arrivé : ${list}. Tout ce que vous aviez dans OKX Boost est sorti.`,
    withdrawn: (syms) => `Votre solde de ${syms} dans le contrat de blocage est maintenant à 0 et l'enregistrement du blocage existe toujours : il a donc été retiré du staking (personne d'autre que vous ne peut le faire, et l'argent ne revient qu'à votre propre adresse). Le montant et l'heure exacts n'ont pas été trouvés cette fois : dans l'application OKX, ouvrez ${syms} dans votre portefeuille et cherchez dans son historique des transactions le retrait du staking venant d'OKX Boost.`,
    nothing: "Cette adresse n'a rien de bloqué dans le Plasma X Launch d'OKX Boost. Vérifiez que vous êtes sur le bon compte : un portefeuille OKX peut en contenir plusieurs.",
  },
  arr: {
    list: (items) => (items || []).map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `${x} ${sym} depuis le contrat de blocage d'OKX Boost 0xDA63…FD2b`,
  },
};
