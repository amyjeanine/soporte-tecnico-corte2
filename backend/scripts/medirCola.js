/**
 * Microbenchmark de la consulta de la cola (docs/pruebas.md §4.5).
 *
 * Reproduce la medición que explicó la regresión del estrés v3: con N solicitudes abiertas,
 * cuánto tarda cada paso de `listarAbiertas`, y cuánto cuesta el constructor genérico de
 * `Solicitud` (el de la versión lenta) frente al actual, que asigna campo por campo.
 *
 * Uso (desde backend/):  npm run medir:cola          → escribe perf/resultados/micro-cola.txt
 *                        node scripts/medirCola.js 4000 15
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { abrirBaseDatos } = require('../src/adapters/out/persistence/sqlite/baseDatos');
const { RepositorioSolicitudesSqlite } = require('../src/adapters/out/persistence/sqlite/repositorios');
const { Solicitud } = require('../src/domain/modelo/Solicitud');
const { EstadoSolicitud, TipoSolicitud } = require('../src/domain/modelo/enums');

const N = Number(process.argv[2] ?? 4000);
const REPETICIONES = Number(process.argv[3] ?? 15);

/** Constructor genérico de la versión lenta (estrés v3): copia valores por defecto y filtra los undefined. */
const POR_DEFECTO = {
  codigoEquipo: null, descripcionEquipo: null, detalle: null, datos: {}, claseEnCurso: false,
  estado: EstadoSolicitud.PENDIENTE, tecnicoId: null, creadaPor: null, programadaPara: null,
  activadaEn: null, asignadaEn: null, resueltaEn: null, escaladaEn: null, motivoEscalacion: null,
};
class SolicitudGenerica {
  constructor(c) {
    const definidos = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined));
    Object.assign(this, { ...POR_DEFECTO, ...definidos, claseEnCurso: Boolean(definidos.claseEnCurso) });
  }
}

const mediana = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
};

function medir(fn) {
  fn(); // calentamiento
  const tiempos = [];
  for (let i = 0; i < REPETICIONES; i += 1) {
    const t0 = performance.now();
    fn();
    tiempos.push(performance.now() - t0);
  }
  return mediana(tiempos);
}

const db = abrirBaseDatos(':memory:');
const repo = new RepositorioSolicitudesSqlite(db);
const ahora = Date.now();
db.exec('BEGIN');
for (let i = 0; i < N; i += 1) {
  repo.guardar(new Solicitud({
    id: `micro-${i}`, salon: `${100 + (i % 50)}`, edificio: 'Edificio K', sede: 'CAMPUS',
    tipo: i % 10 < 7 ? TipoSolicitud.FALLA_EQUIPO_FIJO : TipoSolicitud.PRESTAMO_EQUIPO,
    detalle: 'No proyecta imagen', datos: { cantidad: 1 }, claseEnCurso: i % 5 < 3, creadaEn: ahora - i * 1000,
  }));
}
db.exec('COMMIT');

const sentencia = db.prepare("SELECT * FROM solicitudes WHERE estado <> 'RESUELTA' AND sede = ? ORDER BY creada_en");
const filas = sentencia.all('CAMPUS');
const comoCampos = (f) => ({
  id: f.id, codigoEquipo: f.codigo_equipo ?? undefined, salon: f.salon, edificio: f.edificio, sede: f.sede,
  tipo: f.tipo, detalle: f.detalle, datos: JSON.parse(f.datos || '{}'), claseEnCurso: f.clase_en_curso === 1,
  estado: f.estado, creadaEn: f.creada_en,
});
const campos = filas.map(comoCampos);

const r = {
  select: medir(() => sentencia.all('CAMPUS')),
  selectJson: medir(() => sentencia.all('CAMPUS').forEach((f) => JSON.parse(f.datos || '{}'))),
  listarAbiertas: medir(() => repo.listarAbiertas({ sede: 'CAMPUS' })),
  listarAbiertasGenerico: medir(() => sentencia.all('CAMPUS').map((fila) => new SolicitudGenerica(comoCampos(fila)))),
  constructorActual: medir(() => campos.map((c) => new Solicitud(c))),
  constructorGenerico: medir(() => campos.map((c) => new SolicitudGenerica(c))),
};

const f = (ms) => `${ms.toFixed(1)} ms`;
const salida = [
  `Microbenchmark de la consulta de la cola · ${new Date().toISOString()}`,
  `Node ${process.version} · ${os.cpus()[0]?.model ?? 'CPU desconocida'} · ${N} solicitudes abiertas · mediana de ${REPETICIONES} repeticiones`,
  '',
  `Solo el SELECT en SQLite ............................ ${f(r.select)}`,
  `SELECT + leer el JSON de "datos" .................... ${f(r.selectJson)}`,
  `listarAbiertas completo (crea una Solicitud por fila)  ${f(r.listarAbiertas)}`,
  `Lo mismo con el constructor genérico (versión v3) .... ${f(r.listarAbiertasGenerico)}`,
  '',
  `Crear ${N} entidades, constructor actual (campo a campo) .. ${f(r.constructorActual)}`,
  `Crear ${N} entidades, constructor genérico (versión v3) ... ${f(r.constructorGenerico)}`,
  `El genérico es ${(r.constructorGenerico / r.constructorActual).toFixed(0)} veces más lento`,
  '',
].join('\n');

process.stdout.write(salida);
const destino = path.join(__dirname, '..', '..', 'perf', 'resultados', 'micro-cola.txt');
fs.writeFileSync(destino, salida);
process.stdout.write(`\nGuardado en ${path.relative(process.cwd(), destino)}\n`);
