# Runbook de mantenimiento — NudoEscudo eShop

Para problemas y tareas poco frecuentes. Las tareas diarias están en
`guia-operacion.md`. Casi todo el mantenimiento es **automático**:

| Tarea                          | Frecuencia      | Automática |
| ------------------------------ | --------------- | ---------- |
| Precios Card Kingdom (Magic)   | todos los días  | ✅         |
| Precios TCGplayer (Pokémon)    | todos los días  | ✅         |
| Tipo de cambio dólar → peso    | todos los días  | ✅         |
| Catálogo de cartas (sets nuevos) | semanal       | ✅         |
| Expirar pedidos sin confirmar  | cada 15 min     | ✅         |
| Copia de seguridad de la base  | todas las noches | ✅        |
| Copia fuera del servidor       | todas las noches | ✅ (una vez configurada) |
| Probar que las copias sirven   | una vez por mes | ❌ manual |

## Ver que todo esté funcionando

En el panel, en **Inicio**, está la tabla **Sincronizaciones**: cada trabajo
con su última ejecución y estado (**OK** / **Error** / **En curso**). Si algo
dice **Error** hace más de un día, se puede tocar **“Ejecutar ahora”** para
reintentar. Si sigue fallando, pasar a la sección de problemas.

## Conectarse al servidor (para todo lo de abajo)

Necesitás: la IP del servidor y el usuario (están en la hoja de datos de la
entrega). Desde una terminal (en Windows: PowerShell):

```
ssh USUARIO@IP-DEL-SERVIDOR
cd /opt/nudoescudo
```

## Comandos útiles en el servidor

```bash
docker compose ps                     # estado de los servicios
docker compose logs -f app           # logs de la web (Ctrl+C para salir)
docker compose logs -f worker        # logs de los trabajos automáticos
docker compose restart app worker    # reiniciar la aplicación
docker compose up -d --build         # aplicar una actualización del código
```

## Reiniciar todo (servidor colgado, después de un corte, etc.)

```bash
cd /opt/nudoescudo
docker compose down
docker compose up -d
```

La aplicación corre las migraciones sola al arrancar. Esperá un minuto y probá
la página.

## Copias de seguridad

Hay tres niveles, del más cómodo al más completo:

1. **Stock en CSV** — Panel → **Respaldos** → “Stock completo (CSV)”. Se abre
   en Excel y se puede volver a importar desde Stock → Importar de Delver. Solo
   tiene el stock (no pedidos ni configuración).
2. **Copia nocturna de la base** — el servicio `backup` hace un `pg_dump`
   completo cada noche en la carpeta `backups/` de la aplicación (7 diarias,
   4 semanales, 6 mensuales). Se ven y se descargan desde Panel →
   **Respaldos**. Si la última tiene más de 36 horas, el panel lo avisa en
   Inicio.
3. **Copia fuera del servidor** — lo único que protege si se pierde el
   servidor entero (disco, proveedor, hackeo). **Hay que configurarla una vez**
   (abajo). El panel muestra en Respaldos cuándo fue la última sincronización.

### Configurar la copia fuera del servidor (una sola vez)

Recomendado: **Backblaze B2** (los primeros 10 GB son gratis; estas copias
ocupan bastante menos). También sirve Cloudflare R2 o Google Drive: el script
usa `rclone`, que habla con todos.

1. Crear una cuenta en backblaze.com → **B2 Cloud Storage** → crear un bucket
   privado (p. ej. `nudoescudo-backups`). En *Lifecycle Settings* → *Use
   custom lifecycle rules*: prefijo vacío, “Days till hide” **180**, “Days
   till delete” **1** (así las copias de más de 6 meses se borran solas).
2. *Application Keys* → crear una clave con acceso **solo a ese bucket**
   (Read and Write). Anotar keyID y applicationKey.
3. En el servidor, como root:

```bash
apt install rclone
rclone config            # n (nuevo) → nombre: b2 → tipo: b2 → pegar keyID y applicationKey
cp deploy/backup-offsite.sh /usr/local/sbin/nudoescudo-backup-offsite.sh
chmod +x /usr/local/sbin/nudoescudo-backup-offsite.sh
OFFSITE_REMOTE=b2:nudoescudo-backups/prod /usr/local/sbin/nudoescudo-backup-offsite.sh   # prueba
crontab -e
# agregar esta línea (todos los días 04:30):
30 4 * * * OFFSITE_REMOTE=b2:nudoescudo-backups/prod /usr/local/sbin/nudoescudo-backup-offsite.sh >> /var/log/nudoescudo-offsite.log 2>&1
```

El script solo **agrega** archivos al bucket (nunca borra), así que aunque
alguien borre el servidor, las copias de afuera quedan.

### Probar que las copias sirven (una vez por mes)

Una copia que nunca se probó no es una copia. En el servidor, como root:

```bash
cp deploy/backup-restore-test.sh /usr/local/sbin/nudoescudo-backup-restore-test.sh
chmod +x /usr/local/sbin/nudoescudo-backup-restore-test.sh
/usr/local/sbin/nudoescudo-backup-restore-test.sh
```

Restaura la última copia en una base temporal dentro de **staging**, compara la
cantidad de filas con producción y la borra. No toca ni producción ni staging.
Si termina con `OK`, las copias sirven.

### Restaurar una copia en producción (último recurso)

Esto **reemplaza toda la base** por la copia. Antes, descargá una copia del
estado actual desde Respaldos por las dudas.

```bash
cd CARPETA-DE-LA-APLICACION
docker compose stop app worker
docker compose exec -T db psql -U postgres -d nudoescudo -v ON_ERROR_STOP=1   -c "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"
gunzip -c backups/daily/ARCHIVO.sql.gz | grep -v '^CREATE SCHEMA public;$'   | docker compose exec -T db psql -q -U postgres -d nudoescudo -v ON_ERROR_STOP=1
docker compose start app worker
```

Si el servidor se perdió: instalar la aplicación en uno nuevo (ver
`guia-migracion.md`), bajar la copia del bucket con
`rclone copy b2:nudoescudo-backups/prod/daily/ARCHIVO.sql.gz backups/daily/`
y seguir los pasos de arriba.

## Problemas comunes

**La página no carga.**
Reiniciar todo (sección de arriba). Si sigue caída, mirar
`docker compose logs app` y buscar líneas con `Error`.

**No llegan los emails.**
1. Revisar spam.
2. En el servidor: `docker compose exec app npm run mail:check -- TU@EMAIL`.
   Revisa la configuración, el estado del dominio en Resend (y qué registros
   DNS faltan) y manda un email de prueba. Todo lo que diga `FALLA` hay que
   corregirlo en `.env` (luego `docker compose up -d`) o en el DNS.
3. Entrar a https://resend.com con la cuenta de la tienda → ver “Logs”. Si hay
   errores de dominio, el dominio hay que re-verificarlo (sección DNS en Resend).
4. Ver `docker compose logs app | grep -i mail`.

**Los precios están viejos.**
Panel → Inicio → “Precios Card Kingdom” → **Ejecutar ahora**. Si da error
repetido, puede ser que MTGJSON esté caído; suele resolverse solo en horas.

**Una carta nueva no aparece en el buscador.**
El catálogo se actualiza solo cada semana. Para forzarlo: Panel → Inicio →
“Catálogo MTG (Scryfall)” → **Ejecutar ahora** (tarda varios minutos).

**Cambiar la contraseña del panel.**
En el servidor: editar el archivo `/opt/nudoescudo/.env`, cambiar
`ADMIN_PASSWORD=...` y luego `docker compose up -d` para aplicar.
