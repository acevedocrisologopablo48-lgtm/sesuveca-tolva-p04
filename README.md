# SESUVECA · Tolva trompo TT10

Web: https://acevedocrisologopablo48-lgtm.github.io/sesuveca-tolva-p04/

Modelo activo: `TT10_C05_CONJUNTO.SLDASM`, revisión interna C06. El visor contiene **492 códigos y 996 instancias**. Incluye las 16 piezas revisadas del bloqueo y el paso de cadena de la plataforma; las piezas suprimidas ya no aparecen.

Documentos: **102 planos A4 horizontales** en PDF y nativos con sus referencias, BOM Excel/PDF, informe de cálculo, STEP y **151 perfiles DXF**. El manifiesto `dist/data/documentos.json` registra los archivos publicados, sus hashes, páginas y formatos reales.

Servir `dist/` por HTTP. GitHub Actions publica esa carpeta al actualizar `main`.

Sincronización 25/10/2026: inventario PN_00_CARGA, geometría nativa y cálculos vigentes. Masa disponible 17.378,657 kg; 83 códigos con masa n/d. Modelo de parada con dos frenos: 1,298 s nominales y 2,015 s al dividir la capacidad por FS 1,5. Son resultados del modelo con las hipótesis indicadas.

Simulación cinemática; el carbón es ilustrativo. Estado técnico: **NO LIBERADA PARA FABRICACIÓN**.

Reconstrucción local de la publicación: `scripts/sincronizar_tt10_c05.py`. Tras guardar los documentos finales: `scripts/datos_actuales.py` sincroniza las descargas y construye el ZIP de nativos/referencias sin duplicar PDFs o archivos de respaldo. `scripts/verificar_cinematica.mjs` comprueba el ciclo y los conteos. Los scripts locales permanecen fuera de Git según `.gitignore`.
