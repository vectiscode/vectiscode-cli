# Assets and Attachments

## Current Direction

Attachments are stored in Supabase:

- Metadata lives in `public.vectis_collections` under the `attachments` collection.
- File bytes live in the private Supabase Storage bucket configured by `SUPABASE_STORAGE_BUCKET`, default `vectis-attachments`.
- Local development may inline small files for convenience.

Do not add Google Cloud Storage, Firestore attachment storage, Vertex image generation, or Gemini API image generation.

## Upload Limits

- Images: PNG, JPEG, and WebP up to 10 MB.
- PDFs: up to 10 MB.
- Text and code: up to 2 MB.
- Executables and archives are rejected.

## Generated Icons

Generated icons are disabled in production until a non-Google image provider is configured. The API fails closed and refunds credits if generation cannot complete.

When a non-Google image provider is added:

- Keep transparent PNG validation.
- Keep generated icon evidence records.
- Store generated image bytes in Supabase Storage.
- Price the feature from the real provider cost, not old Google image pricing.

## Security Notes

- The Supabase service role key must stay server-side only.
- The Storage bucket is private.
- Browser clients fetch attachment content through authenticated API routes.
- RLS is enabled on the document table and public roles are not granted access.
