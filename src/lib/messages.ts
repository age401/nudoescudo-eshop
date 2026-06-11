/**
 * All user-facing text, centralized. The product ships in Spanish (es-UY);
 * keeping strings here makes wording easy to adjust in one place.
 */
export const M = {
  storeName: process.env.STORE_NAME ?? "NudoEscudo",
  tagline: "Cartas sueltas de Magic y Pokémon en Uruguay",

  search: {
    placeholder: "Buscá tu carta…",
    inStock: (n: number) => `${n} en stock`,
    outOfStock: "Sin stock",
    noResults: "No encontramos cartas con ese nombre",
    searching: "Buscando…",
  },

  card: {
    edition: "Edición",
    finish: "Acabado",
    nonfoil: "Normal",
    foil: "Foil",
    etched: "Foil grabado",
    condition: "Estado",
    language: "Idioma",
    quantity: "Cantidad",
    available: (n: number) => `${n} disponibles`,
    outOfStock: "Sin stock por el momento",
    addToCart: "Agregar al pedido",
    added: "¡Agregado!",
    priceReference: "Precio de referencia: Card Kingdom",
    noPrice: "Consultar precio",
    game: { mtg: "Magic: The Gathering", pokemon: "Pokémon" } as Record<string, string>,
    conditions: {
      NM: "Como nueva (NM)",
      LP: "Poco jugada (LP)",
      MP: "Jugada (MP)",
      HP: "Muy jugada (HP)",
      DMG: "Dañada (DMG)",
    } as Record<string, string>,
    languages: {
      en: "Inglés",
      es: "Español",
      pt: "Portugués",
      ja: "Japonés",
      de: "Alemán",
      fr: "Francés",
      it: "Italiano",
      ko: "Coreano",
      ru: "Ruso",
      zhs: "Chino simplificado",
      zht: "Chino tradicional",
    } as Record<string, string>,
  },

  cart: {
    title: "Tu pedido",
    empty: "Tu pedido está vacío. ¡Buscá alguna carta!",
    item: "Carta",
    unitPrice: "Precio",
    quantity: "Cantidad",
    subtotal: "Subtotal",
    total: "Total",
    remove: "Quitar",
    checkout: "Enviar pedido",
    continueShopping: "Seguir buscando",
    approxUyu: "aprox.",
    stockChanged:
      "La disponibilidad de algunas cartas cambió. Revisá las cantidades marcadas.",
  },

  checkout: {
    title: "Confirmá tus datos",
    email: "Tu email",
    emailHelp: "Te enviaremos un enlace para confirmar el pedido.",
    name: "Nombre (opcional)",
    phone: "Teléfono (opcional)",
    submit: "Enviar pedido",
    submitting: "Enviando…",
    legal:
      "Sin pago online: el pedido se coordina y abona al retirar o por el medio que acuerdes con la tienda.",
  },

  orderStatus: {
    pendingTitle: "¡Revisá tu correo!",
    pendingBody: (email: string) =>
      `Te enviamos un enlace de confirmación a ${email}. El pedido queda reservado por un tiempo limitado hasta que lo confirmes.`,
    confirmedTitle: "¡Pedido confirmado!",
    confirmedBody:
      "Reservamos tus cartas. La tienda se va a contactar con vos para coordinar la entrega y el pago.",
    alreadyConfirmed: "Este pedido ya estaba confirmado.",
    invalidToken: "El enlace no es válido o el pedido expiró.",
    expiredNote: "Si el pedido expiró, podés armarlo de nuevo.",
    orderCode: "Código de pedido",
    statusNames: {
      pending_confirmation: "Pendiente de confirmación",
      confirmed: "Confirmado",
      completed: "Entregado",
      cancelled: "Cancelado",
      expired: "Expirado",
    } as Record<string, string>,
  },

  email: {
    confirmSubject: (code: string) => `Confirmá tu pedido ${code}`,
    adminNewOrderSubject: (code: string) => `Nuevo pedido ${code}`,
  },

  errors: {
    insufficientStock: (name: string) => `No hay stock suficiente de "${name}".`,
    invalidEmail: "Ingresá un email válido.",
    emptyCart: "El pedido está vacío.",
    generic: "Algo salió mal. Probá de nuevo en unos minutos.",
  },

  footer: {
    pricesNote:
      "Precios de referencia de Card Kingdom. El total en pesos es aproximado (tipo de cambio del día).",
  },
} as const;
