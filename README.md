# Nhubex Client

Cliente de escritorio para ejecutar Nhubex POS en un espacio controlado, sin depender de Chrome.

## Características

- Una sola instancia abierta; un segundo intento enfoca la ventana existente.
- El botón de cerrar se intercepta y Nhubex permanece visible y activo. Para salir, usa **Salir** en el menú de la bandeja.
- Los atajos normales de recarga (`F5`, `Ctrl/Cmd+R` y recarga forzada) están desactivados.
- Solicita la URL en el primer inicio y la guarda en la caché de la aplicación. Al borrar la caché, vuelve a solicitarla.
- No guarda contraseñas ni expone Node.js a la página POS.
- La opción **Nhubex → Configurar impresora** abre el diálogo del sistema para seleccionar/configurar la impresora. **Nhubex → Impresión silenciosa** es una opción manual que se puede activar o desactivar; no cambia automáticamente después de imprimir. También está disponible desde el menú de la bandeja.
- Soporta ventanas emergentes, notificaciones, audio, fullscreen, clipboard y conexiones web normales (HTTPS/HTTP, WebSocket y puertos accesibles desde el navegador).
- Genera instaladores para Windows (NSIS) y macOS (DMG).

## Desarrollo en macOS

Requiere Node.js 20+.

```bash
npm install
npm start
```

Para probar el instalador local:

```bash
npm run build:mac
```

## Compilación para Windows

Desde Windows:

```bash
npm install
npm run build:win
```

El instalador queda en `release/`. Para una compilación Windows desde macOS puede requerirse Wine y configuración adicional de firma; lo recomendado es compilar en Windows o en CI de Windows.

## Asociar el repositorio

El remoto solicitado es:

```bash
git remote add origin https://github.com/Nullexploit/Nhubex-Client.git
git push -u origin main
```

El primer commit local se crea después de revisar y validar la aplicación.
