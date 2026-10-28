# ADR-007: Llevar el módulo del Corte 1 de Java a Node.js conservando su diseño

- **Estado:** Aceptada
- **Fecha de la decisión:** al empezar el Corte 2
- **Fecha de registro:** 2026-10-27

En la entrega del Corte 2 esta decisión solo aparecía como "restricción del equipo: todo en JS / Expo", sin alternativas y sin decir qué costaba. La registramos ahora por la retroalimentación del profesor. El contenido describe lo que se hizo; no se cambió código.

## Contexto

En el Corte 1 entregamos un **módulo de asignación en Java** (`corte1-java/`, 18 archivos, 928 líneas). Funcionaba solo en memoria, se probaba con escenarios de consola en `Main.java` y usaba cuatro patrones: Singleton, State, Decorator y Chain of Responsibility.

Los retos del Corte 2 le piden a ese módulo cosas que no tenía:

| Reto | Qué hacía falta |
|---|---|
| Reservar mediante QR / QR asociado al PC | Una app con cámara, para Android y web, y un registro persistente de equipos |
| Reporte en tiempo real | Un canal que empuje los cambios a las pantallas |
| Cola de prioridades | Una cola que sobreviva a un reinicio y no deje solicitudes esperando para siempre |
| Multisede | Separar técnicos, colas y búsquedas por sede |
| Enfoque administrativo / pantalla del trabajador | Roles, inicio de sesión y pantallas distintas sobre las mismas reglas |
| Implementar pruebas | Pruebas automáticas, que el Corte 1 no tenía |

La app la hicimos en **Expo**: es la que conecta con nuestro prototipo de Figma AsisTec, da cámara y genera Android y web desde el mismo código. Eso dejaba la pregunta de qué hacer con el backend.

## Opciones

| Opción | A favor | En contra |
|---|---|---|
| **A. Seguir en Java** y agregarle un servidor (Spring Boot o Javalin) que la app Expo consuma | Se conserva el código del Corte 1 tal cual; el compilador sigue revisando interfaces y tipos; el `synchronized` sigue sirviendo dentro de un proceso | Dos lenguajes, dos herramientas de compilación y dos marcos de pruebas (JUnit y Jest) para un equipo de 4; los modelos (Solicitud, estados, roles) se escriben dos veces, uno en Java y otro en TypeScript para la app |
| **B. Pasar a Node.js clase por clase**, conservando nombres, patrones y responsabilidades del Corte 1 | Un solo lenguaje para backend, app y pruebas (incluidas las de navegador y las de carga); Socket.IO y el SQLite de Node no exigen instalar nada más en Windows | Hay que reescribir todo lo del Corte 1 y volver a demostrar que se comporta igual |
| C. Empezar de cero en Node con un diseño nuevo | Libertad total | Se pierde lo que se aprendió en el Corte 1 y no habría forma de mostrar la evolución |

## Decisión

Opción **B**, con una regla: **lo del Corte 1 se traslada con el mismo nombre y el mismo patrón, y solo cambia lo que algún reto obliga a cambiar.** Cada cambio queda escrito en la tabla de abajo y, cuando fue grande, en su propio ADR. El código Java sigue en `corte1-java/` para poder comparar.

## Qué nos costó

1. **Reescribir el Corte 1 completo.** Ninguna línea de Java corre en el Corte 2. Las 18 clases se pasaron a `backend/src/domain/`, y ese tiempo no se pudo dedicar a los retos.
2. **Perdimos el compilador como red de seguridad.** En Java, si una clase no cumplía una interfaz, no compilaba. En JavaScript los puertos son comentarios JSDoc más una verificación al arrancar (`verificarPuerto` en `backend/src/ports/puertos.js`). Un error de tipos ahora aparece al ejecutar, no al compilar. Lo compensamos con pruebas: las unitarias cubren el 98,5 % de las líneas del núcleo.
3. **El Singleton con `synchronized` no se podía trasladar.** Node tiene un solo hilo y la consistencia ahora depende de la base de datos. Hubo que rediseñar la asignación concurrente con bloqueo optimista ([ADR-002](ADR-002-concurrencia-bloqueo-optimista.md)).
4. **Un solo proceso de Node limita la escala.** La prueba de estrés lo midió: el sistema se quiebra hacia las 140 solicitudes/s ([ADR-004](ADR-004-limite-en-consulta-de-cola.md), [pruebas.md §4](../pruebas.md)). Para el uso real de la universidad sobra, pero con Java multihilo el límite habría estado en otro lugar.
5. **Hubo que volver a probar todo.** El Corte 1 se validaba con escenarios en consola. El comportamiento heredado (estados del técnico, búsqueda con cercanía, escalación) se volvió a demostrar con pruebas nuevas: `Tecnico.test.js`, `Asignacion.test.js` y `CasosDeUso.test.js`.
6. **Se rompió la continuidad del historial.** La evolución no se ve como cambios sobre el mismo código, sino como un código nuevo. Por eso existe la tabla de trazabilidad de abajo.

## Trazabilidad: cada pieza del Corte 1 y el reto al que responde

| Corte 1 (Java) | Corte 2 (Node) | Qué cambió y por qué | Reto |
|---|---|---|---|
| `modelo/Solicitud.java` (id, salón, edificio, tipo, estado, técnico) | `domain/modelo/Solicitud.js` | Se agregaron sede, código del equipo, marcas de tiempo y fecha agendada | QR asociado al PC · Multisede · Cola de prioridades |
| `modelo/EstadoSolicitud.java`, `TipoSolicitud.java` | `domain/modelo/enums.js` | Se conservan PENDIENTE, ASIGNADA, ESCALADA y RESUELTA; se agregaron `PROGRAMADA` y `EN_ATENCION`, los 5 tipos de servicio del prototipo (antes solo había falla y préstamo) y los roles | Enfoque administrativo · prototipo ([ADR-006](ADR-006-solicitudes-agendadas.md)) |
| `asignacion/GestorAsignaciones.java` (Singleton `synchronized`) | `domain/asignacion/GestorAsignaciones.js` | Deja de ser Singleton: una instancia inyectada y bloqueo optimista. Ahora usa la cola de prioridades | Cola de prioridades · Tiempo real ([ADR-002](ADR-002-concurrencia-bloqueo-optimista.md)) |
| `busqueda/BusquedaPorEdificio.java`, `MapaCercania.java`, `FallbackDecorator.java` | `domain/busqueda/busqueda.js` (`BusquedaPorEdificio`, `MapaCercania`, `FallbackCercaniaDecorator`) | Igual que antes, más un segundo decorador, `CualquieraDeLaSedeDecorator`, que nunca sale de la sede | Multisede |
| `tecnicos/Tecnico.java` y los estados `Disponible`, `Asignado`, `EnCamino`, `Ocupado` | `domain/tecnicos/Tecnico.js`, `domain/tecnicos/estados.js` | Mismo State, sin cambios de diseño. Se agregó `estadoDesdeNombre` para cargarlo desde la base de datos | Pantalla del trabajador |
| `escalacion/*Handler.java` (los 3 handlers imprimían en consola) | `domain/escalacion/cadena.js` + `application/EscalarVencidas.js` + `adapters/in/scheduler/ProgramadorEscalacion.js` | Los mismos 3 handlers, que ahora devuelven un resultado. Un temporizador los dispara solo, como el Corte 1 dejó pendiente | Enfoque administrativo (escaladas en el panel) |
| `Main.java` (escenarios de consola) | Adaptadores de entrada: API HTTP, Socket.IO y programador | La consola se reemplaza por entradas reales sobre los mismos casos de uso | QR · Tiempo real |
| — | `domain/modelo/CodigoQR.js` | Nuevo: el QR solo lleva el código del equipo | QR asociado al PC |
| — | `domain/modelo/FabricaSolicitudes.js` (Factory Method) | Nuevo: reglas propias por tipo de servicio | Reservar mediante QR |
| — | `domain/prioridad/ColaPrioridad.js`, `politicas.js` (Strategy) | Nuevo: montículo con envejecimiento | Cola de prioridades ([ADR-003](ADR-003-tiempo-real-y-cola.md)) |

Los nombres de las clases son los mismos del Corte 1, así que un archivo Java se puede comparar directamente con su equivalente en JavaScript.

## Consecuencias

- El diseño del Corte 1 sigue siendo el centro del sistema: los cuatro patrones se conservan (el Singleton, retirado y reemplazado como explica el ADR-002) y los retos se resolvieron agregando piezas alrededor.
- `backend/tests/unit/arquitectura.test.js` verifica que el dominio no dependa de la infraestructura, y las pruebas unitarias del dominio demuestran que el comportamiento heredado se mantiene.
- **Lo que haríamos distinto:** registrar este ADR en el momento de la decisión, con su costo, en lugar de dejarlo como una restricción del equipo.
