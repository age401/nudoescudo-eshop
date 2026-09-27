# NudoEscudo eShop

Tienda online de cartas sueltas (Magic: The Gathering y Pokémon) con pedidos
por email (sin pago online), pensada para una tienda física en Uruguay.

- **Catálogo MTG**: Scryfall (bulk data, actualización semanal automática).
- **Precios MTG**: Card Kingdom, vía los archivos diarios de MTGJSON.
- **Catálogo Pokémon**: TCGdex. **Precios Pokémon**: TCGplayer (vía TCGdex).
- **Moneda**: US$ con conversión diaria a $U (pesos uruguayos).
- **Stock**: se gestiona en el panel (filtros, ajustes con historial, CSV). Delver Lens (CSV con Scryfall ID) se usa para agregar cartas nuevas y para ventas en tienda con sugerencias de edición; reemplazo total protegido.
- **Respaldos**: pg_dump nocturno visible en el panel + copia fuera del servidor con rclone (ver runbook).
- **Pedidos**: el cliente confirma por enlace de email; el stock queda reservado
  y se libera solo si no confirma. Panel de administración en `/admin`.

## Desarrollo local (Windows/Mac/Linux, sin Docker)

```bash
npm install
npm run db:dev        # PostgreSQL embebido (terminal aparte, dejar corriendo)
npm run mail:dev      # Mailpit: emails de prueba en http://localhost:8025
npm run db:migrate    # migraciones
npm run db:seed       # juegos + configuración inicial
npm run dev           # http://localhost:3000
```

Variables: copiar `.env.example` a `.env` (los valores por defecto sirven para
desarrollo).

### Datos de prueba

```bash
npm run sync -- catalog --sets=fdn,dsk,blb   # catálogo MTG (3 sets)
npm run sync -- prices                       # precios Card Kingdom
npm run sync -- fx                           # tipo de cambio
npm run sync -- pokemon-catalog              # catálogo Pokémon completo
npx tsx scripts/make-test-csv.ts             # genera .local/test-delver.csv
npm run import:delver -- .local/test-delver.csv --replace
```

### Tests

```bash
npm test    # requiere la base de desarrollo corriendo
```

## Producción (VPS con Docker)

```bash
cp .env.example .env   # completar: POSTGRES_PASSWORD, SITE_URL, APP_SECRET,
                       # ADMIN_PASSWORD, EMAIL_MODE=resend, RESEND_API_KEY,
                       # EMAIL_FROM, ADMIN_EMAIL
docker compose up -d --build
```

- `app` publica en `127.0.0.1:3000`; el reverse proxy del servidor (nginx/caddy)
  termina TLS para el subdominio y hace proxy a ese puerto.
- `worker` ejecuta los trabajos programados (precios, catálogos, tipo de cambio,
  expiración de pedidos). `backup` hace `pg_dump` diario a `./backups`.
- Migraciones y seed corren automáticamente al iniciar `app`.
- Emails: `docker compose exec app npm run mail:check -- TU@EMAIL` valida la
  config, el dominio en Resend (y los registros DNS faltantes) y manda una prueba.
- Primera vez: `docker compose exec app npm run sync -- catalog` (y `prices`,
  `fx`, `pokemon-catalog`) o usar los botones de "Ejecutar ahora" en `/admin`.

## Staging (entorno de pruebas)

Copia completa de la tienda en **https://staging.tcg.nudoescudo.com**, en el
mismo servidor que producción pero con su propia base de datos, carpeta
(`/home/nudoescudo/htdocs/staging.tcg.nudoescudo.com`) y puerto (3002). Muestra
un aviso rojo arriba, no se indexa en buscadores y sus emails llevan
`[STAGING]` en el asunto.

Flujo de trabajo:

```text
feature/xyz ──PR──▶ staging ──PR──▶ master
                    │                │
                    ▼                ▼
      staging.tcg.nudoescudo.com   tcg.nudoescudo.com
```

1. Rama nueva desde `staging`: `git switch staging && git pull && git switch -c feature/xyz`.
2. PR de `feature/xyz` hacia **`staging`**. Al mergear, GitHub Actions despliega staging.
3. Probar en staging (vos y el cliente).
4. Cuando está aprobado: PR de `staging` hacia **`master`** → producción.

Diferencias de configuración (`.env` de staging): `SITE_ENV=staging`,
`WORKER_HEAVY_SYNCS=off` (las sincronizaciones semanales de ~1GB no se
programan, porque el servidor tiene 2GB; se corren a mano desde `/admin` o
`npm run sync`), `APP_PORT=3002` y contraseñas/secretos propios.

Copiar los datos de producción a staging (catálogo, precios, stock y
configuración; **sin pedidos**, que tienen datos de clientes):

```bash
sudo /usr/local/sbin/nudoescudo-staging-refresh-db.sh
```

Los scripts del servidor están versionados en `deploy/`.

## Estructura

- `src/app` — storefront + panel admin (App Router, server components).
- `src/lib` — lógica de negocio (pedidos, precios, importaciones, email).
- `src/jobs` — sincronizaciones programadas.
- `scripts/` — CLI: migraciones, seed, sync, importación Delver, worker.
- `drizzle/` — migraciones SQL generadas (drizzle-kit).

Las guías de operación en español para la tienda están en `docs/`.
