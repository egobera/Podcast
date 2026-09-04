# Estudio

Production workspace for serialized audio fiction. The script is the interface: paste it, see
everything the episode needs, fill each gap, hear the whole thing.

---

# Instalación paso a paso

Tiempo estimado: 45 minutos la primera vez. Necesitas cuentas en Supabase, GitHub, Netlify y Monid.

---

## Paso 1. Instalar las herramientas base

Necesitas **Node.js 20 o superior** y **Git**. Comprueba en la terminal:

```bash
node -v
git --version
```

Si `node -v` da error o un número menor que 20, instala Node desde nodejs.org, versión LTS.

---

## Paso 2. Poner el código en tu computadora

Descomprime la carpeta `estudio` donde guardes tus proyectos. Después, en la terminal:

```bash
cd ruta/hasta/estudio
npm install
```

Tarda un par de minutos.

---

## Paso 3. Crear el proyecto en Supabase

1. Entra en supabase.com y crea una cuenta
2. **New project**. Ponle nombre, elige una contraseña de base de datos y guárdala
3. Región: la más cercana a ti
4. Espera dos minutos a que termine de crearse

Cuando esté listo:

5. Menú lateral, **SQL Editor**, **New query**
6. Abre el archivo `supabase/schema.sql` de este proyecto, copia **todo** su contenido y pégalo
7. Pulsa **Run**. Debe decir "Success"
8. Nueva consulta, y repite con `supabase/migration-002-template-and-blocks.sql`
9. Nueva consulta otra vez, y repite con `supabase/migration-003-teams.sql`
10. Otra con `supabase/migration-004-language.sql`
11. Otra con `supabase/migration-005-ensure-team.sql`
12. Otra con `supabase/migration-006-flexible-vault.sql`
13. Otra con `supabase/migration-007-block-triggers.sql`
14. Otra con `supabase/migration-008-suggestions.sql`
15. Otra con `supabase/migration-009-autofill-vault.sql`
16. Otra con `supabase/migration-010-comments.sql`
17. Otra con `supabase/migration-011-mix.sql`
18. Otra con `supabase/migration-012-expected-length.sql`
19. Otra con `supabase/migration-013-direction.sql`
20. Otra con `supabase/migration-014-clear-raw-prompts.sql`
21. Y la última, `supabase/migration-015-clean-pause-assets.sql`

El primero crea las tablas, las reglas de seguridad y el almacén de audio. El segundo añade la
plantilla de episodio, el bloque de congelamiento y los objetivos de duración de 8 minutos. El
tercero convierte todo en multiusuario.

> Todas las migraciones se pueden ejecutar más de una vez sin romper nada. Si una se corta a mitad
> por un error, vuelve a ejecutarla entera desde el principio. La 003 mueve tus series existentes a
> un equipo personal y deja los archivos de audio donde están.

### Recoger las claves

9. Menú lateral, **Project Settings**, **API**
10. Copia estos tres valores, los vas a necesitar:
   - **Project URL**
   - **anon public** key
   - **service_role** key (esta es secreta, nunca la pongas en el navegador)

### Activar el acceso con contraseña

11. **Authentication**, **Providers**, **Email**: comprueba que está activado
12. En ese mismo panel, **desactiva "Confirm email"**

    Con esto entras con correo y contraseña sin que Supabase mande ningún correo. Si lo dejas
    activado, se envía un correo de confirmación al crear la cuenta y hay que abrirlo una vez.
    El plan gratuito limita los envíos a unos pocos por hora, así que desactivarlo evita quedarte
    fuera si creas y borras cuentas mientras pruebas.

13. En **Authentication**, **URL Configuration**, añade `http://localhost:5173` a las URLs
    permitidas. Hace falta solo para el enlace de recuperación de contraseña.

---

## Paso 4. Clave de ElevenLabs

Toda la generación va directa a ElevenLabs: voces, efectos y clonación. Con una clave basta.

1. Entra en elevenlabs.io con tu cuenta
2. Perfil, **API Keys**, **Create API Key**
3. Activa estos permisos, o nada funcionará:
   - **Text to Speech**: Access
   - **Sound Generation**: Access
   - **Voices**: Write, si vas a clonar o diseñar voces
4. Cópiala

Una clave sin el permiso de escritura de voces genera diálogo pero no puede clonar. Es el error
más frecuente al empezar.

---

## Paso 5. Configurar las variables locales

En la carpeta del proyecto, copia el archivo de ejemplo:

```bash
cp .env.example .env
```

Abre `.env` y rellena los valores con lo que copiaste. Las que empiezan por `VITE_` van al
navegador y son públicas; las otras cuatro son secretas y solo las ve el servidor.

**El archivo `.env` nunca se sube a GitHub.** Ya está excluido en `.gitignore`.

---

## Paso 6. Probar en tu computadora

```bash
npm run dev
```

Abre `http://localhost:5173`. Deberías ver la pantalla de acceso. Escribe tu email, te llega un
enlace, y entras.

En local, las funciones de servidor todavía no responden. Para probarlas también:

```bash
npm install -g netlify-cli
netlify dev
```

Eso levanta la web y las funciones a la vez, en el puerto 8888.

---

## Paso 7. Subir a GitHub

```bash
git init
git add .
git commit -m "Primera versión"
```

Después, en github.com, crea un repositorio nuevo **privado**, sin README. Copia los dos comandos
que te muestra y ejecútalos. Serán parecidos a:

```bash
git remote add origin https://github.com/tuusuario/estudio.git
git branch -M main
git push -u origin main
```

---

## Paso 8. Desplegar en Netlify

1. Entra en netlify.com y accede con tu cuenta de GitHub
2. **Add new site**, **Import an existing project**, **GitHub**
3. Elige el repositorio `estudio`
4. La configuración de build ya viene en `netlify.toml`, no toques nada
5. **Deploy**

### Meter las variables

6. Site configuration, **Environment variables**, **Add a variable**, **Import from a .env file**
7. Pega el contenido de tu `.env`
8. **Deploys**, **Trigger deploy**, **Clear cache and deploy site**

### Activar el plan de pago

El botón de "Generate first pass" usa **Background Functions**, que corren hasta 15 minutos y
requieren plan de pago en Netlify. Sin él, la generación de un solo elemento funciona pero la
generación masiva se corta a los 10 segundos.

### Volver a Supabase

9. Copia la URL que te dio Netlify
10. En Supabase, **Authentication**, **URL Configuration**, añádela a las URLs permitidas

---

## Paso 9. Primer uso

1. **Create an account** con tu correo y una contraseña de al menos 8 caracteres. La sesión queda
   guardada en el navegador y se renueva sola, así que no vuelves a escribirla salvo que cierres
   sesión o cambies de dispositivo
2. Crea la serie. Puedes tener varias, cada una con su propia bóveda, sus voces y sus episodios.
   La pantalla de la bóveda te muestra una lista de primeros pasos hasta que la completas
3. **Vault**: sube la sintonía de apertura, la de cierre, las camas y los tres archivos del
   congelamiento. Esto se hace una sola vez para toda la serie
4. **New episode**: crea el primero. Nace con la apertura y el cierre ya colocados, porque están
   marcados para colocación automática en el vault
5. Pega el guion y pulsa **Read script**. La app extrae los personajes, las líneas y los efectos
6. **Characters**: asigna una voz a cada personaje. Para la voz del niño, sube 1 a 3 minutos de
   audio limpio y usa **Clone from audio**
7. Vuelve al episodio y pulsa **Generate first pass**

---

## El guion describe el reparto

Si el guion trae una lista de personajes, la app la lee y rellena la descripción de cada uno. Se
entienden dos formatos, porque son los dos que se escriben de verdad:

```
| NARRADORA | Cálida, cercana, ritmo tranquilo |
- NILO — 8 años, impulsivo, voz clara y rápida
```

Esa descripción viaja al diseñador de voces ya escrita, con los rasgos preseleccionados a partir de
ella. Solo hay que pulsar generar. Todo es editable, y la puerta a clonar sigue abierta al lado.

Los rasgos se deducen del español y se traducen a lo que el modelo entiende: *8 años* pasa a
`child`, *pausada* a `slow and deliberate`, *grave* a `deep`. Una descripción que la app ya rellenó
nunca se sobrescribe al releer el guion, así que si la editas se queda como la dejaste.

## Dos formas de dar voz a un personaje

**Clonar desde audio** copia a una persona real. Reproduce la muestra y no acepta instrucciones:
no puedes pedirle a un clon que suene más mayor, más grave o más calmado. Lo que haya en la
grabación es lo que sale, en todas las temporadas.

**Diseñar una voz** la inventa a partir de una descripción escrita, así que la edad, la
profundidad, la textura y el ritmo son exactamente los que pidas. El panel tiene etiquetas para
construir la descripción, pero el texto se puede editar: una frase concreta escrita por una persona
casi siempre gana a una lista de etiquetas.

Genera tres candidatas, las escuchas, eliges una y queda fijada al personaje con su identificador
permanente.

**Cuál usar.** Una voz diseñada es inventada, así que es tuya sin permiso de nadie. También es
menos consistente que el clon de una persona real. Para los personajes que sostienen un episodio,
una voz grabada sigue ganando. Para la abuela que necesitas más mayor de lo que puedes grabar,
diseñarla es el camino correcto.

## Idioma y acento

Son dos cosas distintas y conviene no confundirlas.

**El idioma** se manda al modelo en cada generación como código ISO 639-1, y determina cómo lee
números, horas y abreviaturas. Sin fijarlo, el modelo lo adivina del texto y a veces se equivoca.

**El acento no es un parámetro que el modelo acepte.** Sale de la voz. Si clonas a alguien con
acento mexicano, todas sus líneas sonarán mexicanas, aunque el guion esté escrito en otro español.
Si clonas a alguien de Madrid, seguirá sonando a Madrid por mucho que el texto diga *tenis* y
*aventar*.

Por eso no existe un código `es-MX`: el modelo solo conoce `es`. La variedad regional sale de dos
sitios que sí controlas, el acento de la voz y el vocabulario del guion.

En Estudio, el idioma y el acento de la serie se fijan en la bóveda. Cada personaje puede tener su
propio acento si el papel lo pide, y la app avisa cuando difiere del de la serie.

**Consecuencia práctica:** graba la muestra de clonación en el mismo idioma y acento en que vas a
publicar. Es una decisión que se arrastra durante todas las temporadas.

## Equipos

Todo pertenece a un equipo, no a una persona. Los miembros de un equipo ven las mismas series, la
misma bóveda y las mismas voces. Nada se duplica.

**Invitar a alguien** es escribir su correo en la pestaña Team y elegir un rol. **Estudio no envía
ningún correo**: la invitación queda guardada y se convierte en acceso real en cuanto esa persona
crea su cuenta o entra con esa dirección. Avísale tú por el canal que uses normalmente.

| Rol | Puede |
|---|---|
| Owner | Gestionar personas y todo lo demás |
| Editor | Crear y modificar cualquier cosa |
| Viewer | Escuchar y leer, sin modificar |

Los roles se aplican en la base de datos, no en la interfaz, así que un viewer no puede escribir ni
aunque manipule la aplicación desde el navegador.

**Sobre el audio ya subido:** los archivos anteriores viven bajo la carpeta de quien los subió, y la
migración no los mueve. En su lugar, la regla de acceso permite leerlos a cualquiera que comparta
equipo con esa persona. Nada se rompe y nada hay que volver a subir.

## La biblioteca

Al entrar aterrizas en **All series**, no dentro de un proyecto. Cada serie es una tarjeta con sus
episodios representados por una **espina de estado**: una barra por episodio, segmentada según el
estado real de sus elementos. Verde lo aprobado, gris lo que espera revisión, ocre lo que falta.

No es decoración. De un vistazo ves que el episodio tres está terminado y el cinco sin empezar, sin
abrir nada.

Arriba, **Pick up where you left off** muestra los tres episodios más avanzados sin terminar,
ordenados por cuánto les queda. Es el atajo que evita navegar por la barra lateral cada vez.

## Cómo escribir un guion para esta app

Cuatro formas de acotación, y cada una hace algo distinto.

**Diálogo con dirección.** La acotación entre paréntesis antes de la línea. Puede llevar la
posición y la interpretación juntas: la posición se ignora, la interpretación se traduce.

```
**NILO:** *(en off, nervioso)* Espérate, espérate, espérate...
**ABUELA:** *(después de un momento, muy despacio)* Ay.
```

**Sonido puntual.** Un sonido por acotación, con su duración. Partir "puerta, pasos y balón" en
tres acotaciones da tres archivos limpios en vez de uno confuso.

```
*(SONIDO · Vidrio que se rompe, seco y corto. 2 seg)*
```

**Ambiente y música.** Se anclan a la escena y no empujan la duración del episodio.

```
*(AMBIENTE · Cocina, mañana de domingo, radio muy bajita)*
*(MÚSICA · Cama de tensión)*
```

**Silencio.** No genera nada: es tiempo real en la línea de tiempo, y todo lo que viene después se
mueve si lo cambias.

```
*(Silencio. 3 segundos.)*
```

## Cómo se dice cada línea

Un guion no dirige cada frase: dirige las que se salen de la norma. En el episodio 1, 37 líneas de
115 traen acotación. Las demás no están sin tono, están en el tono del personaje.

Por eso cada personaje tiene un **tono por defecto**, que sale de la descripción del reparto y se
aplica a toda línea que no traiga acotación propia. La narradora es *cálida, cercana, ritmo
tranquilo* en las 78 líneas donde el guion no dice otra cosa.

La acotación de una línea **sustituye** al tono del personaje, no se suma. Si el guion dice
*gritando*, es gritando, no gritando sobre calma.

Resultado en el episodio 1: 37 líneas con dirección propia, 78 heredadas del personaje, ninguna
leída en plano.

Un guion no solo dice qué se dice, dice cómo. `*(la voz quebrándose)*`, `*(muy despacio)*`,
`*(suspirando)*`. Todo eso se descartaba al leer el guion, y por eso el resultado sonaba plano.

Ahora cada línea guarda su acotación y se traduce a lo que el modelo entiende antes de generar:

| En el guion | Lo que recibe el modelo |
|---|---|
| la voz quebrándose | `[crying]` |
| suspirando | `[sighs]` |
| muy bajito | `[whispers]` |
| recitando de memoria, aburrido | `[bored]` |
| muy despacio, sin prisa | pausas de 0,7 seg entre frases |

Las acotaciones de posición, como *desde la cocina* o *en off*, no generan nada. Son indicaciones
de puesta en escena, no de interpretación, y etiquetarlas sería inventar.

En el inspector puedes editar la acotación de cualquier línea, con atajos para las más comunes, y
debajo se ve exactamente qué se le está diciendo al modelo. Como máximo tres etiquetas por línea:
más, y la interpretación se convierte en una caricatura.

De tu episodio 1, 37 líneas traen acotación y 19 producen instrucción para el modelo.

## Escuchar

Se escucha **antes** de aprobar, no después. La reproducción usa la toma aprobada si la hay y la más
reciente si no, así que un episodio recién generado suena entero desde el primer momento. Aprobar es
lo que se hace después de oírlo, no el requisito para oírlo.

Todos los botones de reproducción son también de pausa, y solo suena una cosa a la vez. Generar
detiene lo que estuviera sonando: dos audios encimados mientras se reemplaza una toma no ayudan a
nadie.

## Si el episodio suena sin sintonía

Las sintonías se colocan cuando se **crea** el episodio. Un episodio creado antes de llenar la
bóveda nunca las recibió. El panel derecho lo detecta y ofrece colocarlas, sin recrear nada. el episodio

Pulsa **espacio** en cualquier momento, o el botón de reproducción de la barra inferior. La app
descarga todo lo aprobado, lo coloca en su minuto y lo reproduce como lo va a oír el oyente.

Los niveles no se ajustan a mano. Salen del papel de cada elemento: voz, ambiente, efecto puntual,
impacto, cama musical o sintonía. Y las camas y ambientes **bajan solos** cuando alguien habla, con
una rampa de 0,18 segundos, y vuelven a subir en los silencios. Eso es la diferencia más grande
entre una mezcla que suena amateur y una que suena producida.

La barra inferior es navegable: haz clic en cualquier punto para saltar ahí.

## Exportar

El botón **Export** abre un control de calidad antes de sacar nada. Avisa de elementos sin aprobar,
de duración fuera del objetivo, de líneas solapadas y de camas musicales mal ancladas. Los avisos
graves se marcan aparte, pero nunca te bloquean: puedes exportar igual.

Lo que produce:

| Archivo | Para qué |
|---|---|
| Mezcla WAV | El episodio completo, normalizado al objetivo del proyecto |
| Tres stems | Voz, música y efectos por separado |
| Proyecto `.rpp` | Se abre en Reaper con cada clip en su pista y en su minuto |
| Hoja de cues | Texto plano con tiempos, carril, nivel y archivo, por si no usas Reaper |

El renderizado ocurre en la pestaña con OfflineAudioContext, más rápido que en tiempo real y con
precisión de sample. La mezcla que sale es exactamente la que oíste en el reproductor.

La normalización mide la sonoridad integrada y aplica una ganancia para llegar al objetivo, con
techo duro sin compresión. Este material vive del rango dinámico.

## El panel inferior

Es la vista de conjunto, y funciona como la de cualquier estación de audio.

**Regla de tiempo** con marcas que se adaptan a la duración del episodio, y **formas de onda reales**
dibujadas a partir del audio decodificado. Los clips que todavía no tienen audio aprobado aparecen
translúcidos, así que de un vistazo ves dónde están los huecos.

**Arrastra en cualquier parte de los carriles** para navegar. Al soltar sobre un clip, la línea
correspondiente del guion se selecciona y se centra en pantalla. Funciona en las dos direcciones:
lo que eliges arriba se resalta abajo.

**M y S en cada carril.** Silencio y solo, como en una mesa de mezclas. Solo la voz es la forma
rápida de comprobar si se entiende todo; silenciar la música te dice si un efecto está tapado.

**Monitorización.** El interruptor *Phone speaker* filtra la mezcla para imitar el altavoz de un
teléfono: corta por debajo de 420 Hz y por encima de 4,2 kHz, y realza la presencia. Es el
escenario real en el que se va a escuchar la mayor parte de este contenido, y una mezcla que solo
funciona con buenos auriculares es una mezcla sin comprobar.

| Tecla | Acción |
|---|---|
| `espacio` | Reproducir o pausar |
| `shift` + `←` `→` | Saltar al elemento anterior o siguiente |

## El panel derecho

El detalle de cada elemento vive en una columna fija a la derecha, no dentro de la lista. Recorres
las líneas con las flechas y el panel cambia sin que el guion se mueva ni pierdas el sitio.

Cuando no hay nada seleccionado, ese espacio muestra el estado del episodio: duración frente al
objetivo, cuánto está aprobado, de qué está hecho el episodio (líneas, sonido, música) y los avisos
del control de calidad en vivo, sin esperar a exportar.

Por debajo de 1180 píxeles de ancho el panel pasa a colocarse bajo el guion.

## Revisar con el teclado

Aprobar 160 elementos con el ratón no es un flujo de trabajo. Los atajos aparecen al final de cada
episodio:

| Tecla | Acción |
|---|---|
| `espacio` | Reproducir o pausar el episodio |
| `↑` `↓` | Moverse entre líneas |
| `enter` | Abrir la línea |
| `a` | Aprobar la toma más reciente |
| `g` | Pedir otra toma |
| `n` | Saltar al siguiente hueco |

**Aprobar avanza solo.** Cuando pulsas `a`, la app aprueba y salta al siguiente elemento que
todavía necesita atención, saltándose lo que ya está listo. Con el filtro en **Review** puedes
recorrer un episodio entero sin tocar el ratón.

Arriba hay un filtro segmentado con el recuento de cada estado: todo, lo que falta, lo que espera
revisión y lo aprobado.

## La bóveda se llena sola

No hay que darla de alta a mano. Al leer un guion pasan tres cosas:

**Se conecta lo que ya existe.** Si el guion pide un timbre y la bóveda ya tiene uno con audio, ese
elemento queda resuelto sin generar nada. Es el motivo entero de que la bóveda exista: el timbre se
hace una vez y sirve para las cinco temporadas.

**Se añade lo que se repite.** Cualquier sonido que el guion pida más de una vez entra en la bóveda
como entrada vacía, esperando audio.

**Se ofrece el resto en un clic.** Los que aparecen una sola vez no se añaden solos, porque una
mención no demuestra que algo se repita y una bóveda llena de sonidos únicos es una bóveda peor.
Aparecen agrupados bajo el guion con un botón para meterlos todos.

Las entradas creadas así llevan la etiqueta *script* y muestran cuántas veces se usan. Se pueden
renombrar, describir o borrar, y no vuelven a aparecer.

## La bóveda la define cada serie

No hay una lista fija de sonidos. Añades lo que se repita en tus episodios y le pones el nombre que
quieras: una sintonía, una cama, una cortinilla, el timbre que suena cada semana. Cada uno lleva una
descripción y se puede marcar para que se coloque solo al principio o al final de cada episodio.

**Los bloques** son formas que se repiten dentro de un episodio: algo lo abre, algo se repite
debajo mientras dura el momento, y algo lo cierra. Defines uno en la bóveda y luego puedes envolver
cualquier línea de cualquier guion con él. Un congelamiento del tiempo, un flashback, un sueño.

Las repeticiones no tienen posición propia: se reparten a lo largo de la línea que cubren y se
recalculan cuando esa línea cambia de duración.

## Bloques que se insertan solos

Un bloque puede declarar qué lo dispara, y entonces se coloca al leer el guion sin que tengas que
insertarlo línea por línea.

**Por marcador.** Escribe `[[Freeze]]` en una línea suelta y el bloque envuelve la línea siguiente.
Añade `[[/Freeze]]` más abajo y envuelve todo lo que hay entre las dos. El marcador se configura por
bloque, así que puedes llamarlo como quieras.

**Por acotación.** Para guiones ya escritos, el bloque puede reconocer una acotación existente.
Defines la palabra que lo abre y la que lo cierra, por ejemplo *chasquido* y *golpe de aire*, y los
detecta sin tocar el guion.

**La distinción que importa:** los bloques colocados automáticamente quedan marcados como tales.
Al volver a leer un guion editado se rehacen desde cero, mientras que los que insertaste a mano
sobreviven intactos. Sin esa distinción, al segundo cambio de guion tendrías bloques duplicados.

## Detección de patrones

La app mira los guiones y propone. Nunca cambia nada por su cuenta: un falso positivo que
reescribiera la bóveda costaría más que teclear un marcador a mano.

**Capa de episodio.** Al leer un guion, busca acotaciones que se repiten tres o más veces, y pares
que se abren y se cierran con diálogo en medio. Ese par es la forma de un bloque, aunque el bloque
todavía no exista.

**Capa de serie.** En la bóveda, cuando ya hay dos episodios o más, mira todos a la vez. Algo que
aparece una vez por episodio durante seis episodios es claramente recurrente aunque ningún guion lo
repita. Esta capa exige aparecer en al menos dos episodios.

Aceptar una sugerencia de sonido crea la entrada en la bóveda. Aceptar una de bloque crea el bloque
con las palabras de apertura y cierre ya rellenas, así que a partir de ahí se coloca solo.

Lo que descartas se recuerda y no vuelve a proponerse.

**Un detalle:** las indicaciones de tiempo puras, como *Pausa.* o *Silencio.*, se ignoran. Le dicen
al actor cuánto esperar, no son sonidos. Pero una acotación que solo las contiene en parte, como
*CHASQUIDO. SILENCIO TOTAL.*, sí cuenta.

## Recortar el audio

La música generada casi nunca sale con la duración que necesitas. Cualquier archivo de la bóveda
tiene un botón **Trim**: ves la forma de onda, arrastras los dos extremos, escuchas la selección y
guardas.

Guarda una copia recortada y apunta el asset a ella. El original se queda donde estaba, así que
siempre puedes volver. La opción de fundir los extremos aplica 25 milisegundos de entrada y salida,
suficiente para que un bucle no haga clic e imperceptible al oído.

## Cómo funcionan la plantilla y el congelamiento

**La plantilla de episodio.** Los assets del vault marcados como apertura o cierre se colocan solos
en cada episodio nuevo, ya aprobados, porque el audio existe. Un episodio nunca nace vacío.

**El bloque de congelamiento.** Selecciona la línea del monólogo dentro del tiempo detenido y pulsa
**Wrap in a freeze**. Se crea la entrada antes, el regreso después, y diez pulsos que se reparten a
lo largo de esa línea. Los pulsos no tienen posición fija: se recalculan cada vez que la línea
cambia de duración, así que el reparto sigue el ritmo del actor y no un reloj. El décimo siempre cae
justo antes del regreso.

Necesita los tres archivos maestros en el vault. Hasta entonces el botón está desactivado y la app
te dice por qué.

**Volver a leer el guion no destruye nada.** Reemplaza solo lo que vino del guion. Las sintonías de
plantilla y los bloques insertados se quedan intactos, y las tomas aprobadas cuya línea no cambió
conservan su audio. La app te dice cuántas se conservaron y cuántas necesitan toma nueva.

---

## Lo que la app no hace, a propósito

Aparece explicado dentro de la propia interfaz, en el sitio donde hace falta, con los pasos para
hacerlo a mano:

- **Reverb invertida.** Se fabrica en Audacity en dos minutos. Las instrucciones están en el Vault
- **Montaje del congelamiento.** Tres archivos maestros que se construyen una vez
- **Corte de silencio dentro de la sintonía.** Se hace en cualquier editor
- **Edición fina en milisegundos.** Se exporta a un DAW y se trabaja ahí
- **Masterización.** La app normaliza al objetivo del proyecto y nada más

Estudio coloca y organiza. No talla. Esa frontera es una decisión, no una carencia.

---

## Instalarla como aplicación

La app trae manifiesto e iconos, así que se puede sacar del navegador y tenerla como una ventana
propia, sin barra de direcciones ni pestañas.

**En Mac con Chrome o Edge:** abre la app, menú de los tres puntos, **Guardar y compartir**,
**Instalar página como aplicación**. Aparece en el Launchpad y puedes anclarla al Dock.

**En Mac con Safari:** menú **Archivo**, **Añadir al Dock**.

**En Windows con Chrome o Edge:** el icono de instalar aparece a la derecha de la barra de
direcciones.

**En iPhone o iPad:** compartir, **Añadir a pantalla de inicio**.

El icono es una onda de audio que se detiene: diez barras que suben y bajan, y donde debería estar
la última hay un hueco. Solo son barras verticales, así que se sigue leyendo a 16 píxeles en el Dock.

## Notas en una línea

Cualquiera del equipo puede dejar una nota sobre una línea concreta, y es **lo único que un viewer
puede escribir**. Un revisor que solo escucha no sirve de nada si no tiene forma de decir que la
línea 47 va demasiado rápida.

Las líneas con notas abiertas llevan un contador junto al timecode, así que se localizan sin
buscar. Las notas se marcan como resueltas en vez de borrarse, y quedan ocultas hasta que pides
verlas. Solo su autor puede borrar la suya.

`Cmd + Enter` guarda la nota sin soltar el teclado.

## Movimiento

El movimiento aparece solo donde explica algo, y siempre con la misma curva y duraciones cortas.
`prefers-reduced-motion` se respeta en todas partes, incluidas las animaciones hechas en
JavaScript.

**El ripple se ve viajar.** Al aprobar una toma más larga, los clips posteriores se deslizan a su
nueva posición en un tercio de segundo en lugar de saltar. Saltando, el ojo no entiende qué pasó;
deslizándose, ves recorrer el episodio al desplazamiento que acabas de provocar.

**El cursor de reproducción no pasa por React.** Se escribe directo al DOM con `transform`, sesenta
veces por segundo. Si pasara por el estado, cada fotograma repintaría la línea de tiempo y las
ciento y pico filas del guion, y una línea suave se convertiría en una línea a saltos. El contador
numérico, que no lo necesita, se actualiza diez veces por segundo.

**Navegar con el teclado no pelea con el scroll.** Manteniendo pulsada una flecha, los
desplazamientos suaves se encolan más rápido de lo que pueden terminar y la página se queda medio
pantallazo por detrás del cursor. Por debajo de un cuarto de segundo entre movimientos, salta en
lugar de deslizarse.

**Las filas recién añadidas se marcan.** Insertar un bloque añade trece elementos de golpe. Se
tiñen un segundo y medio y sueltan el color, lo justo para encontrarlas sin que se convierta en
decoración.

## Cómo escribir un guion para esta app

Cuatro formas de acotación, y cada una hace algo distinto.

**Diálogo con dirección.** La acotación entre paréntesis antes de la línea. Puede llevar la
posición y la interpretación juntas: la posición se ignora, la interpretación se traduce.

```
**NILO:** *(en off, nervioso)* Espérate, espérate, espérate...
**ABUELA:** *(después de un momento, muy despacio)* Ay.
```

**Sonido puntual.** Un sonido por acotación, con su duración. Partir "puerta, pasos y balón" en
tres acotaciones da tres archivos limpios en vez de uno confuso.

```
*(SONIDO · Vidrio que se rompe, seco y corto. 2 seg)*
```

**Ambiente y música.** Se anclan a la escena y no empujan la duración del episodio.

```
*(AMBIENTE · Cocina, mañana de domingo, radio muy bajita)*
*(MÚSICA · Cama de tensión)*
```

**Silencio.** No genera nada: es tiempo real en la línea de tiempo, y todo lo que viene después se
mueve si lo cambias.

```
*(Silencio. 3 segundos.)*
```

## Cómo se dice cada línea

Un guion no dirige cada frase: dirige las que se salen de la norma. En el episodio 1, 37 líneas de
115 traen acotación. Las demás no están sin tono, están en el tono del personaje.

Por eso cada personaje tiene un **tono por defecto**, que sale de la descripción del reparto y se
aplica a toda línea que no traiga acotación propia. La narradora es *cálida, cercana, ritmo
tranquilo* en las 78 líneas donde el guion no dice otra cosa.

La acotación de una línea **sustituye** al tono del personaje, no se suma. Si el guion dice
*gritando*, es gritando, no gritando sobre calma.

Resultado en el episodio 1: 37 líneas con dirección propia, 78 heredadas del personaje, ninguna
leída en plano.

Un guion no solo dice qué se dice, dice cómo. `*(la voz quebrándose)*`, `*(muy despacio)*`,
`*(suspirando)*`. Todo eso se descartaba al leer el guion, y por eso el resultado sonaba plano.

Ahora cada línea guarda su acotación y se traduce a lo que el modelo entiende antes de generar:

| En el guion | Lo que recibe el modelo |
|---|---|
| la voz quebrándose | `[crying]` |
| suspirando | `[sighs]` |
| muy bajito | `[whispers]` |
| recitando de memoria, aburrido | `[bored]` |
| muy despacio, sin prisa | pausas de 0,7 seg entre frases |

Las acotaciones de posición, como *desde la cocina* o *en off*, no generan nada. Son indicaciones
de puesta en escena, no de interpretación, y etiquetarlas sería inventar.

En el inspector puedes editar la acotación de cualquier línea, con atajos para las más comunes, y
debajo se ve exactamente qué se le está diciendo al modelo. Como máximo tres etiquetas por línea:
más, y la interpretación se convierte en una caricatura.

De tu episodio 1, 37 líneas traen acotación y 19 producen instrucción para el modelo.

## Escuchar

Se escucha **antes** de aprobar, no después. La reproducción usa la toma aprobada si la hay y la más
reciente si no, así que un episodio recién generado suena entero desde el primer momento. Aprobar es
lo que se hace después de oírlo, no el requisito para oírlo.

Todos los botones de reproducción son también de pausa, y solo suena una cosa a la vez. Generar
detiene lo que estuviera sonando: dos audios encimados mientras se reemplaza una toma no ayudan a
nadie.

## Si el episodio suena sin sintonía

Las sintonías se colocan cuando se **crea** el episodio. Un episodio creado antes de llenar la
bóveda nunca las recibió. El panel derecho lo detecta y ofrece colocarlas, sin recrear nada.

Todos los botones de reproducción son también de pausa, y solo suena una cosa a la vez. Pulsar en
otro sitio detiene lo anterior en lugar de encimarlo.

## Los prompts de sonido se construyen, no se copian

El generador de efectos responde a sustantivos concretos en inglés. Mandarle la acotación tal cual
era el error: *"AMBIENTE · Cocina de domingo. Radio muy bajita y alguien picando sobre una tabla. En
bucle hasta que salen al balón"* son tres cosas a la vez, una etiqueta, una descripción y una
instrucción de montaje, y el modelo intenta sonorizar las tres.

Ahora la acotación se convierte en prompt en tres pasos: se quita la etiqueta, se corta todo lo que
es instrucción al editor (*en bucle*, *hasta que*, *sustituye a*, *20 dB*), y se recogen los
conceptos que se reconocen, en inglés. Lo que no se reconoce se descarta.

```
Cocina de domingo. Radio muy bajita y alguien picando sobre una tabla. En bucle…
  ↓
a quiet kitchen, a distant muffled radio, someone chopping vegetables on a board,
a still sunday morning. continuous background room tone, no music, no speech.
```

Traducir palabra por palabra se probó primero y salía espanglish, que el modelo entiende peor que
cualquiera de los dos idiomas. Por eso se reconocen conceptos enteros y se tira el resto.

Los ambientes piden sala y doce segundos; los golpes puntuales piden estar secos, cerca del
micrófono y sin cola de reverb. Si una acotación no se reconoce, el prompt sale tal cual y el
inspector te avisa de que hay que reescribirlo a mano.

## Qué sigue haciendo falta y qué no

La bóveda cuenta en cuántos episodios se usa cada sonido, y lo cuenta **en vivo** cada vez que se
abre. Antes había un contador guardado que solo sumaba, así que al borrar un episodio todo lo que
ese episodio había introducido seguía pareciendo igual de necesario.

Cuando un sonido deja de aparecer en cualquier episodio, la bóveda lo marca y ofrece borrar todos
los que estén en esa situación de una vez. Los personajes hacen lo mismo: si ya no tienen líneas en
ningún episodio, se avisa.

Las sintonías quedan fuera de esa cuenta a propósito. Las coloca la plantilla, no las pide un
guion, así que una serie entre episodios se ofrecería a borrar su propia sintonía.

Al borrar un episodio, el aviso dice cuántos sonidos se quedaron sin uso.

## Duraciones

Cada entrada de la bóveda dice cuánto debería durar, en un campo editable, y muestra al lado lo que
dura de verdad el audio que subiste.

Los valores de partida: apertura 15 seg, cierre 30 seg, camas 2 min, efectos 3 seg, entrada del
bloque 4 seg, pulso 0,7 seg, regreso 1 seg. Se cambian escribiendo encima.

## Generar sonidos sin salir de la app

Los efectos se generan desde la bóveda con el botón **Generate**: usa el nombre y la descripción de
la entrada como prompt y la duración que pide el guion. **Again** genera otra versión.

La música sigue viniendo de fuera, porque ElevenLabs no la hace. Ahí el flujo es generar en Suno,
subir y recortar.

## Cuando el audio no dura lo que pide el guion

Si una indicación dice *4 segundos*, *15 seg* o *1:30*, ese número se guarda junto al asset. Al
subir el audio, la bóveda compara y avisa si no cuadra, con un acceso directo a recortarlo.

Es el caso constante con música generada: pides quince segundos de sintonía y Suno devuelve un
minuto. Tolera hasta un 20% de diferencia antes de decir nada, porque una cama de dos minutos no
tiene que durar exactamente dos minutos.

## Mezclar desde el panel inferior

Cada carril lleva su propio fader, con el nivel en decibelios al lado. Se guarda en el episodio, así
que un ambiente que quedó alto se corrige una vez y queda corregido.

Al seleccionar un clip, la barra superior del panel muestra su nombre, su nivel y dos botones para
subirlo o bajarlo de decibelio en decibelio, más un acceso directo a **Trim**. Ese recorte guarda
una toma nueva y la aprueba, así que el original sigue en la lista de tomas por si te arrepientes.

El nivel de un clip se suma al de su papel. Un efecto puntual está 8 dB bajo la voz por defecto; si
le pones +3, queda a −5.

## Tests

```bash
npm test          # ejecuta la batería
npm run test:watch
npm run typecheck # incluye los tests, que el build excluye
```

Hay 37 tests sobre las tres piezas donde han aparecido todos los fallos reales de este proyecto:
el parser de guiones, el motor de posicionamiento y la detección de patrones.

Cada uno cubre un error que ocurrió de verdad. Por ejemplo, que las acotaciones se colaran en el
texto hablado, o que el cierre de un congelamiento se emparejara con la apertura del siguiente
creando un bloque fantasma. Escribiendo esta batería aparecieron dos fallos más que estaban en el
código: las etiquetas `<break>` contaban como palabras al estimar la duración, y ese emparejamiento
cruzado entre bloques consecutivos.

## Cómo escribir la música y los ambientes en el guion

Etiqueta cada indicación y la app la clasifica bien sin adivinar:

```
*(MÚSICA · Cama de tensión. Entra a 5:35 en bucle, 20 dB bajo la voz. Sigue hasta 8:30.)*
*(AMBIENTE · Cocina de domingo. Entra a 0:45 y se mantiene hasta 2:00.)*
*(AMBIENTE · Ninguno. Esta escena va seca a propósito.)*
```

La etiqueta manda sobre el contenido, así que un ambiente que menciona una cama musical de pasada
sigue siendo un ambiente. Y una que dice *Ninguno* no crea ningún elemento: es una nota para quien
produce.

Música y ambientes se anclan a la escena, no a la línea, así que no empujan la duración del
episodio. Solo la voz y los efectos puntuales lo hacen.

## Problemas frecuentes

**"Missing VITE_SUPABASE_URL"**
El archivo `.env` no existe o no tiene los valores. Recuerda reiniciar `npm run dev` después de
editarlo.

**"new row violates row-level security policy for table ..."**
Una migración se quedó a medias: la tabla tiene la seguridad activada pero le faltan políticas.
Vuelve a ejecutar el archivo entero desde el principio. Están escritas para poder repetirse.

**"policy ... already exists" al ejecutar una migración**
Versión antigua del archivo. Usa la del paquete actual, que borra cada política antes de crearla.

**"Monid ... failed: 404"**
Ya no existe: toda la generación va directa a ElevenLabs. Actualiza el código y borra
`MONID_API_KEY` de las variables si quieres.

**La tanda se quedaba en 0 sin avanzar**
Corregido, y era un error de diseño. La tanda se enviaba a una función de fondo escrita para
responder de inmediato y terminar el trabajo después, pero el entorno congela una función en cuanto
responde, así que el trabajo nunca ocurría. Ahora la tanda corre desde el navegador, dos elementos
a la vez, con progreso real y un botón para pararla. Ya no hace falta plan de pago en Netlify.

**"Failed to execute 'json' on 'Response'" al generar la tanda**
Corregido. Una función de fondo de Netlify responde 202 con el cuerpo vacío, y el cliente intentaba
leerlo como JSON.

**"missing the permission voices_write"**
Tu clave de ElevenLabs no puede crear voces. En ElevenLabs, perfil, API Keys, crea una nueva con el
permiso **Voices: Write** activado y sustituye `ELEVENLABS_API_KEY`.

**"this prompt potentially doesn't follow our safety guidelines"**
ElevenLabs bloquea diseñar voces que suenen a menores. Una voz infantil tiene que venir de la
biblioteca de voces o de la clonación de un niño real con consentimiento por escrito.

**La bóveda se llenó de entradas llamadas "Silencio. 1 segundo"**
Corregido. Las pausas se contaban como sonidos al rellenar la bóveda. La migración 015 borra las
que se crearon, y solo toca entradas automáticas y sin audio, así que nada de lo que subiste corre
peligro.

**"Añadidos a la bóveda" pero no aparece ninguno**
Corregido. El alta en bloque no comprobaba si había fallado y devolvía el número de intentos, no el
de creados. Un solo duplicado tiraba el lote entero y aun así decía que todo había ido bien.

**Los efectos suenan a alguien leyendo la acotación en voz alta**
Corregido, y tenía dos causas. La bóveda pegaba el nombre en español delante del prompt en inglés, y
un prompt guardado por una versión antigua tenía prioridad sobre el construido. El generador lee en
voz alta cualquier prompt que parezca una frase que alguien diría.

Ahora todo prompt construido termina diciendo *no voice, no narration, no words*, y cualquier prompt
guardado que no lleve esa firma se ignora y se reconstruye. La migración 014 limpia los que ya
estaban en la base de datos.

**No puedo crear una serie y no pasa nada al pulsar**
Casi siempre es que falta ejecutar `migration-003-teams.sql`. Sin ella no existe el equipo al que
pertenece la serie. La app ahora te lo dice en pantalla en vez de fallar en silencio.

**"That email and password do not match an account"**
Si acabas de registrarte y "Confirm email" sigue activado en Supabase, la cuenta existe pero está
sin confirmar. O desactivas esa opción, o abres el correo de confirmación una vez.

**El correo de recuperación no llega**
Revisa spam, y comprueba que la URL desde la que entras está en Supabase, Authentication, URL
Configuration. El plan gratuito limita los envíos por hora.

**"Not signed in" al generar**
La sesión caducó. Recarga la página.

**La generación masiva se corta**
Background Functions requiere plan de pago en Netlify.

**"This character has no voice set yet"**
Ve a Characters y asigna un voice_id, o clónalo desde audio.
