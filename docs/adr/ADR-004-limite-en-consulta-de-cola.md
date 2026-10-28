# ADR-004 — Paginar la consulta de la cola (decisión tomada a partir de la prueba de estrés)

- **Estado:** Aceptada
- **Fecha:** 2026-09-22

## Contexto

La primera versión de `GET /api/sedes/:sede/cola` devolvía **la cola completa** en cada refresco. En la prueba de estrés (`perf/scripts/estres.js`, resultados en `perf/resultados/estres-v1-sin-limite-*`) pasó esto:

- con unas 1.500 solicitudes acumuladas el p95 de la cola era de 13 ms, y con ≈2.600 (≈108 solicitudes/s) ya era de 227 ms;
- en la ventana siguiente saltó a **1.650 ms**, y el throughput empezó a **caer** en vez de subir;
- al final las peticiones expiraron (60 s) y falló el **4,5 %**;
- se transfirieron **2,4 GB** de respuesta en 2,5 minutos.

La causa: cada refresco de pantalla serializaba miles de filas a JSON en el único hilo de Node, y eso bloqueaba también la creación de solicitudes.

## Decisión

La consulta devuelve `{ total, items }`, donde `items` son solo las primeras `limite` solicitudes (50 por defecto, máximo 500, validado en el adaptador HTTP). `ColaPrioridad.aListaOrdenada(limite)` extrae solo k elementos del montículo, en O(k log n) en vez de ordenar todo.

## Consecuencias (medidas con la misma prueba de estrés, ver [pruebas.md](../pruebas.md) §4)

Fuentes: `perf/resultados/estres-v1-sin-limite-*` (antes) y `perf/resultados/estres-v2-antes-prototipo-*` (después): `data_received`, `http_reqs` y `http_req_failed` del `-resumen.json`, y las ventanas de 10 s del `-ventanas.md`.

| Métrica | Antes (v1) | Después (v2) | Cambio |
|---|---|---|---|
| Datos transferidos | 2,4 GB | **66 MB** | −97 % |
| Punto de quiebre (ventana de 10 s con más solicitudes/s; en la siguiente el p95 ya pasa el SLO) | ≈108 sol/s, ≈2.600 acumuladas | **≈140 sol/s, ≈4.000 acumuladas** | +30 % de tasa, +55 % de volumen |
| Peticiones completadas | 12.691 | **14.119** | +11 % |
| Tasa de error total | 4,50 % | 3,64 % | Mejora poco |

- **+** Mucho menos dato por petición, y el sistema aguanta más antes de degradarse.
- **−** **No elimina** el cuello de botella: cada consulta sigue leyendo **todas** las pendientes de SQLite y armando el montículo (O(n)), y el panel admin lee todas las solicitudes del día. Pasado el quiebre, las peticiones se encolan en el hilo de Node y terminan en timeout igual que antes. La siguiente mitigación sería mantener la cola en memoria y actualizarla con los eventos de dominio, o calcular la prioridad en SQL con `ORDER BY … LIMIT`.
- **−** La pantalla muestra solo las primeras 50 (más el total). Para ver más hay que pedir `?limite=`.
