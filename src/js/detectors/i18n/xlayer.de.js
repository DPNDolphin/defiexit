// Fenster „Rausholen“ für X Layer: Texte auf Deutsch (du-Form). Gleiche Form wie HOW.en in ../../lib/xlayer.text.js.
// v: { ready (entsperrt oder nicht), date (schon formatiert), got (erwarteter Eingang, etwa „0.5 OKB“) }.
const s = (x) => (x == null ? "" : x);

export default {
  "okx-boost": (v) => {
    const x = v || {};
    return {
      title: "Deine gesperrten Token aus OKX Boost holen",
      note: `Gesperrt für den Plasma X Launch · ${x.ready ? "entsperrt seit" : "Entsperrung am"} ${s(x.date)}`,
      status: x.ready ? { ok: true, head: `Seit ${s(x.date)} entsperrt, bereit zum Abheben`, text: "Es gibt keine Frist: Nach dem Entsperren lässt es sich jederzeit abheben." }
        : { ok: false, head: `Entsperrung am ${s(x.date)}`, text: "Vorher kommt nichts heraus." },
      lead: "Für den Plasma X Launch von OKX Boost musstest du Token für 2 Tage auf X Layer sperren. Sie kommen nicht von allein zurück: Du musst auf „Unstake“ tippen. Der Quellcode des Sperr-Contracts ist im OKX-Explorer verifiziert, er hat keinen Admin, und das Geld kann nur an deine eigene Adresse zurückgehen.",
      steps: [
        { text: "In der OKX-App: Wähle oben „Web3“, öffne unten den Entdecken-Tab, füge den Link unten ins Suchfeld ein und tippe auf das Ergebnis, das als Drittanbieter-Website gekennzeichnet ist. Wenn ein Pop-up die App-Version anbietet, tippe auf den fett gedruckten Button, um sie in der App zu öffnen (die Web-Version kann sich nicht mit der Wallet in der App verbinden).", copy: "https://web3.okx.com/boost/x-launch/plasma" },
        "Scroll nach unten zu den Staking-Details und tippe auf den Unstake-Button.",
        "Die Unstake-Bestätigung öffnet sich. Prüf: Das Netzwerk ist X Layer, die Interaktionsadresse ist 0xDA63…FD2b (OKX Boost), und der Betrag hat ein Pluszeichen, du bekommst ihn also. Wenn etwas nicht passt, lehne ab.",
        `Eingang: ${s(x.got)} erscheint in deiner Wallet auf X Layer (als echtes OKB, nicht WOKB). Komm hierher zurück und tippe auf „Nochmal prüfen“.`,
      ],
    };
  },
  dyorswap: (v) => {
    const x = v || {};
    return {
      title: "Deine Liquidität aus DYORSwap holen",
      note: "Pool USDT_Bridged / WOKB · LP-Token in deiner Wallet",
      warn: "Im September 2026 hat DYORSwap versehentlich eine gefälschte Chain aufgenommen, und Nutzer haben über eine gefälschte Bridge Geld verloren (die eigenen Contracts von DYORSwap wurden nicht gehackt). Nutze nur dyorswap.finance, wähle das Netzwerk X Layer und tippe nicht auf „Bridge“.",
      lead: "Das ist Liquidität, die du dem Pool USDT_Bridged / WOKB auf DYORSwap (einem Fork von PancakeSwap) hinzugefügt hast. Das Abheben braucht zwei Bestätigungen in deiner Wallet: zuerst eine Signatur, die nur die LP freigibt, die du abhebst, dann eine Transaktion.",
      steps: [
        { text: "Öffne diesen Link in der Wallet, die deine Adresse hält, verbinde dich und wähle das Netzwerk X Layer.", copy: "https://dyorswap.finance/find/?chainId=196" },
        "Tippe auf „Select a Token“, wähle USDT (nicht USD₮0) und tippe dann auf „Manage this pool“. Dieser Pool steht nicht in der Standardliste der Website, deshalb zeigt „Your Liquidity“ allein „No liquidity found“.",
        "Zurück in der Liste änderst du zuerst die Slippage: Tippe auf das Zahnrad, wähle 1.0% und tippe auf ×, um zu schließen. Lässt du das aus, schlägt das Abheben mit „This transaction would fail“ fehl: Dieser Pool zahlt etwas weniger aus, als die Website schätzt, mehr als die Standard-Slippage von 0.5%.",
        "Tippe auf die Zeile USDT/OKB, dann auf „Remove“ und dann auf „Max“. Behalte die Standardeinstellung, USDT und OKB beide zu bekommen; stell nicht auf nur einen Token um.",
        "Tippe auf „Enable“. Deine Wallet fragt nach einer Signatur (Permit). Prüf: Der Contract ist DYOR LPs (0x35c1…cD25), der Spender ist 0x1E69…6036 (der Router von DYORSwap), und der Betrag ist die LP-Menge, die du abhebst.",
        `Tippe auf „Remove“, dann auf „Confirm“. Deine Wallet bittet dich, eine Transaktion zu bestätigen. Prüf: Sie geht an 0x1E69…6036 und sendet 0 OKB. Du solltest etwa ${s(x.got)} bekommen; das Pop-up zeigt die genauen Zahlen.`,
        "Öffne zum Schluss die Freigabeverwaltung deiner Wallet und widerrufe die USDT-Freigabe, die du 0x1E69…6036 beim Hinzufügen der Liquidität gegeben hast.",
      ],
      after: "Das USDT_Bridged, das du zurückbekommst, ist das alte USDT von X Layer, das OKX nach und nach auslaufen lässt. Um auf das neue USDT0 umzusteigen, zahl es bei der OKX-Börse ein und heb es wieder ab.",
    };
  },
  foot: "Diese Schritte wurden anhand der offiziellen Website und der Contracts geprüft. Das ist die Textversion.",
};
