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
- **Nhubex → Ajustes de impresión** permite actualizar las impresoras sin reiniciar, elegir el nombre técnico detectado por Electron, papel, orientación, escala, márgenes y opciones de color/fondo. Conserva una selección válida y advierte si la cola fue eliminada o renombrada.
- El panel permite imprimir un comprobante local y muestra diagnóstico del sistema, Electron, impresoras, selección y último resultado. Un resultado “aceptado” significa que el subsistema de impresión recibió el trabajo; no confirma la salida física del papel.
- **Nhubex → Impresión silenciosa** activa o desactiva la impresión directa. Desactivada, Electron usa el diálogo nativo para elegir el destino. Activada, una impresora guardada que ya no existe bloquea el envío hasta que el usuario elige otra o confirma explícitamente la predeterminada.
- Las solicitudes de impresión se capturan desde el inicio del documento, incluso en tickets generados con `document.write()`. Si el POS cierra el ticket después de pedir la impresión, el cierre espera la respuesta del controlador; las solicitudes repetidas mientras ese envío está pendiente no duplican el trabajo.
- Electron no ofrece dentro de la app la vista previa de impresión de Chrome; los ajustes de Nhubex son el panel de configuración y se aplican a sus impresiones silenciosas.
- El panel incluye el tamaño predeterminado del controlador, tamaños de hoja comunes y rollos de ticket de 58, 76.2, 80 y 88 mm de ancho. En rollos, Nhubex estima una altura según el contenido del documento (hasta 508 mm); el corte físico también depende del controlador de la impresora.
- Las descargas se guardan en Descargas y muestran avisos tanto dentro de Nhubex como en el sistema operativo.
- **Nhubex → Configuración → Desinstalar Nhubex** borra los datos locales y abre el desinstalador del sistema; no borra datos del servidor.
- Soporta ventanas emergentes, notificaciones, audio, fullscreen, clipboard y conexiones web normales (HTTPS/HTTP, WebSocket y puertos accesibles desde el navegador).
- Genera instalador NSIS x64 para Windows, DMG/ZIP para macOS Intel y Apple Silicon, y AppImage/DEB x86_64 para Linux.

## Desarrollo y pruebas

Requiere Node.js 20+.

```bash
npm install
npm start
```

Pruebas de impresión (sin enviar trabajos a impresoras físicas):

```bash
npm test
npm run test:printing
```

En Linux, si no hay sesión gráfica, ejecuta la segunda prueba mediante `xvfb-run --auto-servernum npm run test:printing`. Esta abre ventanas ocultas con un perfil temporal independiente y reemplaza la llamada de impresión: no envía papel ni accede al POS. GitHub Actions ejecuta ambas suites y un build de directorio en Windows, macOS y Ubuntu cuando cambia `prudan`; no publica artefactos.

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

## Compilación para macOS y Linux

En macOS, `npm run build:mac` genera artefactos separados `x64` y `arm64`. Para distribución pública se requiere una identidad de Developer ID, firma de código y notarización de Apple; una compilación local sin firma puede requerir autorización manual de Gatekeeper.

En Linux x86_64, `npm run build:linux` genera AppImage y DEB. El host necesita las herramientas de empaquetado que usa `electron-builder`; el usuario final necesita un escritorio compatible y el controlador/CUPS configurado. AppImage puede requerir FUSE según la distribución.

Los artefactos se nombran `Nhubex-<versión>-<arquitectura>.<ext>`. El comando genérico `npm run build` construye los objetivos configurados para la plataforma donde se ejecuta.

## Prueba manual de impresión

1. Descarga el artefacto de tu sistema desde la versión de GitHub que corresponda. En Windows ejecuta el `.exe` NSIS; en macOS abre el `.dmg` de tu arquitectura y mueve Nhubex a Aplicaciones; en Ubuntu/Debian instala el `.deb` o marca el AppImage como ejecutable y ábrelo.
2. Instala primero el controlador oficial o compatible de la impresora y confirma desde los ajustes del sistema operativo que puede imprimir una página de prueba. La compatibilidad física depende del controlador, el sistema y el hardware.
3. Abre **Nhubex → Ajustes de impresión**, pulsa **Actualizar impresoras** y verifica el nombre descriptivo, la predeterminada y el diagnóstico. Selecciona la impresora y el tamaño; guarda los cambios.
4. Con impresión silenciosa desactivada, pulsa **Imprimir prueba**, elige el destino en el diálogo nativo y prueba también la cancelación. Con impresión silenciosa activada, repite y confirma que sólo se envía un trabajo al destino guardado.
5. Para una térmica, selecciona 58, 76.2, 80 u 88 mm según el rollo/controlador, revisa márgenes, escala, longitud y corte. Si el controlador ya define correctamente el rollo, prueba **Usar tamaño predeterminado del controlador**.
6. Desconecta o elimina temporalmente una cola guardada y confirma que Nhubex bloquea el envío silencioso y ofrece abrir ajustes o usar explícitamente la predeterminada. Luego reinstala/restaura la cola y actualiza la lista.

Windows 10/11 x64, macOS Intel/Apple Silicon y Linux x86_64 son objetivos de empaquetado, pero una plataforma sólo se considera validada cuando sus pruebas se ejecutan allí. `Microsoft Print to PDF` se trata exclusivamente como otra impresora virtual cuando Windows y su controlador la exponen; en modo silencioso su comportamiento y solicitudes de nombre/ruta dependen del controlador. Nhubex no genera PDF ni usa `printToPDF()`.

## Asociar el repositorio

El remoto solicitado es:

```bash
git remote add origin https://github.com/Nullexploit/Nhubex-Client.git
git push -u origin main
```

El primer commit local se crea después de revisar y validar la aplicación.
