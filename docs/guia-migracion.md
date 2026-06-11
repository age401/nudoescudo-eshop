# Guía de migración — del servidor de prueba al servidor propio

Para mover la tienda del Vultr de prueba al Vultr (u otro VPS) del dueño, con
sus propias cuentas. Tiempo estimado: 1–2 horas. La tienda vieja puede quedar
andando hasta el final, así no se pierde nada.

## 1. Crear lo nuevo

1. **VPS**: crear en la cuenta del dueño un servidor Ubuntu LTS (2 vCPU / 4 GB
   recomendado; en Vultr, la región São Paulo es la más cercana a Uruguay).
2. **Dominio**: tener acceso al DNS del dominio definitivo de la tienda.
3. **Resend** (emails): crear cuenta en https://resend.com con el email del
   dueño, agregar el dominio y configurar los registros DNS que indica
   (SPF/DKIM). Crear una **API key** y guardarla.

## 2. Preparar el servidor nuevo

```bash
ssh root@IP-NUEVA
# instalar docker
curl -fsSL https://get.docker.com | sh
# instalar caddy (reverse proxy con HTTPS automático) si no se usa otro
apt install -y caddy
# traer el código
git clone URL-DEL-REPOSITORIO /opt/nudoescudo
cd /opt/nudoescudo
cp .env.example .env
```

Editar `/opt/nudoescudo/.env` con valores nuevos:

- `POSTGRES_PASSWORD`: contraseña larga nueva (cualquiera, no se vuelve a tipear).
- `SITE_URL`: `https://DOMINIO-DEFINITIVO`
- `APP_SECRET`: texto largo aleatorio nuevo.
- `ADMIN_PASSWORD`: contraseña del panel que usará el dueño.
- `EMAIL_MODE=resend`, `RESEND_API_KEY`: la key nueva.
- `EMAIL_FROM`: `NudoEscudo <pedidos@DOMINIO>` (dominio verificado en Resend).
- `ADMIN_EMAIL`: el email del dueño que recibirá los avisos de pedidos.

Configurar Caddy (`/etc/caddy/Caddyfile`):

```
DOMINIO-DEFINITIVO {
    reverse_proxy 127.0.0.1:3000
}
```

y recargar: `systemctl reload caddy`.

## 3. Copiar los datos (stock, pedidos, configuración)

En el servidor **viejo**:

```bash
cd /opt/nudoescudo
docker compose exec db pg_dump -U postgres -d nudoescudo | gzip > migracion.sql.gz
```

Pasarlo al nuevo (desde tu computadora o directo entre servidores):

```bash
scp USUARIO@IP-VIEJA:/opt/nudoescudo/migracion.sql.gz .
scp migracion.sql.gz root@IP-NUEVA:/opt/nudoescudo/
```

En el servidor **nuevo**:

```bash
cd /opt/nudoescudo
docker compose up -d db                  # solo la base por ahora
sleep 10
gunzip -c migracion.sql.gz | docker compose exec -T db psql -U postgres -d nudoescudo
docker compose up -d --build             # ahora todo
```

## 4. Apuntar el dominio

En el DNS del dominio definitivo: registro **A** apuntando a la IP nueva.
Esperar a que propague (minutos a horas). Caddy emite el certificado HTTPS
solo, en el primer acceso.

## 5. Verificación final

- [ ] La página carga con candado (HTTPS) en el dominio nuevo.
- [ ] El buscador sugiere cartas y el stock coincide con el viejo.
- [ ] Hacer un pedido de prueba con un email real → llega el email → confirmar
      → llega el aviso al `ADMIN_EMAIL` → aparece en el panel → cancelarlo.
- [ ] Panel → Inicio → ejecutar “Tipo de cambio” y “Precios Card Kingdom” y
      verificar que terminen **OK**.

## 6. Apagar lo viejo

Cuando todo lo anterior está OK durante unos días:

```bash
# en el servidor viejo
cd /opt/nudoescudo && docker compose down -v
```

y dar de baja el subdominio de prueba y las cuentas temporales (Resend vieja).
