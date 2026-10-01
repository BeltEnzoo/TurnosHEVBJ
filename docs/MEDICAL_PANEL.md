# Panel médico

Cuenta individual por profesional. Al login: agenda de hoy, con salto a otras fechas. No ve agendas ajenas.

## Vista del día

Cada fila: hora, código de turno, estado, nombre del paciente (necesario para atender), acciones.

Estados visibles: Confirmado, Llamado, En atención, Atendido, Ausente.

## Acciones (pocos clics)

1. **Llamar paciente** — botón primario grande  
2. Tras llamar: **Volver a llamar**, **Atendido**, **Ausente**  
3. Opcional **Iniciar atención** (IN_PROGRESS)

Confirmación de ausente para evitar taps accidentales. Llamar no pide confirmación (velocidad); el servidor debouncea dobles taps.

## Lo que no hace

Configurar horarios, ver reportes globales, buscar en toda la base de pacientes, exportar.

## Dispositivos

Debe funcionar en notebook del consultorio y tablet. Área táctil grande. No depende de la TV: si la TV está offline, el médico igual llama y el sistema registra.
