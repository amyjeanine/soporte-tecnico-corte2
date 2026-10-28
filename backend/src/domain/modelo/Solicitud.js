const { EstadoSolicitud } = require('./enums');
const { TransicionInvalida } = require('../errores');

/**
 * Solicitud de soporte creada desde un salón (evoluciona la clase Solicitud del Corte 1).
 * Guarda la ubicación completa (sede → edificio → salón → equipo) para el reto multisede
 * y las marcas de tiempo que usan la cola de prioridades y el panel administrativo.
 *
 *  - `codigoEquipo` solo existe cuando la solicitud es sobre un equipo concreto (QR o búsqueda
 *    manual). Un préstamo, un mantenimiento o un evento se piden para un salón.
 *  - `datos` guarda lo propio de cada tipo (cantidad de equipos, requerimientos del evento...).
 *    Lo valida FabricaSolicitudes.
 *  - `programadaPara` (ms) marca una solicitud agendada: queda PROGRAMADA hasta que se activa.
 */
class Solicitud {
  /**
   * Campos: id, codigoEquipo, descripcionEquipo, salon, edificio, sede, tipo, detalle, datos,
   * claseEnCurso, estado, tecnicoId, creadaPor, creadaEn, programadaPara, activadaEn,
   * asignadaEn, resueltaEn, escaladaEn, motivoEscalacion.
   *
   * Asignación campo por campo a propósito: se crea una entidad por fila en cada consulta de la cola,
   * así que este constructor está en el camino caliente de la prueba de carga. Una versión genérica
   * (copiar valores por defecto y filtrar los undefined) era unas 30 veces más lenta y bajó el punto de quiebre (docs/pruebas.md §4.5, perf/resultados/micro-cola.txt).
   */
  // eslint-disable-next-line complexity -- cada `??` cuenta como rama, pero aquí solo se copian valores por defecto
  constructor(c) {
    this.id = c.id;
    this.codigoEquipo = c.codigoEquipo ?? null;
    this.descripcionEquipo = c.descripcionEquipo ?? null;
    this.salon = c.salon;
    this.edificio = c.edificio;
    this.sede = c.sede;
    this.tipo = c.tipo;
    this.detalle = c.detalle ?? null;
    this.datos = c.datos ?? {};
    this.claseEnCurso = Boolean(c.claseEnCurso);
    this.estado = c.estado ?? EstadoSolicitud.PENDIENTE;
    this.tecnicoId = c.tecnicoId ?? null;
    this.creadaPor = c.creadaPor ?? null;
    this.creadaEn = c.creadaEn;
    this.programadaPara = c.programadaPara ?? null;
    this.activadaEn = c.activadaEn ?? null;
    this.asignadaEn = c.asignadaEn ?? null;
    this.resueltaEn = c.resueltaEn ?? null;
    this.escaladaEn = c.escaladaEn ?? null;
    this.motivoEscalacion = c.motivoEscalacion ?? null;
  }

  estaAbierta() {
    return this.estado !== EstadoSolicitud.RESUELTA;
  }

  estaEnCola() {
    return this.estado === EstadoSolicitud.PENDIENTE;
  }

  estaProgramada() {
    return this.estado === EstadoSolicitud.PROGRAMADA;
  }

  /** Desde cuándo cuenta la espera: una agendada empieza a esperar cuando se activa, no cuando se pidió. */
  inicioEspera() {
    return this.activadaEn ?? this.creadaEn;
  }

  minutosEsperando(ahora) {
    return Math.max(0, Math.floor((ahora - this.inicioEspera()) / 60000));
  }

  /** PROGRAMADA → PENDIENTE: llegó la hora y entra a la cola de prioridades. */
  activar(ahora) {
    if (!this.estaProgramada()) {
      throw new TransicionInvalida(`La solicitud ${this.id} no está programada.`);
    }
    this.estado = EstadoSolicitud.PENDIENTE;
    this.activadaEn = ahora;
  }

  asignarA(tecnicoId, ahora) {
    if (this.estado !== EstadoSolicitud.PENDIENTE && this.estado !== EstadoSolicitud.ESCALADA) {
      throw new TransicionInvalida(`La solicitud ${this.id} no se puede asignar en estado ${this.estado}.`);
    }
    this.tecnicoId = tecnicoId;
    this.estado = EstadoSolicitud.ASIGNADA;
    this.asignadaEn = ahora;
  }

  marcarEnAtencion() {
    if (this.estado !== EstadoSolicitud.ASIGNADA) {
      throw new TransicionInvalida(`La solicitud ${this.id} no está asignada.`);
    }
    this.estado = EstadoSolicitud.EN_ATENCION;
  }

  resolver(ahora) {
    if (this.estado !== EstadoSolicitud.EN_ATENCION) {
      throw new TransicionInvalida(`La solicitud ${this.id} no está en atención.`);
    }
    this.estado = EstadoSolicitud.RESUELTA;
    this.resueltaEn = ahora;
  }

  /** El técnico no respondió o canceló: vuelve a la cola para intentar con otro. */
  liberar() {
    if (this.estado !== EstadoSolicitud.ASIGNADA && this.estado !== EstadoSolicitud.EN_ATENCION) {
      throw new TransicionInvalida(`La solicitud ${this.id} no tiene técnico que liberar.`);
    }
    this.tecnicoId = null;
    this.asignadaEn = null;
    this.estado = EstadoSolicitud.PENDIENTE;
  }

  escalar(ahora = null, motivo = null) {
    this.tecnicoId = null;
    this.estado = EstadoSolicitud.ESCALADA;
    this.escaladaEn = ahora;
    this.motivoEscalacion = motivo;
  }
}

module.exports = { Solicitud };
