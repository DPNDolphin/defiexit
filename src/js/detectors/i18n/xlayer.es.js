// Cómo sacar dos tipos de posiciones de X Layer (versión en texto), en español (de tú).
// Misma forma que HOW.en en ../../lib/xlayer.text.js. Parámetro v: { ready, date, got }. Sin imports.
export default {
  "okx-boost": (v) => {
    const x = v || {};
    return {
      title: "Saca de OKX Boost tus tokens bloqueados",
      note: `Bloqueados para Plasma X Launch · ${x.ready ? `desbloqueados desde el ${x.date}` : `se desbloquean el ${x.date}`}`,
      status: x.ready ? { ok: true, head: `Desbloqueados desde el ${x.date}, listos para retirar`, text: "No hay fecha límite: se pueden retirar en cualquier momento después del desbloqueo." }
        : { ok: false, head: `Se desbloquean el ${x.date}`, text: "Antes de esa fecha no sale nada." },
      lead: "Para participar en Plasma X Launch de OKX Boost había que bloquear tokens en X Layer durante 2 días. No vuelven solos: tienes que tocar “Unstake”. El código fuente del contrato de bloqueo está verificado en el explorador de OKX, no tiene administrador, y los fondos solo pueden volver a tu propia dirección.",
      steps: [
        { text: "En la app de OKX: elige “Web3” arriba, abre la pestaña de explorar abajo, pega el enlace de abajo en el buscador y toca el resultado de sitio web de terceros. Cuando una ventana te ofrezca la versión de la app, toca el botón en negrita para abrirla en la app (la versión web no puede conectarse a la billetera dentro de la app).", copy: "https://web3.okx.com/boost/x-launch/plasma" },
        "Desplázate hasta los detalles del staking y toca el botón para retirar del staking.",
        "Se abre la confirmación para retirar del staking. Comprueba: la red es X Layer, la dirección de interacción es 0xDA63…FD2b (OKX Boost) y el monto tiene signo más, es decir, lo recibes tú. Si algo no coincide, recházala.",
        `Llegada: ${x.got} aparece en tu billetera en X Layer (como OKB propiamente dicho, no WOKB). Vuelve aquí y toca “Revisar de nuevo”.`,
      ],
    };
  },
  dyorswap: (v) => {
    const x = v || {};
    return {
      title: "Saca tu liquidez de DYORSwap",
      note: "Pool USDT_Bridged / WOKB · tokens LP en tu billetera",
      warn: "En septiembre de 2026 DYORSwap listó por error una cadena falsa y hubo usuarios que perdieron fondos con un puente falso (los contratos propios de DYORSwap no fueron hackeados). Usa solo dyorswap.finance, elige la red X Layer y no toques “Bridge”.",
      lead: "Es la liquidez que agregaste al pool USDT_Bridged / WOKB de DYORSwap (un fork de PancakeSwap). Retirarla requiere dos confirmaciones en tu billetera: primero una firma que aprueba solo el LP que retiras y luego una transacción.",
      steps: [
        { text: "Abre este enlace en la billetera que tiene tu dirección, conéctate y elige la red X Layer.", copy: "https://dyorswap.finance/find/?chainId=196" },
        "Toca “Select a Token”, elige USDT (no USD₮0) y luego toca “Manage this pool”. Este pool no está en la lista predeterminada del sitio, así que “Your Liquidity” por sí solo muestra “No liquidity found”.",
        "De vuelta en la lista, primero cambia el deslizamiento (slippage): toca el engranaje, elige 1.0% y toca × para cerrar. Si te saltas esto, el retiro falla con “This transaction would fail”: este pool paga un poco menos de lo que estima el sitio, más que el 0.5% predeterminado.",
        "Toca la fila USDT/OKB, toca “Remove” y luego “Max”. Deja la opción predeterminada de recibir USDT y OKB; no la cambies a un solo token.",
        "Toca “Enable”. Tu billetera te pide una firma (Permit). Comprueba: el contrato es DYOR LPs (0x35c1…cD25), el spender es 0x1E69…6036 (el router de DYORSwap) y el monto es el LP que retiras.",
        `Toca “Remove” y luego “Confirm”. Tu billetera te pide confirmar una transacción. Comprueba: va a 0x1E69…6036 y envía 0 OKB. Deberías recibir unos ${x.got}; la ventana emergente tiene las cifras exactas.`,
        "Para terminar, abre el gestor de aprobaciones de tu billetera y revoca la aprobación de USDT que diste a 0x1E69…6036 cuando agregaste liquidez.",
      ],
      after: "El USDT_Bridged que recibes es el USDT antiguo de X Layer, que OKX está retirando poco a poco. Para cambiarlo al nuevo USDT0, deposítalo en el exchange de OKX y vuelve a retirarlo.",
    };
  },
  foot: "Estos pasos se revisaron con el sitio oficial y los contratos. Esta es la versión en texto.",
};
