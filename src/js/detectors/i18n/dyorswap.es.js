// Diagnóstico en vivo de DYORSwap, en español (de tú). Misma forma que TEXT.en en ../dyorswap.text.js:
// las cifras llegan ya calculadas y formateadas desde dyorswap.js. Sin imports.
export default {
  row: {
    usdt: "USDT que puedes retirar",
    okb: "OKB que puedes retirar",
    about: (usd) => `unos $${usd}`,
    noPrice: "Precio en USD no disponible ahora",
  },
  total: "Puedes recuperar unos",
  line: {
    lp: (x) => `En el pool USDT/OKB de DYORSwap, puedes retirar: ${x}`,
    none: "Pool USDT/OKB de DYORSwap: no hay LP en esta dirección",
    approval: "La aprobación de USDT que diste al router de DYORSwap al agregar liquidez sigue activa",
    gas: (x) => `OKB en la billetera en X Layer (para comisiones): ${x}`,
  },
  warn: {
    slip: (x) => `Ahora mismo este pool paga un ${x}% menos de lo que estima el sitio, así que el deslizamiento (slippage) de 1% de esta guía puede no ser suficiente y el retiro fallaría. Tu dinero está a salvo: por ahora no sigas la guía. Toca “¿Te atascaste?” arriba a la derecha y envíanos el informe`,
    lowGas: (x) => `Solo hay ${x} OKB en X Layer en esta billetera, y puede que no alcance para la comisión. Primero envía un poco de OKB a esta dirección en X Layer (0.001 es más que suficiente)`,
  },
  head: {
    "in-pool": "Todavía tienes LP en este pool",
    partial: "Una parte ya salió",
    "need-slip": "Por ahora no sigas la guía",
    "low-gas": "Primero agrega un poco de OKB para la comisión",
    arrived: "Ya llegó",
    "no-lp": "Ahora no hay LP en este pool",
    "old-approval": "Hay una aprobación antigua que puedes cancelar",
    nothing: "No se encontró LP en este pool",
  },
  say: {
    inPool: (x) => `Todavía tienes LP en este pool, y ahora mismo puedes retirar ${x}. La blockchain no muestra hasta dónde llegaste: si no terminaste, sigue la guía; si acabas de confirmar, espera un minuto y no vuelvas a tocar; si la página mostró un error al tocar “Confirm”, mira las situaciones comunes de abajo.`,
    partial: (done, left) => `En los últimos minutos salió un retiro: llegaron ${done}. Todavía tienes LP y ahora mismo puedes retirar ${left}. Para sacarlo todo, vuelve a seguir la guía; o déjalo, sigue siendo tuyo.`,
    lowGas: (x) => `Solo hay ${x} OKB en X Layer en esta billetera. Retirar requiere una pequeña comisión (menos de $0.01), así que primero envía un poco de OKB a esta dirección en X Layer (0.001 es más que suficiente) y luego vuelve.`,
    arrived: (list) => `Llegó: ${list}. Ya retiraste todo tu LP de este pool.`,
    noLp: "Esta dirección no tiene LP en este pool ahora mismo, y ya retiró antes con una firma. No pudimos confirmar qué llegó (solo vemos los retiros de los últimos minutos): en la app de OKX, abre OKB o USDT en tu billetera y mira su historial de transacciones.",
    approval: "La aprobación de USDT que diste al router de DYORSwap 0x1E69…6036 al agregar liquidez sigue activa. Ya no la necesitas: cancélala en la pestaña de aprobaciones del inicio de tu billetera (cuesta una pequeña comisión). Tu dinero está a salvo de cualquier forma.",
    nothing: "Esta dirección no tiene LP en el pool USDT/OKB de DYORSwap. Comprueba que estés en la cuenta correcta: una billetera de OKX puede tener varias. Esta guía no se ha revisado para otros pools.",
  },
  arr: {
    list: (items) => (items || []).map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `${x} ${sym} del contrato router de DYORSwap 0x1E69…6036`,
  },
};
