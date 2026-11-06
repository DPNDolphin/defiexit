// Diagnóstico en vivo de OKX Boost, en español (de tú). Misma forma que TEXT.en en ../okx-boost.text.js:
// las cifras y fechas llegan ya calculadas y formateadas desde okx-boost.js. Sin imports.
export default {
  row: {
    locked: (sym) => `${sym} bloqueado`,
    end: "Se desbloquea",
    ready: "Desbloqueado, listo para retirar",
    wait: "Todavía bloqueado; antes de esa fecha no sale nada",
    about: (usd) => `unos $${usd}`,
    noPrice: "Precio en USD no disponible ahora",
  },
  total: "Puedes recuperar unos",
  line: {
    lock: (list) => `Contrato de bloqueo de OKX Boost 0xDA63…FD2b (Plasma X Launch): ${list}`,
    none: "Contrato de bloqueo de OKX Boost 0xDA63…FD2b (Plasma X Launch): nada bloqueado",
    done: (syms) => `Tenías ${syms} bloqueado; ahora 0 (retirado)`,
    end: (d, ready) => `Se desbloquea: ${d}${ready ? " (desbloqueado)" : " (todavía bloqueado)"}`,
    gas: (x) => `OKB en la billetera en X Layer (para comisiones): ${x}`,
  },
  warn: {
    notYet: (d) => `Todavía bloqueado: se puede retirar después de ${d}`,
    lowGas: (x) => `Solo hay ${x} OKB en X Layer en esta billetera, y puede que no alcance para la comisión. Primero envía un poco de OKB a esta dirección en X Layer (0.001 es más que suficiente)`,
  },
  head: {
    "can-unstake": "Tus tokens siguen bloqueados en OKX Boost",
    "not-yet": "Todavía no se desbloquea",
    "low-gas": "Primero agrega un poco de OKB para la comisión",
    arrived: "Ya llegó",
    withdrawn: "Ya retirado",
    nothing: "Aquí no hay nada bloqueado",
  },
  say: {
    unstake: (x) => `Todavía hay ${x} en el contrato de bloqueo de OKX Boost, y ya se desbloqueó. En la app de OKX, abre la página de la campaña, desplázate hasta los detalles del staking y toca el botón para retirar del staking.`,
    notYet: (d) => `Tus tokens se desbloquean el ${d}. Si tocas “Unstake” antes, no sale nada.`,
    lowGas: (x) => `Solo hay ${x} OKB en X Layer en esta billetera. Retirar del staking requiere una pequeña comisión (menos de $0.01), así que primero envía un poco de OKB a esta dirección en X Layer (0.001 es más que suficiente) y luego vuelve.`,
    arrived: (list) => `Llegó: ${list}. Ya sacaste de OKX Boost todo lo que tenías.`,
    withdrawn: (syms) => `Tu ${syms} en el contrato de bloqueo ahora está en 0 y el registro del bloqueo sigue ahí, así que se retiró del staking (solo tú puedes hacerlo, y el dinero solo vuelve a tu propia dirección). Esta vez no encontramos el monto exacto ni la hora: en la app de OKX, abre ${syms} en tu billetera y busca en su historial de transacciones el retiro del staking de OKX Boost.`,
    nothing: "Esta dirección no tiene nada bloqueado en Plasma X Launch de OKX Boost. Comprueba que estés en la cuenta correcta: una billetera de OKX puede tener varias.",
  },
  arr: {
    list: (items) => (items || []).map((x) => `${x.amount} ${x.sym}`).join(", "),
    item: (x, sym) => `${x} ${sym} del contrato de bloqueo de OKX Boost 0xDA63…FD2b`,
  },
};
