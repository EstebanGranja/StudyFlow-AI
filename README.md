# StudyFlow AI

Aplicacion web para organizar planes de estudio con PDFs, autenticacion completa y almacenamiento en Google Cloud Storage.

## Alcance actual (modo simple)

El flujo actual es intencionalmente simple y estable:

1. El usuario crea un plan de estudio y sube un PDF.
2. El backend guarda el PDF en Cloud Storage.
3. Se registran metadatos basicos en base de datos:
   - nombre de archivo
   - cantidad de paginas
   - peso del archivo (bytes)
4. El dashboard lista todos los planes creados.
5. Desde el detalle del plan se puede abrir el PDF.

No hay procesamiento OCR ni analisis con IA en esta etapa.

## Stack

- Next.js (App Router)
- React
- TypeScript
- Insforge SDK
- Google Cloud Storage

## Variables de entorno

```bash
NEXT_PUBLIC_INSFORGE_BASE_URL=...
NEXT_PUBLIC_INSFORGE_ANON_KEY=...
GOOGLE_APPLICATION_CREDENTIALS=./keys/service-account.json
GOOGLE_CLOUD_PROJECT=...
GCP_BUCKET_NAME=...

# Opcionales
# public recomendado para abrir PDF directo desde la UI
GCP_UPLOAD_URL_MODE=public
# default: 7 dias
GCP_SIGNED_URL_TTL_SECONDS=604800
```

- Ejemplo: `.env.example`
- Local real: `.env.local`

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

## API principal

### `POST /api/process-document`

- Auth: `Authorization: Bearer <token>`
- Request:
  - `multipart/form-data`: `studyPlanId`, `file` (PDF)
  - `application/json`: `{ "documentId": "..." }` para consultar/normalizar documento existente
- Response `200`:

```json
{
  "success": true,
  "mode": "simple-upload",
  "message": "Documento subido y registrado correctamente.",
  "document": {
    "id": "...",
    "studyPlanId": "...",
    "status": "done",
    "fileName": "apunte-parcial.pdf",
    "fileUrl": "https://storage.googleapis.com/...",
    "pageCount": 60,
    "fileSizeBytes": 4914330,
    "createdAt": "2026-04-12T20:00:00.000Z"
  }
}
```

### `GET /api/process-document?documentId=<id>`

- Auth: `Authorization: Bearer <token>`
- Response `200`: datos del documento y sus metadatos.

### `POST /api/process-document/worker`

Endpoint desactivado en modo simple (`410`). Se conserva reservado para una etapa futura.

## Migraciones necesarias

Aplica en orden:

- `insforge/sql/001_auth_and_user_data.sql`
- `insforge/sql/002_study_model.sql`
- `insforge/sql/003_study_plans_metadata.sql`
- `insforge/sql/004_document_processing_queue.sql` (legacy, no activo en modo simple)
- `insforge/sql/005_study_documents_metadata.sql`
