# Copart — subastas de vehículos en tiempo real

Sitio publicado: **https://subastas-copart-javier.onrender.com/**.

Aplicación Node.js, Express, SQL Server y Socket.IO. Frontend SPA sin compilación: catálogo, filtros, registro/login, publicaciones y ofertas en vivo. Las pujas se serializan en SQL Server para impedir ofertas simultáneas contradictorias. La identidad de quien oferta no se envía al público.

## Ejecutar

1. Instala Node.js 20 o superior: `npm ci`.
2. Copia `.env.example` a `.env` y completa `DB_PASSWORD` y un `JWT_SECRET` aleatorio de 24 caracteres o más. La base anterior `db_WebDevUMG` se usa con tablas nuevas `Copart_Javier_*`.
3. Ejecuta `npm start` y abre `http://localhost:3000`. Al iniciar se crea el esquema del archivo `schema.sql` si el usuario tiene permisos `CREATE TABLE`.
4. Si el usuario SQL no tiene permiso de crear tablas, solicita una base propia o permisos al docente. No elimines ni alteres las tablas existentes del reto maestro-detalle.

## Variables de Render

Configura `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT=true`, `DB_TRUST_SERVER_CERTIFICATE=true`, `JWT_SECRET` (secreto nuevo) y `SEED_DEMO=true`. Build: `npm install`. Start: `npm start`.

## Usuarios de prueba

Con `SEED_DEMO=true`, al arrancar se crean si faltan estas cuentas y tres vehículos de prueba. Estas claves son **solo para las cuentas de demostración**, no para el servidor SQL:

| Correo | Contraseña |
| --- | --- |
| demo1@copart.test | DemoCopart2026!1 |
| demo2@copart.test | DemoCopart2026!2 |
| demo3@copart.test | DemoCopart2026!3 |

Inicia sesión como demo2 y demo3 en dos navegadores para ofertar por un vehículo de demo1. La oferta mínima sube 10 % respecto a la actual, el estado cambia en vivo y el reloj llega a cero sin actualizar la página.

## API

- `POST /api/auth/registro`, `POST /api/auth/login`
- `GET /api/vehiculos`, `GET /api/vehiculos/:id`
- `POST /api/vehiculos`, `PUT /api/vehiculos/:id` (Bearer token)
- `POST /api/vehiculos/:id/pujas` (Bearer token; cuerpo `{"monto": 30000}`)
- `GET /api/salud`

Las imágenes se registran como URL HTTPS, cinco o más por vehículo. Para publicar, las URLs deben ser de imágenes accesibles públicamente.
