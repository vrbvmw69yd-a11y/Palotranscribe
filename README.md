# PaloTranscribe

Proyecto nuevo y aislado para PaloTranscribe.

## Arquitectura
- Frontend: React + Vite.
- Transcripción: Whisper en el navegador con `@huggingface/transformers`.
- Aceleración: WebGPU cuando está disponible; WASM como respaldo.
- Decodificación de audio: Mediabunny, por fragmentos para reducir el uso de RAM.
- Backend conectado: Supabase **PaloTranscribe** (`dpnjavicsonidjjuwkug`) únicamente para health/config. Los audios no se suben a Supabase.
- Modelos: Whisper Tiny, Base y Small multilingües.

## Privacidad
Los archivos de audio se procesan localmente en el navegador. La función de Supabase solo confirma que el backend del proyecto nuevo está activo.

## Nota de despliegue
Este repositorio fue creado para conectarse a un **proyecto nuevo de Lovable**. No reutilizar ni enlazar con proyectos previos.
