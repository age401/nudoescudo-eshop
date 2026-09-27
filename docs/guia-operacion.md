# Guía de operación diaria — NudoEscudo eShop

Esta guía es para quien atiende la tienda. No hace falta saber de computación:
todo se hace desde el **panel de administración** en el navegador.

## Entrar al panel

1. Abrí `https://TU-DOMINIO/admin` en el navegador.
2. Ingresá la contraseña de administración.
3. La sesión queda guardada 30 días en ese navegador.

## Cuando llega un pedido

1. Te llega un **email** con el detalle (cartas, cantidades, total y datos del
   cliente). El pedido también aparece en el panel con la etiqueta **NUEVO**.
2. Importante: el cliente ya confirmó por email, así que **las cartas ya están
   reservadas** — nadie más puede comprarlas mientras el pedido esté activo.
3. Contactá al cliente (email o teléfono si lo dejó) para coordinar entrega y
   pago. No hay pago online: se paga al retirar o como acuerden.
4. Cuando entregás el pedido: abrí el pedido en el panel y tocá
   **“Marcar entregado”**. Esto descuenta las cartas del stock definitivamente.
5. Si el pedido se cae (el cliente no aparece, se arrepiente, etc.): tocá
   **“Cancelar pedido”**. Las cartas vuelven a estar disponibles en la tienda.

> Si el cliente nunca confirma por email, no hay que hacer nada: el pedido
> expira solo (por defecto a las 24 horas) y la reserva se libera.

## El stock vive en la web

El stock se maneja **en el panel**. Delver Lens se usa solo para dos cosas:
**agregar cartas nuevas** y **registrar ventas en el mostrador**. Todo cambio
de cantidad (importaciones, ajustes, pedidos web entregados, ventas en tienda)
queda registrado en **Stock → Movimientos**.

## Venta en el mostrador

Cuando alguien trae cartas de las cajas:

1. En Delver Lens, escaneá las cartas en una **lista nueva** y exportala como
   **CSV** (con el campo **Scryfall ID**).
2. En el panel: **Venta en tienda** → elegí el archivo → **“Revisar venta”**.
3. Arriba aparecen en rojo las cartas que **necesitan revisión**:
   - *No tenemos esa edición*: Delver a veces lee mal la edición. Si la carta
     que tenés en la mano es una de las sugeridas (con foto), tocá **“Es
     esta”**.
   - *Reservada para un pedido web*: esa copia está prometida a un cliente
     online. Tocá el código del pedido para verlo.
   - Si la carta no está en el stock: **“No se vende”**.
   Hasta que no resuelvas todas, no se puede confirmar.
4. Abajo está la lista de la venta: podés cambiar cantidades y **precios**
   (por ejemplo, redondear). Las cartas sin precio de referencia hay que
   ponerles precio. Con “Agregar una carta del stock” sumás algo que no
   escaneaste.
5. Opcional: nombre del cliente y una nota. Tocá **“Confirmar venta”**. Las
   cartas se descuentan del stock en ese momento.

**Me equivoqué en una venta**: abrí la venta (Pedidos → Ventas en tienda) →
**“Anular venta…”**. Las cartas vuelven al stock. Sirve también para pedidos
web ya entregados que el cliente devuelve.

## Agregar cartas nuevas (Magic, con Delver Lens)

1. En Delver Lens, escaneá las cartas nuevas en una **lista aparte** y
   exportala como **CSV** con el campo **Scryfall ID**.
2. En el panel: **Stock → Importar de Delver → Agregar cartas nuevas**.
3. Elegí el archivo y tocá **“Subir y revisar”**. Vas a ver cada carta con
   cuántas hay ahora y cuántas va a haber. Las filas no reconocidas aparecen
   aparte (suelen ser tokens o cartas muy nuevas).
4. Tocá **“Confirmar y sumar”**.

¿Te equivocaste de archivo? En el historial de importaciones, abrí la última y
tocá **“Deshacer esta importación”**.

### Reemplazar todo el stock (casi nunca)

Solo para un inventario completo desde cero. Está al final de **Importar de
Delver**, en la **zona peligrosa**: pone el stock de Magic exactamente igual al
archivo y **se pierde todo lo que se cargó, vendió o ajustó en la web** y no
esté en tu colección de Delver. Antes de aplicarlo te muestra cuántas copias
desaparecen, te ofrece descargar el stock actual, y tenés que escribir
`REEMPLAZAR TODO EL STOCK` para confirmar. Se puede deshacer mientras sea la
última importación.

## Mantener el stock (Stock → Inventario)

- **Filtros**: nombre, juego, edición, acabado, estado, idioma y
  disponibilidad (con stock / agotadas / con reservas). **Descargar CSV** baja
  exactamente lo filtrado.
- **Cambiar una cantidad**: usá **−/+** o escribí el número, opcionalmente el
  motivo (“conteo”, “dañada”…), y **Guardar** (o Enter). Si mientras editabas
  alguien compró esa carta, el panel te avisa en vez de pisar la venta.
- La columna **Reserv.** son copias prometidas a pedidos web: la cantidad no
  puede bajar de ahí.
- **Historial** muestra todos los movimientos de esa fila.
- Una fila en 0 que nunca se vendió se puede eliminar con la **✕**.

## Cargar stock de Pokémon (o sueltas de Magic a mano)

Delver Lens solo escanea Magic, así que el stock de Pokémon se carga a mano:

1. En el panel: **Stock → Agregar stock manualmente** (arriba de la tabla).
2. Buscá la carta por nombre, elegí la edición correcta.
3. Elegí el **acabado** (Normal / Reverse Holo / Foil — fijate qué es
   físicamente la carta), el estado, el idioma y la cantidad.
4. Tocá **“Agregar”**.

## Respaldos

En **Respaldos** ves las copias nocturnas de la base (y podés bajarlas) y si
se están copiando fuera del servidor. Si algo falla, el panel lo avisa en
**Inicio**. Detalles en `runbook-mantenimiento.md`.

## Precios

- El precio de venta es **automático**: precio de referencia (Card Kingdom para
  Magic, TCGplayer para Pokémon) **× el multiplicador** que configures.
- El multiplicador se cambia en **Configuración** (ej.: `1` = igual que la
  referencia, `0.9` = 10% más barato, `1.1` = 10% más caro).
- Los precios se actualizan **solos todas las mañanas**.
- El precio en pesos es informativo, con el dólar del día.

### Una carta dice “Consultar precio”

Significa que la referencia no tiene precio para esa carta/acabado. Mientras
diga eso, **no se puede comprar online**. Solución: en **Stock** (filtrá por
nombre), poné un **precio manual** (en US$) en esa fila y guardá. El precio manual siempre le
gana al automático.

### Quiero un precio distinto para una carta puntual

Mismo camino: **Stock → precio manual** en la fila correspondiente. Para volver
al precio automático, borrá el número y guardá.

## Qué ve el cliente

1. Entra a la tienda y busca una carta (el buscador sugiere mientras escribe;
   las cartas sin stock aparecen en gris).
2. En la página de la carta elige edición, acabado y cantidad, y la agrega al
   pedido.
3. En “Tu pedido” pone su email y envía.
4. Le llega un email con un botón para **confirmar el pedido**. Al confirmar,
   el stock queda reservado y a vos te llega la notificación.
