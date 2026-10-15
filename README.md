# SESUVECA · Tolva basculante P04

Web estática del proyecto de Javier Acevedo. Incluye visor 3D de la geometría P04, movimiento 0–70°, vistas ortogonales, sección, cotas, despiece visual, selección de piezas, cálculos y lista de materiales. La cotización y los planos no forman parte de esta publicación.

El visor distingue pintura satinada, acero mecanizado, placas interiores y elastómero. Incluye reflejos de estudio, sombras de contacto, superficies cilíndricas suaves y aristas de piezas activadas inicialmente. Los acabados son una representación visual; los materiales de ingeniería se consultan en la lista de piezas. Las aristas se agrupan en dos conjuntos para mantener fluida la maniobra.

## Abrir localmente

Servir la carpeta `dist` con cualquier servidor HTTP estático. Por ejemplo:

```sh
python -m http.server 4173 --directory dist
```

Abrir `http://localhost:4173`. Los módulos y datos necesitan HTTP; abrir `index.html` directamente como archivo no es suficiente.

## Datos y alcance

- 371 códigos / 749 instancias de la máquina; 207 resultados y 92 comprobaciones de la memoria P04.
- Geometría de presentación teselada a partir de perfiles, agujeros, operaciones y 106 cortes de la geometría canónica. Roscas, radios pequeños, taladros transversales especiales e interiores de componentes comerciales están simplificados.
- La animación es cinemática. El carbón es una representación aproximada y no una simulación DEM o validación de impacto.
- 10 t es el caso resistente. Volumen útil 8,446 m³; capacidad volumétrica 6,08–7,43 t para 720–880 kg/m³.
- Las verificaciones físicas y confirmaciones de los fabricantes conservan el alcance indicado en la memoria P04.
- La velocidad de reproducción modifica únicamente el tiempo del visor; el movimiento de proyecto se limita a 0,5 rpm.

## Publicación

El flujo de GitHub Actions publica únicamente `dist/` en GitHub Pages. Las rutas son relativas y funcionan bajo un subdirectorio. Three.js 0.180.0 y OrbitControls se sirven localmente; su licencia MIT está en `dist/assets/vendor/THREE-LICENSE.txt`. No hay analítica, formularios, cuentas de visitantes ni servicios externos en ejecución.

La geometría y las cantidades pertenecen a la revisión P04 del 14 de octubre de 2026.
