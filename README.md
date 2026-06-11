# NudoEscudo eShop

Tienda online de cartas sueltas (Magic: The Gathering y Pokémon) con pedidos
por email (sin pago online), pensada para una tienda física en Uruguay.

- **Catálogo MTG**: Scryfall (bulk data, actualización semanal automática).
- **Precios MTG**: Card Kingdom, vía los archivos diarios de MTGJSON.
- **Catálogo Pokémon**: TCGdex. **Precios Pokémon**: TCGplayer (vía TCGdex).
- **Moneda**: US$ con conversión diaria a $U (pesos uruguayos).
- **Stock**: importación del CSV de Delver Lens (con Scryfall ID) + carga manual.
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
- Primera vez: `docker compose exec app npm run sync -- catalog` (y `prices`,
  `fx`, `pokemon-catalog`) o usar los botones de "Ejecutar ahora" en `/admin`.

## Estructura

- `src/app` — storefront + panel admin (App Router, server components).
- `src/lib` — lógica de negocio (pedidos, precios, importaciones, email).
- `src/jobs` — sincronizaciones programadas.
- `scripts/` — CLI: migraciones, seed, sync, importación Delver, worker.
- `drizzle/` — migraciones SQL generadas (drizzle-kit).

Las guías de operación en español para la tienda están en `docs/`.
