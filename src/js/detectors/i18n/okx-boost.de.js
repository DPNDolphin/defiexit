// Live-Prüfung OKX Boost: Texte auf Deutsch (du-Form). Gleiche Form wie TEXT.en in ../okx-boost.text.js.
// Zahlen und Daten kommen schon formatiert aus okx-boost.js und bleiben unverändert.
export default {
  row: {
    locked: (sym) => `Gesperrtes ${sym}`,
    end: "Entsperrung",
    ready: "Entsperrt, bereit zum Abheben",
    wait: "Noch gesperrt, vorher kommt nichts heraus",
    about: (usd) => `etwa $${usd}`,
    noPrice: "USD-Preis gerade nicht verfügbar",
  },
  total: "Zurückbekommen kannst du etwa",
  line: {
    lock: (list) => `Sperr-Contract von OKX Boost 0xDA63…FD2b (Plasma X Launch): ${list}`,
    none: "Sperr-Contract von OKX Boost 0xDA63…FD2b (Plasma X Launch): nichts gesperrt",
    done: (syms) => `${syms} war gesperrt, jetzt 0 (abgehoben)`,
    end: (d, ready) => `Entsperrung: ${d}${ready ? " (entsperrt)" : " (noch gesperrt)"}`,
    gas: (x) => `OKB in der Wallet auf X Layer (für Gebühren): ${x}`,
  },
  warn: {
    notYet: (d) => `Noch gesperrt: Abheben ist nach dem ${d} möglich`,
    lowGas: (x) => `In dieser Wallet sind nur ${x} OKB auf X Layer, das reicht womöglich nicht für die Gebühr. Schick zuerst etwas OKB auf X Layer an diese Adresse (0.001 reicht locker)`,
  },
  head: {
    "can-unstake": "Deine Token sind noch in OKX Boost gesperrt",
    "not-yet": "Noch nicht entsperrt",
    "low-gas": "Füg zuerst etwas OKB für die Gebühr hinzu",
    arrived: "Angekommen",
    withdrawn: "Schon abgehoben",
    nothing: "Hier ist nichts gesperrt",
  },
  say: {
    unstake: (x) => `${x} liegt noch im Sperr-Contract von OKX Boost und ist entsperrt. Öffne in der OKX-App die Kampagnenseite, scroll nach unten zu den Staking-Details und tippe auf den Unstake-Button.`,
    notYet: (d) => `Deine Token werden am ${d} entsperrt. Wenn du vorher auf „Unstake“ tippst, kommt nichts heraus.`,
    lowGas: (x) => `In dieser Wallet sind nur ${x} OKB auf X Layer. Unstaking kostet eine kleine Gebühr (unter $0.01), schick also zuerst etwas OKB auf X Layer an diese Adresse (0.001 reicht locker) und komm dann zurück.`,
    arrived: (list) => `Angekommen: ${list}. Alles, was du in OKX Boost hattest, ist draußen.`,
    withdrawn: (syms) => `Dein ${syms} im Sperr-Contract steht jetzt auf 0, und der Sperr-Eintrag ist noch da, es wurde also aus dem Staking genommen (das kannst nur du, und das Geld geht nur an deine eigene Adresse zurück). Genauen Betrag und Zeitpunkt haben wir diesmal nicht gefunden: Öffne in der OKX-App ${syms} in deiner Wallet und such im Transaktionsverlauf nach dem Unstaking von OKX Boost.`,
    nothing: "Diese Adresse hat im Plasma X Launch von OKX Boost nichts gesperrt. Prüf, ob du im richtigen Konto bist: Eine OKX-Wallet kann mehrere enthalten.",
  },
  arr: {
    list: (items) => (items || []).map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `${x} ${sym} vom Sperr-Contract von OKX Boost 0xDA63…FD2b`,
  },
};
