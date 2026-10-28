# Pruebas de carga (k6)

## Plan (escrito ANTES de ejecutar)

| | |
|---|---|
| **Reto** | "Reporte en tiempo real, cola de prioridades" + "Multisede (distribución y demanda)" |
| **Atributos** | Rendimiento (latencia) y escalabilidad |
| **Pregunta** | Cuando muchos salones reportan a la vez al inicio de clases, ¿el docente recibe confirmación rápido y las pantallas de la cola siguen respondiendo? |
| **SLO** | p95 crear solicitud ≤ 500 ms · p95 consultar cola ≤ 300 ms · errores < 1 % |
| **Tipos de prueba** | baseline (carga normal) · pico (inicio de clases) · estrés (punto de quiebre) |

Los umbrales del SLO están codificados como `thresholds` en cada script: si no se cumplen, k6 termina con error.

## Escenarios

| Script | Docentes creando solicitudes | Pantallas consultando cola/panel | Técnicos | Duración |
|---|---|---|---|---|
| `scripts/baseline.js` | 2/s constante | 5/s | 4 atendiendo | 1 min |
| `scripts/pico.js` | 2 → 30/s en 15 s, sostenido 1 min | 20/s | 4 | 1,5 min |
| `scripts/estres.js` | 10 → 300/s en 90 s, sostenido 30 s | 50/s | 4 | 2 min |

La lógica común está en `scripts/comun.js`: login de todos los roles en `setup()`, equipos al azar de las dos sedes, 70 % fallas / 30 % préstamos y 60 % con clase en curso.

## Cómo ejecutar

Requisitos: [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/), Node.js 22.13+ y `npm install` en `backend/`.

```bash
# desde la raíz del repositorio (Linux/macOS/Git Bash)
bash perf/correr.sh baseline
bash perf/correr.sh pico
bash perf/correr.sh estres
```

`correr.sh` levanta el backend con una BD nueva, corre k6 y deja en `resultados/`:

- `<prueba>-resumen.json`: métricas finales (p95, throughput, errores)
- `<prueba>-consola.txt`: la salida de k6
- `<prueba>-ventanas.md`: evolución cada 10 s (generada con `analizar_csv.py`)

En Windows sin Git Bash: en una terminal `cd backend && npm start`, y en otra `k6 run perf/scripts/baseline.js`.

## Resultados

**Segunda medición, en un portátil con Windows (26/09/2026)**, con el servidor, k6, VS Code y Expo abiertos al tiempo:

| Prueba | p95 crear | p95 cola | Errores | Peticiones | SLO |
|---|---|---|---|---|---|
| Baseline | 156 ms | 25 ms | 0 % | 790 | ✅ |
| Pico | 58 ms | 50 ms | 0 % | 4.616 (50 req/s) | ✅ |

Capturas: [baseline](../docs/evidencias/windows/04-k6-baseline.png) · [pico](../docs/evidencias/windows/05-k6-pico.png). El estrés no se corrió en el portátil, porque lo satura a propósito.


Resumen y análisis del cuello de botella en **[docs/pruebas.md §4](../docs/pruebas.md#4-pruebas-de-carga)**.

Versión final (con las pantallas del prototipo AsisTec). Cada cifra sale de `resultados/<prueba>-resumen.json` (`metrics → http_req_duration{nombre:crear_solicitud|consultar_cola} → p(95)` y `http_req_failed → value`); lo mismo se ve al final de `resultados/<prueba>-consola.txt`:

| Prueba | p95 crear | p95 cola | Errores | SLO |
|---|---|---|---|---|
| Baseline | 7,5 ms | 5,6 ms | 0 % | ✅ |
| Pico | 21,8 ms | 18,6 ms | 0 % | ✅ |
| Estrés | 10.912 ms | 34.740 ms | 2,71 % | ❌ quiebre ≈140 sol/s |

Resultados anteriores que se conservan para comparar:

| Archivos | Versión | Quiebre | Errores |
|---|---|---|---|
| `estres-v1-sin-limite-*` | cola completa (antes del ADR-004) | ≈108 sol/s | 4,50 % |
| `estres-v2-antes-prototipo-*` | cola paginada, antes de las pantallas del prototipo | ≈140 sol/s | 3,64 % |
| `estres-v3-constructor-lento-*` | primera versión con el prototipo (regresión, ver docs/pruebas.md §4.5) | ≈97 sol/s | 6,94 % |

`micro-cola.txt` es la medición paso a paso de la consulta de la cola que explica la regresión v3 (docs/pruebas.md §4.5). Se regenera con `npm run medir:cola` desde `backend/`.

`correr.sh` sobrescribe `baseline-*`, `pico-*` y `estres-*` cada vez que se corre. **Si se vuelve a correr, hay que actualizar las cifras de este README, de `docs/pruebas.md` y del README principal con lo que quede en los archivos nuevos.**
