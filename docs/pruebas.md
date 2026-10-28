# Estrategia y resultados de pruebas

Todas las pruebas del backend se corren desde `backend/`:

| Qué | Comando | Tiempo aprox. |
|---|---|---|
| Todo (unitarias + integración + sistema) | `npm test` | 20 s |
| Solo unitarias | `npm run test:unit` | 2 s |
| Solo integración y sistema | `npm run test:integration` | 18 s |
| Con reporte de cobertura (HTML en `backend/coverage/`) | `npm run test:coverage` | 20 s |
| Regenerar la evidencia (`docs/evidencias/*.md`) desde una sola ejecución | `npm run evidencia` | 1 min |
| **Lista de chequeo por reto** (corre todo y marca ✓ cada prueba de cada reto) | `npm run retos` | 1 min |
| **De punta a punta en el navegador** (desde `e2e/`; la primera vez `npm install` y `npm run preparar`) | `npm test` | 10 s |
| Carga (desde la raíz, requiere k6) | `bash perf/correr.sh baseline` · `pico` · `estres` | 1–2 min c/u |

**Resultado actual: 278 de 278 pruebas de Jest pasan, y 7 de 7 en el navegador (Playwright).** La lista completa está en [evidencias/resultados-pruebas.md](evidencias/resultados-pruebas.md), hay un reporte navegable en [evidencias/reporte-pruebas.html](evidencias/reporte-pruebas.html) (`npm run test:reporte`), y **la prueba de cada reto, con su código y su salida**, está en [evidencias/evidencia-por-reto.md](evidencias/evidencia-por-reto.md).

Además de las pruebas, el código pasa por un **escaneo** (análisis estático + seguridad + dependencias) con `npm run escaneo`. Ver §6.

## 1. Estrategia: qué se prueba en cada nivel y por qué

```
                 ┌──────────────┐
                 │  Carga (k6)  │  3 escenarios: ¿aguanta el pico de inicio de clases?
                 ├──────────────┤
                 │ Sistema (1)  │  historia completa solo por HTTP (caja negra)
              ┌──┴──────────────┴──┐
              │  Integración (60)  │  fronteras del hexágono con infraestructura REAL
           ┌──┴────────────────────┴──┐
           │     Unitarias (208)      │  dominio + casos de uso, sin BD ni red
           └──────────────────────────┘
```

La forma de la pirámide sale del estilo elegido. En hexagonal **las reglas de negocio viven en el núcleo**, así que la mayoría de las pruebas van ahí, rápidas y aisladas. Las de integración se concentran en **las fronteras que el estilo define** (cada adaptador contra su puerto). La prueba de sistema confirma que todo junto resuelve los retos.

| Nivel | Frontera del estilo que cubre | Infraestructura | Herramientas |
|---|---|---|---|
| Unitarias | Dominio y aplicación (dentro del hexágono) | Ninguna: fakes, espías y reloj falso | Jest |
| Arquitectura | Regla de dependencia (núcleo → nada de afuera) | Lee los `require` del código | Jest + fs |
| Integración: escaneo de QR | Imagen QR impresa → decodificador (jsQR) → API → casos de uso → SQLite | PNG reales generados por el sistema | Jest + jsQR + pngjs |
| Integración: persistencia | Puerto `Repositorio*` ↔ adaptador SQLite | SQLite real en memoria (el equivalente a H2) | Jest + `node:sqlite` |
| Integración: API | Adaptador HTTP ↔ casos de uso ↔ SQLite | Express + SQLite reales | Jest + Supertest |
| Integración: tiempo real | Productor (caso de uso) ↔ consumidor (cliente Socket.IO) | Servidor HTTP y sockets reales en un puerto libre | Jest + socket.io-client |
| Sistema (caja negra) | Toda la API pública | Igual que en producción | Jest + Supertest |
| De punta a punta (app) | La app web real → backend real, como la usa una persona | Chromium con cámara falsa que transmite un QR impreso; backend con BD temporal | Playwright + Page Object Model |
| Carga | Sistema desplegado | Servidor real con BD en archivo | k6 |

**Aislamiento:** cada prueba de integración crea su propia BD `:memory:` con `crearEntorno()` (`tests/integration/entorno.js`), así que no dependen del orden ni comparten datos. El tiempo se controla con un reloj inyectado (puerto `Reloj`). Por eso "esperar 5 minutos a que escale" toma 0 ms.

## 2. Pruebas unitarias (208)

Archivos en `backend/tests/unit/`. Todas siguen **AAA** (Arrange, Act, Assert). En las más largas está marcado con comentarios, y en las cortas se nota por los bloques separados por una línea en blanco.

### 2.1 Clases de equivalencia y valores límite

| Regla (reto) | Clases de equivalencia | Valores límite probados | Archivo |
|---|---|---|---|
| Formato del QR (QR asociado al PC) | válido · vacío/nulo/no texto · de otro sistema · versión no soportada · caracteres prohibidos (incluye un intento de inyección SQL, guiones al final o dobles) | longitud del código 4 ✗, **5 ✓**, **40 ✓**, 41 ✗ | `dominio/CodigoQR.test.js` |
| Creación por tipo (Reservar mediante QR) | falla · préstamo válido · préstamo sin elemento · tipo desconocido | descripción de 200 ✓ / 201 ✗ caracteres | `dominio/FabricaSolicitudes.test.js` |
| Servicios del prototipo (pantallas 3c, 12, 13, 14) | préstamo ahora / agendado · falla por salón sin equipo (✗) · mantenimiento y evento sin fecha (✗) · falla agendada (✗) · chips fuera de la lista (✗) · software sin decir cuál (✗) | cantidad **0 ✗, 1 ✓, 10 ✓, 11 ✗**, 2,5 ✗; fecha en el pasado ✗, **justo ahora ✗**, **a 90 días ✓**, a 90 días + 1 h ✗ | `dominio/ServiciosPrototipo.test.js` |
| Agenda → cola (ADR-006) | agendada con técnico libre · sin técnicos | activación a los **29 ✗ / 30 ✓** min antes; la espera cuenta desde la activación (9 min no escala) | `aplicacion/CasosDeUsoPrototipo.test.js` |
| "Hoy" del panel del coordinador | resuelta antes / después de la medianoche | 11:50 p. m. cuenta, **12:10 a. m.** del día siguiente ya no (hora de Bogotá, UTC−5) | `aplicacion/CasosDeUsoPrototipo.test.js` |
| Transiciones del técnico (Pantalla del trabajador) | 4 transiciones válidas · 12 inválidas (cada estado × acción no permitida) | — | `dominio/Tecnico.test.js` |
| Prioridad con envejecimiento (Cola de prioridades) | 4 combinaciones tipo × clase en curso | espera de 0, 1, **59, 60**, 61 y 600 min (el tope es 60) | `dominio/Prioridad.test.js` |
| Minutos de espera | normal · reloj desfasado | 59.999 ms → 0 min, **60.000 ms → 1 min**, −5.000 ms → 0 | `dominio/Tecnico.test.js` |
| Escalación por tiempo (Tiempo real) | asignada sin aceptar · pendiente sin técnico · ya aceptada | sin respuesta a los **4 ✗ / 5 ✓** min; en cola a los **9 ✗ / 10 ✓** min; el motivo queda guardado para el coordinador | `aplicacion/CasosDeUso.test.js`, `aplicacion/CasosDeUsoPrototipo.test.js` |
| Multisede | misma sede · otra sede · asignación manual del coordinador | único técnico libre es de otra sede → no se asigna solo; el coordinador sí puede mandarlo | `dominio/Asignacion.test.js`, `aplicacion/CasosDeUsoPrototipo.test.js` |
| Límite de la cola (ADR-004) | límite menor, igual o mayor que la cola | `limite` = 1, = total, > total | `aplicacion/CasosDeUso.test.js` |

### 2.2 Dobles de prueba

| Doble | Tipo | Dónde | Para qué |
|---|---|---|---|
| `RepoSolicitudesFake`, `RepoTecnicosFake`, `RepoEquiposFake`, `RepoNotificacionesFake` | **Fake** (implementación en memoria del puerto) | `tests/dobles/fakes.js` | Probar casos de uso sin SQLite |
| `RelojFalso` | **Fake** controlable | `tests/dobles/fakes.js` | Avanzar minutos para el aging y la escalación |
| `publicador = { publicar: jest.fn() }` | **Espía** (mock) | `CasosDeUso.test.js` | Verificar QUÉ evento se publicó y A QUIÉN (salas) |
| `busquedaStub`, `generadorId`, `politicaFija` | **Stub** | `Asignacion.test.js`, `FabricaSolicitudes.test.js`, `Prioridad.test.js` | Fijar respuestas y aislar una sola regla |
| `jest.spyOn(repoEquipos, 'buscarPorCodigo')` | **Espía** | `CasosDeUso.test.js` | Comprobar que un QR inválido se rechaza sin tocar el repositorio |
| Espía **detrás** del decorador `NotificacionesDocente` | **Espía** | `CasosDeUsoPrototipo.test.js` | Ver a la vez los eventos que salen (con la sala `usuario:`) y los avisos guardados |
| `repoNotificaciones.guardar = () => { throw … }` | **Stub** que falla | `CasosDeUsoPrototipo.test.js` | Probar que si el aviso no se guarda, la solicitud igual queda creada |

### 2.3 Cobertura del dominio

Solo con las pruebas unitarias (`npx jest tests/unit --coverage`), sobre `src/domain` y `src/application`:

| Métrica | Resultado | Umbral configurado en `package.json` |
|---|---|---|
| Líneas | **98,6 %** | 85 % |
| Ramas | **91,2 %** | 75 % |
| Funciones | 96,4 % | — |
| Sentencias | 98,6 % | — |

Tabla por archivo al final de [evidencias/resultados-pruebas.md](evidencias/resultados-pruebas.md). Las ramas sin cubrir son sobre todo valores por defecto de parámetros y textos alternativos de las vistas, no reglas de negocio.

## 3. Pruebas de integración (69) y de sistema (1)

| Archivo | Frontera | Qué demuestra |
|---|---|---|
| **`escaneoQR.int.test.js` (16)** | **Imagen del QR → lector → API** | **El reto del QR probado como lo vive el docente.** Se toma la imagen PNG que se imprime, se lee con un decodificador de QR (jsQR, que hace lo mismo que la cámara) y lo leído se envía a la API. Casos: se escanea el QR del video beam, la app muestra **qué le puede pasar a ese equipo**, la docente elige "No proyecta imagen" y la solicitud se crea y se asigna a Laura con ese problema; las opciones de un video beam y de un PC son distintas; un problema que no es de ese equipo, uno inventado o un "Otro problema" sin describir se rechazan (400);  reservar un portátil con el QR del PC; **los 61 QR impresos se leen y cada uno apunta a su equipo**; un QR pequeño (120 px) se lee; un QR de un enlace web se lee pero la API responde 400; un equipo inexistente da 404 y no crea nada; un QR con la ubicación "escrita a mano" se rechaza; **un sticker con el 10 % rayado se sigue leyendo con corrección H pero no con M** (por eso se imprimen en H); con el 30 % rayado no se lee. Al regenerar los QR del Corte 2 medimos el rayón del 10 % sobre los 61: **se leen 59**. Los 2 que no, se cubren con la búsqueda manual de la pantalla 3a |
| `persistencia.int.test.js` (5) | Repositorio ↔ SQLite | El técnico se guarda y se rehidrata con su **estado** (State). **Bloqueo optimista:** dos lectores de la misma versión y el segundo recibe `ConflictoConcurrencia`. La transacción revierte todo si falla. La BD rechaza un equipo inexistente (llave foránea) |
| `api.int.test.js` (23) | HTTP ↔ casos de uso ↔ SQLite | Roles: 401 sin token, 403 con rol equivocado. QR válido 201, inválido 400, equipo inexistente 404. Multisede: una sede saturada no toma técnicos de otra. Panel admin con déficit. Cola con límite. Escalación por tiempo, manual y con el `ProgramadorEscalacion` |
| `tiempoReal.int.test.js` (4) | Caso de uso (productor) ↔ cliente Socket.IO (consumidor) | El técnico recibe `solicitud:asignada` en vivo. El admin ve creación y cambio de estado. **Un técnico de otra sede no recibe nada.** Un socket sin token es rechazado |
| **`prototipo.int.test.js` (21)** | App (HTTP) ↔ casos de uso ↔ SQLite, y Socket.IO | **Estudiantes:** una estudiante reserva un PC por QR y solo ella lo ve en "Mis solicitudes"; no entra al panel del coordinador ni a las acciones del técnico (403); la docente no puede abrir el detalle de la solicitud de la estudiante (403). Un caso por pantalla del prototipo: búsqueda manual (ubicaciones → equipos del salón → solicitud), préstamo ahora y agendado (entra a la cola al activarse), mantenimiento / evento en el auditorio / falla eléctrica en un salón que no existe (404), "Mis solicitudes" solo con las propias, notificaciones y marcarlas leídas, "Cancelar" del técnico, panel del coordinador (escalada con motivo → asignar a Andrés, de otra sede). Persistencia de los campos nuevos (JSON, agenda, escalación) y **una BD de la versión anterior se recrea sola**. Con sockets reales: cuando Laura acepta, a la docente le llegan el cambio y el aviso |
| `flujoSistema.e2e.test.js` (1) | **Caja negra**, solo HTTP | Una mañana en el Edificio O (sin carrito): 3 solicitudes se reparten entre Laura (edificio cercano), Miguel (el siguiente cercano) y Sofía (cualquiera de la sede). Otras 2 quedan en cola. Al finalizar, Laura recibe la **urgente** aunque el préstamo llegó antes. El docente ve su posición y el admin ve demanda y déficit |

## 4. Pruebas de carga

Scripts versionados en [`perf/scripts/`](../perf/scripts), resultados crudos en [`perf/resultados/`](../perf/resultados) y el plan completo en [`perf/README.md`](../perf/README.md).

### 4.1 Objetivo (SLO), definido antes de ejecutar

| Métrica | Objetivo | Por qué ese número |
|---|---|---|
| p95 de **crear solicitud** | ≤ 500 ms | El docente escanea y espera la confirmación con la clase detenida; más de medio segundo ya se siente lento |
| p95 de **consultar cola** | ≤ 300 ms | La pantalla del trabajador se refresca con cada evento; tiene que sentirse inmediata |
| Tasa de error | < 1 % | Una solicitud perdida es justo el problema que el sistema viene a resolver |

Escenario ligado al reto **"Reporte en tiempo real, cola de prioridades"** y a **"Multisede"**: al inicio de la jornada muchos salones de ambas sedes reportan a la vez, los técnicos no alcanzan, la cola crece y las pantallas la consultan todo el tiempo.

Entorno: backend en un solo proceso Node.js 22, SQLite en archivo (modo WAL), k6 en la misma máquina (contenedor Linux, 2 vCPU). Mezcla de solicitudes: 70 % fallas y 30 % préstamos; 60 % con clase en curso; equipos al azar de las dos sedes.

Las tres pruebas **se volvieron a correr con la versión final** (la que tiene las pantallas del prototipo, los avisos del docente y la agenda). Los resultados de antes quedan en `perf/resultados/` para comparar.

### 4.2 Resultados

Versión final (con las pantallas del prototipo). **Todas las cifras salen de los archivos de `perf/resultados/`**: p95 y errores de `<prueba>-resumen.json`, peticiones y throughput de `http_reqs`. El resumen de k6 al final de `<prueba>-consola.txt` muestra lo mismo.

| Prueba | Carga | Peticiones | Throughput | p95 crear | p95 cola | Errores | ¿Cumple el SLO? |
|---|---|---|---|---|---|---|---|
| **Baseline** | 2 solicitudes/s + 5 consultas/s, 1 min | 790 | 13 req/s | **7,5 ms** | **5,6 ms** | **0 %** | ✅ |
| **Pico** (inicio de clases) | 2→30 solicitudes/s en 15 s, 1 min sostenido; 20 consultas/s | 4.628 | 50 req/s | **21,8 ms** | **18,6 ms** | **0 %** | ✅ |
| **Estrés** | 10→300 solicitudes/s en 2 min; 50 consultas/s | 14.854 | 108 req/s | 10.912 ms | 34.740 ms | 2,71 % | ❌ (esperado: busca el quiebre) |

Historia del estrés (misma prueba, versiones distintas del código). El **quiebre** es la ventana de 10 s con más solicitudes/s atendidas en `<archivo>-ventanas.md`; a partir de ahí el throughput cae y el p95 supera el SLO. Los errores son `http_req_failed` del `-resumen.json`:

| Versión | Qué cambió | Quiebre | Errores | Archivos |
|---|---|---|---|---|
| v1 | cola completa en cada consulta | ≈108 sol/s | 4,50 % | `estres-v1-sin-limite-*` |
| v2 | cola paginada (ADR-004) | ≈140 sol/s | 3,64 % | `estres-v2-antes-prototipo-*` |
| v3 | pantallas del prototipo, **primera versión** | **≈97 sol/s** ↓ | **6,94 %** | `estres-v3-constructor-lento-*` |
| **final** | v3 con el constructor de `Solicitud` corregido (§4.5) | **≈140 sol/s** | **2,71 %** | `estres-*` |

**Segunda medición en un portátil con Windows** (26/09/2026, con VS Code y Expo abiertos al tiempo): baseline p95 crear 156 ms / cola 25 ms, pico p95 crear 58 ms / cola 50 ms, **0 % errores en ambas**. Más lentos que en la máquina de desarrollo, pero igual muy por debajo del SLO. De esa corrida solo se guardaron las capturas de la consola de k6 ([04-k6-baseline.png](evidencias/windows/04-k6-baseline.png), [05-k6-pico.png](evidencias/windows/05-k6-pico.png)); las cifras se leen ahí. La próxima vez se puede guardar también el JSON con `k6 run --summary-export perf/resultados/windows-pico-resumen.json perf/scripts/pico.js`.

El pico ya es muy exagerado a propósito: 30 solicitudes por segundo durante un minuto son unas 2.300 solicitudes, más que la cantidad de salones de una sede. **Con la carga realista, el sistema va sobrado.** El p95 del pico al crear (21,8 ms) es unas 23 veces menor que el SLO de 500 ms.

En el estrés, k6 no alcanzó a lanzar todas las iteraciones programadas (`dropped_iterations`) porque el servidor ya no respondía a tiempo. Eso también es un síntoma de saturación.

### 4.3 Dónde se rompe (estrés, en ventanas de 10 s)

**v1 (antes de la mitigación)**, ver `perf/resultados/estres-v1-sin-limite-ventanas.md`:

| Segundo | Solicitudes/s atendidas | Solicitudes creadas (acum.) | p95 crear | p95 cola |
|---|---|---|---|---|
| 20–30 | 81 | 1.525 | 15 ms | 13 ms |
| 30–40 | **108** | **2.604** | 273 ms | 227 ms |
| 40–50 | 83 ↓ | 3.435 | **1.483 ms** | **1.650 ms** |
| 90–100 | 49 ↓ | 6.302 | 2.690 ms | 2.674 ms |
| 100–110 | 75 | 6.795 | **60 s (timeout)** | **60 s (timeout)** |

**v2 (con límite en la cola)**, ver `perf/resultados/estres-v2-antes-prototipo-ventanas.md`:

| Segundo | Solicitudes/s atendidas | Solicitudes creadas (acum.) | p95 crear | p95 cola |
|---|---|---|---|---|
| 30–40 | 112 | 2.657 | 28 ms | 27 ms |
| 40–50 | **140** | **4.053** | 298 ms | 242 ms |
| 50–60 | 88 ↓ | 4.934 | **1.230 ms** | **1.790 ms** |
| 100–110 | 52 ↓ | 7.888 | 2.453 ms | 2.447 ms |
| 110–120 | 77 | 8.385 | **60 s (timeout)** | **60 s (timeout)** |

**Versión final**, ver `perf/resultados/estres-ventanas.md`:

| Segundo | Solicitudes/s atendidas | Solicitudes creadas (acum.) | p95 crear | p95 cola |
|---|---|---|---|---|
| 30–40 | 116 | 2.770 | 24 ms | 22 ms |
| 40–50 | **140** | **4.167** | 586 ms | 754 ms |
| 50–60 | 89 ↓ | 5.057 | **1.352 ms** | **1.548 ms** |
| 100–110 | 63 ↓ | 8.401 | 2.584 ms | 2.563 ms |
| 110–120 | 82 | 8.949 | **60 s (timeout)** | **60 s (timeout)** |

### 4.4 Análisis del cuello de botella

**Qué se rompe:** no es la red. Es **el hilo único de Node.js**, ocupado leyendo, recalculando y serializando la cola cada vez que una pantalla la pide.

1. Casi ninguna solicitud se resuelve durante la prueba (hay 4 técnicos), así que la cola crece sin parar: miles de pendientes.
2. Cada `GET /cola` lee **todas** las pendientes de la sede desde SQLite, crea un objeto por fila, arma el montículo de prioridades y, en v1, serializaba **toda** la cola a JSON: megabytes por petición, 2,4 GB en total. El panel admin (20 % de las consultas) además lee todas las solicitudes del día.
3. Mientras el hilo hace eso, las peticiones de crear solicitud esperan en fila. Por eso sube **también** el p95 de crear, aunque crear en sí es barato (mediana de 4,2 ms en el baseline, `baseline-resumen.json`).
4. Pasado el punto de quiebre, el throughput **baja** en vez de mantenerse (v2: de 140/s a 88/s y luego 52/s). El servidor gasta cada vez más tiempo en consultas cada vez más caras hasta que aparecen los timeouts de 60 s.

**Qué hicimos (ADR-004):** paginar la cola a 50 elementos. El resultado medido: datos de 2,4 GB → **66 MB**, quiebre de ≈108 → **≈140 solicitudes/s** (de ≈2.600 a ≈4.000 solicitudes acumuladas). **No bastó para eliminar los timeouts** (4,5 % → 3,6 % de errores; 2,7 % en la versión final): el trabajo O(n) por consulta sigue ahí.

**Qué ofrece la arquitectura para mitigarlo, y qué no:**

| Mitigación | ¿La arquitectura hexagonal la facilita? |
|---|---|
| Paginar la cola (**hecha**) | Sí: un cambio en `Consultas` y en la validación del adaptador HTTP, sin tocar reglas de prioridad |
| Mantener la cola en memoria y actualizarla con los eventos de dominio en vez de recalcularla (**siguiente paso**) | Sí: los casos de uso ya publican cada cambio por el puerto `PublicadorEventos`; bastaría un adaptador que también actualice una caché. Con eso la consulta pasaría de O(n) a O(k) |
| Calcular la prioridad en SQL (`ORDER BY … LIMIT 50`) | Sí, pero duplicaría la regla de prioridad fuera del dominio (la regla vive en `PoliticaImpactoYEspera`). Por eso preferimos la caché |
| Empujar la cola por Socket.IO en vez de que las pantallas la pidan | Sí: ya existe el canal. Hoy la app recarga el panel al recibir cada evento, y mandar el cambio en el mismo evento evitaría la consulta |
| Varias instancias de Node detrás de un balanceador | **A medias:** el bloqueo optimista (ADR-002) ya evita asignaciones dobles entre instancias, pero SQLite es un archivo local. Hay que cambiar el adaptador a PostgreSQL y usar el adaptador de Redis de Socket.IO para compartir las salas |
| Más técnicos | No es un problema de software: el panel admin ya muestra el **déficit por sede** para que coordinación lo decida |

### 4.5 Una regresión que encontró la prueba de carga

Al conectar las pantallas del prototipo volvimos a correr las tres pruebas. Baseline y pico seguían cumpliendo el SLO de sobra, pero el **estrés empeoró**: el quiebre bajó de ≈140 a **≈97 solicitudes/s** y los errores subieron de 3,6 % a **6,9 %** (`estres-v3-constructor-lento-*`).

Para encontrar la causa medimos por separado cada paso de la consulta de la cola con 4.000 solicitudes abiertas. Esa primera medición la hicimos a mano y no quedó guardada, así que la convertimos en un script versionado: `npm run medir:cola` (en `backend/`, archivo `scripts/medirCola.js`). El script reproduce el constructor genérico de la versión lenta y guarda el resultado en [`perf/resultados/micro-cola.txt`](../perf/resultados/micro-cola.txt). Las cifras de esta sección salen de ese archivo (mediana de 15 repeticiones):

| Paso | Tiempo |
|---|---|
| Solo el `SELECT` en SQLite | 9,6 ms |
| `SELECT` + leer el JSON de `datos` | 9,4 ms |
| `listarAbiertas` completo con el constructor actual (campo por campo) | 18,9 ms |
| Lo mismo con el constructor genérico de la versión v3 | **29,8 ms** |

El culpable no era la base de datos ni el JSON nuevo, sino **el constructor de `Solicitud`**. Al agregarle los campos del prototipo lo habíamos escrito de forma genérica (copiar un objeto de valores por defecto y filtrar los `undefined`) para que el escaneo no marcara complejidad alta. Crear 4.000 entidades así toma 11,8 ms, contra 0,4 ms asignando campo por campo (**unas 30 veces más lento**), y eso se ejecuta en cada consulta de la cola.

Lo reescribimos campo por campo (la excepción a la regla de complejidad quedó justificada en el código). `listarAbiertas` bajó de 29,8 a 18,9 ms y el estrés volvió a quebrar en **≈140 solicitudes/s**, con menos errores que antes (2,7 %) aunque ahora cada evento guarda además un aviso para el docente (ADR-005).

**Lección:** una regla de estilo (complejidad ≤ 10) nos empujó a una versión más lenta, y solo la prueba de carga lo mostró; las 253 pruebas funcionales de ese momento pasaban igual. Por eso la dejamos en el plan: se corre de nuevo después de cada cambio grande.

**Conclusión:** para el volumen real de la universidad (decenas de solicitudes por minuto en el peor momento, no cientos por segundo) el sistema cumple el SLO con margen: en el pico, que ya es exagerado, el p95 al crear (21,8 ms) queda unas 23 veces por debajo del límite. El límite aparece entre 100 y 140 solicitudes/s con miles de solicitudes en cola. Lo impone el diseño de "recalcular la cola en cada consulta" dentro de un proceso único, y queda documentado como límite conocido para el Corte 3.

## 5. Pruebas de punta a punta en la app (Playwright) y evaluación de UX

Las pruebas de Jest llegan hasta la API. Faltaba mostrar que **en la app** el QR se lee de verdad, así que agregamos pruebas de punta a punta (7) en [`e2e/`](../e2e). Cada una abre la versión web de la app en Chromium contra un backend real (con BD temporal) y hace lo que haría una persona. Usan **Page Object Model** ([`e2e/paginas/index.js`](../e2e/paginas/index.js)) y aserciones de Playwright.

**Cómo se prueba la cámara sin una persona:** Chromium se abre con una **cámara falsa** que transmite un video. Ese video lo arma [`e2e/camara-falsa.js`](../e2e/camara-falsa.js) a partir del PNG del QR impreso (`docs/qr/CAM-O-301-VB01.png`). La app pide la cámara, la lee con jsQR cada 200 ms, igual que con una cámara real.

| Prueba | Reto | Qué hace | Captura |
|---|---|---|---|
| `qr.spec.js` › la cámara del navegador lee el QR del video beam y la docente dice qué le pasa y reporta la falla | Reservar mediante QR | Docente → "Reportar falla" → la cámara lee `CAM-O-301-VB01` → la app muestra "Salón 301 · Edificio O" (lo dice el backend) → **"¿Qué le pasa al video beam?"**: aparecen las opciones de un video beam y no las de un PC, sin elegir no se puede enviar; elige "No proyecta imagen" y lo describe → confirmación → seguimiento "Técnico asignado" con el problema | [e2e-01](capturas/e2e-01-qr-leido-camara-navegador.png), [e2e-10](capturas/e2e-10-que-le-pasa-al-equipo.png), [e2e-02](capturas/e2e-02-seguimiento-desde-qr.png) |
| `qr.spec.js` › una estudiante sube la foto del QR del PC y reserva un equipo para ese salón | Reservar mediante QR · estudiantes | Estudiante → sube la foto del QR `CAM-K-201-PC01` → "Reservar un equipo para este salón" → el préstamo ya trae "Edificio K, Salón 201" → enviar | [e2e-03](capturas/e2e-03-estudiante-prestamo-desde-qr.png) |
| `qr.spec.js` › un QR que no es del sistema se lee pero se rechaza | QR asociado al PC | Sube un QR con un enlace web → "El QR no pertenece al sistema de soporte." y no aparece el botón de reportar | [e2e-04](capturas/e2e-04-qr-otro-sistema-rechazado.png) |
| `cuentas.spec.js` › cambiando de usuario, cada cuenta llega a su pantalla | Enfoque administrativo | En la misma ventana se entra con Docente, se cierra sesión, luego Estudiante, Técnico y Coordinador. Cada una llega a su pantalla (el perfil dice "Docente" o "Estudiante"; el técnico no tiene la barra de servicios; el coordinador ve "Escaladas hoy") | [e2e-05 a e2e-08](capturas/e2e-05-cuenta-docente.png) |
| `cuentas.spec.js` › escribir la dirección del panel del coordinador no lo abre | Enfoque administrativo | La estudiante escribe `/coordinador` en el navegador: el panel no aparece y se vuelve a pedir inicio de sesión (la app no guarda la sesión en el navegador) | [e2e-09](capturas/e2e-09-direccion-panel-sin-permiso.png) |
| `cuentas.spec.js` › directo a la API, cada cuenta solo puede lo suyo | Enfoque administrativo | Sin pasar por la app: 9 casos con su código esperado (la estudiante ve su solicitud 200, la docente no 403, la estudiante no abre el panel 403, el técnico no crea solicitudes 403, el coordinador sí abre su panel 200, sin sesión 401…). La tabla queda adjunta en el reporte | — |
| `tiempo-real.spec.js` › el técnico del Norte ve aparecer la solicitud sin recargar | Reporte en tiempo real · multisede | Dos navegadores: Andrés (técnico del Norte) con su pantalla abierta; la docente del Norte reporta por QR; a Andrés le aparece "Video Beam · Salón 101 · No enciende" sin recargar (sabe qué revisar), la acepta, y a la docente le cambia a "Técnico en camino · Andrés Pardo" | — |

```bash
cd e2e
npm install
npm run preparar   # compila la app web (apuntando al backend de pruebas) y descarga Chromium
npm test           # levanta backend (puerto 3100) y app (8082) solos; ≈13 s
npm run reporte    # reporte HTML con capturas de cada paso
```

Resultado: **7 de 7 pasan.** El último resultado queda en `e2e/resultados/ultimo.json` y `npm run retos` / `npm run evidencia` lo incluyen junto a las pruebas de Jest.

Aparte, el script [`app/scripts/capturas.js`](../app/scripts/capturas.js) recorre todas las pantallas del prototipo y toma una captura de cada una ([docs/capturas](capturas)); falla si alguna pantalla escribe un error en la consola.

**Limitaciones:** son 7 flujos, no todas las pantallas; se usó Playwright y no Cypress/Selenium; la cámara del celular (expo-camera) no se prueba de forma automática, se probó a mano con Expo Go. **Evaluación de UX (SUS):** no se hizo.

## 6. Escaneo de código

Se corre con `npm run escaneo` desde `backend/`. El reporte completo, con el antes y el después, está en **[evidencias/escaneo-codigo.md](evidencias/escaneo-codigo.md)**.

| Herramienta | Qué revisa | Resultado |
|---|---|---|
| **ESLint** + `@eslint/js` | Errores comunes de programación | 0 hallazgos |
| **eslint-plugin-security** | Patrones inseguros: ReDoS, inyección por prototipo, rutas de archivo con datos externos | 0 hallazgos (21 en el primer escaneo, ver abajo) |
| **eslint-plugin-jest** | Pruebas mal escritas | 0 hallazgos (6 en el primer escaneo) |
| **Reglas del equipo** | Complejidad ≤ 10, anidamiento ≤ 3 y **regla de dependencia hexagonal** | 0 hallazgos |
| **npm audit** | Vulnerabilidades conocidas en dependencias | backend: 0 · app: 14 moderadas heredadas de Expo SDK 57 (riesgo aceptado y justificado) |
| SonarQube / SonarCloud (opcional) | Lo anterior + duplicación y *code smells* en la nube | Configurado en `sonar-project.properties`, falta crear el proyecto en SonarCloud con la cuenta del grupo |

**Lo más importante que encontró el escaneo:** el primer escaneo arrojó 29 hallazgos. Dos eran **defectos reales**: buscar un estado de técnico o un edificio con un nombre como `"toString"` o `"constructor"` devolvía funciones heredadas del prototipo de JavaScript, en vez de fallar. Para cada uno se escribió primero una prueba que lo demostraba (6 pruebas fallando), luego se corrigió el código cambiando objetos por `Map`, y las pruebas pasaron. El resto eran mejoras de calidad o falsos positivos, que quedaron justificados en el código.
