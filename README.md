# PaloTranscribe

PaloTranscribe es una aplicación web de transcripción de audio/video a texto diseñada para funcionar directamente en el navegador y quedar lista para desplegarse en cualquier hosting compatible con Vite.

## Estado

✅ Proyecto completo en GitHub  
✅ Build validado con GitHub Actions  
✅ TypeScript + Vite compilan correctamente  
✅ Supabase nuevo y aislado conectado únicamente para health/config  
✅ Sin dependencia de un proveedor de hosting específico

## Funciones

- Hasta 20 archivos por sesión.
- Audio y video: M4A, MP3, WAV, AAC, OGG, FLAC, MP4, MOV y WebM.
- Whisper local mediante `@huggingface/transformers`.
- Modelos Tiny, Base y Small.
- WebGPU cuando el dispositivo lo soporta.
- WASM como respaldo.
- Procesamiento por bloques para reducir consumo de memoria.
- Interfaz responsive para iPhone, iPad, Android y escritorio.
- Español como idioma principal.
- Modo médico y normalización con glosario personalizado.
- Si un archivo falla, continúa con los demás.
- Nombre personalizado para el archivo final.
- Descarga del resultado completo en TXT.
- Diseño PaloTranscribe original con hero “para Paloma mi novia ❤️”.

## Arquitectura

- Frontend: React + Vite + TypeScript.
- Inferencia: Whisper en Web Worker.
- Decodificación: Mediabunny.
- Aceleración: WebGPU / WASM.
- Supabase autorizado: `dpnjavicsonidjjuwkug`.
- Función de health: `palotranscribe-health`.

Los archivos de audio no se suben a Supabase para transcribirse. La inferencia se ejecuta en el navegador del usuario.

## Desarrollo

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

La salida lista para producción se genera en `dist/`.

## Validación automática

El workflow `.github/workflows/build.yml` ejecuta automáticamente la instalación de dependencias y `npm run build` en cada push a `main` y en pull requests.

## Despliegue

El repositorio no está atado a Lovable, Emergent ni a otro constructor. Puede conectarse directamente a un proveedor de hosting que soporte Vite/SPA y publicar la carpeta `dist/`.

Configuración típica:

- Build command: `npm run build`
- Output directory: `dist`
- Node: 22

## Aislamiento

Este proyecto usa exclusivamente el repositorio `vrbvmw69yd-a11y/Palotranscribe` y el Supabase nuevo `dpnjavicsonidjjuwkug`. No depende de proyectos anteriores.
