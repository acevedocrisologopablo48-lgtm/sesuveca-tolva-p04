# SESUVECA · Planta de selección de carbón R03

Web: https://acevedocrisologopablo48-lgtm.github.io/sesuveca-tolva-p04/#planta

Actualización: 29/10/2026. Modelo activo: `PLANTA_SELECCION_CARBON_R03_CIERRE.SLDASM`, con 2.174 componentes y 473 geometrías exportadas desde SolidWorks. Incluye la disposición R02, plataforma, escalera, canaleta y accionamiento 318M R03.

El visor reproduce las configuraciones nativas 0°, 35° y 70° con error inferior a 0,001 mm. `plant-motion.js` comparte la cinemática entre el visor y las pruebas locales. La secuencia visual acelerada libera pasadores, abate la canaleta, gira y retorna. La extracción intermedia de 60 mm de los pasadores cautivos es una hipótesis visual; no representa un actuador diseñado. Los componentes comerciales e interiores de transmisión están simplificados.

Servir `dist/` por HTTP. GitHub Actions publica esa carpeta al actualizar `main`.

**Verificación no aprobada para la canaleta.** El barrido de superficies registró 127 pares de contacto, que incluyen contactos nominales. Siete ejemplos de penetración volumétrica se confirmaron con OCP. No se declara el conjunto libre de interferencias o desconexiones mecánicas ni liberado para fabricación. La comprobación anterior de 69 componentes del accionamiento, sin solapes superiores a 1 mm³, tiene un alcance distinto.

La memoria R03 y la evidencia están en `dist/documentos/`. El informe `VERIFICACION_WEB_R03.html` identifica resultados, pares y limitaciones; el JSON conserva la trazabilidad al SHA-256 del CAD. El resaltado del visor indica piezas de canaleta incluidas en pares de contacto, sin afirmar que cada par sea una penetración.

Las secciones Tolva, Cálculos y Piezas C05/C06 y las descargas R01 se conservan como **históricas**, anteriores al accionamiento 318M.


Validación local: sintaxis JavaScript, rutas e IDs HTML, coincidencia de transformaciones, continuidad e interbloqueo de la secuencia, inicialización y controles en jsdom con escena Three.js sin GPU. No se realizó inspección visual en navegador: su control está deshabilitado en Work. Scripts de exportación y verificación en la carpeta local `PLANTA SELECCION CARBON/07_FUENTES/R03_ACCIONAMIENTO/web_qa`.
