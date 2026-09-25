# Nhubex

Cliente de escritorio para ejecutar Nhubex POS en un espacio controlado, sin depender de Chrome.

## Características

- Una sola instancia abierta; un segundo intento enfoca la ventana existente.
- El botón de cerrar se intercepta y Nhubex permanece visible y activo. Para salir, usa **Salir** en el menú de la bandeja.
- Los atajos normales de recarga (`F5`, `Ctrl/Cmd+R` y recarga forzada) están desactivados.
- El pegado mediante `Ctrl/Cmd+V` está desactivado dentro de Nhubex y sus ventanas emergentes.
- La opción **Salir** está deshabilitada para evitar cerrar el cliente desde el menú.
- Solicita la URL en el primer inicio y la guarda en la caché de la aplicación. Al borrar la caché, vuelve a solicitarla.
- En el primer inicio permite elegir el ambiente Alpha, Beta o Producción y abre la URL oficial correspondiente.
- Las herramientas de desarrollador se pueden abrir con los atajos habituales de Chromium para limpiar caché.
- También están disponibles directamente en **Nhubex → Abrir consola**.
- No guarda contraseñas ni expone Node.js a la página POS.
- **Nhubex → Ajustes de impresión** permite elegir impresora, papel, orientación, escala, márgenes y opciones de color/fondo. **Nhubex → Impresión silenciosa** activa o desactiva la impresión directa con esas preferencias guardadas.
- Electron no ofrece dentro de la app la vista previa de impresión de Chrome; los ajustes de Nhubex son el panel de configuración y se aplican a sus impresiones silenciosas.
- El panel incluye tamaños de hoja comunes y rollos de ticket de 58, 76.2, 80 y 88 mm de ancho. En rollos, Nhubex estima una altura según el contenido del documento (hasta 508 mm); el corte físico también depende del controlador de la impresora.
- Las descargas se guardan en Descargas y muestran avisos tanto dentro de Nhubex como en el sistema operativo.
- **Nhubex → Configuración → Desinstalar Nhubex** borra los datos locales y abre el desinstalador del sistema; no borra datos del servidor.
- Soporta ventanas emergentes, notificaciones, audio, fullscreen, clipboard y conexiones web normales (HTTPS/HTTP, WebSocket y puertos accesibles desde el navegador).
- Genera instaladores para Windows (NSIS) y macOS (DMG).

## Desarrollo en macOS

Requiere Node.js 20+.

```bash
npm install
npm start
```

Cada versión produce un instalador x64 con versión en el nombre (por ejemplo, `Nhubex-1.0.6-x64.exe`). Electron 44 ya no ofrece binarios Windows de 32 bits. Incrementa `version` en `package.json` y `package-lock.json` para cada nueva entrega. Al publicar un tag `vX.Y.Z`, GitHub Actions compila Windows y adjunta el instalador a la versión.

Para probar el instalador local (no es necesario para el desarrollo; `npm start` ejecuta el cliente directamente):

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
