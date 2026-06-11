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

- Se generan solas cada noche en la carpeta `/opt/nudoescudo/backups`
  (se guardan 7 diarias, 4 semanales y 6 mensuales).
- **Recomendado**: una vez por mes, bajarse la más reciente a una computadora
  propia:

```bash
scp USUARIO@IP-DEL-SERVIDOR:/opt/nudoescudo/backups/daily/*.sql.gz .
```

### Restaurar una copia (último recurso)

```bash
cd /opt/nudoescudo
docker compose stop app worker
gunzip -c backups/daily/ARCHIVO.sql.gz | docker compose exec -T db psql -U postgres -d nudoescudo
docker compose start app worker
```

## Problemas comunes

**La página no carga.**
Reiniciar todo (sección de arriba). Si sigue caída, mirar
`docker compose logs app` y buscar líneas con `Error`.

**No llegan los emails.**
1. Revisar spam.
2. Entrar a https://resend.com con la cuenta de la tienda → ver “Logs”. Si hay
   errores de dominio, el dominio hay que re-verificarlo (sección DNS en Resend).
3. Ver `docker compose logs app | grep -i mail`.

**Los precios están viejos.**
Panel → Inicio → “Precios Card Kingdom” → **Ejecutar ahora**. Si da error
repetido, puede ser que MTGJSON esté caído; suele resolverse solo en horas.

**Una carta nueva no aparece en el buscador.**
El catálogo se actualiza solo cada semana. Para forzarlo: Panel → Inicio →
“Catálogo MTG (Scryfall)” → **Ejecutar ahora** (tarda varios minutos).

**Cambiar la contraseña del panel.**
En el servidor: editar el archivo `/opt/nudoescudo/.env`, cambiar
`ADMIN_PASSWORD=...` y luego `docker compose up -d` para aplicar.
