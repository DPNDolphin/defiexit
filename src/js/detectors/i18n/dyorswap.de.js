// Live-Prüfung DYORSwap: Texte auf Deutsch (du-Form). Gleiche Form wie TEXT.en in ../dyorswap.text.js.
// Zahlen kommen schon formatiert aus dyorswap.js und bleiben unverändert.
export default {
  row: {
    usdt: "USDT, das du abheben kannst",
    okb: "OKB, das du abheben kannst",
    about: (usd) => `etwa $${usd}`,
    noPrice: "USD-Preis gerade nicht verfügbar",
  },
  total: "Zurückbekommen kannst du etwa",
  line: {
    lp: (x) => `Im USDT/OKB-Pool von DYORSwap kannst du abheben: ${x}`,
    none: "USDT/OKB-Pool von DYORSwap: keine LP an dieser Adresse",
    approval: "Die USDT-Freigabe, die du dem Router von DYORSwap beim Hinzufügen der Liquidität gegeben hast, ist noch aktiv",
    gas: (x) => `OKB in der Wallet auf X Layer (für Gebühren): ${x}`,
  },
  warn: {
    slip: (x) => `Dieser Pool zahlt derzeit ${x}% weniger aus, als die Website schätzt, die 1% Slippage aus dieser Anleitung reichen also womöglich nicht, und die Auszahlung würde fehlschlagen. Dein Geld ist sicher: Folge der Anleitung vorerst nicht. Tippe oben rechts auf „Hängst du fest?“ und schick uns den Bericht`,
    lowGas: (x) => `In dieser Wallet sind nur ${x} OKB auf X Layer, das reicht womöglich nicht für die Gebühr. Schick zuerst etwas OKB auf X Layer an diese Adresse (0.001 reicht locker)`,
  },
  head: {
    "in-pool": "Du hältst noch LP in diesem Pool",
    partial: "Ein Teil ist draußen",
    "need-slip": "Folge der Anleitung vorerst nicht",
    "low-gas": "Füg zuerst etwas OKB für die Gebühr hinzu",
    arrived: "Angekommen",
    "no-lp": "Gerade keine LP in diesem Pool",
    "old-approval": "Es gibt eine alte Freigabe, die du widerrufen kannst",
    nothing: "Keine LP in diesem Pool gefunden",
  },
  say: {
    inPool: (x) => `Du hältst noch LP in diesem Pool und kannst jetzt ${x} abheben. Die Chain zeigt nicht, wie weit du gekommen bist: Wenn du noch nicht fertig bist, folge weiter der Anleitung; wenn du gerade bestätigt hast, warte eine Minute und tippe nicht noch einmal; wenn die Seite bei „Confirm“ einen Fehler gezeigt hat, sieh dir die häufigen Fälle unten an.`,
    partial: (done, left) => `In den letzten Minuten ging eine Auszahlung durch. Angekommen: ${done}. Du hältst noch LP und kannst jetzt ${left} abheben. Um alles abzuheben, geh die Anleitung noch einmal durch; oder lass es liegen, es gehört weiterhin dir.`,
    lowGas: (x) => `In dieser Wallet sind nur ${x} OKB auf X Layer. Das Abheben kostet eine kleine Gebühr (unter $0.01), schick also zuerst etwas OKB auf X Layer an diese Adresse (0.001 reicht locker) und komm dann zurück.`,
    arrived: (list) => `Angekommen: ${list}. Deine LP in diesem Pool sind vollständig abgehoben.`,
    noLp: "Diese Adresse hat gerade keine LP in diesem Pool und hat schon einmal mit einer Signatur abgehoben. Was angekommen ist, konnten wir nicht bestätigen (wir sehen nur Auszahlungen der letzten Minuten): Öffne in der OKX-App OKB oder USDT in deiner Wallet und sieh im Transaktionsverlauf nach.",
    approval: "Die USDT-Freigabe, die du dem Router von DYORSwap 0x1E69…6036 beim Hinzufügen der Liquidität gegeben hast, ist noch aktiv. Du brauchst sie nicht mehr: Widerrufe sie im Freigaben-Tab auf der Startseite deiner Wallet (das kostet eine kleine Gebühr). Dein Geld ist so oder so sicher.",
    nothing: "Diese Adresse hat keine LP im USDT/OKB-Pool von DYORSwap. Prüf, ob du im richtigen Konto bist: Eine OKX-Wallet kann mehrere enthalten. Für andere Pools wurde diese Anleitung nicht geprüft.",
  },
  arr: {
    list: (items) => (items || []).map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `${x} ${sym} vom Router-Contract von DYORSwap 0x1E69…6036`,
  },
};
