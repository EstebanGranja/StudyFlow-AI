# StudyFlow AI

Aplicacion web para gestionar estudio mediante apuntes PDF, con autenticacion completa usando Insforge.

## Estado actual

La autenticacion ya esta implementada y lista para usar.

- Registro con email y password
- Verificacion por codigo OTP (segun configuracion actual de Insforge)
- Inicio y cierre de sesion
- Dashboard protegido por usuario autenticado
- Base de datos con RLS para acceso por propietario
- Endpoint backend autenticado para obtener perfil/sesion

## Stack

- Next.js (App Router)
- React
- TypeScript
- Insforge SDK

## Variables de entorno

El proyecto usa:

```bash
NEXT_PUBLIC_INSFORGE_BASE_URL=...
NEXT_PUBLIC_INSFORGE_ANON_KEY=...
```

- Ejemplo: `.env.example`
- Local real: `.env.local`

## Flujo de autenticacion implementado

- `app/register/page.tsx`: registro y verificacion OTP
- `app/login/page.tsx`: inicio de sesion
- `app/dashboard/page.tsx`: ruta protegida y lectura de perfil
- `lib/insforge/client.ts`: cliente singleton del SDK
- `lib/insforge/ensure-user-settings.ts`: bootstrap de perfil en DB

## Backend y base de datos en Insforge

Se aplico la migracion:

- `insforge/sql/001_auth_and_user_data.sql`

Recursos creados:

- Tabla `public.user_settings`
- Tabla `public.study_documents`
- Politicas RLS por `auth.uid()`
- Triggers `updated_at`

Nota: Insforge no permite gestionar triggers en `auth.users` desde SQL import, por eso el alta de `user_settings` se resuelve en la app justo despues de sign-up/sign-in.

## Endpoint backend

Se desplego la edge function:

- Slug: `auth-me`
- Archivo fuente: `insforge/functions/auth-me.ts`
- URL base functions: `https://p2qhb29d.functions.insforge.app`

La funcion requiere `Authorization: Bearer <access_token>` y responde usuario autenticado + `user_settings`.

## Desarrollo local

```bash
pnpm install
pnpm dev
```

Abrir `http://localhost:3000`.

## Scripts

- `pnpm dev`
- `pnpm build`
- `pnpm start`
- `pnpm lint`
