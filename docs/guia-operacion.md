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

## Cargar stock desde Delver Lens (Magic)

1. En el teléfono, en Delver Lens: exportar la colección como **CSV** e incluir
   el campo **Scryfall ID** (en la configuración de exportación). Con ese campo
   el sistema reconoce cada carta sin errores.
2. En el panel: **Stock → Importar desde Delver Lens**.
3. Elegí el archivo y el modo:
   - **Sumar al stock actual**: agrega lo del archivo a lo que ya hay
     (para cargar cartas nuevas que escaneaste).
   - **Reemplazar todo el stock**: borra las cantidades actuales y deja solo lo
     del archivo (para cuando hacés un inventario completo).
4. Tocá **“Vista previa”** primero: te dice cuántas filas se reconocen.
5. Tocá **“Importar”**.

## Cargar stock de Pokémon (o ajustes sueltos de Magic)

Delver Lens solo escanea Magic, así que el stock de Pokémon se carga a mano:

1. En el panel: **Stock → Agregar stock manualmente**.
2. Buscá la carta por nombre, elegí la edición correcta.
3. Elegí el **acabado** (Normal / Reverse Holo / Foil — fijate qué es
   físicamente la carta), el estado, el idioma y la cantidad.
4. Tocá **“Agregar”**.

## Precios

- El precio de venta es **automático**: precio de referencia (Card Kingdom para
  Magic, TCGplayer para Pokémon) **× el multiplicador** que configures.
- El multiplicador se cambia en **Configuración** (ej.: `1` = igual que la
  referencia, `0.9` = 10% más barato, `1.1` = 10% más caro).
- Los precios se actualizan **solos todas las mañanas**.
- El precio en pesos es informativo, con el dólar del día.

### Una carta dice “Consultar precio”

Significa que la referencia no tiene precio para esa carta/acabado. Mientras
diga eso, **no se puede comprar online**. Solución: en **Stock**, poné un
**precio manual** (en US$) en esa fila y guardá. El precio manual siempre le
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
