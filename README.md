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

## Aislamiento
Este repositorio y el proyecto Supabase asociado son nuevos. No reutilizar ni enlazar con proyectos previos.

## Lovable
Lovable actualmente no permite iniciar un proyecto importando un repositorio GitHub existente. Si se decide usar Lovable, debe crearse un proyecto Lovable nuevo y su integración GitHub generará su propio repositorio; no se debe conectar ni modificar ningún proyecto Lovable ya existente.
