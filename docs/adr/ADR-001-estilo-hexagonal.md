# ADR-001 — Estilo arquitectónico: hexagonal (puertos y adaptadores) con cliente móvil

- **Estado:** Aceptada
- **Fecha:** 2026-09-22
- **Decisores:** María José Almanza, Pablo Tamayo, Amy Nossa, Simón Martínez

## Contexto

En el Corte 1 construimos solo el módulo de asignación, en Java, sin interfaz, sin base de datos y sin red. Los retos del Corte 1 nos obligan a meter al sistema cosas que antes no tenía:

| Reto | Qué le exige a la arquitectura |
|---|---|
| Reservar mediante QR / QR asociado al PC | Una app móvil con cámara (entrada nueva) y un registro persistente de equipos |
| Reporte en tiempo real, cola de prioridades | Un canal de salida que empuje eventos a los clientes, y una cola que no se pierda si el servidor se reinicia |
| Multisede | Separar datos y búsquedas por sede |
| Enfoque administrativo | Roles y consultas agregadas |
| Pantalla del trabajador | Otra interfaz sobre las mismas reglas del técnico (State del Corte 1) |
| Pruebas | Poder probar las reglas de negocio sin base de datos ni red |
| Pasar el Corte 1 a JS / Expo ([ADR-007](ADR-007-migracion-java-a-node.md)) | Backend en Node.js y app en Expo, conservando las clases y patrones del Corte 1 |

La lógica del Corte 1 (State, Chain of Responsibility, Decorator) funciona y queremos conservarla. El riesgo es que, al agregar Express, Socket.IO, SQLite y la app, esas reglas terminen mezcladas con código de infraestructura y dejen de poder probarse aisladas.

## Opciones consideradas

Comparamos cuatro estilos con criterios que salen directamente de los retos. Puntaje de 1 (malo) a 3 (bueno) para **nuestro** tamaño: 4 personas, un semestre, un servidor.

| Criterio (reto que lo origina) | Capas (N-tier) | **Hexagonal** | Microservicios | Event-driven puro |
|---|---|---|---|---|
| Probar reglas sin BD ni red (Pruebas) | 2: el servicio suele importar el repositorio concreto | **3: el núcleo solo conoce puertos** | 2: cada servicio sí, pero el flujo completo exige levantar varios | 2: probar flujos asíncronos es más difícil |
| Agregar entradas nuevas: app, QR, temporizador (QR, Pantalla del trabajador) | 2 | **3: cada entrada es un adaptador más** | 3 | 2 |
| Cambiar el canal de tiempo real sin tocar reglas (Tiempo real) | 1: la capa de negocio termina llamando a Socket.IO | **3: puerto `PublicadorEventos`** | 3 | 3 |
| Consistencia al asignar técnicos (heredado del Corte 1) | 3 | **3** | 1: asignación distribuida, se necesitan sagas o locks distribuidos | 1: consistencia eventual |
| Multisede | 2 | **2: filtro por sede en dominio y repositorio** | 3: un servicio por sede | 2 |
| Costo de operar y desplegar para 4 estudiantes | 3 | **3: un solo proceso** | 1: varios procesos, red, observabilidad | 2: necesita broker (RabbitMQ/Kafka) |
| **Total** | 13 | **17** | 13 | 12 |

- **Capas:** simple y conocida, pero en la práctica la capa de negocio importa el repositorio y el socket concretos. Eso rompe justo lo que el reto de pruebas nos pide.
- **Microservicios:** a primera vista encaja con "multisede". Pero dos sedes y cuatro técnicos no justifican varios servicios, y perderíamos la asignación atómica que ya resolvimos en el Corte 1. El enunciado lo dice explícitamente: elegirlos para un módulo pequeño sin un reto que los justifique es mala decisión.
- **Event-driven puro:** encaja con el tiempo real, pero obliga a montar un broker y a aceptar consistencia eventual justo en la asignación, donde no la queremos. Lo que sí tomamos de este estilo son los **eventos de dominio** publicados por un puerto, sin broker externo.

## Decisión

Adoptamos **arquitectura hexagonal (puertos y adaptadores)** en el backend (Node.js), con la **app Expo como cliente** (cliente-servidor sobre HTTP + WebSocket).

```
backend/src/
├── domain/        ← reglas puras: Solicitud, Tecnico (State), ColaPrioridad, políticas (Strategy),
│                    búsqueda (Decorator), escalación (Chain), FabricaSolicitudes (Factory Method)
├── application/   ← casos de uso: CrearSolicitud, AtenderSolicitud, AsignarManualmente, ActivarProgramadas,
│                    EscalarVencidas, Consultas, Autenticar (+ NotificacionesDocente, ADR-005)
├── ports/         ← contratos que el núcleo necesita (repositorios, publicador, reloj, credenciales)
├── adapters/
│   ├── in/        ← http (Express), realtime (Socket.IO), scheduler (temporizador de escalación)
│   └── out/       ← persistence/sqlite, realtime (publicador Socket.IO), seguridad (JWT), reloj
└── config/        ← raíz de composición: el único lugar que conecta adaptadores con puertos
```

**Regla de dependencia:** `domain` y `application` no importan nada de `adapters`, `config` ni librerías de infraestructura. La prueba automática `tests/unit/arquitectura.test.js` lo verifica, así que si alguien rompe la regla, `npm test` falla.

## Consecuencias

**Positivas (qué ganamos)**
- **Testabilidad:** 192 pruebas unitarias corren en unos segundos sin BD ni red, usando fakes y un reloj falso. El aging de la cola y la escalación a los 5 minutos se prueban sin esperar.
- **Modificabilidad:** cambiar Socket.IO por notificaciones push, o SQLite por PostgreSQL, es escribir un adaptador nuevo. El dominio no se toca.
- **Entradas múltiples sobre las mismas reglas:** la app (HTTP), el temporizador de escalación y las pruebas llaman a los mismos casos de uso.
- **Lo comprobamos al conectar el prototipo de Figma:** los servicios nuevos (préstamo agendado, mantenimiento, eventos, falla eléctrica, avisos) entraron como creadores de la fábrica, casos de uso y un decorador; el dominio del Corte 1 y los adaptadores existentes casi no cambiaron.
- **Se conserva el Corte 1:** State, Chain y Decorator pasaron casi intactos al dominio.

**Negativas (qué sacrificamos)**
- **Más archivos e indirección:** hay puertos, adaptadores y raíz de composición. Una funcionalidad pequeña toca 3 o 4 archivos.
- **JavaScript no tiene interfaces:** los puertos son documentación JSDoc más una verificación al arrancar (`verificarPuerto`), no un contrato del compilador.
- **Un solo proceso:** la escalabilidad horizontal no es gratis. La prueba de estrés mostró el límite (ver [pruebas.md](../pruebas.md) §4), y escalar a varias instancias exige cambiar SQLite por una BD de servidor (ver ADR-002).
- **Los repositorios son síncronos** porque el SQLite que trae Node (`node:sqlite`) lo es. Si se cambia a PostgreSQL, habrá que volver asíncronos los puertos. Elegimos `node:sqlite` en vez de `better-sqlite3` porque este último se compila al instalar y en Windows exige Visual Studio.

## Atributos de calidad

| Mejora | Sacrifica |
|---|---|
| Testabilidad, mantenibilidad/modificabilidad, consistencia en la asignación | Simplicidad (más piezas), escalabilidad horizontal inmediata |
